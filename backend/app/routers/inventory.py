"""Business surplus inventory listing, validation, and AI Surplus Detection endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import get_current_user, require_roles
from app.database import db_manager, get_db
from app.ml.surplus_detector import surplus_detector
from app.models.schemas import InventoryCreateRequest, InventoryUpdateRequest, UserRole
from app.services.gemini_service import gemini_service
from app.services.langgraph_agent import run_autonomous_coordination

router = APIRouter(prefix="/api/inventory", tags=["Surplus Inventory"])


@router.get("")
async def list_inventory(
    mine_only: bool = False,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    db = get_db()
    query: Dict[str, Any] = {}
    if mine_only or current_user["role"] == UserRole.BUSINESS.value:
        if current_user["role"] == UserRole.BUSINESS.value:
            query["business_id"] = current_user["id"]

    lots = await db["inventory_lots"].find(query).sort("created_at", -1).to_list(length=200)
    # Strip Mongo internal _id for clean JSON
    cleaned = [{k: v for k, v in lot.items() if k != "_id"} for lot in lots]
    return {"items": cleaned, "total": len(cleaned)}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_inventory_lot(
    payload: InventoryCreateRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.BUSINESS, UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    now = datetime.now(timezone.utc)
    lot_id = f"lot-{uuid.uuid4().hex[:10]}"

    lot_doc: Dict[str, Any] = {
        "id": lot_id,
        "business_id": current_user["id"],
        "business_name": current_user["organization_name"],
        "pickup_location": current_user["location"],
        "title": payload.title,
        "description": payload.description,
        "category": payload.category.value,
        "quantity_kg": round(payload.quantity_kg, 2),
        "servings_estimate": payload.servings_estimate or int(payload.quantity_kg * 3),
        "unit_label": payload.unit_label,
        "storage_requirement": payload.storage_requirement.value,
        "prepared_at": payload.prepared_at,
        "expires_at": payload.expires_at,
        "pickup_window_start": payload.pickup_window_start or now,
        "pickup_window_end": payload.pickup_window_end or payload.expires_at,
        "packaging_type": payload.packaging_type,
        "allergens": payload.allergens,
        "handling_notes": payload.handling_notes,
        "estimated_retail_value_usd": payload.estimated_retail_value_usd,
        "historical_daily_turnover_kg": payload.historical_daily_turnover_kg,
        "status": "listed",
        "fallback_activated": False,
        "expanded_radius_km": 10.0,
        "is_demo_seed": False,
        "created_at": now,
        "updated_at": now,
    }

    # Immediate AI Surplus Detection & strict food-safety validation
    ml_analysis = surplus_detector.validate_and_analyze(lot_doc)
    if not ml_analysis["is_eligible"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Inventory failed food-safety and storage validation.",
                "safety_status": ml_analysis["safety_status"],
                "quality_risk_flags": ml_analysis["quality_risk_flags"],
                "storage_validation_notes": ml_analysis["storage_validation_notes"],
            },
        )

    await db["inventory_lots"].insert_one(dict(lot_doc))
    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": "inventory_listed",
            "target_id": lot_id,
            "details": f"Listed {payload.quantity_kg} kg '{payload.title}' ({payload.storage_requirement.value}).",
            "created_at": now,
        }
    )

    coordination_result = None
    if payload.auto_coordinate:
        coordination_result = await run_autonomous_coordination(
            db=db,
            lot=lot_doc,
            donor=current_user,
            triggered_by=current_user["id"],
        )
    else:
        gemini_brief = await gemini_service.explain_surplus_lot(lot_doc, ml_analysis)
        analysis = {**ml_analysis, **gemini_brief}
        await db["inventory_lots"].update_one(
            {"id": lot_id},
            {"$set": {"analysis": analysis, "status": "analyzed", "updated_at": datetime.now(timezone.utc)}},
        )

    await db_manager.maybe_persist()
    saved_lot = await db["inventory_lots"].find_one({"id": lot_id})
    return {
        "lot": {k: v for k, v in (saved_lot or lot_doc).items() if k != "_id"},
        "coordination": coordination_result,
    }


@router.post("/{lot_id}/analyze")
async def analyze_inventory_lot(
    lot_id: str,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.BUSINESS, UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    lot = await db["inventory_lots"].find_one({"id": lot_id})
    if not lot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory lot not found.")
    if current_user["role"] == UserRole.BUSINESS.value and lot["business_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot analyze another business's lot.")

    ml_analysis = surplus_detector.validate_and_analyze(lot)
    gemini_brief = await gemini_service.explain_surplus_lot(lot, ml_analysis)
    analysis = {**ml_analysis, **gemini_brief}
    new_status = lot["status"]
    if not analysis["is_eligible"]:
        new_status = "expired" if analysis["safety_status"] == "blocked_expired" else "blocked_unsafe"
    elif new_status == "listed":
        new_status = "analyzed"

    await db["inventory_lots"].update_one(
        {"id": lot_id},
        {"$set": {"analysis": analysis, "status": new_status, "updated_at": datetime.now(timezone.utc)}},
    )
    await db_manager.maybe_persist()
    return {"inventory_id": lot_id, "status": new_status, "analysis": analysis}


@router.get("/{lot_id}")
async def get_inventory_detail(
    lot_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    db = get_db()
    lot = await db["inventory_lots"].find_one({"id": lot_id})
    if not lot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory lot not found.")
    allocations = await db["allocations"].find({"inventory_id": lot_id}).to_list(length=100)
    runs = await db["agent_runs"].find({"inventory_id": lot_id}).sort("created_at", -1).to_list(length=20)
    return {
        "lot": {k: v for k, v in lot.items() if k != "_id"},
        "allocations": [{k: v for k, v in a.items() if k != "_id"} for a in allocations],
        "agent_runs": [{k: v for k, v in r.items() if k != "_id"} for r in runs],
    }


@router.patch("/{lot_id}")
async def update_inventory_lot(
    lot_id: str,
    payload: InventoryUpdateRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.BUSINESS, UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    lot = await db["inventory_lots"].find_one({"id": lot_id})
    if not lot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory lot not found.")
    if current_user["role"] == UserRole.BUSINESS.value and lot["business_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot edit another business's inventory.")

    updates: Dict[str, Any] = {}
    if payload.title is not None:
        updates["title"] = payload.title
    if payload.description is not None:
        updates["description"] = payload.description
    if payload.category is not None:
        updates["category"] = payload.category.value
    if payload.quantity_kg is not None:
        updates["quantity_kg"] = round(payload.quantity_kg, 2)
        updates["servings_estimate"] = int(payload.quantity_kg * 3)
    if payload.storage_requirement is not None:
        updates["storage_requirement"] = payload.storage_requirement.value
    if payload.expires_at is not None:
        updates["expires_at"] = payload.expires_at
    if payload.packaging_type is not None:
        updates["packaging_type"] = payload.packaging_type
    if payload.allergens is not None:
        updates["allergens"] = payload.allergens
    if payload.handling_notes is not None:
        updates["handling_notes"] = payload.handling_notes
    if payload.estimated_retail_value_usd is not None:
        updates["estimated_retail_value_usd"] = payload.estimated_retail_value_usd

    merged_lot = {**lot, **updates}
    ml_analysis = surplus_detector.validate_and_analyze(merged_lot)
    if not ml_analysis["is_eligible"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Updated inventory fails food-safety and storage validation.",
                "safety_status": ml_analysis["safety_status"],
                "quality_risk_flags": ml_analysis["quality_risk_flags"],
            },
        )

    now = datetime.now(timezone.utc)
    updates["analysis"] = {**(lot.get("analysis") or {}), **ml_analysis}
    updates["updated_at"] = now
    await db["inventory_lots"].update_one({"id": lot_id}, {"$set": updates})
    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": "inventory_updated",
            "target_id": lot_id,
            "details": f"Updated surplus lot '{merged_lot['title']}'.",
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()
    saved = await db["inventory_lots"].find_one({"id": lot_id})
    return {"lot": {k: v for k, v in (saved or merged_lot).items() if k != "_id"}}


@router.delete("/{lot_id}")
async def delete_inventory_lot(
    lot_id: str,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.BUSINESS, UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    lot = await db["inventory_lots"].find_one({"id": lot_id})
    if not lot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory lot not found.")
    if current_user["role"] == UserRole.BUSINESS.value and lot["business_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete another business's inventory.")

    active_delivery = await db["deliveries"].find_one(
        {"inventory_id": lot_id, "status": {"$in": ["collected", "in_transit", "delivered"]}}
    )
    if active_delivery:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete inventory that has already been collected or delivered.",
        )

    now = datetime.now(timezone.utc)
    await db["inventory_lots"].delete_one({"id": lot_id})
    await db["allocations"].delete_many({"inventory_id": lot_id})
    await db["funding_campaigns"].delete_many({"inventory_id": lot_id, "status": "open"})
    await db["deliveries"].delete_many({"inventory_id": lot_id, "status": {"$in": ["pending_funding", "ready_for_dispatch", "pickup_scheduled"]}})
    await db["approval_requests"].delete_many({"inventory_id": lot_id, "status": "pending"})
    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": "inventory_deleted",
            "target_id": lot_id,
            "details": f"Removed surplus lot '{lot.get('title', lot_id)}'.",
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()
    return {"deleted": True, "id": lot_id}

