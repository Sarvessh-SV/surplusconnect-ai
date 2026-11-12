"""Predictive Demand Intelligence endpoints powered by Scikit-learn."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import get_current_user, require_roles
from app.database import db_manager, get_db
from app.ml.demand_forecaster import demand_forecaster
from app.models.schemas import FoodCategory, UserRole

router = APIRouter(prefix="/api/demand", tags=["Predictive Demand Intelligence"])


class DemandSignalRequest(BaseModel):
    category: FoodCategory
    daily_capacity_kg: float = Field(..., ge=10.0, le=20000.0)
    urgency_bias: float = Field(..., ge=0.1, le=1.0)


@router.get("/intelligence")
async def get_demand_intelligence(
    category: str = "prepared_meals",
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    db = get_db()
    orgs = await db["users"].find({"role": "organization", "verified": True}).to_list(length=300)
    open_allocs = await db["allocations"].find(
        {"status": {"$in": ["proposed", "accepted", "awaiting_safety_approval", "confirmed", "in_delivery"]}}
    ).to_list(length=2000)
    load_map: Dict[str, float] = {}
    for a in open_allocs:
        load_map[a["organization_id"]] = load_map.get(a["organization_id"], 0.0) + float(a["allocated_kg"])

    forecasts: List[Dict[str, Any]] = []
    for org in orgs:
        pred = demand_forecaster.predict_organization_demand(
            org_doc=org,
            category=category,
            active_allocated_kg=load_map.get(org["id"], 0.0),
        )
        pred["location"] = org.get("location")
        pred["storage_capabilities"] = org.get("storage_capabilities", [])
        forecasts.append(pred)

    forecasts.sort(key=lambda f: f["urgency_score"], reverse=True)

    # Aggregate 7-day regional forecast curve
    regional_7d: List[Dict[str, Any]] = []
    if forecasts:
        num_days = len(forecasts[0]["forecast_7d"])
        for i in range(num_days):
            day_entry = forecasts[0]["forecast_7d"][i]
            regional_7d.append(
                {
                    "date": day_entry["date"],
                    "day_label": day_entry["day_label"],
                    "total_predicted_need_kg": round(sum(f["forecast_7d"][i]["predicted_need_kg"] for f in forecasts), 1),
                    "total_confidence_low_kg": round(sum(f["forecast_7d"][i]["confidence_low_kg"] for f in forecasts), 1),
                    "total_confidence_high_kg": round(sum(f["forecast_7d"][i]["confidence_high_kg"] for f in forecasts), 1),
                }
            )

    return {
        "model": "scikit_learn_GradientBoostingRegressor",
        "category_evaluated": category,
        "organizations": forecasts,
        "regional_7d_forecast": regional_7d,
    }


@router.post("/signals")
async def update_org_demand_signal(
    payload: DemandSignalRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ORGANIZATION, UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    now = datetime.now(timezone.utc)
    await db["users"].update_one(
        {"id": current_user["id"]},
        {
            "$set": {
                "daily_capacity_kg": payload.daily_capacity_kg,
                "urgency_bias": payload.urgency_bias,
            },
            "$addToSet": {"preferred_categories": payload.category.value},
        },
    )
    await db["demand_history"].insert_one(
        {
            "organization_id": current_user["id"],
            "org_type": current_user.get("organization_type", "ngo"),
            "category": payload.category.value,
            "daily_capacity_kg": payload.daily_capacity_kg,
            "current_utilization": 0.35,
            "urgency_bias": payload.urgency_bias,
            "day_of_week": now.weekday(),
            "observed_demand_kg": round(payload.daily_capacity_kg * payload.urgency_bias, 1),
            "is_demo_seed": False,
            "created_at": now,
        }
    )
    history = await db["demand_history"].find({}).to_list(length=500)
    demand_forecaster.retrain_with_history(history)
    await db_manager.maybe_persist()

    updated_org = await db["users"].find_one({"id": current_user["id"]})
    forecast = demand_forecaster.predict_organization_demand(updated_org or current_user, category=payload.category.value)
    return {"updated_forecast": forecast}

