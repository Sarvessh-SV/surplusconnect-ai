"""LangGraph Autonomous AI Coordination Agent with Human-in-the-Loop Approval Gates."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from app.database import db_manager
from app.ml.surplus_detector import surplus_detector
from app.services.funding_service import funding_service
from app.services.gemini_service import gemini_service
from app.services.logistics_service import logistics_service
from app.services.matching_engine import matching_engine


class CoordinationState(TypedDict, total=False):
    run_id: str
    db: Any
    inventory_id: str
    donor: Dict[str, Any]
    lot: Dict[str, Any]
    primary_radius_km: float
    max_fallback_radius_km: float
    preferred_funding_mode: Optional[str]
    triggered_by: str
    analysis: Dict[str, Any]
    matching: Dict[str, Any]
    logistics_plans: List[Dict[str, Any]]
    funding_plans: List[Dict[str, Any]]
    pending_approvals: List[Dict[str, Any]]
    created_allocations: List[Dict[str, Any]]
    created_allocation_ids: List[str]
    created_campaign_ids: List[str]
    gemini_summary: Dict[str, Any]
    trace: List[Dict[str, Any]]
    status: str


async def _node_analyze_surplus(state: CoordinationState) -> CoordinationState:
    db = state["db"]
    lot = state["lot"]
    ml_res = surplus_detector.validate_and_analyze(lot)
    gemini_brief = await gemini_service.explain_surplus_lot(lot, ml_res)
    analysis = {**ml_res, **gemini_brief}

    new_status = lot.get("status", "listed")
    if not analysis["is_eligible"]:
        new_status = "expired" if analysis["safety_status"] == "blocked_expired" else "blocked_unsafe"
    elif new_status == "listed":
        new_status = "analyzed"

    await db["inventory_lots"].update_one(
        {"id": lot["id"]},
        {"$set": {"analysis": analysis, "status": new_status, "updated_at": datetime.now(timezone.utc)}},
    )
    lot["analysis"] = analysis
    lot["status"] = new_status

    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "analyze_surplus_and_safety",
            "status": "completed" if analysis["is_eligible"] else "blocked",
            "detail": (
                f"Surplus prob {analysis['surplus_probability']}, urgency {analysis['spoilage_urgency_score']}/100, "
                f"safety={analysis['safety_status']}."
            ),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )
    return {"lot": lot, "analysis": analysis, "trace": trace}


def _route_after_safety(state: CoordinationState) -> str:
    if not state["analysis"].get("is_eligible", False):
        return "synthesize"
    return "match_and_fallback"


async def _node_match_and_fallback(state: CoordinationState) -> CoordinationState:
    db = state["db"]
    lot = state["lot"]
    donor = state["donor"]
    matching = await matching_engine.compute_allocations(
        db=db,
        lot=lot,
        donor=donor,
        primary_radius_km=float(state.get("primary_radius_km", 10.0)),
        allow_split_allocation=True,
        activate_fallback_if_needed=True,
        max_fallback_radius_km=float(state.get("max_fallback_radius_km", 75.0)),
    )

    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "intelligent_matching_and_fallback",
            "status": "completed",
            "detail": (
                f"Allocated {matching['allocated_kg']} kg across {matching['split_count']} org(s). "
                f"Fallback={'ACTIVATED (' + str(matching['expanded_radius_km']) + ' km)' if matching['fallback_activated'] else 'not needed'}."
            ),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )
    return {"matching": matching, "trace": trace}


async def _node_logistics_and_funding(state: CoordinationState) -> CoordinationState:
    db = state["db"]
    lot = state["lot"]
    donor = state["donor"]
    matching = state["matching"]
    donor_loc = donor.get("location") or lot.get("pickup_location") or {}

    logistics_plans: List[Dict[str, Any]] = []
    funding_plans: List[Dict[str, Any]] = []

    for prop in matching.get("proposed_allocations", []):
        org_doc = await db["users"].find_one({"id": prop["organization_id"]})
        if not org_doc:
            continue
        log_plan = await logistics_service.recommend_partners_and_route(
            db=db,
            origin_loc=donor_loc,
            dest_loc=prop["location"],
            weight_kg=float(prop["allocated_kg"]),
            storage_requirement=lot["storage_requirement"],
            is_fallback=bool(prop.get("is_fallback_match", False)),
        )
        cost_usd = float(log_plan["cost_breakdown"]["total_estimated_cost_usd"])
        fund_plan = funding_service.recommend_funding_allocation(
            estimated_cost_usd=cost_usd,
            org_doc=org_doc,
            urgency_score=float(prop.get("urgency_score", 70.0)),
            is_fallback=bool(prop.get("is_fallback_match", False)),
        )
        if state.get("preferred_funding_mode"):
            mode = str(state["preferred_funding_mode"])
            fund_plan["recommended_mode"] = mode
            if mode == "self_funded":
                fund_plan["self_funded_share_pct"] = 100.0
                fund_plan["self_funded_amount_usd"] = round(cost_usd, 2)
                fund_plan["sponsor_target_amount_usd"] = 0.0
            elif mode == "sponsor_funded":
                fund_plan["self_funded_share_pct"] = 0.0
                fund_plan["self_funded_amount_usd"] = 0.0
                fund_plan["sponsor_target_amount_usd"] = round(cost_usd, 2)
            else:
                fund_plan["self_funded_share_pct"] = 40.0
                fund_plan["self_funded_amount_usd"] = round(cost_usd * 0.4, 2)
                fund_plan["sponsor_target_amount_usd"] = round(cost_usd * 0.6, 2)

        logistics_plans.append({"organization_id": prop["organization_id"], **log_plan})
        funding_plans.append({"organization_id": prop["organization_id"], **fund_plan})

    trace = list(state.get("trace", []))
    total_cost = sum(lp["cost_breakdown"]["total_estimated_cost_usd"] for lp in logistics_plans)
    trace.append(
        {
            "node": "logistics_and_funding_optimization",
            "status": "completed",
            "detail": f"Computed {len(logistics_plans)} route/partner plans; total estimated transport cost ${total_cost:.2f}.",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )
    return {"logistics_plans": logistics_plans, "funding_plans": funding_plans, "trace": trace}


async def _node_persist_and_human_gate(state: CoordinationState) -> CoordinationState:
    db = state["db"]
    lot = state["lot"]
    donor = state["donor"]
    analysis = state["analysis"]
    matching = state["matching"]
    logistics_plans = state.get("logistics_plans", [])
    funding_plans = state.get("funding_plans", [])
    now = datetime.now(timezone.utc)

    log_by_org = {lp["organization_id"]: lp for lp in logistics_plans}
    fund_by_org = {fp["organization_id"]: fp for fp in funding_plans}

    created_allocations: List[Dict[str, Any]] = []
    created_alloc_ids: List[str] = []
    created_campaign_ids: List[str] = []
    pending_approvals: List[Dict[str, Any]] = []

    needs_safety_gate = bool(analysis.get("requires_safety_approval", False))

    for prop in matching.get("proposed_allocations", []):
        org_id = prop["organization_id"]
        lp = log_by_org.get(org_id, {})
        fp = fund_by_org.get(org_id, {})
        alloc_id = f"alloc-{uuid.uuid4().hex[:10]}"
        alloc_status = "awaiting_safety_approval" if needs_safety_gate else "proposed"

        top_partner = (lp.get("recommended_partners") or [None])[0]
        route = lp.get("route") or {}
        cost = lp.get("cost_breakdown") or {}

        alloc_doc = {
            "id": alloc_id,
            "inventory_id": lot["id"],
            "inventory_title": lot["title"],
            "category": lot["category"],
            "storage_requirement": lot["storage_requirement"],
            "business_id": donor["id"],
            "business_name": donor["organization_name"],
            "pickup_location": donor.get("location"),
            "organization_id": org_id,
            "organization_name": prop["organization_name"],
            "organization_type": prop["organization_type"],
            "dropoff_location": prop["location"],
            "allocated_kg": prop["allocated_kg"],
            "servings_estimate": int(round(float(prop["allocated_kg"]) * 2.5)),
            "distance_km": prop["distance_km"],
            "match_score": prop["match_score"],
            "urgency_score": prop["urgency_score"],
            "is_fallback_match": prop["is_fallback_match"],
            "fallback_tier": prop.get("fallback_tier") or "primary",
            "fallback_radius_km": prop.get("search_radius_km", matching.get("expanded_radius_km", 10.0)),
            "match_rationale": (
                f"Matched {prop['allocated_kg']} kg based on capacity, {lot['storage_requirement']} storage compatibility, "
                f"{prop['distance_km']} km distance, and {prop['urgency_score']}/100 demand urgency."
            ),
            "status": alloc_status,
            "vehicle_requirements": lp.get("vehicle_requirements"),
            "route": route,
            "cost_breakdown": cost,
            "recommended_partner": top_partner,
            "funding_recommendation": fp,
            "funding_plan": fp,
            "expires_at": lot["expires_at"],
            "created_at": now,
            "updated_at": now,
            "is_demo_seed": False,
        }
        await db["allocations"].insert_one(dict(alloc_doc))
        created_allocations.append(alloc_doc)
        created_alloc_ids.append(alloc_id)

        # Create funding campaign record for sponsor/shared visibility
        total_req = float(fp.get("total_required_usd", 0.0))
        sponsor_target = float(fp.get("sponsor_target_amount_usd", 0.0))
        if total_req > 0:
            camp_id = f"camp-{uuid.uuid4().hex[:10]}"
            camp_doc = {
                "id": camp_id,
                "allocation_id": alloc_id,
                "inventory_id": lot["id"],
                "title": f"Rescue {prop['allocated_kg']} kg {lot['title']} -> {prop['organization_name']}",
                "business_name": donor["organization_name"],
                "organization_id": org_id,
                "organization_name": prop["organization_name"],
                "funding_mode": fp.get("recommended_mode", "sponsor_funded"),
                "required_amount_usd": total_req,
                "self_funded_committed_usd": 0.0,
                "sponsor_target_usd": sponsor_target,
                "funded_amount_usd": 0.0,
                "status": "open",
                "distance_km": prop["distance_km"],
                "allocated_kg": prop["allocated_kg"],
                "urgency_score": prop["urgency_score"],
                "is_fallback_match": prop["is_fallback_match"],
                "rationale": fp.get("rationale", ""),
                "created_at": now,
                "updated_at": now,
                "is_demo_seed": False,
            }
            await db["funding_campaigns"].insert_one(dict(camp_doc))
            created_campaign_ids.append(camp_id)

        # If high-cost financial commitment (>= $40) or fallback corridor, raise financial review gate
        if float(cost.get("total_estimated_cost_usd", 0.0)) >= 40.0 or prop.get("is_fallback_match"):
            fin_gate_id = f"appr-{uuid.uuid4().hex[:10]}"
            fin_reason = (
                f"{'Expanded fallback corridor (' + str(prop['distance_km']) + ' km). ' if prop.get('is_fallback_match') else ''}"
                f"Estimated transport commitment ${cost.get('total_estimated_cost_usd', 0):.2f} requires operator sign-off before PayPal payout eligibility."
            )
            fin_gate = {
                "id": fin_gate_id,
                "run_id": state["run_id"],
                "inventory_id": lot["id"],
                "allocation_id": alloc_id,
                "gate_type": "financial_logistics_approval",
                "title": f"Logistics Funding Gate: ${cost.get('total_estimated_cost_usd', 0):.2f} ({prop['organization_name']})",
                "reason": fin_reason,
                "summary": fin_reason,
                "risk_flags": [
                    f"Transport commitment ${cost.get('total_estimated_cost_usd', 0):.2f}",
                    "Fallback distance corridor" if prop.get("is_fallback_match") else "Primary corridor",
                ],
                "estimated_financial_exposure_usd": float(cost.get("total_estimated_cost_usd", 0.0)),
                "severity": "medium",
                "status": "pending",
                "payload": {
                    "estimated_cost_usd": cost.get("total_estimated_cost_usd", 0.0),
                    "funding_mode": fp.get("recommended_mode"),
                    "distance_km": prop["distance_km"],
                },
                "is_demo_seed": False,
                "created_at": now,
                "resolved_at": None,
                "resolved_by": None,
                "reviewer_notes": None,
            }
            await db["approval_requests"].insert_one(dict(fin_gate))
            pending_approvals.append(fin_gate)

    # Food Safety Human Approval Gate if triggered
    if needs_safety_gate and created_alloc_ids:
        safety_gate_id = f"appr-{uuid.uuid4().hex[:10]}"
        safety_reason = "; ".join(analysis.get("quality_risk_flags") or ["Cold-chain / short-expiry human verification."])
        safety_gate = {
            "id": safety_gate_id,
            "run_id": state["run_id"],
            "inventory_id": lot["id"],
            "allocation_id": created_alloc_ids[0],
            "all_allocation_ids": created_alloc_ids,
            "gate_type": "food_safety_approval",
            "title": f"Food Safety Sign-Off: {lot['title']} ({analysis['hours_until_expiry']}h shelf life)",
            "reason": safety_reason,
            "summary": safety_reason,
            "risk_flags": list(analysis.get("quality_risk_flags") or []),
            "severity": "high",
            "status": "pending",
            "payload": {
                "hours_until_expiry": analysis["hours_until_expiry"],
                "storage_requirement": lot["storage_requirement"],
                "category": lot["category"],
                "ai_explanation": analysis.get("ai_explanation"),
            },
            "is_demo_seed": False,
            "created_at": now,
            "resolved_at": None,
            "resolved_by": None,
            "reviewer_notes": None,
        }
        await db["approval_requests"].insert_one(dict(safety_gate))
        pending_approvals.append(safety_gate)

    # Update inventory lot status
    if created_alloc_ids:
        lot_status = (
            "awaiting_approval"
            if needs_safety_gate
            else ("matched" if matching["unallocated_kg"] <= 0.5 else "partially_allocated")
        )
    else:
        lot_status = "analyzed"

    await db["inventory_lots"].update_one(
        {"id": lot["id"]},
        {
            "$set": {
                "status": lot_status,
                "fallback_activated": matching["fallback_activated"],
                "expanded_radius_km": matching["expanded_radius_km"],
                "storage_hub_options": matching["storage_hub_options"],
                "future_matching_windows": matching["future_matching_windows"],
                "updated_at": now,
            }
        },
    )

    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "human_approval_gate_and_commit",
            "status": "awaiting_human_approval" if pending_approvals else "completed",
            "detail": (
                f"Persisted {len(created_alloc_ids)} allocation(s) and {len(created_campaign_ids)} funding campaign(s). "
                f"Raised {len(pending_approvals)} human approval request(s)."
            ),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )

    return {
        "created_allocations": created_allocations,
        "created_allocation_ids": created_alloc_ids,
        "created_campaign_ids": created_campaign_ids,
        "pending_approvals": pending_approvals,
        "trace": trace,
        "status": "awaiting_human_approval" if pending_approvals else "completed",
    }


async def _node_synthesize_explainability(state: CoordinationState) -> CoordinationState:
    db = state["db"]
    lot = state["lot"]
    analysis = state["analysis"]
    matching = state.get("matching", {"allocated_kg": 0, "unallocated_kg": lot["quantity_kg"], "split_count": 0, "fallback_activated": False, "proposed_allocations": []})
    logistics_plans = state.get("logistics_plans", [])
    funding_plans = state.get("funding_plans", [])
    pending_approvals = state.get("pending_approvals", [])

    summary = await gemini_service.synthesize_coordination_plan(
        lot=lot,
        analysis=analysis,
        matching=matching,
        logistics=logistics_plans[0] if logistics_plans else None,
        funding=funding_plans[0] if funding_plans else None,
        pending_approvals=pending_approvals,
    )

    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "gemini_explainable_synthesis",
            "status": "completed",
            "detail": summary["headline"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )

    final_status = state.get("status") or ("blocked" if not analysis.get("is_eligible") else "completed")
    exec_summary = summary.get("executive_summary") or summary.get("headline") or ""
    run_doc = {
        "id": state["run_id"],
        "inventory_id": lot["id"],
        "inventory_title": lot["title"],
        "triggered_by": state.get("triggered_by", "system"),
        "status": final_status,
        "analysis": analysis,
        "safety_analysis": analysis,
        "matching": matching,
        "fallback_activated": bool(matching.get("fallback_activated", False)),
        "expanded_radius_km": float(matching.get("expanded_radius_km", 10.0)),
        "storage_hub_options": matching.get("storage_hub_options", []),
        "future_matching_windows": matching.get("future_matching_windows", []),
        "created_allocation_ids": state.get("created_allocation_ids", []),
        "created_campaign_ids": state.get("created_campaign_ids", []),
        "pending_approval_ids": [p["id"] for p in pending_approvals],
        "gemini_summary": summary,
        "executive_summary": exec_summary,
        "ai_provider": summary.get("ai_provider", analysis.get("ai_provider", "deterministic_engine")),
        "trace": trace,
        "node_trace": trace,
        "is_demo_seed": False,
        "created_at": datetime.now(timezone.utc),
    }
    await db["agent_runs"].insert_one(dict(run_doc))
    await db_manager.maybe_persist()
    return {"gemini_summary": summary, "trace": trace, "status": final_status}


def _build_coordination_graph():
    graph = StateGraph(CoordinationState)
    graph.add_node("analyze_surplus", _node_analyze_surplus)
    graph.add_node("match_and_fallback", _node_match_and_fallback)
    graph.add_node("logistics_and_funding", _node_logistics_and_funding)
    graph.add_node("persist_and_gate", _node_persist_and_human_gate)
    graph.add_node("synthesize", _node_synthesize_explainability)

    graph.add_edge(START, "analyze_surplus")
    graph.add_conditional_edges(
        "analyze_surplus",
        _route_after_safety,
        {"match_and_fallback": "match_and_fallback", "synthesize": "synthesize"},
    )
    graph.add_edge("match_and_fallback", "logistics_and_funding")
    graph.add_edge("logistics_and_funding", "persist_and_gate")
    graph.add_edge("persist_and_gate", "synthesize")
    graph.add_edge("synthesize", END)
    return graph.compile()


COORDINATION_GRAPH = _build_coordination_graph()


async def run_autonomous_coordination(
    db: Any,
    lot: Dict[str, Any],
    donor: Dict[str, Any],
    triggered_by: str,
    primary_radius_km: float = 10.0,
    max_fallback_radius_km: float = 75.0,
    preferred_funding_mode: Optional[str] = None,
) -> Dict[str, Any]:
    run_id = f"run-{uuid.uuid4().hex[:10]}"
    result = await COORDINATION_GRAPH.ainvoke(
        {
            "run_id": run_id,
            "db": db,
            "inventory_id": lot["id"],
            "lot": dict(lot),
            "donor": dict(donor),
            "triggered_by": triggered_by,
            "primary_radius_km": primary_radius_km,
            "max_fallback_radius_km": max_fallback_radius_km,
            "preferred_funding_mode": preferred_funding_mode,
            "trace": [],
        }
    )
    matching_res = result.get("matching") or {}
    gemini_summary = result.get("gemini_summary") or {}
    analysis_res = result.get("analysis") or {}
    return {
        "run_id": run_id,
        "inventory_id": lot["id"],
        "status": result.get("status"),
        "analysis": analysis_res,
        "safety_analysis": analysis_res,
        "matching": matching_res,
        "fallback": {
            "fallback_activated": bool(matching_res.get("fallback_activated", False)),
            "expanded_radius_km": float(matching_res.get("expanded_radius_km", 10.0)),
            "fallback_reasons": matching_res.get("fallback_reasons", []),
            "storage_hub_options": matching_res.get("storage_hub_options", []),
            "future_matching_windows": matching_res.get("future_matching_windows", []),
        },
        "allocations": result.get("created_allocations", []),
        "created_allocation_ids": result.get("created_allocation_ids", []),
        "created_campaign_ids": result.get("created_campaign_ids", []),
        "approval_requests": result.get("pending_approvals", []),
        "pending_approvals": result.get("pending_approvals", []),
        "gemini_summary": gemini_summary,
        "run_summary": {
            "ai_provider": gemini_summary.get("ai_provider", analysis_res.get("ai_provider", "deterministic_engine")),
            "executive_summary": gemini_summary.get("executive_summary", ""),
            "headline": gemini_summary.get("headline", ""),
        },
        "trace": result.get("trace", []),
        "node_trace": result.get("trace", []),
    }

