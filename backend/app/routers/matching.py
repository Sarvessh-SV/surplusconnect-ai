"""Organization Matching, Multi-Org Split, Intelligent Fallback, and Recipient Review endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import get_current_user, require_roles
from app.database import db_manager, get_db
from app.models.schemas import MatchingRequest, OrganizationResponseRequest, UserRole
from app.services.langgraph_agent import run_autonomous_coordination

router = APIRouter(prefix="/api/matching", tags=["Matching & Fallback"])


@router.post("/inventory/{lot_id}/run")
async def run_matching_for_lot(
    lot_id: str,
    payload: MatchingRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.BUSINESS, UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    lot = await db["inventory_lots"].find_one({"id": lot_id})
    if not lot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory lot not found.")
    if current_user["role"] == UserRole.BUSINESS.value and lot["business_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this inventory lot.")

    donor = await db["users"].find_one({"id": lot["business_id"]})
    if not donor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Donor account not found.")

    result = await run_autonomous_coordination(
        db=db,
        lot=lot,
        donor=donor,
        triggered_by=current_user["id"],
        primary_radius_km=payload.primary_radius_km,
        max_fallback_radius_km=payload.max_fallback_radius_km if payload.activate_fallback_if_needed else payload.primary_radius_km,
    )
    return result


@router.get("/allocations")
async def list_allocations(
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    db = get_db()
    query: Dict[str, Any] = {}
    role = current_user["role"]
    if role == UserRole.ORGANIZATION.value:
        query["organization_id"] = current_user["id"]
    elif role == UserRole.BUSINESS.value:
        query["business_id"] = current_user["id"]

    docs = await db["allocations"].find(query).sort("created_at", -1).to_list(length=300)
    cleaned = [{k: v for k, v in d.items() if k != "_id"} for d in docs]
    return {"items": cleaned, "total": len(cleaned)}


@router.post("/allocations/{allocation_id}/respond")
async def respond_to_allocation(
    allocation_id: str,
    payload: OrganizationResponseRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ORGANIZATION, UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    alloc = await db["allocations"].find_one({"id": allocation_id})
    if not alloc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allocation not found.")

    if current_user["role"] == UserRole.ORGANIZATION.value and alloc["organization_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot respond to another organization's match.")

    now = datetime.now(timezone.utc)
    if payload.action == "decline":
        await db["allocations"].update_one(
            {"id": allocation_id},
            {"$set": {"status": "declined", "response_notes": payload.notes, "updated_at": now}},
        )
        await db["funding_campaigns"].update_many(
            {"allocation_id": allocation_id},
            {"$set": {"status": "cancelled", "updated_at": now}},
        )
        await db["audit_logs"].insert_one(
            {
                "id": f"audit-{uuid.uuid4().hex[:10]}",
                "actor_id": current_user["id"],
                "actor_role": current_user["role"],
                "action": "allocation_declined",
                "target_id": allocation_id,
                "details": payload.notes or "Organization declined allocation.",
                "created_at": now,
            }
        )
        await db_manager.maybe_persist()
        return {"allocation_id": allocation_id, "status": "declined"}

    # Check if food safety human approval gate is still pending
    if alloc["status"] == "awaiting_safety_approval":
        pending_safety = await db["approval_requests"].find_one(
            {"inventory_id": alloc["inventory_id"], "gate_type": "food_safety_approval", "status": "pending"}
        )
        if pending_safety:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Food safety human approval gate is still pending. Admin sign-off is required before recipient acceptance.",
            )

    # Accept allocation & configure funding mode + delivery record
    total_cost = float((alloc.get("cost_breakdown") or {}).get("total_estimated_cost_usd", 25.0))
    if payload.funding_mode.value == "self_funded":
        self_share_pct = 100.0
    elif payload.funding_mode.value == "sponsor_funded":
        self_share_pct = 0.0
    else:
        self_share_pct = payload.self_funded_share_pct if payload.self_funded_share_pct > 0 else 40.0

    self_amt = round(total_cost * (self_share_pct / 100.0), 2)
    sponsor_target = round(max(0.0, total_cost - self_amt), 2)

    campaign = await db["funding_campaigns"].find_one({"allocation_id": allocation_id})
    if not campaign:
        camp_id = f"camp-{uuid.uuid4().hex[:10]}"
        campaign = {
            "id": camp_id,
            "allocation_id": allocation_id,
            "inventory_id": alloc["inventory_id"],
            "title": f"Rescue {alloc['allocated_kg']} kg {alloc['inventory_title']} -> {alloc['organization_name']}",
            "business_name": alloc["business_name"],
            "organization_id": alloc["organization_id"],
            "organization_name": alloc["organization_name"],
            "funding_mode": payload.funding_mode.value,
            "required_amount_usd": total_cost,
            "self_funded_committed_usd": self_amt,
            "sponsor_target_amount_usd": sponsor_target,
            "sponsor_target_usd": sponsor_target,
            "funded_amount_usd": self_amt if payload.funding_mode.value == "self_funded" else 0.0,
            "status": "funded" if payload.funding_mode.value == "self_funded" else "open",
            "distance_km": alloc["distance_km"],
            "allocated_kg": alloc["allocated_kg"],
            "urgency_score": alloc.get("urgency_score", 75.0),
            "is_fallback_match": alloc.get("is_fallback_match", False),
            "is_demo_seed": False,
            "created_at": now,
            "updated_at": now,
        }
        await db["funding_campaigns"].insert_one(dict(campaign))
    else:
        funded_already = float(campaign.get("funded_amount_usd", 0.0))
        new_funded = max(funded_already, self_amt) if payload.funding_mode.value != "sponsor_funded" else funded_already
        camp_status = "funded" if new_funded >= total_cost - 0.01 else "open"
        await db["funding_campaigns"].update_one(
            {"id": campaign["id"]},
            {
                "$set": {
                    "funding_mode": payload.funding_mode.value,
                    "self_funded_committed_usd": self_amt,
                    "sponsor_target_usd": sponsor_target,
                    "funded_amount_usd": round(new_funded, 2),
                    "status": camp_status,
                    "updated_at": now,
                }
            },
        )
        campaign = await db["funding_campaigns"].find_one({"id": campaign["id"]})

    # Ensure delivery record exists
    delivery = await db["deliveries"].find_one({"allocation_id": allocation_id})
    rec_partner = alloc.get("recommended_partner") or {}
    funded_enough = float((campaign or {}).get("funded_amount_usd", 0.0)) >= total_cost - 0.01
    delivery_status = "ready_for_dispatch" if funded_enough else "pending_funding"

    if not delivery:
        delivery_id = f"deliv-{uuid.uuid4().hex[:10]}"
        partner_doc = None
        if rec_partner.get("partner_id"):
            partner_doc = await db["users"].find_one({"id": rec_partner["partner_id"]})
        delivery = {
            "id": delivery_id,
            "allocation_id": allocation_id,
            "inventory_id": alloc["inventory_id"],
            "inventory_title": alloc["inventory_title"],
            "business_name": alloc["business_name"],
            "organization_id": alloc["organization_id"],
            "organization_name": alloc["organization_name"],
            "partner_id": rec_partner.get("partner_id"),
            "partner_name": rec_partner.get("partner_name"),
            "partner_payout_email": (partner_doc or {}).get("paypal_payout_email"),
            "pickup_location": alloc["pickup_location"],
            "dropoff_location": alloc["dropoff_location"],
            "allocated_kg": alloc["allocated_kg"],
            "storage_requirement": alloc["storage_requirement"],
            "route": alloc.get("route"),
            "estimated_cost_usd": total_cost,
            "status": delivery_status,
            "payout_eligible": False,
            "payout_status": "not_initiated",
            "is_demo_seed": False,
            "created_at": now,
            "updated_at": now,
        }
        await db["deliveries"].insert_one(dict(delivery))

    await db["allocations"].update_one(
        {"id": allocation_id},
        {
            "$set": {
                "status": "confirmed" if funded_enough else "accepted",
                "selected_funding_mode": payload.funding_mode.value,
                "response_notes": payload.notes,
                "updated_at": now,
            }
        },
    )
    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": "allocation_accepted",
            "target_id": allocation_id,
            "details": f"Accepted {alloc['allocated_kg']} kg with funding mode {payload.funding_mode.value}.",
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()

    return {
        "allocation_id": allocation_id,
        "status": "confirmed" if funded_enough else "accepted",
        "campaign": {k: v for k, v in (campaign or {}).items() if k != "_id"},
        "delivery": {k: v for k, v in (delivery or {}).items() if k != "_id"},
    }

