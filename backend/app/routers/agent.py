"""Autonomous AI Coordination Agent (Gemini + LangGraph) and Human-in-the-Loop Approval endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import get_current_user, require_roles
from app.database import db_manager, get_db
from app.ml.demand_forecaster import demand_forecaster
from app.models.schemas import AgentCoordinationRequest, ApprovalDecisionRequest, UserRole
from app.services.gemini_service import gemini_service
from app.services.langgraph_agent import run_autonomous_coordination

router = APIRouter(prefix="/api/agent", tags=["Autonomous AI Coordination Agent"])


@router.post("/coordinate")
async def trigger_coordination_workflow(
    payload: AgentCoordinationRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.BUSINESS, UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    if not payload.inventory_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="inventory_id is required.")

    lot = await db["inventory_lots"].find_one({"id": payload.inventory_id})
    if not lot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory lot not found.")
    if current_user["role"] == UserRole.BUSINESS.value and lot["business_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this lot.")

    donor = await db["users"].find_one({"id": lot["business_id"]})
    if not donor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Donor user not found.")

    return await run_autonomous_coordination(
        db=db,
        lot=lot,
        donor=donor,
        triggered_by=current_user["id"],
        primary_radius_km=payload.primary_radius_km,
        max_fallback_radius_km=payload.max_fallback_radius_km,
        preferred_funding_mode=payload.preferred_funding_mode.value if payload.preferred_funding_mode else None,
    )


@router.post("/chat")
async def agent_command_console(
    payload: AgentCoordinationRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Allows operators to consult the Gemini + LangGraph Autonomous Agent using live backend tools."""
    db = get_db()
    instruction = payload.instruction or "Summarize active surplus lots, demand gaps, and pending human approvals."

    async def tool_platform_overview() -> Dict[str, Any]:
        lots = await db["inventory_lots"].find({}).to_list(length=100)
        approvals = await db["approval_requests"].find({"status": "pending"}).to_list(length=100)
        campaigns = await db["funding_campaigns"].find({"status": "open"}).to_list(length=100)
        return {
            "total_lots": len(lots),
            "pending_approvals": [{"id": a["id"], "title": a["title"], "gate_type": a["gate_type"]} for a in approvals],
            "open_campaigns": [{"id": c["id"], "title": c["title"], "needed_usd": c["required_amount_usd"] - c.get("funded_amount_usd", 0)} for c in campaigns],
        }

    async def tool_demand_hotspots(category: str = "prepared_meals") -> Dict[str, Any]:
        orgs = await db["users"].find({"role": "organization", "verified": True}).to_list(length=100)
        ranked = [demand_forecaster.predict_organization_demand(o, category=category) for o in orgs]
        ranked.sort(key=lambda x: x["urgency_score"], reverse=True)
        return {"top_organizations": ranked[:5]}

    async def tool_coordinate_inventory(inventory_id: str) -> Dict[str, Any]:
        if current_user["role"] not in {UserRole.ADMIN.value, UserRole.BUSINESS.value}:
            return {"error": "Only Business or Admin roles may trigger coordination mutations."}
        lot = await db["inventory_lots"].find_one({"id": inventory_id})
        if not lot:
            return {"error": f"Inventory '{inventory_id}' not found."}
        donor = await db["users"].find_one({"id": lot["business_id"]})
        if not donor:
            return {"error": "Donor missing."}
        return await run_autonomous_coordination(db=db, lot=lot, donor=donor, triggered_by=current_user["id"])

    tool_declarations: List[Dict[str, Any]] = [
        {
            "type": "function",
            "name": "platform_overview",
            "description": "Retrieve current surplus inventory count, pending human approval gates, and open sponsor funding campaigns.",
            "parameters": {"type": "object", "properties": {}},
        },
        {
            "type": "function",
            "name": "demand_hotspots",
            "description": "Predict top high-urgency recipient organizations for a given food category using Scikit-learn.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "Food category such as bakery, produce, dairy, prepared_meals, frozen_goods."}
                },
                "required": ["category"],
            },
        },
        {
            "type": "function",
            "name": "coordinate_inventory",
            "description": "Run the LangGraph coordination workflow (surplus detection, matching, fallback, logistics, approval gates) for an inventory_id.",
            "parameters": {
                "type": "object",
                "properties": {"inventory_id": {"type": "string"}},
                "required": ["inventory_id"],
            },
        },
    ]

    snapshot = {
        "active_lots": await db["inventory_lots"].count_documents({"status": {"$nin": ["completed", "expired", "blocked_unsafe"]}}),
        "pending_approvals": await db["approval_requests"].count_documents({"status": "pending"}),
        "open_campaigns": await db["funding_campaigns"].count_documents({"status": "open"}),
        "user_role": current_user["role"],
    }

    return await gemini_service.run_agent_chat(
        instruction=instruction,
        tool_registry={
            "platform_overview": tool_platform_overview,
            "demand_hotspots": tool_demand_hotspots,
            "coordinate_inventory": tool_coordinate_inventory,
        },
        tool_declarations=tool_declarations,
        platform_snapshot=snapshot,
    )


