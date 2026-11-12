"""Google Gemini API service using the official google-genai SDK (Interactions API)."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from google import genai
from pydantic import BaseModel, Field

from app.config import get_settings

logger = logging.getLogger(__name__)


class SurplusSafetyBrief(BaseModel):
    executive_summary: str = Field(description="Concise 2-sentence explanation of surplus urgency and safety.")
    packaging_recommendation: str = Field(description="Handling and packaging advice for transit.")
    safety_attention_points: List[str] = Field(description="Key food-safety checkpoints for human reviewer.")


class CoordinationRecommendation(BaseModel):
    headline: str = Field(description="Short action summary of the coordination plan.")
    rationale: str = Field(description="Explainable reasoning behind organization matching, fallback, and funding.")
    risk_assessment: str = Field(description="Food safety and financial compliance considerations.")
    recommended_next_action: str = Field(description="Next concrete workflow step.")


class GeminiService:
    """Wrapper over google-genai Interactions API with gemini-3.8-flash and transparent fallback."""

    def _get_client(self) -> Optional[genai.Client]:
        settings = get_settings()
        if not settings.has_gemini:
            return None
        return genai.Client(api_key=settings.GEMINI_API_KEY)

    async def explain_surplus_lot(
        self,
        lot: Dict[str, Any],
        ml_analysis: Dict[str, Any],
    ) -> Dict[str, Any]:
        settings = get_settings()
        client = self._get_client()

        if client is not None:
            prompt = (
                "You are a food-safety and surplus redistribution specialist at SurplusConnect AI.\n"
                f"Inventory Title: {lot.get('title')}\n"
                f"Category: {lot.get('category')}, Quantity: {lot.get('quantity_kg')} kg\n"
                f"Storage Requirement: {lot.get('storage_requirement')}\n"
                f"Packaging: {lot.get('packaging_type')}, Allergens: {lot.get('allergens')}\n"
                f"ML Analysis: safety_status={ml_analysis.get('safety_status')}, "
                f"hours_until_expiry={ml_analysis.get('hours_until_expiry')}, "
                f"surplus_probability={ml_analysis.get('surplus_probability')}, "
                f"urgency_score={ml_analysis.get('spoilage_urgency_score')}, "
                f"flags={ml_analysis.get('quality_risk_flags')}.\n"
                "Provide a structured, concise safety and redistribution brief."
            )
            try:
                def _call() -> SurplusSafetyBrief:
                    interaction = client.interactions.create(
                        model=settings.GEMINI_MODEL,
                        input=prompt,
                        response_format={
                            "type": "text",
                            "mime_type": "application/json",
                            "schema": SurplusSafetyBrief.model_json_schema(),
                        },
                        generation_config={"thinking_level": "low"},
                    )
                    return SurplusSafetyBrief.model_validate_json(interaction.output_text)

                brief = await asyncio.to_thread(_call)
                return {
                    "ai_explanation": (
                        f"{brief.executive_summary} Packaging: {brief.packaging_recommendation}"
                    ),
                    "safety_attention_points": brief.safety_attention_points,
                    "ai_provider": settings.GEMINI_MODEL,
                }
            except Exception as exc:
                logger.warning("Gemini surplus explanation fallback triggered: %s", exc)

        # Deterministic explainable synthesis when GEMINI_API_KEY is not configured
        flags = ml_analysis.get("quality_risk_flags") or []
        flag_text = "; ".join(flags) if flags else "No critical spoilage flags detected."
        return {
            "ai_explanation": (
                f"Surplus probability {int(ml_analysis.get('surplus_probability', 0) * 100)}% with "
                f"urgency {ml_analysis.get('spoilage_urgency_score')}/100 ({ml_analysis.get('hours_until_expiry')}h "
                f"remaining under {lot.get('storage_requirement')} storage). {flag_text}"
            ),
            "safety_attention_points": flags or ["Verify seal integrity and pickup temperature at handoff."],
            "ai_provider": "deterministic_engine (GEMINI_API_KEY not configured)",
        }

    async def synthesize_coordination_plan(
        self,
        lot: Dict[str, Any],
        analysis: Dict[str, Any],
        matching: Dict[str, Any],
        logistics: Optional[Dict[str, Any]],
        funding: Optional[Dict[str, Any]],
        pending_approvals: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        settings = get_settings()
        client = self._get_client()

        summary_context = {
            "lot_title": lot.get("title"),
            "quantity_kg": lot.get("quantity_kg"),
            "category": lot.get("category"),
            "storage": lot.get("storage_requirement"),
            "hours_until_expiry": analysis.get("hours_until_expiry"),
            "safety_status": analysis.get("safety_status"),
            "allocated_kg": matching.get("allocated_kg"),
            "unallocated_kg": matching.get("unallocated_kg"),
            "split_count": matching.get("split_count"),
            "fallback_activated": matching.get("fallback_activated"),
            "expanded_radius_km": matching.get("expanded_radius_km"),
            "allocations": [
                {
                    "org": a.get("organization_name"),
                    "kg": a.get("allocated_kg"),
                    "distance_km": a.get("distance_km"),
                    "fallback": a.get("is_fallback_match"),
                }
                for a in matching.get("proposed_allocations", [])
            ],
            "estimated_cost_usd": (logistics or {}).get("cost_breakdown", {}).get("total_estimated_cost_usd"),
            "recommended_funding_mode": (funding or {}).get("recommended_mode"),
            "pending_approvals": [p.get("gate_type") for p in pending_approvals],
        }

        if client is not None:
            prompt = (
                "You are the Autonomous Coordination Agent for SurplusConnect AI.\n"
                "Explain the coordination outcome transparently for operators, donors, organizations, and sponsors.\n"
                f"Workflow Data:\n{json.dumps(summary_context, indent=2)}\n"
                "Emphasize food safety, multi-org splits, fallback matching (if activated), logistics optimization, "
                "and any human approval gates pending."
            )
            try:
                def _call() -> CoordinationRecommendation:
                    interaction = client.interactions.create(
                        model=settings.GEMINI_MODEL,
                        input=prompt,
                        response_format={
                            "type": "text",
                            "mime_type": "application/json",
                            "schema": CoordinationRecommendation.model_json_schema(),
                        },
                        generation_config={"thinking_level": "low"},
                    )
                    return CoordinationRecommendation.model_validate_json(interaction.output_text)

                rec = await asyncio.to_thread(_call)
                return {
                    "headline": rec.headline,
                    "rationale": rec.rationale,
                    "risk_assessment": rec.risk_assessment,
                    "recommended_next_action": rec.recommended_next_action,
                    "ai_provider": settings.GEMINI_MODEL,
                }
            except Exception as exc:
                logger.warning("Gemini coordination synthesis fallback: %s", exc)

        fallback_str = (
            f"Intelligent Fallback expanded search to {matching.get('expanded_radius_km')} km. "
            if matching.get("fallback_activated")
            else "Matched within primary radius. "
        )
        gate_str = (
            f"Human approval required for: {', '.join(p.get('gate_type', '') for p in pending_approvals)}."
            if pending_approvals
            else "No blocking safety/finance holds remain."
        )
        return {
            "headline": f"Coordinated {matching.get('allocated_kg', 0)}/{lot.get('quantity_kg')} kg across {matching.get('split_count', 0)} recipient(s)",
            "rationale": (
                f"{fallback_str}"
                f"Recommended funding strategy: {(funding or {}).get('recommended_mode', 'sponsor_funded')}. "
                f"Estimated transport cost: ${(logistics or {}).get('cost_breakdown', {}).get('total_estimated_cost_usd', 0):.2f}."
            ),
            "risk_assessment": f"Safety status: {analysis.get('safety_status')}. {gate_str}",
            "recommended_next_action": (
                "Review and approve pending human-in-the-loop safety/financial gates."
                if pending_approvals
                else "Recipient organizations can now review and accept proposed allocations."
            ),
            "ai_provider": "deterministic_engine (GEMINI_API_KEY not configured)",
        }

    async def run_agent_chat(
        self,
        instruction: str,
        tool_registry: Dict[str, Any],
        tool_declarations: List[Dict[str, Any]],
        platform_snapshot: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Interactive Gemini Interactions API tool-calling loop for Autonomous Coordination Agent."""
        settings = get_settings()
        client = self._get_client()
        invoked_tools: List[Dict[str, Any]] = []

        if client is not None:
            system_context = (
                "You are the SurplusConnect AI Autonomous Coordination Agent. "
                "You coordinate surplus detection, demand forecasting, organization matching, fallback matching, "
                "logistics routing, funding allocation, and human approval requests. "
                "Always inspect live platform tools before summarizing, never invent transaction IDs or approval statuses, "
                "and clearly flag any sensitive food-safety or PayPal financial step that requires human approval.\n\n"
                f"Current Platform Snapshot: {json.dumps(platform_snapshot)}"
            )
            history: List[Dict[str, Any]] = [
                {"type": "user_input", "content": [{"type": "text", "text": f"{system_context}\n\nOperator Request: {instruction}"}]}
            ]

            try:
                def _step(curr_history: List[Dict[str, Any]]):
                    return client.interactions.create(
                        model=settings.GEMINI_MODEL,
                        store=False,
                        input=curr_history,
                        tools=tool_declarations,
                        generation_config={"thinking_level": "low"},
                    )

                for _ in range(4):
                    interaction = await asyncio.to_thread(_step, history)
                    for step in interaction.steps:
                        history.append(step.model_dump())

                    fc_steps = [s for s in interaction.steps if getattr(s, "type", None) == "function_call"]
                    if not fc_steps:
                        return {
                            "response_text": interaction.output_text or "Coordination check complete.",
                            "tool_calls": invoked_tools,
                            "ai_provider": settings.GEMINI_MODEL,
                        }

                    for fc in fc_steps:
                        fn = tool_registry.get(fc.name)
                        args = dict(getattr(fc, "arguments", {}) or {})
                        if fn:
                            res = await fn(**args)
                        else:
                            res = {"error": f"Unknown tool '{fc.name}'"}
                        invoked_tools.append({"tool": fc.name, "arguments": args, "result": res})
                        history.append(
                            {
                                "type": "function_result",
                                "name": fc.name,
                                "call_id": fc.id,
                                "result": [{"type": "text", "text": json.dumps(res, default=str)}],
                            }
                        )

                final_interaction = await asyncio.to_thread(_step, history)
                return {
                    "response_text": final_interaction.output_text or "Coordination cycle finished.",
                    "tool_calls": invoked_tools,
                    "ai_provider": settings.GEMINI_MODEL,
                }
            except Exception as exc:
                logger.warning("Gemini agent chat fallback triggered: %s", exc)

        # Deterministic tool invocation fallback if GEMINI_API_KEY is absent
        if "platform_overview" in tool_registry:
            overview = await tool_registry["platform_overview"]()
            invoked_tools.append({"tool": "platform_overview", "arguments": {}, "result": overview})
        return {
            "response_text": (
                f"Autonomous Coordination Snapshot processed request: '{instruction}'. "
                f"Active inventory lots: {platform_snapshot.get('active_lots', 0)}, "
                f"Pending human approvals: {platform_snapshot.get('pending_approvals', 0)}, "
                f"Open sponsor campaigns: {platform_snapshot.get('open_campaigns', 0)}. "
                "Add GEMINI_API_KEY in backend/.env to enable live Gemini 3.8 Flash multi-step tool reasoning."
            ),
            "tool_calls": invoked_tools,
            "ai_provider": "deterministic_engine (GEMINI_API_KEY not configured)",
        }


gemini_service = GeminiService()

