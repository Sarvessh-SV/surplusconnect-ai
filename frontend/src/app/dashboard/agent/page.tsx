"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  MapPin,
  Package,
  Play,
  Send,
  ShieldAlert,
  Sparkles,
  Warehouse,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type {
  AgentRun,
  AllocationRecord,
  ApprovalRequest,
  InventoryLot,
  OrganizationDemandForecast,
} from "@/lib/types";
import { AppShell } from "@/components/layout/AppShell";
import { RoleGuard } from "@/components/layout/RoleGuard";
import {
  Button,
  Card,
  DashboardSkeleton,
  EmptyState,
  StatusIndicator,
} from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/KpiCard";
import { WorkflowStepper } from "@/components/ui/WorkflowStepper";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { useToast } from "@/components/ui/ToastProvider";
import { AiDecisionExplanationCard } from "@/components/agent/AiResponseCard";
import { FallbackMatcherCard } from "@/components/agent/FallbackMatcherCard";

const SUGGESTED_QUESTIONS = [
  "Find recipients for my surplus",
  "Show urgent inventory",
  "Analyze pending donations",
  "Find nearby organizations",
];

export default function AgentAssistantPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [allocations, setAllocations] = useState<AllocationRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [orgForecasts, setOrgForecasts] = useState<OrganizationDemandForecast[]>([]);

  const [selectedLotId, setSelectedLotId] = useState<string>("");
  const [question, setQuestion] = useState("");
  const [chatReply, setChatReply] = useState<{
    question: string;
    answer: string;
    tool_calls: Array<{ name: string; args: Record<string, unknown> }>;
  } | null>(null);

  const [detailAlloc, setDetailAlloc] = useState<AllocationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [coordinating, setCoordinating] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [runsRes, lotsRes, allocRes, appRes, demRes] = await Promise.all([
        api.listAgentRuns(),
        api.listInventory(false),
        api.listAllocations(),
        api.listApprovals(),
        api.getDemandIntelligence("prepared_meals").catch(() => ({
          organizations: [] as OrganizationDemandForecast[],
        })),
      ]);
      setRuns(runsRes.items);
      setLots(lotsRes.items);
      setAllocations(allocRes.items);
      setApprovals(appRes.items);
      setOrgForecasts(demRes.organizations || []);

      if (!selectedLotId) {
        const firstLotId = runsRes.items[0]?.inventory_id || lotsRes.items[0]?.id || "";
        if (firstLotId) setSelectedLotId(firstLotId);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : "Unable to load coordination assistant data."
      );
    } finally {
      setLoading(false);
    }
  }, [selectedLotId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const submitQuestion = async (promptText: string) => {
    const clean = promptText.trim();
    if (!clean) return;
    setErrorMsg(null);
    setAsking(true);
    try {
      const res = await api.chatAgent(clean);
      setChatReply({
        question: clean,
        answer: res.answer,
        tool_calls: res.tool_calls || [],
      });
      await loadData();
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : "Unable to reach AI assistant."
      );
    } finally {
      setAsking(false);
    }
  };

  const handleAskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitQuestion(question);
  };

  const handleCoordinateBatch = async () => {
    if (!selectedLotId) return;
    setErrorMsg(null);
    setCoordinating(true);
    try {
      await api.coordinateAgent({
        inventory_id: selectedLotId,
        primary_radius_km: 10,
        max_fallback_radius_km: 75,
      });
      notify({
        tone: "success",
        title: "Coordination updated",
        message: "Recipient matching and safety checks completed.",
      });
      await loadData();
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : "Unable to run coordination."
      );
    } finally {
      setCoordinating(false);
    }
  };

  const activeLot = useMemo(
    () => lots.find((l) => l.id === selectedLotId) || lots[0] || null,
    [lots, selectedLotId]
  );

  const activeRun = useMemo(
    () =>
      (activeLot
        ? runs.find((r) => r.inventory_id === activeLot.id)
        : runs[0]) || null,
    [runs, activeLot]
  );

  const activeAllocations = useMemo(() => {
    const targetLotId = activeLot?.id || activeRun?.inventory_id;
    return targetLotId
      ? allocations.filter((a) => a.inventory_id === targetLotId)
      : allocations.slice(0, 6);
  }, [allocations, activeLot, activeRun]);

  const capacityByOrgId = useMemo(() => {
    const map: Record<string, OrganizationDemandForecast> = {};
    for (const org of orgForecasts) {
      map[org.organization_id] = org;
    }
    return map;
  }, [orgForecasts]);

  const metrics = useMemo(() => {
    const analyzed = lots.filter((l) => Boolean(l.analysis)).length;
    const matched = allocations.filter(
      (a) => a.status !== "declined"
    ).length;
    const awaitingApproval = approvals.filter((a) => a.status === "pending").length;
    const safetyAlerts = lots.filter(
      (l) =>
        l.analysis?.requires_safety_approval ||
        l.status === "awaiting_approval" ||
        l.status === "blocked_unsafe"
    ).length;
    return { analyzed, matched, awaitingApproval, safetyAlerts };
  }, [lots, allocations, approvals]);

  const handleApproveRecommendation = async (alloc: AllocationRecord) => {
    setActionBusyId(alloc.id);
    try {
      if (user?.role === "admin" && alloc.status === "awaiting_safety_approval") {
        const pendingGate = approvals.find(
          (g) =>
            g.status === "pending" &&
            (g.allocation_id === alloc.id ||
              g.all_allocation_ids?.includes(alloc.id) ||
              g.inventory_id === alloc.inventory_id)
        );
        if (pendingGate) {
          await api.resolveApproval(pendingGate.id, {
            decision: "approve",
            reviewer_notes: "Approved from AI Coordination Assistant.",
          });
          notify({
            tone: "success",
            title: "Safety review approved",
            message: `${alloc.organization_name} match is now cleared.`,
          });
          await loadData();
          return;
        }
      }

      if (user?.role === "organization" || user?.role === "admin") {
        await api.respondAllocation(alloc.id, {
          action: "accept",
          funding_mode: alloc.funding_plan?.recommended_mode || "sponsor_funded",
          self_funded_share_pct: alloc.funding_plan?.self_funded_share_pct ?? 0,
          notes: "Approved via AI Coordination Assistant.",
        });
        notify({
          tone: "success",
          title: "Match confirmed",
          message: `${alloc.allocated_kg} kg allocation for ${alloc.organization_name} confirmed.`,
        });
        await loadData();
      } else {
        notify({
          tone: "info",
          title: "Match ready for recipient",
          message: `${alloc.organization_name} can accept this match from their Recipient Hub.`,
        });
      }
    } catch (err) {
      notify({
        tone: "error",
        title: "Approval could not be completed",
        message: err instanceof ApiError ? err.message : "Please try again.",
      });
    } finally {
      setActionBusyId(null);
    }
  };

  return (
    <RoleGuard
      allowedRoles={[
        "business",
        "organization",
        "delivery_partner",
        "sponsor",
        "admin",
      ]}
    >
      <AppShell
        title="AI Coordination Assistant"
        subtitle="Ask questions about surplus inventory, track matching steps, and review recommended recipients."
      >
        {errorMsg ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-danger-bg px-4 py-3 text-sm text-danger"
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => void loadData()}>
              Retry
            </Button>
          </div>
        ) : null}

        {/* Section 1: AI Assistant */}
        <Card className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-mint-soft text-emerald">
              <Bot className="h-5 w-5" />
            </span>
            <div>
              <h2 className="sc-section-title">AI Assistant</h2>
              <p className="text-xs text-ink-muted">
                Ask for help finding recipients, checking urgent items, or summarizing active donations.
              </p>
            </div>
          </div>

          <form onSubmit={handleAskSubmit} className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              aria-label="Ask the AI assistant a question"
              placeholder="Ask a question about surplus batches, recipients, or delivery priorities..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="min-h-11 flex-1 rounded-xl border border-border-subtle bg-canvas/60 px-4 text-sm text-ink placeholder:text-ink-muted/75"
            />
            <Button type="submit" size="lg" disabled={asking || !question.trim()}>
              <Send className="h-4 w-4" />
              {asking ? "Thinking..." : "Ask AI"}
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-ink-muted">Try:</span>
            {SUGGESTED_QUESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={asking}
                onClick={() => {
                  setQuestion(suggestion);
                  void submitQuestion(suggestion);
                }}
                className="rounded-full border border-border-subtle bg-canvas px-3 py-1.5 text-xs font-medium text-forest hover:border-emerald hover:bg-mint-soft/70 transition-colors cursor-pointer disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>

          {chatReply ? (
            <div className="rounded-2xl border border-emerald/25 bg-mint-soft/35 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-forest">
                <Sparkles className="h-4 w-4 text-emerald" />
                <span>Assistant Response</span>
              </div>
              <p className="text-sm text-ink whitespace-pre-line leading-relaxed">
                {chatReply.answer}
              </p>
              {chatReply.tool_calls.length > 0 ? (
                <details className="rounded-xl border border-border-subtle bg-white px-3 py-2 text-xs text-ink-muted">
                  <summary className="cursor-pointer font-medium text-forest">
                    View data sources checked ({chatReply.tool_calls.length})
                  </summary>
                  <ul className="mt-2 space-y-1 pl-4 list-disc">
                    {chatReply.tool_calls.map((tc, idx) => (
                      <li key={idx}>
                        <span className="font-mono text-[11px] text-forest">
                          {tc.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </Card>

        {loading && lots.length === 0 ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* Section 2: Coordination Overview */}
            <section aria-label="Coordination Overview" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Inventory Analyzed"
                value={metrics.analyzed}
                helper={`${lots.length} registered batch${lots.length === 1 ? "" : "es"}`}
                icon={Package}
                tone="forest"
              />
              <KpiCard
                label="Successful Matches"
                value={metrics.matched}
                helper="Eligible recipient matches"
                icon={CheckCircle2}
                tone="emerald"
              />
              <KpiCard
                label="Awaiting Approval"
                value={metrics.awaitingApproval}
                helper="Human oversight checks"
                icon={Clock}
                tone={metrics.awaitingApproval > 0 ? "amber" : "forest"}
              />
              <KpiCard
                label="Safety Alerts"
                value={metrics.safetyAlerts}
                helper="Storage or expiry flags"
                icon={ShieldAlert}
                tone={metrics.safetyAlerts > 0 ? "danger" : "emerald"}
              />
            </section>

            {/* Section 3: Coordination Workflow */}
            <section className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="sc-section-title">Coordination Workflow</h2>
                  <p className="text-xs text-ink-muted">
                    Select an inventory batch to review each step from analysis to approval.
                  </p>
                </div>

                {lots.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Select inventory batch"
                      value={selectedLotId}
                      onChange={(e) => setSelectedLotId(e.target.value)}
                      className="min-h-10 rounded-xl border border-border-subtle bg-white px-3 text-xs font-medium text-forest max-w-xs"
                    >
                      {lots.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title} ({l.quantity_kg} kg)
                        </option>
                      ))}
                    </select>

                    {user?.role === "business" || user?.role === "admin" ? (
                      <Button
                        size="sm"
                        disabled={coordinating || !selectedLotId}
                        onClick={() => void handleCoordinateBatch()}
                      >
                        <Play className="h-3.5 w-3.5" />
                        {coordinating ? "Running..." : "Run Matching"}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <WorkflowStepper run={activeRun} />
            </section>

            {/* Section 4: Recommended Recipients */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="sc-section-title">Recommended Recipients</h2>
                  <p className="text-xs text-ink-muted">
                    Organizations matched by location, storage fit, capacity, and food safety.
                  </p>
                </div>
              </div>

              {activeAllocations.length === 0 ? (
                <EmptyState
                  icon={Warehouse}
                  title="No Recipient Recommendations Yet"
                  description="Add surplus inventory or run matching above to see recommended local recipient organizations."
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {activeAllocations.map((alloc) => {
                    const orgCap = capacityByOrgId[alloc.organization_id];
                    const safetyCleared = alloc.status !== "awaiting_safety_approval";
                    const canApprove =
                      alloc.status === "proposed" ||
                      alloc.status === "awaiting_safety_approval";

                    return (
                      <Card key={alloc.id} className="flex flex-col justify-between gap-4">
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="sc-card-title truncate">
                                {alloc.organization_name}
                              </h3>
                              <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-muted">
                                <MapPin className="h-3.5 w-3.5 text-emerald shrink-0" />
                                {alloc.distance_km} km away
                              </p>
                            </div>
                            <StatusIndicator
                              label={safetyCleared ? "Safety Passed" : "Review Needed"}
                              tone={safetyCleared ? "success" : "warning"}
                            />
                          </div>

                          <div className="grid grid-cols-3 gap-2 rounded-xl bg-canvas p-3 text-xs">
                            <div>
                              <span className="text-ink-muted block">Quantity</span>
                              <span className="font-semibold text-forest">
                                {alloc.allocated_kg} kg
                              </span>
                            </div>
                            <div>
                              <span className="text-ink-muted block">Capacity</span>
                              <span className="font-semibold text-forest">
                                {orgCap
                                  ? `${orgCap.remaining_capacity_kg} kg`
                                  : "Verified"}
                              </span>
                            </div>
                            <div>
                              <span className="text-ink-muted block">Match</span>
                              <span className="font-semibold text-emerald">
                                {alloc.match_score}%
                              </span>
                            </div>
                          </div>

                          <p className="text-xs text-ink-muted leading-relaxed line-clamp-2">
                            {alloc.match_rationale ||
                              `Selected based on ${alloc.storage_requirement.replace(
                                "_",
                                " "
                              )} storage fit and ${alloc.distance_km} km proximity.`}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 border-t border-border-subtle pt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => setDetailAlloc(alloc)}
                          >
                            View Details
                          </Button>
                          {canApprove ? (
                            <Button
                              size="sm"
                              className="flex-1"
                              disabled={actionBusyId === alloc.id}
                              onClick={() => void handleApproveRecommendation(alloc)}
                            >
                              {actionBusyId === alloc.id ? "Saving..." : "Approve Match"}
                            </Button>
                          ) : (
                            <StatusIndicator
                              label={alloc.status.replace(/_/g, " ")}
                              tone="success"
                            />
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Fallback Visualization & Section 5: AI Decision Explanation */}
            <div className="grid gap-6 lg:grid-cols-12">
              <div className="lg:col-span-6">
                <AiDecisionExplanationCard
                  run={activeRun}
                  recipientCount={activeAllocations.length}
                />
              </div>
              <div className="lg:col-span-6">
                <FallbackMatcherCard
                  lot={activeLot}
                  allocations={activeAllocations}
                  run={activeRun}
                />
              </div>
            </div>
          </>
        )}

        {/* Recipient Detail Modal */}
        <ModalDialog
          open={Boolean(detailAlloc)}
          onClose={() => setDetailAlloc(null)}
          title={detailAlloc?.organization_name || "Recipient Details"}
          subtitle={
            detailAlloc
              ? `${detailAlloc.inventory_title} • ${detailAlloc.allocated_kg} kg`
              : undefined
          }
        >
          {detailAlloc ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-canvas p-4 text-xs">
                <div>
                  <span className="text-ink-muted block">Distance</span>
                  <strong className="text-forest">{detailAlloc.distance_km} km</strong>
                </div>
                <div>
                  <span className="text-ink-muted block">Est. Transport Cost</span>
                  <strong className="text-forest">
                    ${detailAlloc.cost_breakdown?.total_estimated_cost_usd.toFixed(2) ?? "—"}
                  </strong>
                </div>
                <div>
                  <span className="text-ink-muted block">Storage Requirement</span>
                  <strong className="text-forest capitalize">
                    {detailAlloc.storage_requirement.replace("_", " ")}
                  </strong>
                </div>
                <div>
                  <span className="text-ink-muted block">Recommended Carrier</span>
                  <strong className="text-forest">
                    {detailAlloc.recommended_partner?.partner_name || "Assigned upon confirmation"}
                  </strong>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-semibold text-forest">Selection Reason</div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {detailAlloc.match_rationale}
                </p>
              </div>

              <div className="text-xs text-ink-muted">
                <strong className="text-forest">Dropoff Address:</strong>{" "}
                {detailAlloc.dropoff_location.address}, {detailAlloc.dropoff_location.city}
              </div>

              <details className="rounded-xl border border-border-subtle bg-canvas px-3 py-2 text-xs text-ink-muted">
                <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-forest">
                  <span>Matching Metadata</span>
                  <ChevronDown className="h-4 w-4" />
                </summary>
                <div className="mt-2 space-y-1">
                  <div>Match score: {detailAlloc.match_score}/100</div>
                  <div>Urgency index: {detailAlloc.urgency_score}/100</div>
                  <div>
                    Fallback search: {detailAlloc.is_fallback_match ? "Yes" : "Primary radius"}
                  </div>
                </div>
              </details>
            </div>
          ) : null}
        </ModalDialog>
      </AppShell>
    </RoleGuard>
  );
}