@router.get("/runs")
async def list_agent_runs(
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    db = get_db()
    docs = await db["agent_runs"].find({}).sort("created_at", -1).to_list(length=50)
    cleaned = [{k: v for k, v in d.items() if k != "_id"} for d in docs]
    return {"items": cleaned, "total": len(cleaned)}


@router.get("/approvals")
async def list_approval_requests(
    status_filter: str | None = None,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    db = get_db()
    query: Dict[str, Any] = {}
    if status_filter:
        query["status"] = status_filter
    docs = await db["approval_requests"].find(query).sort("created_at", -1).to_list(length=100)
    cleaned = [{k: v for k, v in d.items() if k != "_id"} for d in docs]
    return {"items": cleaned, "total": len(cleaned)}


@router.post("/approvals/{approval_id}/decision")
async def resolve_approval_gate(
    approval_id: str,
    payload: ApprovalDecisionRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    gate = await db["approval_requests"].find_one({"id": approval_id})
    if not gate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval request not found.")
    if gate["status"] != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Approval gate has already been resolved as '{gate['status']}'.",
        )

    now = datetime.now(timezone.utc)
    new_status = "approved" if payload.decision == "approve" else "rejected"
    await db["approval_requests"].update_one(
        {"id": approval_id},
        {
            "$set": {
                "status": new_status,
                "resolved_at": now,
                "resolved_by": current_user["id"],
                "resolved_by_name": current_user["full_name"],
                "reviewer_notes": payload.reviewer_notes,
            }
        },
    )

    alloc_ids = gate.get("all_allocation_ids") or ([gate["allocation_id"]] if gate.get("allocation_id") else [])
    if gate["gate_type"] == "food_safety_approval":
        if new_status == "approved":
            await db["allocations"].update_many(
                {"id": {"$in": alloc_ids}, "status": "awaiting_safety_approval"},
                {"$set": {"status": "proposed", "updated_at": now}},
            )
            await db["inventory_lots"].update_one(
                {"id": gate["inventory_id"], "status": "awaiting_approval"},
                {"$set": {"status": "matched", "updated_at": now}},
            )
        else:
            await db["allocations"].update_many(
                {"id": {"$in": alloc_ids}},
                {"$set": {"status": "declined", "response_notes": f"Safety rejected: {payload.reviewer_notes}", "updated_at": now}},
            )
            await db["inventory_lots"].update_one(
                {"id": gate["inventory_id"]},
                {"$set": {"status": "blocked_unsafe", "updated_at": now}},
            )
            await db["funding_campaigns"].update_many(
                {"allocation_id": {"$in": alloc_ids}},
                {"$set": {"status": "cancelled", "updated_at": now}},
            )

    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": f"human_gate_{new_status}",
            "target_id": approval_id,
            "details": f"{gate['gate_type']} -> {new_status}: {payload.reviewer_notes}",
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()
    updated = await db["approval_requests"].find_one({"id": approval_id})
    return {"approval": {k: v for k, v in (updated or {}).items() if k != "_id"}}

