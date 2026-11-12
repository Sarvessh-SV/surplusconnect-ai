"""Social impact and platform analytics endpoints (explicitly separating live vs demo-seed data)."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter

from app.config import get_settings
from app.database import get_db

router = APIRouter(prefix="/api/analytics", tags=["Impact Analytics"])


@router.get("/impact")
async def get_social_impact_metrics() -> Dict[str, Any]:
    """Computes real rescued inventory, meal equivalents, CO2e avoided, and funding volume from MongoDB."""
    db = get_db()
    settings = get_settings()
    prod_filter: Dict[str, Any] = {} if settings.is_dev_seed_enabled else {"is_demo_seed": {"$ne": True}}

    deliveries = await db["deliveries"].find(prod_filter).to_list(length=1000)
    lots = await db["inventory_lots"].find(prod_filter).to_list(length=1000)
    txns = await db["transactions"].find({**prod_filter, "status": "COMPLETED"}).to_list(length=1000)
    orgs = await db["users"].count_documents({**prod_filter, "role": "organization", "verified": True})
    businesses = await db["users"].count_documents({**prod_filter, "role": "business", "verified": True})

    def _calc(subset_deliv, subset_txns):
        kg = round(sum(float(d.get("allocated_kg", 0.0)) for d in subset_deliv if d.get("status") == "delivered"), 1)
        meals = int(round(kg * 2.5))
        co2e_kg = round(kg * 2.5, 1)  # Standard EPA/WRAP food-waste rescue conversion (~2.5 kg CO2e per kg food rescued)
        funding_usd = round(
            sum(float(t.get("amount_usd", 0.0)) for t in subset_txns if t.get("type") == "sponsor_contribution"), 2
        )
        completed_count = sum(1 for d in subset_deliv if d.get("status") == "delivered")
        return {
            "completed_deliveries": completed_count,
            "rescued_kg": kg,
            "meals_equivalent": meals,
            "co2e_avoided_kg": co2e_kg,
            "funding_volume_usd": funding_usd,
        }

    live_deliv = [d for d in deliveries if not d.get("is_demo_seed", False)]
    seed_deliv = [d for d in deliveries if d.get("is_demo_seed", False)]
    live_txns = [t for t in txns if not t.get("is_demo_seed", False)]
    seed_txns = [t for t in txns if t.get("is_demo_seed", False)]

    category_breakdown: Dict[str, float] = {}
    for lot in lots:
        cat = str(lot.get("category", "other"))
        category_breakdown[cat] = round(category_breakdown.get(cat, 0.0) + float(lot.get("quantity_kg", 0.0)), 1)

    fallback_rescues = sum(1 for lot in lots if lot.get("fallback_activated"))

    return {
        "live_metrics": _calc(live_deliv, live_txns),
        "demo_seed_metrics": _calc(seed_deliv, seed_txns),
        "combined_metrics": _calc(deliveries, txns),
        "registered_organizations": orgs,
        "registered_businesses": businesses,
        "active_inventory_lots": len(lots),
        "fallback_activations": fallback_rescues,
        "category_breakdown": [
            {"category": k, "quantity_kg": v} for k, v in sorted(category_breakdown.items(), key=lambda x: -x[1])
        ],
    }

