"""AI Logistics Optimization, Google Routes API proxy, delivery assignment, and driver status updates."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import get_current_user, require_roles
from app.config import get_settings
from app.database import db_manager, get_db
from app.models.schemas import (
    DeliveryAssignmentRequest,
    DeliveryStatus,
    DeliveryStatusUpdateRequest,
    RoadRouteRequest,
    UserRole,
)
from app.services.logistics_service import logistics_service
from app.services.maps_service import maps_service

router = APIRouter(prefix="/api/logistics", tags=["Logistics & Delivery"])


@router.get("/partners")
async def list_delivery_partners(
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    db = get_db()
    partners = await db["users"].find({"role": "delivery_partner"}).to_list(length=200)
    cleaned = [
        {
            "id": p["id"],
            "organization_name": p["organization_name"],
            "full_name": p["full_name"],
            "verified": p.get("verified", False),
            "vehicle_type": p.get("vehicle_type"),
            "vehicle_capacity_kg": p.get("vehicle_capacity_kg"),
            "cold_chain_certified": p.get("cold_chain_certified", False),
            "rating": p.get("rating", 4.8),
            "location": p.get("location"),
            "paypal_payout_email": p.get("paypal_payout_email"),
        }
        for p in partners
    ]
    return {"items": cleaned, "total": len(cleaned)}


@router.get("/deliveries")
async def list_deliveries(
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    db = get_db()
    query: Dict[str, Any] = {}
    role = current_user["role"]
    if role == UserRole.DELIVERY_PARTNER.value:
        # Partners see deliveries assigned to them plus unassigned ready deliveries
        query = {
            "$or": [
                {"partner_id": current_user["id"]},
                {"partner_id": None, "status": "ready_for_dispatch"},
            ]
        }
    elif role == UserRole.ORGANIZATION.value:
        query = {"organization_id": current_user["id"]}

    docs = await db["deliveries"].find(query).sort("created_at", -1).to_list(length=300)
    cleaned = [{k: v for k, v in d.items() if k != "_id"} for d in docs]
    return {"items": cleaned, "total": len(cleaned)}


@router.post("/routes/preview")
async def preview_allocation_logistics(
    payload: DeliveryAssignmentRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    db = get_db()
    alloc = await db["allocations"].find_one({"id": payload.allocation_id})
    if not alloc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allocation not found.")

    plan = await logistics_service.recommend_partners_and_route(
        db=db,
        origin_loc=alloc["pickup_location"],
        dest_loc=alloc["dropoff_location"],
        weight_kg=float(alloc["allocated_kg"]),
        storage_requirement=alloc["storage_requirement"],
        is_fallback=bool(alloc.get("is_fallback_match", False)),
        travel_mode=payload.travel_mode,
    )
    return {"allocation_id": payload.allocation_id, **plan}


@router.post("/assign")
async def assign_delivery_partner(
    payload: DeliveryAssignmentRequest,
    current_user: Dict[str, Any] = Depends(
        require_roles(UserRole.DELIVERY_PARTNER, UserRole.ORGANIZATION, UserRole.ADMIN)
    ),
) -> Dict[str, Any]:
    db = get_db()
    alloc = await db["allocations"].find_one({"id": payload.allocation_id})
    if not alloc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allocation not found.")

    partner_id = payload.partner_id or (
        current_user["id"]
        if current_user["role"] == UserRole.DELIVERY_PARTNER.value
        else (alloc.get("recommended_partner") or {}).get("partner_id")
    )
    if not partner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No partner_id specified or recommended.")

    partner = await db["users"].find_one({"id": partner_id, "role": "delivery_partner"})
    if not partner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery partner not found.")

    # Enforce cold-chain & capacity validation
    if alloc["storage_requirement"] in {"refrigerated", "frozen"} and not partner.get("cold_chain_certified", False):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Selected delivery partner lacks cold-chain certification required for refrigerated/frozen inventory.",
        )
    if float(partner.get("vehicle_capacity_kg", 0.0)) < float(alloc["allocated_kg"]):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Selected partner vehicle capacity is smaller than allocated lot weight.",
        )

    now = datetime.now(timezone.utc)
    delivery = await db["deliveries"].find_one({"allocation_id": payload.allocation_id})
    campaign = await db["funding_campaigns"].find_one({"allocation_id": payload.allocation_id})
    total_cost = float((alloc.get("cost_breakdown") or {}).get("total_estimated_cost_usd", 25.0))
    funded_enough = bool(campaign and float(campaign.get("funded_amount_usd", 0.0)) >= total_cost - 0.01)

    next_status = "pickup_scheduled" if funded_enough else "pending_funding"
    if delivery:
        await db["deliveries"].update_one(
            {"id": delivery["id"]},
            {
                "$set": {
                    "partner_id": partner["id"],
                    "partner_name": partner["organization_name"],
                    "partner_payout_email": partner.get("paypal_payout_email") or partner["email"],
                    "status": next_status if delivery["status"] in {"pending_funding", "ready_for_dispatch"} else delivery["status"],
                    "updated_at": now,
                }
            },
        )
        delivery = await db["deliveries"].find_one({"id": delivery["id"]})
    else:
        delivery_id = f"deliv-{uuid.uuid4().hex[:10]}"
        delivery = {
            "id": delivery_id,
            "allocation_id": payload.allocation_id,
            "inventory_id": alloc["inventory_id"],
            "inventory_title": alloc["inventory_title"],
            "business_name": alloc["business_name"],
            "organization_id": alloc["organization_id"],
            "organization_name": alloc["organization_name"],
            "partner_id": partner["id"],
            "partner_name": partner["organization_name"],
            "partner_payout_email": partner.get("paypal_payout_email") or partner["email"],
            "pickup_location": alloc["pickup_location"],
            "dropoff_location": alloc["dropoff_location"],
            "allocated_kg": alloc["allocated_kg"],
            "storage_requirement": alloc["storage_requirement"],
            "route": alloc.get("route"),
            "estimated_cost_usd": total_cost,
            "status": next_status,
            "payout_eligible": False,
            "payout_status": "not_initiated",
            "is_demo_seed": False,
            "created_at": now,
            "updated_at": now,
        }
        await db["deliveries"].insert_one(dict(delivery))

    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": "delivery_partner_assigned",
            "target_id": delivery["id"],
            "details": f"Assigned {partner['organization_name']} to allocation {payload.allocation_id} ({next_status}).",
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()
    return {"delivery": {k: v for k, v in delivery.items() if k != "_id"}}


@router.post("/deliveries/{delivery_id}/status")
async def update_delivery_status(
    delivery_id: str,
    payload: DeliveryStatusUpdateRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.DELIVERY_PARTNER, UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    delivery = await db["deliveries"].find_one({"id": delivery_id})
    if not delivery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery not found.")

    if current_user["role"] == UserRole.DELIVERY_PARTNER.value and delivery.get("partner_id") != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not assigned to this delivery.")

    # Enforce funding & safety gates before pickup/transit/delivery
    if payload.status in {
        DeliveryStatus.PICKUP_SCHEDULED,
        DeliveryStatus.COLLECTED,
        DeliveryStatus.IN_TRANSIT,
        DeliveryStatus.DELIVERED,
    }:
        if delivery["status"] == "pending_funding":
            campaign = await db["funding_campaigns"].find_one({"allocation_id": delivery["allocation_id"]})
            funded = float((campaign or {}).get("funded_amount_usd", 0.0))
            required = float(delivery.get("estimated_cost_usd", 0.0))
            if funded < required - 0.01:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Delivery cannot dispatch until transport funding is complete (${funded:.2f} / ${required:.2f}).",
                )
        pending_safety = await db["approval_requests"].find_one(
            {"inventory_id": delivery["inventory_id"], "gate_type": "food_safety_approval", "status": "pending"}
        )
        if pending_safety:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Food safety approval is still pending. Admin sign-off is required before pickup.",
            )

    if payload.status == DeliveryStatus.DELIVERED:
        if not payload.recipient_confirmation_name or not payload.recipient_confirmation_name.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Recipient confirmation name is required to complete delivery.",
            )
        if delivery.get("storage_requirement") in {"refrigerated", "frozen"} and payload.temperature_verified_c is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Cold-chain temperature verification (C) is required on delivery confirmation.",
            )

    now = datetime.now(timezone.utc)
    update_fields: Dict[str, Any] = {
        "status": payload.status.value,
        "updated_at": now,
    }
    if payload.temperature_verified_c is not None:
        update_fields["temperature_verified_c"] = payload.temperature_verified_c
    if payload.recipient_confirmation_name:
        update_fields["recipient_confirmation_name"] = payload.recipient_confirmation_name.strip()
    if payload.delivery_notes:
        update_fields["delivery_notes"] = payload.delivery_notes.strip()
    if payload.proof_reference:
        update_fields["proof_reference"] = payload.proof_reference.strip()

    if payload.status == DeliveryStatus.DELIVERED:
        update_fields["delivered_at"] = now
        update_fields["payout_eligible"] = True
        if delivery.get("payout_status") == "not_initiated":
            update_fields["payout_status"] = "eligible_pending_approval"

    await db["deliveries"].update_one({"id": delivery_id}, {"$set": update_fields})

    # Sync allocation & lot completion
    alloc_status_map = {
        DeliveryStatus.PICKUP_SCHEDULED: "confirmed",
        DeliveryStatus.COLLECTED: "in_delivery",
        DeliveryStatus.IN_TRANSIT: "in_delivery",
        DeliveryStatus.DELIVERED: "delivered",
    }
    if payload.status in alloc_status_map:
        await db["allocations"].update_one(
            {"id": delivery["allocation_id"]},
            {"$set": {"status": alloc_status_map[payload.status], "updated_at": now}},
        )

    if payload.status == DeliveryStatus.DELIVERED:
        sibling_allocs = await db["allocations"].find(
            {"inventory_id": delivery["inventory_id"], "status": {"$ne": "declined"}}
        ).to_list(length=100)
        if sibling_allocs and all(a["status"] == "delivered" for a in sibling_allocs):
            await db["inventory_lots"].update_one(
                {"id": delivery["inventory_id"]},
                {"$set": {"status": "completed", "updated_at": now}},
            )

    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": f"delivery_{payload.status.value}",
            "target_id": delivery_id,
            "details": f"Delivery updated to {payload.status.value}.",
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()
    updated = await db["deliveries"].find_one({"id": delivery_id})
    return {"delivery": {k: v for k, v in (updated or {}).items() if k != "_id"}}


@router.get("/geocode")
async def geocode_address_search(
    q: str = Query(..., min_length=3, max_length=200),
) -> Dict[str, Any]:
    """Searches real street addresses responsibly via OpenStreetMap Nominatim."""
    return await maps_service.search_nominatim(q)


@router.post("/road-route")
async def compute_road_route_geometry(
    payload: RoadRouteRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Computes genuine road-following route geometry using OSRM without inventing fallback geometry."""
    return await maps_service.compute_osrm_road_route(
        origin_lat=payload.origin_lat,
        origin_lng=payload.origin_lng,
        dest_lat=payload.dest_lat,
        dest_lng=payload.dest_lng,
        profile=payload.profile,
    )


