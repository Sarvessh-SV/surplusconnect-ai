"""Scikit-learn Predictive Demand Intelligence Engine for recipient organizations."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


ORG_TYPES = ["orphanage", "old_age_home", "ngo", "homeless_shelter", "food_bank", "community_kitchen"]
CATEGORIES = [
    "bakery",
    "produce",
    "dairy",
    "prepared_meals",
    "groceries",
    "frozen_goods",
    "beverages",
]


class DemandIntelligenceEngine:
    """Forecasts 7-day demand and urgency indices for recipient organizations using Scikit-learn."""

    def __init__(self) -> None:
        self._model: Pipeline | None = None
        self._train_initial_model()

    def _encode_rows(self, rows: List[Dict[str, Any]]) -> np.ndarray:
        mat: List[List[float]] = []
        for r in rows:
            org_vec = [1.0 if r.get("org_type") == t else 0.0 for t in ORG_TYPES]
            cat_vec = [1.0 if r.get("category") == c else 0.0 for c in CATEGORIES]
            dow = int(r.get("day_of_week", 2))
            dow_sin = float(np.sin(2 * np.pi * dow / 7.0))
            dow_cos = float(np.cos(2 * np.pi * dow / 7.0))
            nums = [
                float(r.get("daily_capacity_kg", 100.0)),
                float(r.get("current_utilization", 0.5)),
                float(r.get("urgency_bias", 0.5)),
                dow_sin,
                dow_cos,
            ]
            mat.append(org_vec + cat_vec + nums)
        return np.array(mat, dtype=float)

    def _train_initial_model(self) -> None:
        rng = np.random.default_rng(101)
        rows: List[Dict[str, Any]] = []
        targets: List[float] = []

        org_multiplier = {
            "orphanage": 0.68,
            "old_age_home": 0.62,
            "ngo": 0.80,
            "homeless_shelter": 0.88,
            "food_bank": 0.94,
            "community_kitchen": 0.85,
        }
        cat_weight = {
            "bakery": 0.20,
            "produce": 0.28,
            "dairy": 0.16,
            "prepared_meals": 0.30,
            "groceries": 0.25,
            "frozen_goods": 0.18,
            "beverages": 0.10,
        }

        for _ in range(420):
            ot = ORG_TYPES[int(rng.integers(0, len(ORG_TYPES)))]
            cat = CATEGORIES[int(rng.integers(0, len(CATEGORIES)))]
            cap = float(rng.uniform(45.0, 500.0))
            util = float(rng.uniform(0.15, 0.92))
            bias = float(rng.uniform(0.25, 0.95))
            dow = int(rng.integers(0, 7))
            weekend_boost = 1.14 if dow in (4, 5, 6) else 1.0

            demand = (
                cap
                * org_multiplier[ot]
                * (0.55 + cat_weight[cat])
                * (1.0 - 0.35 * util)
                * (0.75 + 0.45 * bias)
                * weekend_boost
            )
            demand = float(np.clip(demand + rng.normal(0, 3.5), 6.0, cap * 1.1))
            rows.append(
                {
                    "org_type": ot,
                    "category": cat,
                    "daily_capacity_kg": cap,
                    "current_utilization": util,
                    "urgency_bias": bias,
                    "day_of_week": dow,
                }
            )
            targets.append(demand)

        X = self._encode_rows(rows)
        self._model = Pipeline(
            [
                ("scaler", StandardScaler()),
                ("gbr", GradientBoostingRegressor(n_estimators=120, max_depth=4, random_state=42)),
            ]
        )
        self._model.fit(X, np.array(targets))

    def retrain_with_history(self, history_docs: List[Dict[str, Any]]) -> None:
        """Augments the baseline model with observed organization demand records from MongoDB."""
        if len(history_docs) < 10:
            return
        rows: List[Dict[str, Any]] = []
        targets: List[float] = []
        for d in history_docs:
            rows.append(
                {
                    "org_type": d.get("org_type", "ngo"),
                    "category": d.get("category", "groceries"),
                    "daily_capacity_kg": float(d.get("daily_capacity_kg", 100.0)),
                    "current_utilization": float(d.get("current_utilization", 0.5)),
                    "urgency_bias": float(d.get("urgency_bias", 0.6)),
                    "day_of_week": int(d.get("day_of_week", 2)),
                }
            )
            targets.append(float(d.get("observed_demand_kg", 40.0)))

        # Blend baseline synthetic priors + real observed records
        rng = np.random.default_rng(7)
        base_rows: List[Dict[str, Any]] = []
        base_targets: List[float] = []
        for r, y in zip(rows, targets):
            base_rows.append(r)
            base_targets.append(y)
        # Keep baseline generalization alongside observed records
        X_obs = self._encode_rows(base_rows)
        y_obs = np.array(base_targets)
        assert self._model is not None
        # Fit on combined dataset generated by refitting cleanly
        synth_rows = []
        synth_y = []
        for _ in range(250):
            ot = ORG_TYPES[int(rng.integers(0, len(ORG_TYPES)))]
            cat = CATEGORIES[int(rng.integers(0, len(CATEGORIES)))]
            cap = float(rng.uniform(45.0, 500.0))
            util = float(rng.uniform(0.15, 0.92))
            bias = float(rng.uniform(0.25, 0.95))
            dow = int(rng.integers(0, 7))
            pred = float(
                self._model.predict(
                    self._encode_rows(
                        [
                            {
                                "org_type": ot,
                                "category": cat,
                                "daily_capacity_kg": cap,
                                "current_utilization": util,
                                "urgency_bias": bias,
                                "day_of_week": dow,
                            }
                        ]
                    )
                )[0]
            )
            synth_rows.append(
                {
                    "org_type": ot,
                    "category": cat,
                    "daily_capacity_kg": cap,
                    "current_utilization": util,
                    "urgency_bias": bias,
                    "day_of_week": dow,
                }
            )
            synth_y.append(pred)

        X_all = np.vstack([self._encode_rows(synth_rows), X_obs, X_obs])
        y_all = np.concatenate([np.array(synth_y), y_obs, y_obs])
        self._model.fit(X_all, y_all)

    def predict_organization_demand(
        self,
        org_doc: Dict[str, Any],
        category: str = "prepared_meals",
        active_allocated_kg: float = 0.0,
    ) -> Dict[str, Any]:
        """Produces today's demand score and 7-day forecast for an organization."""
        assert self._model is not None
        now = datetime.now(timezone.utc)
        capacity = float(org_doc.get("daily_capacity_kg") or 120.0)
        utilization = float(np.clip(active_allocated_kg / max(capacity, 1.0), 0.0, 0.98))
        org_type = str(org_doc.get("organization_type") or "ngo").lower().replace(" ", "_")
        if org_type not in ORG_TYPES:
            org_type = "ngo"
        urgency_bias = float(org_doc.get("urgency_bias", 0.72))

        forecast_7d: List[Dict[str, Any]] = []
        for offset in range(7):
            day = now + timedelta(days=offset)
            X = self._encode_rows(
                [
                    {
                        "org_type": org_type,
                        "category": category if category in CATEGORIES else "groceries",
                        "daily_capacity_kg": capacity,
                        "current_utilization": utilization if offset == 0 else max(0.25, utilization * 0.65),
                        "urgency_bias": urgency_bias,
                        "day_of_week": day.weekday(),
                    }
                ]
            )
            pred_kg = float(np.clip(self._model.predict(X)[0], 5.0, capacity))
            forecast_7d.append(
                {
                    "date": day.strftime("%Y-%m-%d"),
                    "day_label": day.strftime("%a"),
                    "predicted_need_kg": round(pred_kg, 1),
                    "confidence_low_kg": round(max(2.0, pred_kg * 0.88), 1),
                    "confidence_high_kg": round(min(capacity * 1.05, pred_kg * 1.12), 1),
                }
            )

        today_need = forecast_7d[0]["predicted_need_kg"]
        remaining_capacity = max(0.0, round(capacity - active_allocated_kg, 1))
        demand_gap_ratio = today_need / max(remaining_capacity, 1.0) if remaining_capacity > 0 else 0.0
        urgency_score = float(
            np.clip(
                (1.0 - utilization) * 45.0 + urgency_bias * 38.0 + min(demand_gap_ratio, 1.5) * 17.0,
                12.0,
                99.0,
            )
        )

        return {
            "organization_id": org_doc["id"],
            "organization_name": org_doc["organization_name"],
            "organization_type": org_type,
            "daily_capacity_kg": capacity,
            "active_allocated_kg": round(active_allocated_kg, 1),
            "remaining_capacity_kg": remaining_capacity,
            "predicted_daily_need_kg": today_need,
            "urgency_score": round(urgency_score, 1),
            "forecast_7d": forecast_7d,
        }


demand_forecaster = DemandIntelligenceEngine()

