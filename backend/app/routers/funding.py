"""Sponsor portal funding campaigns, PayPal Sandbox Orders API v2, and Payouts API v1 endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.auth import get_current_user, require_roles
from app.database import db_manager, get_db
from app.models.schemas import (
    FundingPlanUpdateRequest,
    PayPalOrderCaptureRequest,
    PayPalOrderCreateRequest,
    PayPalPayoutRequest,
    UserRole,
)
from app.services.paypal_service import paypal_service

router = APIRouter(prefix="/api/funding", tags=["Funding & PayPal Sandbox"])


@router.get("/campaigns")
async def list_funding_campaigns(
    status_filter: str | None = None,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    db = get_db()
    query: Dict[str, Any] = {}
    if status_filter:
        query["status"] = status_filter
    if current_user["role"] == UserRole.ORGANIZATION.value:
        query["organization_id"] = current_user["id"]

    docs = await db["funding_campaigns"].find(query).sort("created_at", -1).to_list(length=300)
    cleaned = [{k: v for k, v in d.items() if k != "_id"} for d in docs]
    return {"items": cleaned, "total": len(cleaned)}


@router.patch("/campaigns/{campaign_id}/plan")
async def update_funding_plan(
    campaign_id: str,
    payload: FundingPlanUpdateRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ORGANIZATION, UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    camp = await db["funding_campaigns"].find_one({"id": campaign_id})
    if not camp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Funding campaign not found.")
    if current_user["role"] == UserRole.ORGANIZATION.value and camp["organization_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this campaign.")

    required = float(camp["required_amount_usd"])
    if payload.funding_mode.value == "self_funded":
        self_amt = required
        sponsor_target = 0.0
    elif payload.funding_mode.value == "sponsor_funded":
        self_amt = 0.0
        sponsor_target = required
    else:
        self_amt = round(min(required, payload.self_funded_amount_usd if payload.self_funded_amount_usd is not None else required * 0.4), 2)
        sponsor_target = round(max(0.0, required - self_amt), 2)

    now = datetime.now(timezone.utc)
    new_funded = max(float(camp.get("funded_amount_usd", 0.0)), self_amt)
    new_status = "funded" if new_funded >= required - 0.01 else "open"

    await db["funding_campaigns"].update_one(
        {"id": campaign_id},
        {
            "$set": {
                "funding_mode": payload.funding_mode.value,
                "self_funded_committed_usd": self_amt,
                "sponsor_target_usd": sponsor_target,
                "funded_amount_usd": round(new_funded, 2),
                "status": new_status,
                "updated_at": now,
            }
        },
    )
    if new_status == "funded":
        await db["deliveries"].update_many(
            {"allocation_id": camp["allocation_id"], "status": "pending_funding"},
            {"$set": {"status": "ready_for_dispatch", "updated_at": now}},
        )
    await db_manager.maybe_persist()
    updated = await db["funding_campaigns"].find_one({"id": campaign_id})
    return {"campaign": {k: v for k, v in (updated or {}).items() if k != "_id"}}


@router.post("/paypal/orders")
async def create_paypal_order(
    payload: PayPalOrderCreateRequest,
    request: Request,
    current_user: Dict[str, Any] = Depends(
        require_roles(UserRole.SPONSOR, UserRole.ORGANIZATION, UserRole.ADMIN)
    ),
) -> Dict[str, Any]:
    """Creates a PayPal Sandbox Order (Orders API v2) for sponsor or organization transport funding."""
    db = get_db()
    camp = await db["funding_campaigns"].find_one({"id": payload.campaign_id})
    if not camp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Funding campaign not found.")
    if camp["status"] in {"cancelled", "funded"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Campaign is already '{camp['status']}' and cannot accept additional PayPal contributions.",
        )

    remaining_needed = round(max(0.0, float(camp["required_amount_usd"]) - float(camp.get("funded_amount_usd", 0.0))), 2)
    if payload.amount_usd > remaining_needed + 0.01:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Contribution ${payload.amount_usd:.2f} exceeds remaining funding gap ${remaining_needed:.2f}.",
        )

    origin = request.headers.get("origin") or "http://localhost:3000"
    return_url = payload.return_url or f"{origin}/dashboard/sponsor?paypal_status=approved&campaign_id={camp['id']}"
    cancel_url = payload.cancel_url or f"{origin}/dashboard/sponsor?paypal_status=cancelled&campaign_id={camp['id']}"

    order = await paypal_service.create_order(
        campaign_id=camp["id"],
        amount_usd=payload.amount_usd,
        description=camp["title"],
        return_url=return_url,
        cancel_url=cancel_url,
    )

    now = datetime.now(timezone.utc)
    await db["transactions"].insert_one(
        {
            "id": f"txn-{uuid.uuid4().hex[:10]}",
            "campaign_id": camp["id"],
            "allocation_id": camp["allocation_id"],
            "type": "paypal_order_created",
            "payer_id": current_user["id"],
            "payer_name": current_user["organization_name"],
            "amount_usd": round(payload.amount_usd, 2),
            "currency": "USD",
            "payment_mode": "paypal_sandbox",
            "paypal_order_id": order["order_id"],
            "paypal_capture_id": None,
            "contributor_note": payload.contributor_note,
            "status": order["status"],
            "is_demo_seed": False,
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()
    return order


@router.post("/paypal/orders/capture")
async def capture_paypal_order(
    payload: PayPalOrderCaptureRequest,
    current_user: Dict[str, Any] = Depends(
        require_roles(UserRole.SPONSOR, UserRole.ORGANIZATION, UserRole.ADMIN)
    ),
) -> Dict[str, Any]:
    """Captures an approved PayPal Sandbox Order and updates campaign & dispatch status."""
    db = get_db()
    camp = await db["funding_campaigns"].find_one({"id": payload.campaign_id})
    if not camp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Funding campaign not found.")

    existing_capture = await db["transactions"].find_one(
        {"paypal_order_id": payload.order_id, "type": "sponsor_contribution", "status": "COMPLETED"}
    )
    if existing_capture:
        return {
            "already_captured": True,
            "transaction": {k: v for k, v in existing_capture.items() if k != "_id"},
            "campaign": {k: v for k, v in camp.items() if k != "_id"},
        }

    capture = await paypal_service.capture_order(order_id=payload.order_id)
    if capture.get("status") != "COMPLETED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"PayPal order {payload.order_id} is not completed (status={capture.get('status')}). Approve the order in PayPal Sandbox first.",
        )

    amount_usd = float(capture["amount_usd"])
    now = datetime.now(timezone.utc)
    txn_doc = {
        "id": f"txn-{uuid.uuid4().hex[:10]}",
        "campaign_id": camp["id"],
        "allocation_id": camp["allocation_id"],
        "type": "sponsor_contribution",
        "payer_id": current_user["id"],
        "payer_name": current_user["organization_name"],
        "payer_email": capture.get("payer_email"),
        "amount_usd": round(amount_usd, 2),
        "currency": capture.get("currency", "USD"),
        "payment_mode": "paypal_sandbox",
        "paypal_order_id": capture["order_id"],
        "paypal_capture_id": capture["capture_id"],
        "status": "COMPLETED",
        "is_demo_seed": False,
        "created_at": now,
    }
    await db["transactions"].insert_one(dict(txn_doc))

    new_funded = round(float(camp.get("funded_amount_usd", 0.0)) + amount_usd, 2)
    camp_status = "funded" if new_funded >= float(camp["required_amount_usd"]) - 0.01 else "open"
    await db["funding_campaigns"].update_one(
        {"id": camp["id"]},
        {"$set": {"funded_amount_usd": new_funded, "status": camp_status, "updated_at": now}},
    )

    if camp_status == "funded":
        await db["deliveries"].update_many(
            {"allocation_id": camp["allocation_id"], "status": "pending_funding"},
            {"$set": {"status": "ready_for_dispatch", "updated_at": now}},
        )
        await db["allocations"].update_one(
            {"id": camp["allocation_id"], "status": "accepted"},
            {"$set": {"status": "confirmed", "updated_at": now}},
        )

    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": "paypal_order_captured",
            "target_id": camp["id"],
            "details": f"Captured ${amount_usd:.2f} via PayPal Sandbox Order {capture['order_id']}.",
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()

    updated_camp = await db["funding_campaigns"].find_one({"id": camp["id"]})
    return {
        "capture": capture,
        "transaction": {k: v for k, v in txn_doc.items() if k != "_id"},
        "campaign": {k: v for k, v in (updated_camp or {}).items() if k != "_id"},
    }


@router.post("/paypal/payouts")
async def trigger_delivery_partner_payout(
    payload: PayPalPayoutRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
) -> Dict[str, Any]:
    """Executes PayPal Sandbox Payouts API v1 for an eligible, completed delivery (Admin approval required)."""
    db = get_db()
    delivery = await db["deliveries"].find_one({"id": payload.delivery_id})
    if not delivery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery not found.")

    if delivery["status"] != "delivered" or not delivery.get("payout_eligible", False):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Delivery must be DELIVERED with confirmed recipient handoff before payout eligibility.",
        )

    if delivery.get("payout_status") in {"submitted", "SUCCESS", "PENDING"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Payout already initiated for this delivery (status={delivery.get('payout_status')}).",
        )

    # Check if a pending financial approval gate blocks payout
    pending_fin_gate = await db["approval_requests"].find_one(
        {
            "allocation_id": delivery["allocation_id"],
            "gate_type": "financial_logistics_approval",
            "status": "pending",
        }
    )
    if pending_fin_gate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pending financial approval gate must be approved before triggering PayPal Payout.",
        )

    campaign = await db["funding_campaigns"].find_one({"allocation_id": delivery["allocation_id"]})
    required = float(delivery.get("estimated_cost_usd", 0.0))
    funded = float((campaign or {}).get("funded_amount_usd", 0.0))
    if funded < required - 0.01:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Delivery funding incomplete (${funded:.2f} / ${required:.2f}); cannot disburse payout.",
        )

    recipient_email = delivery.get("partner_payout_email")
    if not recipient_email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Delivery partner has no configured PayPal payout email.",
        )

    payout = await paypal_service.create_payout(
        delivery_id=delivery["id"],
        recipient_email=recipient_email,
        amount_usd=required,
        note=payload.note or f"SurplusConnect AI payout for delivery {delivery['id']}",
    )

    now = datetime.now(timezone.utc)
    await db["deliveries"].update_one(
        {"id": delivery["id"]},
        {
            "$set": {
                "payout_status": payout["batch_status"],
                "paypal_payout_batch_id": payout["payout_batch_id"],
                "payout_initiated_at": now,
                "updated_at": now,
            }
        },
    )
    txn_doc = {
        "id": f"txn-{uuid.uuid4().hex[:10]}",
        "campaign_id": (campaign or {}).get("id"),
        "allocation_id": delivery["allocation_id"],
        "delivery_id": delivery["id"],
        "type": "delivery_partner_payout",
        "payer_id": current_user["id"],
        "payer_name": "SurplusConnect Escrow",
        "recipient_email": recipient_email,
        "amount_usd": round(required, 2),
        "currency": "USD",
        "payment_mode": "paypal_sandbox",
        "paypal_payout_batch_id": payout["payout_batch_id"],
        "status": payout["batch_status"],
        "is_demo_seed": False,
        "created_at": now,
    }
    await db["transactions"].insert_one(dict(txn_doc))
    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": "paypal_payout_submitted",
            "target_id": delivery["id"],
            "details": f"Submitted PayPal Sandbox Payout ${required:.2f} to {recipient_email} (batch {payout['payout_batch_id']}).",
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()
    return {"payout": payout, "transaction": {k: v for k, v in txn_doc.items() if k != "_id"}}


@router.get("/paypal/payouts/{batch_id}")
async def check_paypal_payout_status(
    batch_id: str,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN, UserRole.DELIVERY_PARTNER)),
) -> Dict[str, Any]:
    return await paypal_service.get_payout_status(batch_id)


@router.get("/transactions")
async def list_transactions(
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    db = get_db()
    query: Dict[str, Any] = {}
    if current_user["role"] == UserRole.SPONSOR.value:
        query["payer_id"] = current_user["id"]
    docs = await db["transactions"].find(query).sort("created_at", -1).to_list(length=300)
    cleaned = [{k: v for k, v in d.items() if k != "_id"} for d in docs]
    return {"items": cleaned, "total": len(cleaned)}

