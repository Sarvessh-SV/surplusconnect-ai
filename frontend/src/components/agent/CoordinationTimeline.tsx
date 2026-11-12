"use client";

import React from "react";
import type { AgentRun } from "@/lib/types";
import { WorkflowStepper } from "@/components/ui/WorkflowStepper";
import { AiDecisionExplanationCard } from "@/components/agent/AiResponseCard";

export function CoordinationTimeline({ run }: { run: AgentRun }) {
  return (
    <div className="space-y-4">
      <WorkflowStepper run={run} />
      <AiDecisionExplanationCard run={run} recipientCount={0} />
    </div>
  );
}
