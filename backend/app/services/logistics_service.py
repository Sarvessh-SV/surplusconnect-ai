"""AI Logistics Optimization: vehicle sizing, cost estimation, partner ranking, and routing."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.services.maps_service import haversine_km, maps_service


class LogisticsService:
    """Computes transport requirements, cost estimates, and partner rankings."""

    def determine_vehicle_requirements(self, storage_requirement: str, weight_kg: float) -> Dict[str, Any]:
        needs_cold_chain = storage_requirement in {"refrigerated", "frozen"}
        if needs_cold_chain:
            vehicle_class = "refrigerated_box_truck" if weight_kg > 220 else "refrigerated_van"
            temp_range = "-18C to -12C" if storage_requirement == "frozen" else "2C to 4C"
        elif weight_kg <= 35:
            vehicle_class = "cargo_ebike_or_compact_van"
            temp_range = "Ambient 15C to 22C"
        elif weight_kg <= 250:
            vehicle_class = "insulated_cargo_van"
            temp_range = "Ambient 15C to 22C"
        else:
            vehicle_class = "commercial_box_truck"
            temp_range = "Ambient 15C to 22C"

        return {
            "required_vehicle_class": vehicle_class,
            "cold_chain_required": needs_cold_chain,
            "target_temperature": temp_range,
            "estimated_crates": max(1, int((weight_kg + 14) // 15)),
            "handling_crew": 2 if weight_kg > 150 else 1,
        }

    def estimate_delivery_cost(
        self,
        distance_km: float,
        weight_kg: float,
        storage_requirement: str,
        is_fallback: bool = False,
    ) -> Dict[str, Any]:
        base_dispatch = 12.0
        per_km_rate = 1.65 if storage_requirement in {"refrigerated", "frozen"} else 1.25
        distance_fee = round(distance_km * per_km_rate, 2)
        weight_fee = round(max(2.5, weight_kg * 0.14), 2)
        cold_chain_fee = round(8.50 if storage_requirement in {"refrigerated", "frozen"} else 0.0, 2)
        corridor_surcharge = round(6.00 if (is_fallback and distance_km > 20.0) else 0.0, 2)
        total = round(base_dispatch + distance_fee + weight_fee + cold_chain_fee + corridor_surcharge, 2)

        return {
            "base_dispatch_usd": base_dispatch,
            "distance_fee_usd": distance_fee,
            "weight_handling_usd": weight_fee,
            "cold_chain_surcharge_usd": cold_chain_fee,
            "fallback_corridor_usd": corridor_surcharge,
            "total_estimated_cost_usd": total,
        }

    async def recommend_partners_and_route(
        self,
        db: Any,
        origin_loc: Dict[str, Any],
        dest_loc: Dict[str, Any],
        weight_kg: float,
        storage_requirement: str,
        is_fallback: bool = False,
        travel_mode: str = "DRIVE",
    ) -> Dict[str, Any]:
        vehicle_req = self.determine_vehicle_requirements(storage_requirement, weight_kg)
        route = await maps_service.compute_route(
            origin_lat=float(origin_loc["lat"]),
            origin_lng=float(origin_loc["lng"]),
            dest_lat=float(dest_loc["lat"]),
            dest_lng=float(dest_loc["lng"]),
            travel_mode=travel_mode,
        )
        cost = self.estimate_delivery_cost(
            distance_km=route["distance_km"],
            weight_kg=weight_kg,
            storage_requirement=storage_requirement,
            is_fallback=is_fallback,
        )

        partners = await db["users"].find({"role": "delivery_partner", "verified": True}).to_list(length=200)
        ranked: List[Dict[str, Any]] = []
        for p in partners:
            cap = float(p.get("vehicle_capacity_kg") or 300.0)
            if cap < weight_kg:
                continue
            cold_ok = bool(p.get("cold_chain_certified", False))
            if vehicle_req["cold_chain_required"] and not cold_ok:
                continue

            p_loc = p.get("location") or origin_loc
            deadhead_km = haversine_km(
                float(p_loc["lat"]),
                float(p_loc["lng"]),
                float(origin_loc["lat"]),
                float(origin_loc["lng"]),
            )
            rating = float(p.get("rating", 4.8))
            score = round(
                max(
                    10.0,
                    min(
                        99.0,
                        88.0 - deadhead_km * 1.4 + (8.0 if cold_ok else 0.0) + (rating - 4.0) * 6.0,
                    ),
                ),
                1,
            )
            ranked.append(
                {
                    "partner_id": p["id"],
                    "partner_name": p["organization_name"],
                    "contact_name": p["full_name"],
                    "vehicle_type": p.get("vehicle_type", "van"),
                    "vehicle_capacity_kg": cap,
                    "cold_chain_certified": cold_ok,
                    "deadhead_km": round(deadhead_km, 2),
                    "rating": rating,
                    "paypal_payout_email": p.get("paypal_payout_email") or p["email"],
                    "suitability_score": score,
                }
            )

        ranked.sort(key=lambda r: r["suitability_score"], reverse=True)
        return {
            "vehicle_requirements": vehicle_req,
            "route": route,
            "cost_breakdown": cost,
            "recommended_partners": ranked,
        }


logistics_service = LogisticsService()

