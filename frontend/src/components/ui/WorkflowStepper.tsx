"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
} from "lucide-react";
import type { AgentRun } from "@/lib/types";
import { StatusIndicator, type StatusTone } from "@/components/ui/primitives";

export interface WorkflowStepItem {
  key: string;
  number: number;
  title: string;
  summary: string;
  detail: string;
  statusLabel: string;
  tone: StatusTone;
  icon: React.ComponentType<{ className?: string }>;
}

function deriveStepsFromRun(run: AgentRun | null): WorkflowStepItem[] {
  const trace = run?.node_trace || [];
  const findNode = (matcher: (name: string) => boolean) =>
    trace.find((t) => matcher(t.node.toLowerCase()));

  const n1 = findNode((n) => n.includes("analyze"));
  const n2 = findNode((n) => n.includes("match") || n.includes("fallback"));
  const n3 = findNode((n) => n.includes("safety") || n.includes("gate"));
  const n4 = findNode((n) => n.includes("logistic") || n.includes("fund"));
  const n5 = findNode((n) => n.includes("synth") || n.includes("persist"));

  const requiresReview = Boolean(run?.safety_analysis?.requires_safety_approval);
  const eligible = run?.safety_analysis?.is_eligible ?? true;

  return [
    {
      key: "analysis",
      number: 1,
      title: "Inventory Analysis",
      summary: "Checks item condition, shelf life, and surplus eligibility.",
      detail:
        n1?.detail ||
        (run
          ? `Evaluated surplus probability (${Math.round(
              (run.safety_analysis?.surplus_probability || 0) * 100
            )}%) and spoilage urgency.`
          : "Select an inventory batch to review condition and remaining shelf life."),
      statusLabel: n1 ? (n1.status === "blocked" ? "Attention" : "Completed") : "Ready",
      tone: n1 ? (n1.status === "blocked" ? "danger" : "success") : "neutral",
      icon: Sparkles,
    },
    {
      key: "matching",
      number: 2,
      title: "Recipient Matching",
      summary: "Identifies nearby verified organizations or activates expanded search.",
      detail:
        n2?.detail ||
        (run?.fallback_activated
          ? `Expanded search radius to ${run.expanded_radius_km} km to locate compatible recipients.`
          : "Ranks organizations by capacity, storage fit, distance, and urgency."),
      statusLabel: n2
        ? run?.fallback_activated
          ? "Expanded Search"
          : "Completed"
        : "Pending",
      tone: n2 ? (run?.fallback_activated ? "warning" : "success") : "neutral",
      icon: Users,
    },
    {
      key: "safety",
      number: 3,
      title: "Safety Verification",
      summary: "Confirms storage temperature compatibility and food safety rules.",
      detail:
        run?.safety_analysis?.storage_validation_notes ||
        "Verifies refrigerated, frozen, dry, or ambient handling requirements.",
      statusLabel: !run
        ? "Pending"
        : !eligible
        ? "Blocked"
        : requiresReview
        ? "Review Needed"
        : "Verified",
      tone: !run
        ? "neutral"
        : !eligible
        ? "danger"
        : requiresReview
        ? "warning"
        : "success",
      icon: ShieldCheck,
    },
    {
      key: "logistics",
      number: 4,
      title: "Logistics Coordination",
      summary: "Estimates transport routes, cost options, and suitable carriers.",
      detail:
        n4?.detail ||
        "Matches qualified delivery partners and prepares self or sponsor funding options.",
      statusLabel: n4 ? "Ready" : "Pending",
      tone: n4 ? "success" : "neutral",
      icon: Truck,
    },
    {
      key: "approval",
      number: 5,
      title: "Final Approval",
      summary: "Confirms human oversight before pickup and settlement proceed.",
      detail:
        n3?.detail ||
        n5?.detail ||
        (requiresReview
          ? "Waiting for administrator safety sign-off before recipient confirmation."
          : "Ready for recipient confirmation and dispatch scheduling."),
      statusLabel: !run
        ? "Pending"
        : requiresReview
        ? "Awaiting Approval"
        : "Cleared",
      tone: !run ? "neutral" : requiresReview ? "warning" : "success",
      icon: PackageCheck,
    },
  ];
}

export function WorkflowStepper({ run }: { run: AgentRun | null }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const steps = deriveStepsFromRun(run);

  return (
    <div className="grid gap-3 md:grid-cols-5">
      {steps.map((step) => {
        const Icon = step.icon;
        const expanded = expandedKey === step.key;
        const isDone = step.tone === "success";
        return (
          <div
            key={step.key}
            className={`rounded-2xl border bg-white p-4 transition-all ${
              expanded
                ? "border-emerald ring-1 ring-emerald/25"
                : "border-border-subtle hover:border-emerald/60"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${
                    isDone
                      ? "bg-mint-soft text-emerald"
                      : step.tone === "warning"
                      ? "bg-amber-bg text-amber-safe"
                      : step.tone === "danger"
                      ? "bg-danger-bg text-danger"
                      : "bg-surface-muted text-ink-muted"
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : step.tone === "warning" ? (
                    <Clock className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </span>
                <span className="text-xs font-semibold text-ink-muted">
                  Step {step.number}
                </span>
              </div>
              <StatusIndicator label={step.statusLabel} tone={step.tone} />
            </div>

            <h3 className="mt-3 text-sm font-semibold text-forest">{step.title}</h3>
            <p className="mt-1 text-xs text-ink-muted leading-relaxed">
              {step.summary}
            </p>

            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpandedKey(expanded ? null : step.key)}
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald hover:text-forest cursor-pointer"
            >
              <span>{expanded ? "Hide details" : "More info"}</span>
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>

            {expanded ? (
              <div className="mt-2.5 rounded-xl border border-border-subtle bg-canvas/80 p-2.5 text-xs text-ink-muted leading-relaxed">
                {step.detail}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

