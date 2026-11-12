"""Intelligent Organization Matching, Multi-Org Splitting, and Intelligent Fallback Matching."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

from app.ml.demand_forecaster import demand_forecaster
from app.services.maps_service import haversine_km


# Storage compatibility matrix: what org capabilities can safely receive an item's storage requirement
STORAGE_COMPATIBILITY: Dict[str, List[str]] = {
    "ambient": ["ambient", "dry_bulk", "refrigerated"],
    "dry_bulk": ["dry_bulk", "ambient"],
    "refrigerated": ["refrigerated"],
    "frozen": ["frozen"],
}


def is_storage_compatible(item_storage: str, org_capabilities: List[str]) -> bool:
    allowed = STORAGE_COMPATIBILITY.get(item_storage, [item_storage])
    return any(cap in allowed for cap in (org_capabilities or []))


class MatchingEngine:
    """Matches surplus inventory across organizations with quantity splitting & Intelligent Fallback."""

    def _score_candidate(
        self,
        lot: Dict[str, Any],
        donor_loc: Dict[str, Any],
        org: Dict[str, Any],
        active_allocated_kg: float,
        radius_limit_km: float,
        is_fallback: bool,
        fallback_tier: Optional[str],
    ) -> Dict[str, Any] | None:
        if not org.get("verified", False):
            return None
        org_loc = org.get("location") or {}
        dist_km = haversine_km(
            float(donor_loc["lat"]),
            float(donor_loc["lng"]),
            float(org_loc["lat"]),
            float(org_loc["lng"]),
        )
        if dist_km > radius_limit_km:
            return None

        if not is_storage_compatible(lot["storage_requirement"], org.get("storage_capabilities", [])):
            return None

        forecast = demand_forecaster.predict_organization_demand(
            org,
            category=str(lot["category"]),
            active_allocated_kg=active_allocated_kg,
        )
        remaining_cap = forecast["remaining_capacity_kg"]
        if remaining_cap < 3.0:
            return None

        # Multi-factor match score (0..100)
        proximity_score = max(0.0, 100.0 * (1.0 - (dist_km / max(radius_limit_km, 1.0)) * 0.75))
        urgency_score = forecast["urgency_score"]
        demand_fit = min(100.0, (forecast["predicted_daily_need_kg"] / max(float(lot["quantity_kg"]), 1.0)) * 100.0)
        capacity_fit = min(100.0, (remaining_cap / max(float(lot["quantity_kg"]), 1.0)) * 100.0)

        # Category preference boost if org historically needs this food category
        preferred_cats = org.get("preferred_categories") or []
        cat_bonus = 6.0 if lot["category"] in preferred_cats else 0.0

        composite = round(
            min(
                99.5,
                0.35 * proximity_score + 0.30 * urgency_score + 0.20 * demand_fit + 0.15 * capacity_fit + cat_bonus,
            ),
            1,
        )

        return {
            "organization_id": org["id"],
            "organization_name": org["organization_name"],
            "organization_type": org.get("organization_type", "ngo"),
            "location": org_loc,
            "distance_km": round(dist_km, 2),
            "storage_capabilities": org.get("storage_capabilities", []),
            "predicted_daily_need_kg": forecast["predicted_daily_need_kg"],
            "remaining_capacity_kg": remaining_cap,
            "urgency_score": urgency_score,
            "match_score": composite,
            "is_fallback_match": is_fallback,
            "fallback_tier": fallback_tier,
            "search_radius_km": radius_limit_km,
            "forecast_7d": forecast["forecast_7d"],
        }

    async def compute_allocations(
        self,
        db: Any,
        lot: Dict[str, Any],
        donor: Dict[str, Any],
        primary_radius_km: float = 10.0,
        allow_split_allocation: bool = True,
        activate_fallback_if_needed: bool = True,
        max_fallback_radius_km: float = 75.0,
    ) -> Dict[str, Any]:
        """Runs primary matching, multi-org quantity splitting, and Intelligent Fallback Matching."""
        total_qty = float(lot["quantity_kg"])
        # Account for already active non-declined allocations on this lot
        existing_allocs = await db["allocations"].find(
            {"inventory_id": lot["id"], "status": {"$ne": "declined"}}
        ).to_list(length=500)
        already_allocated = sum(float(a["allocated_kg"]) for a in existing_allocs)
        existing_org_ids = {a["organization_id"] for a in existing_allocs}
        needed_qty = round(max(0.0, total_qty - already_allocated), 2)

        if needed_qty <= 0.1:
            return {
                "inventory_id": lot["id"],
                "requested_kg": 0.0,
                "allocated_kg": 0.0,
                "unallocated_kg": 0.0,
                "split_count": len(existing_allocs),
                "fallback_activated": False,
                "fallback_reasons": [],
                "expanded_radius_km": primary_radius_km,
                "proposed_allocations": [],
                "storage_hub_options": [],
                "future_matching_windows": [],
            }

        orgs = await db["users"].find({"role": "organization", "verified": True}).to_list(length=500)

        # Compute current active allocation load per organization
        all_open_allocs = await db["allocations"].find(
            {"status": {"$in": ["proposed", "accepted", "awaiting_safety_approval", "confirmed", "in_delivery"]}}
        ).to_list(length=2000)
        org_load: Dict[str, float] = {}
        for a in all_open_allocs:
            org_load[a["organization_id"]] = org_load.get(a["organization_id"], 0.0) + float(a["allocated_kg"])

        donor_loc = donor.get("location") or lot.get("pickup_location") or {}

        # --- Phase 1: Primary Radius Matching ---
        primary_candidates: List[Dict[str, Any]] = []
        for org in orgs:
            if org["id"] in existing_org_ids:
                continue
            cand = self._score_candidate(
                lot=lot,
                donor_loc=donor_loc,
                org=org,
                active_allocated_kg=org_load.get(org["id"], 0.0),
                radius_limit_km=primary_radius_km,
                is_fallback=False,
                fallback_tier=None,
            )
            if cand:
                primary_candidates.append(cand)

        primary_candidates.sort(key=lambda c: c["match_score"], reverse=True)

        proposed: List[Dict[str, Any]] = []
        remaining_to_allocate = needed_qty

        def _allocate_from_pool(pool: List[Dict[str, Any]]) -> None:
            nonlocal remaining_to_allocate
            for cand in pool:
                if remaining_to_allocate <= 0.1:
                    break
                if not allow_split_allocation and proposed:
                    break
                # Allocate up to org's remaining capacity & daily demand ceiling (allow up to 105% of remaining capacity)
                take_cap = min(cand["remaining_capacity_kg"], max(cand["predicted_daily_need_kg"], cand["remaining_capacity_kg"] * 0.9))
                take_kg = round(min(remaining_to_allocate, take_cap), 1)
                if take_kg < 2.0 and remaining_to_allocate >= 2.0:
                    continue
                if take_kg <= 0:
                    continue
                proposed.append({**cand, "allocated_kg": take_kg})
                existing_org_ids.add(cand["organization_id"])
                remaining_to_allocate = round(max(0.0, remaining_to_allocate - take_kg), 1)

        _allocate_from_pool(primary_candidates)

        # --- Phase 2: Intelligent Fallback Matching ---
        fallback_activated = False
        fallback_reasons: List[str] = []
        expanded_radius_km = primary_radius_km
        storage_hub_options: List[Dict[str, Any]] = []
        future_windows: List[Dict[str, Any]] = []

        if remaining_to_allocate > 0.5 and activate_fallback_if_needed:
            fallback_activated = True
            if not primary_candidates:
                fallback_reasons.append(
                    f"No storage-compatible verified organizations with spare capacity found within {primary_radius_km} km primary radius."
                )
            else:
                fallback_reasons.append(
                    f"Primary radius ({primary_radius_km} km) covered {round(needed_qty - remaining_to_allocate, 1)} kg; "
                    f"{remaining_to_allocate} kg remains unallocated — expanding search for multi-organization split & hubs."
                )

            # Progressive radius expansion tiers
            tiers: List[Tuple[str, float]] = []
            for label, r in [
                ("tier_1_metro", max(primary_radius_km * 2.5, 25.0)),
                ("tier_2_corridor", max(primary_radius_km * 5.0, 50.0)),
                ("tier_3_regional", max_fallback_radius_km),
            ]:
                if r > primary_radius_km and r <= max_fallback_radius_km:
                    tiers.append((label, r))
            if not tiers or tiers[-1][1] < max_fallback_radius_km:
                tiers.append(("tier_max_regional", max_fallback_radius_km))

            for tier_label, radius in tiers:
                if remaining_to_allocate <= 0.5:
                    break
                expanded_radius_km = radius
                tier_candidates: List[Dict[str, Any]] = []
                for org in orgs:
                    if org["id"] in existing_org_ids:
                        continue
                    cand = self._score_candidate(
                        lot=lot,
                        donor_loc=donor_loc,
                        org=org,
                        active_allocated_kg=org_load.get(org["id"], 0.0),
                        radius_limit_km=radius,
                        is_fallback=True,
                        fallback_tier=tier_label,
                    )
                    if cand:
                        tier_candidates.append(cand)
                tier_candidates.sort(key=lambda c: c["match_score"], reverse=True)
                _allocate_from_pool(tier_candidates)

            # Discover safe intermediate storage hubs if unallocated qty remains or for cold-chain staging
            hubs = await db["storage_hubs"].find({}).to_list(length=100)
            expires_at = lot["expires_at"]
            if isinstance(expires_at, str):
                expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            hours_left = (expires_at - datetime.now(timezone.utc)).total_seconds() / 3600.0

            for hub in hubs:
                hub_loc = hub.get("location") or {}
                dist_km = haversine_km(
                    float(donor_loc["lat"]),
                    float(donor_loc["lng"]),
                    float(hub_loc["lat"]),
                    float(hub_loc["lng"]),
                )
                if dist_km <= max_fallback_radius_km and is_storage_compatible(
                    lot["storage_requirement"], hub.get("storage_capabilities", [])
                ):
                    avail_kg = float(hub.get("available_capacity_kg", 0.0))
                    if avail_kg >= 10.0 and hours_left >= 12.0:
                        storage_hub_options.append(
                            {
                                "hub_id": hub["id"],
                                "hub_name": hub["name"],
                                "location": hub_loc,
                                "distance_km": round(dist_km, 2),
                                "available_capacity_kg": avail_kg,
                                "supported_storage": hub.get("storage_capabilities", []),
                                "safe_hold_hours": round(min(48.0, hours_left - 6.0), 1),
                                "reason": (
                                    f"Safe {lot['storage_requirement']} staging hub available for up to "
                                    f"{round(min(48.0, hours_left - 6.0), 1)}h while next-cycle recipient demand opens."
                                ),
                            }
                        )

            # Future scheduled matching windows if shelf life permits
            if remaining_to_allocate > 0.5 and hours_left >= 16.0:
                next_window = datetime.now(timezone.utc) + timedelta(hours=8)
                future_windows.append(
                    {
                        "window_start": next_window.isoformat(),
                        "window_label": "Next-Cycle Morning Recipient Intake (+8h)",
                        "remaining_kg": remaining_to_allocate,
                        "safe_buffer_hours": round(hours_left - 8.0, 1),
                        "recommendation": (
                            f"Hold {remaining_to_allocate} kg in certified {lot['storage_requirement']} staging; "
                            f"projected morning demand across 3 shelters clears remaining surplus safely with "
                            f"{round(hours_left - 8.0, 1)}h shelf-life margin."
                        ),
                    }
                )

        return {
            "inventory_id": lot["id"],
            "requested_kg": needed_qty,
            "allocated_kg": round(needed_qty - remaining_to_allocate, 1),
            "unallocated_kg": remaining_to_allocate,
            "split_count": len(proposed),
            "fallback_activated": fallback_activated,
            "fallback_reasons": fallback_reasons,
            "expanded_radius_km": expanded_radius_km,
            "proposed_allocations": proposed,
            "storage_hub_options": storage_hub_options,
            "future_matching_windows": future_windows,
        }


matching_engine = MatchingEngine()