def _has_valid_coords(loc: Any) -> bool:
    if not isinstance(loc, dict):
        return False
    lat = loc.get("lat")
    lng = loc.get("lng")
    if lat is None or lng is None:
        return False
    try:
        flat = float(lat)
        flng = float(lng)
    except (TypeError, ValueError):
        return False
    if not (-90.0 <= flat <= 90.0 and -180.0 <= flng <= 180.0):
        return False
    return not (abs(flat) < 0.0001 and abs(flng) < 0.0001)


@router.get("/network-map")
async def get_donation_network_map(
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Returns database-backed donor, recipient, allocation, and route markers with missing-coordinate flags."""
    db = get_db()
    settings = get_settings()
    prod_filter: Dict[str, Any] = {} if settings.is_dev_seed_enabled else {"is_demo_seed": {"$ne": True}}

    donors = await db["users"].find({**prod_filter, "role": "business"}).to_list(length=300)
    recipients = await db["users"].find({**prod_filter, "role": "organization"}).to_list(length=300)
    lots = await db["inventory_lots"].find({**prod_filter, "status": {"$nin": ["completed", "expired"]}}).to_list(length=500)
    allocations = await db["allocations"].find(prod_filter).sort("created_at", -1).to_list(length=400)
    deliveries = await db["deliveries"].find(prod_filter).sort("created_at", -1).to_list(length=400)

    lots_by_business: Dict[str, float] = {}
    for lot in lots:
        bid = lot.get("business_id")
        if bid:
            lots_by_business[bid] = round(lots_by_business.get(bid, 0.0) + float(lot.get("quantity_kg", 0.0)), 1)

    allocs_by_business: Dict[str, List[Dict[str, Any]]] = {}
    allocs_by_org: Dict[str, List[Dict[str, Any]]] = {}
    for alloc in allocations:
        bid = alloc.get("business_id")
        oid = alloc.get("organization_id")
        if bid:
            allocs_by_business.setdefault(bid, []).append(alloc)
        if oid:
            allocs_by_org.setdefault(oid, []).append(alloc)

    markers: List[Dict[str, Any]] = []
    missing_locations: List[Dict[str, Any]] = []

    for d in donors:
        loc = d.get("location")
        if not _has_valid_coords(loc):
            missing_locations.append(
                {"id": d["id"], "name": d["organization_name"], "role": "donor"}
            )
            continue
        b_allocs = allocs_by_business.get(d["id"], [])
        has_confirmed = any(a.get("status") in {"accepted", "confirmed", "in_delivery", "delivered"} for a in b_allocs)
        has_pending = any(a.get("status") in {"proposed", "awaiting_safety_approval"} for a in b_allocs)
        match_status = "matched" if has_confirmed else ("pending" if has_pending else "unmatched")
        markers.append(
            {
                "id": d["id"],
                "label": d["organization_name"],
                "role": "donor",
                "kind": "donor",
                "quantity_kg": lots_by_business.get(d["id"], 0.0),
                "match_status": match_status,
                "location": loc,
                "is_current_user": d["id"] == current_user["id"],
            }
        )

    for org in recipients:
        loc = org.get("location")
        if not _has_valid_coords(loc):
            missing_locations.append(
                {"id": org["id"], "name": org["organization_name"], "role": "recipient"}
            )
            continue
        o_allocs = allocs_by_org.get(org["id"], [])
        has_confirmed = any(a.get("status") in {"accepted", "confirmed", "in_delivery", "delivered"} for a in o_allocs)
        has_pending = any(a.get("status") in {"proposed", "awaiting_safety_approval"} for a in o_allocs)
        match_status = "matched" if has_confirmed else ("pending" if has_pending else "unmatched")
        best_dist = min((float(a.get("distance_km", 0.0)) for a in o_allocs if a.get("distance_km") is not None), default=None)
        markers.append(
            {
                "id": org["id"],
                "label": org["organization_name"],
                "role": "recipient",
                "kind": "pending_recipient" if has_pending and not has_confirmed else "recipient",
                "quantity_kg": float(org.get("daily_capacity_kg") or 0.0),
                "distance_km": best_dist,
                "match_status": match_status,
                "location": loc,
                "is_current_user": org["id"] == current_user["id"],
            }
        )

    delivery_by_alloc = {d.get("allocation_id"): d for d in deliveries if d.get("allocation_id")}
    routes: List[Dict[str, Any]] = []
    for alloc in allocations:
        p_loc = alloc.get("pickup_location")
        d_loc = alloc.get("dropoff_location")
        if not (_has_valid_coords(p_loc) and _has_valid_coords(d_loc)):
            continue
        deliv = delivery_by_alloc.get(alloc["id"])
        is_confirmed = bool(
            alloc.get("status") in {"accepted", "confirmed", "in_delivery", "delivered"}
            or (deliv and deliv.get("status") in {"ready_for_dispatch", "pickup_scheduled", "collected", "in_transit", "delivered"})
        )
        route_info = alloc.get("route") or {}
        routes.append(
            {
                "id": alloc["id"],
                "donor_id": alloc.get("business_id"),
                "recipient_id": alloc.get("organization_id"),
                "donor_name": alloc.get("business_name"),
                "recipient_name": alloc.get("organization_name"),
                "inventory_title": alloc.get("inventory_title"),
                "allocated_kg": float(alloc.get("allocated_kg", 0.0)),
                "route_type": "confirmed" if is_confirmed else "suggested",
                "origin": {"lat": float(p_loc["lat"]), "lng": float(p_loc["lng"])},
                "destination": {"lat": float(d_loc["lat"]), "lng": float(d_loc["lng"])},
                "encoded_polyline": route_info.get("encoded_polyline"),
                "distance_km": route_info.get("distance_km"),
                "duration_minutes": route_info.get("duration_minutes"),
                "route_source": route_info.get("route_source"),
            }
        )

    current_loc = current_user.get("location")
    return {
        "markers": markers,
        "routes": routes,
        "missing_locations": missing_locations,
        "current_user_has_coordinates": _has_valid_coords(current_loc),
    }

