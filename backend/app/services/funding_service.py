"""Intelligent Funding Allocation service for delivery & rescue operations."""

from __future__ import annotations

from typing import Any, Dict


class FundingService:
    """Recommends optimal funding split (self-funded, sponsor-funded, or shared) and tracks campaign progress."""

    def recommend_funding_allocation(
        self,
        estimated_cost_usd: float,
        org_doc: Dict[str, Any],
        urgency_score: float,
        is_fallback: bool = False,
    ) -> Dict[str, Any]:
        org_type = str(org_doc.get("organization_type") or "ngo").lower()
        monthly_budget = float(org_doc.get("monthly_logistics_budget_usd", 180.0))

        # High-need charitable homes & urgent/fallback rescues prioritize sponsor or shared funding
        if org_type in {"orphanage", "homeless_shelter", "old_age_home"} or is_fallback or urgency_score >= 78.0:
            if estimated_cost_usd <= 22.0 and monthly_budget >= 250.0:
                mode = "shared_funding"
                self_pct = 30.0
                rationale = (
                    f"Shared Funding (30% organization / 70% sponsor) balances rapid dispatch for "
                    f"{org_doc['organization_name']} while preserving charitable shelter budget."
                )
            else:
                mode = "sponsor_funded"
                self_pct = 0.0
                rationale = (
                    f"100% Sponsor-Funded rescue recommended due to {org_type.replace('_', ' ')} profile, "
                    f"urgency score {urgency_score:.1f}/100, and ${estimated_cost_usd:.2f} logistics cost."
                )
        elif monthly_budget >= 400.0 and estimated_cost_usd <= 35.0:
            mode = "self_funded"
            self_pct = 100.0
            rationale = (
                f"Self-funded delivery recommended: {org_doc['organization_name']} holds sufficient "
                f"operational budget (${monthly_budget:.0f}/mo) for immediate dispatch."
            )
        else:
            mode = "shared_funding"
            self_pct = 40.0
            rationale = (
                f"Shared Funding (40% organization / 60% sponsor) maximizes sponsor leverage for "
                f"${estimated_cost_usd:.2f} rescue transport."
            )

        self_amount = round(estimated_cost_usd * (self_pct / 100.0), 2)
        sponsor_amount = round(max(0.0, estimated_cost_usd - self_amount), 2)
        return {
            "recommended_mode": mode,
            "self_funded_share_pct": self_pct,
            "self_funded_amount_usd": self_amount,
            "sponsor_target_amount_usd": sponsor_amount,
            "total_required_usd": round(estimated_cost_usd, 2),
            "rationale": rationale,
        }


funding_service = FundingService()

