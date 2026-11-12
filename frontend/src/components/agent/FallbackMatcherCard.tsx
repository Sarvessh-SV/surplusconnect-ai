"use client";

import React from "react";
import {
  Clock,
  GitBranch,
  ShieldAlert,
  ShieldCheck,
  Warehouse,
} from "lucide-react";
import type { AgentRun, AllocationRecord, InventoryLot } from "@/lib/types";
import { Card, InfoTooltip, StatusIndicator } from "@/components/ui/primitives";

const SPLIT_COLORS = [
  "bg-forest",
  "bg-emerald",
  "bg-emerald-bright",
  "bg-amber-600",
];

export function FallbackMatcherCard({
  lot,
  allocations,
  run,
}: {
  lot?: InventoryLot | null;
  allocations: AllocationRecord[];
  run?: AgentRun | null;
}) {
  const isFallback =
    Boolean(lot?.fallback_activated) ||
    Boolean(run?.fallback_activated) ||
    allocations.some((a) => a.is_fallback_match);

  if (!isFallback && allocations.length <= 1) {
    return null;
  }

  const radiusKm =
    run?.expanded_radius_km ||
    lot?.expanded_radius_km ||
    Math.max(...allocations.map((a) => a.fallback_radius_km || a.distance_km), 25);

  const totalKg =
    lot?.quantity_kg ||
    allocations.reduce((sum, a) => sum + a.allocated_kg, 0) ||
    1;

  const hoursLeft = lot?.analysis?.hours_until_expiry;
  const requiresApproval =
    Boolean(run?.safety_analysis?.requires_safety_approval) ||
    Boolean(lot?.analysis?.requires_safety_approval) ||
    allocations.some((a) => a.status === "awaiting_safety_approval");

  return (
    <Card className="space-y-4 border-amber-200/80 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-bg text-amber-safe">
            <GitBranch className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="sc-card-title">
                {isFallback ? "Expanded Search Matching Active" : "Split Allocation Plan"}
              </h3>
              <InfoTooltip text="When nearby organizations cannot absorb the full batch, the platform safely expands the radius or splits quantities across verified partners within shelf-life limits." />
            </div>
            <p className="mt-0.5 text-xs text-ink-muted leading-relaxed">
              {isFallback
                ? `No single nearby recipient could receive all items within 10 km. The search radius expanded to ${radiusKm} km to connect eligible partners.`
                : `Quantity is distributed across ${allocations.length} eligible recipients for faster rescue.`}
            </p>
          </div>
        </div>

        <StatusIndicator
          label={isFallback ? `Radius ${radiusKm} km` : "Multi-Recipient Split"}
          tone={isFallback ? "warning" : "info"}
        />
      </div>

      {/* Quantity Distribution Bar */}
      {allocations.length > 0 ? (
        <div className="space-y-2 rounded-xl bg-canvas p-3.5 border border-border-subtle">
          <div className="flex items-center justify-between text-xs font-medium text-forest">
            <span>Quantity Distribution ({totalKg} kg total)</span>
            <span className="text-ink-muted">{allocations.length} organization(s)</span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-muted">
            {allocations.map((alloc, idx) => {
              const pct = Math.max(8, Math.round((alloc.allocated_kg / totalKg) * 100));
              return (
                <div
                  key={alloc.id}
                  style={{ width: `${pct}%` }}
                  title={`${alloc.organization_name}: ${alloc.allocated_kg} kg`}
                  className={`${SPLIT_COLORS[idx % SPLIT_COLORS.length]} h-full border-r border-white last:border-r-0`}
                />
              );
            })}
          </div>
          <div className="grid gap-2 pt-1 sm:grid-cols-2">
            {allocations.map((alloc, idx) => {
              const isConfirmed =
                alloc.status === "accepted" ||
                alloc.status === "confirmed" ||
                alloc.status === "in_delivery" ||
                alloc.status === "delivered";
              return (
                <div
                  key={alloc.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border-subtle bg-white px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                        SPLIT_COLORS[idx % SPLIT_COLORS.length]
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-forest truncate">
                        {alloc.organization_name}
                      </div>
                      <div className="text-[11px] text-ink-muted">
                        {alloc.allocated_kg} kg • {alloc.distance_km} km
                      </div>
                    </div>
                  </div>
                  <StatusIndicator
                    label={isConfirmed ? "Confirmed" : "Suggested"}
                    tone={isConfirmed ? "success" : "warning"}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Safety & Shelf-Life Checks */}
      <div className="grid gap-2.5 sm:grid-cols-2 text-xs">
        <div className="flex items-center gap-2 rounded-xl border border-border-subtle bg-mint-soft/45 px-3 py-2 text-forest">
          <ShieldCheck className="h-4 w-4 text-emerald shrink-0" />
          <span>
            Storage verified:{" "}
            <strong className="capitalize">
              {(lot?.storage_requirement || allocations[0]?.storage_requirement || "ambient").replace(
                "_",
                " "
              )}
            </strong>{" "}
            handling matched
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border-subtle bg-mint-soft/45 px-3 py-2 text-forest">
          <Clock className="h-4 w-4 text-emerald shrink-0" />
          <span>
            {hoursLeft !== undefined
              ? `${hoursLeft.toFixed(1)} hrs shelf life remaining`
              : "Delivery scheduled within safe shelf life"}
          </span>
        </div>
      </div>

      {requiresApproval ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-bg/50 px-3.5 py-2.5 text-xs text-amber-safe">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <strong>Human approval required:</strong> Safety verification sign-off is needed before finalizing pickup for this time-sensitive or expanded match.
          </span>
        </div>
      ) : null}

      {/* Safe Storage Hubs & Scheduled Matching Windows */}
      {run && (run.storage_hub_options?.length > 0 || run.future_matching_windows?.length > 0) ? (
        <div className="grid gap-3 md:grid-cols-2 border-t border-border-subtle pt-3">
          {run.storage_hub_options?.length > 0 ? (
            <div className="rounded-xl border border-border-subtle bg-canvas p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-forest">
                <Warehouse className="h-4 w-4 text-emerald" />
                <span>Nearby Safe Storage Hubs</span>
              </div>
              {run.storage_hub_options.slice(0, 3).map((hub, idx) => (
                <div key={hub.hub_id || hub.id || idx} className="text-xs text-ink-muted">
                  <strong className="text-forest">{hub.hub_name || hub.name}</strong> •{" "}
                  {hub.distance_km} km ({hub.available_capacity_kg ?? hub.available_kg ?? 0} kg open)
                </div>
              ))}
            </div>
          ) : null}

          {run.future_matching_windows?.length > 0 ? (
            <div className="rounded-xl border border-border-subtle bg-canvas p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-forest">
                <Clock className="h-4 w-4 text-emerald" />
                <span>Alternative Rescue Windows</span>
              </div>
              {run.future_matching_windows.slice(0, 2).map((win, idx) => (
                <div key={idx} className="text-xs text-ink-muted">
                  <strong className="text-forest">{win.window_label}:</strong>{" "}
                  {win.recommendation || win.note}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

