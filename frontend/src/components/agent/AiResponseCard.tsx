"use client";

import React from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import type { AgentRun } from "@/lib/types";
import { Card, StatusIndicator } from "@/components/ui/primitives";

export function AiDecisionExplanationCard({
  run,
  recipientCount,
}: {
  run: AgentRun | null;
  recipientCount: number;
}) {
  if (!run) {
    return null;
  }

  const eligible = run.safety_analysis?.is_eligible ?? true;
  const fallbackText = run.fallback_activated
    ? ` Expanded search radius to ${run.expanded_radius_km} km to locate compatible capacity.`
    : "";

  const conciseSummary =
    recipientCount > 0
      ? `${recipientCount} suitable recipient${
          recipientCount === 1 ? " was" : "s were"
        } identified based on distance, storage capacity, and food safety requirements.${fallbackText}`
      : run.executive_summary;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald" />
          <h3 className="sc-card-title">Why AI Recommended This Plan</h3>
        </div>
        <StatusIndicator
          label={eligible ? "Safety Verified" : "Action Needed"}
          tone={eligible ? "success" : "warning"}
        />
      </div>

      <p className="text-sm text-ink leading-relaxed">{conciseSummary}</p>

      <details className="group rounded-xl border border-border-subtle bg-canvas/70">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-xs font-semibold text-forest">
          <span>Technical Details</span>
          <ChevronDown className="h-4 w-4 text-ink-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border-subtle px-3.5 py-3 space-y-2.5 text-xs text-ink-muted">
          <div>
            <strong className="text-forest">Full Assessment:</strong>{" "}
            {run.executive_summary}
          </div>
          <div>
            <strong className="text-forest">Storage Check:</strong>{" "}
            {run.safety_analysis?.storage_validation_notes || "Passed compatibility validation"}
          </div>
          {run.node_trace?.length > 0 ? (
            <div className="space-y-1">
              <strong className="text-forest block">Execution Steps:</strong>
              <ul className="space-y-1 pl-4 list-disc">
                {run.node_trace.map((step, i) => (
                  <li key={`${step.node}-${i}`}>
                    <span className="font-mono text-[11px] text-forest">
                      {step.node}
                    </span>{" "}
                    — {step.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </Card>
  );
}

