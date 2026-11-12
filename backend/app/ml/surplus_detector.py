"""Scikit-learn AI Surplus Detection and Food-Safety / Expiry Validation Engine."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor, RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

CATEGORIES = [
    "bakery",
    "produce",
    "dairy",
    "prepared_meals",
    "groceries",
    "frozen_goods",
    "beverages",
]
STORAGE_TYPES = ["ambient", "dry_bulk", "refrigerated", "frozen"]

# Valid category -> allowed storage combinations for food-safety validation
CATEGORY_STORAGE_RULES: Dict[str, List[str]] = {
    "bakery": ["ambient", "refrigerated", "frozen"],
    "produce": ["ambient", "refrigerated"],
    "dairy": ["refrigerated", "frozen"],
    "prepared_meals": ["refrigerated", "frozen"],
    "groceries": ["ambient", "dry_bulk", "refrigerated"],
    "frozen_goods": ["frozen"],
    "beverages": ["ambient", "dry_bulk", "refrigerated"],
}


class SurplusDetectionEngine:
    """Trains and serves Scikit-learn models for surplus detection and spoilage urgency."""

    def __init__(self) -> None:
        self._surplus_clf: Pipeline | None = None
        self._urgency_reg: Pipeline | None = None
        self._trained: bool = False
        self._train_baseline_models()

    def _build_training_data(self) -> tuple[List[Dict[str, Any]], np.ndarray, np.ndarray]:
        rng = np.random.default_rng(42)
        rows: List[Dict[str, Any]] = []
        y_surplus: List[int] = []
        y_urgency: List[float] = []

        perishability_map = {
            "prepared_meals": 0.95,
            "dairy": 0.85,
            "produce": 0.78,
            "bakery": 0.72,
            "frozen_goods": 0.35,
            "groceries": 0.25,
            "beverages": 0.20,
        }
        storage_decay_map = {
            "ambient": 1.0,
            "dry_bulk": 0.55,
            "refrigerated": 0.75,
            "frozen": 0.35,
        }

        for _ in range(360):
            cat = CATEGORIES[int(rng.integers(0, len(CATEGORIES)))]
            allowed = CATEGORY_STORAGE_RULES[cat]
            storage = allowed[int(rng.integers(0, len(allowed)))]
            qty = float(rng.uniform(8.0, 320.0))
            turnover = float(rng.uniform(25.0, 220.0))
            ratio = qty / max(turnover, 1.0)
            hours_left = float(rng.uniform(3.0, 240.0))
            perish = perishability_map[cat] * storage_decay_map[storage]

            # Surplus likelihood rises when lot exceeds remaining shelf turnover window
            surplus_signal = (ratio * 1.15) + (perish * 0.45) - (hours_left / 260.0)
            is_surplus = 1 if surplus_signal > 0.72 else 0

            # Spoilage urgency score (0..100)
            time_pressure = np.clip(100.0 * np.exp(-hours_left / (36.0 if perish > 0.6 else 96.0)), 4.0, 99.0)
            urgency = float(np.clip(time_pressure * (0.65 + 0.45 * perish) + rng.normal(0, 2.5), 5.0, 99.5))

            rows.append(
                {
                    "category": cat,
                    "storage": storage,
                    "quantity_kg": qty,
                    "turnover_kg": turnover,
                    "qty_turnover_ratio": ratio,
                    "hours_left": hours_left,
                }
            )
            y_surplus.append(is_surplus)
            y_urgency.append(urgency)

        return rows, np.array(y_surplus), np.array(y_urgency)

    def _to_feature_matrix(self, rows: List[Dict[str, Any]]) -> np.ndarray:
        # Encode as structured object array via manual categorical + numeric columns for pure numpy/sklearn compatibility
        cat_idx = {c: i for i, c in enumerate(CATEGORIES)}
        sto_idx = {s: i for i, s in enumerate(STORAGE_TYPES)}
        mat = []
        for r in rows:
            cat_vec = [1.0 if r["category"] == c else 0.0 for c in CATEGORIES]
            sto_vec = [1.0 if r["storage"] == s else 0.0 for s in STORAGE_TYPES]
            num_vec = [
                float(r["quantity_kg"]),
                float(r["turnover_kg"]),
                float(r["qty_turnover_ratio"]),
                float(r["hours_left"]),
            ]
            mat.append(cat_vec + sto_vec + num_vec)
        return np.array(mat, dtype=float)

    def _train_baseline_models(self) -> None:
        rows, y_surplus, y_urgency = self._build_training_data()
        X = self._to_feature_matrix(rows)

        self._surplus_clf = Pipeline(
            [
                ("scaler", StandardScaler()),
                ("clf", RandomForestClassifier(n_estimators=90, max_depth=8, random_state=42)),
            ]
        )
        self._surplus_clf.fit(X, y_surplus)

        self._urgency_reg = Pipeline(
            [
                ("scaler", StandardScaler()),
                ("reg", GradientBoostingRegressor(n_estimators=110, max_depth=4, random_state=42)),
            ]
        )
        self._urgency_reg.fit(X, y_urgency)
        self._trained = True

    def validate_and_analyze(self, lot: Dict[str, Any]) -> Dict[str, Any]:
        """Performs strict food-safety/expiry validation plus ML surplus & urgency scoring."""
        now = datetime.now(timezone.utc)
        expires_at = lot["expires_at"]
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        hours_until_expiry = (expires_at - now).total_seconds() / 3600.0
        category = str(lot["category"])
        storage = str(lot["storage_requirement"])
        quantity_kg = float(lot["quantity_kg"])
        turnover_kg = float(lot.get("historical_daily_turnover_kg") or 80.0)
        allergens = lot.get("allergens") or []

        risk_flags: List[str] = []
        allowed_storages = CATEGORY_STORAGE_RULES.get(category, STORAGE_TYPES)
        storage_valid = storage in allowed_storages

        if not storage_valid:
            risk_flags.append(
                f"Unsafe storage mismatch: '{category}' requires {allowed_storages}, got '{storage}'."
            )

        if hours_until_expiry <= 0:
            risk_flags.append("Item is already expired and blocked from redistribution.")
            return {
                "is_eligible": False,
                "safety_status": "blocked_expired",
                "requires_safety_approval": False,
                "surplus_probability": 0.0,
                "spoilage_urgency_score": 100.0,
                "hours_until_expiry": round(hours_until_expiry, 2),
                "recommended_rescue_window_hours": 0.0,
                "quality_risk_flags": risk_flags,
                "storage_validation_notes": "Blocked: expiry timestamp is in the past.",
            }

        # Strict minimum safe transit/handling buffer
        min_safe_hours = 3.0 if category in ("prepared_meals", "dairy", "frozen_goods") else 2.0
        if not storage_valid or hours_until_expiry < min_safe_hours:
            if hours_until_expiry < min_safe_hours:
                risk_flags.append(
                    f"Insufficient shelf life ({hours_until_expiry:.1f}h < {min_safe_hours:.1f}h minimum handling buffer)."
                )
            return {
                "is_eligible": False,
                "safety_status": "blocked_unsafe",
                "requires_safety_approval": False,
                "surplus_probability": 0.0,
                "spoilage_urgency_score": 99.0,
                "hours_until_expiry": round(hours_until_expiry, 2),
                "recommended_rescue_window_hours": 0.0,
                "quality_risk_flags": risk_flags,
                "storage_validation_notes": "Blocked by food-safety & storage validation rules.",
            }

        # ML prediction
        X = self._to_feature_matrix(
            [
                {
                    "category": category if category in CATEGORIES else "groceries",
                    "storage": storage if storage in STORAGE_TYPES else "ambient",
                    "quantity_kg": quantity_kg,
                    "turnover_kg": turnover_kg,
                    "qty_turnover_ratio": quantity_kg / max(turnover_kg, 1.0),
                    "hours_left": min(hours_until_expiry, 240.0),
                }
            ]
        )

        assert self._surplus_clf is not None and self._urgency_reg is not None
        surplus_prob = float(self._surplus_clf.predict_proba(X)[0][1])
        urgency_score = float(np.clip(self._urgency_reg.predict(X)[0], 5.0, 99.0))

        # Determine human food-safety approval triggers
        requires_safety_approval = False
        if hours_until_expiry <= 18.0:
            requires_safety_approval = True
            risk_flags.append(f"Short remaining shelf life ({hours_until_expiry:.1f}h); requires food-safety sign-off.")
        if category == "prepared_meals":
            requires_safety_approval = True
            risk_flags.append("Prepared meals require temperature & preparation-time verification before dispatch.")
        if storage in ("refrigerated", "frozen") and quantity_kg >= 90.0:
            requires_safety_approval = True
            risk_flags.append("High-volume cold-chain lot requires continuous cold-chain compliance check.")
        if allergens:
            risk_flags.append(f"Declared allergens: {', '.join(allergens)}.")

        recommended_window = round(max(1.5, min(hours_until_expiry * 0.45, 24.0)), 1)
        storage_note = (
            f"Validated: '{category}' stored under '{storage}' meets food-safety rules "
            f"({hours_until_expiry:.1f}h remaining)."
        )
        safety_status = "requires_human_review" if requires_safety_approval else "safe"

        return {
            "is_eligible": True,
            "safety_status": safety_status,
            "requires_safety_approval": requires_safety_approval,
            "surplus_probability": round(surplus_prob, 3),
            "spoilage_urgency_score": round(urgency_score, 1),
            "hours_until_expiry": round(hours_until_expiry, 2),
            "recommended_rescue_window_hours": recommended_window,
            "quality_risk_flags": risk_flags,
            "storage_validation_notes": storage_note,
        }


surplus_detector = SurplusDetectionEngine()

