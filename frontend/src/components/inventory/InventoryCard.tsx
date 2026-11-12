"use client";

import React from "react";
import { Clock, Edit3, Eye, Snowflake, Trash2 } from "lucide-react";
import type { InventoryLot } from "@/lib/types";
import { Button, Card, StatusIndicator, type StatusTone } from "@/components/ui/primitives";

export function getExpirySummary(expiresAt: string) {
  const diffHours = (new Date(expiresAt).getTime() - Date.now()) / 3600000;
  if (diffHours <= 0) {
    return { label: "Expired", tone: "danger" as StatusTone, urgent: true };
  }
  if (diffHours <= 12) {
    return {
      label: `${Math.max(1, Math.round(diffHours))}h left (Urgent)`,
      tone: "danger" as StatusTone,
      urgent: true,
    };
  }
  if (diffHours <= 36) {
    return {
      label: `${Math.round(diffHours)}h remaining`,
      tone: "warning" as StatusTone,
      urgent: false,
    };
  }
  const days = Math.round(diffHours / 24);
  return {
    label: `${days} day${days === 1 ? "" : "s"} remaining`,
    tone: "success" as StatusTone,
    urgent: false,
  };
}

export function getLotStatusTone(status: string): StatusTone {
  if (status === "completed" || status === "matched") return "success";
  if (status === "awaiting_approval" || status === "blocked_unsafe" || status === "expired") {
    return "danger";
  }
  if (status === "partially_allocated" || status === "dispatched") return "warning";
  return "info";
}

export function InventoryCard({
  lot,
  selected = false,
  onSelect,
  onEdit,
  onDelete,
}: {
  lot: InventoryLot;
  selected?: boolean;
  onSelect?: (lot: InventoryLot) => void;
  onEdit?: (lot: InventoryLot) => void;
  onDelete?: (lot: InventoryLot) => void;
}) {
  const expiry = getExpirySummary(lot.expires_at);

  return (
    <Card
      className={`flex flex-col justify-between gap-4 transition-all ${
        selected
          ? "border-emerald ring-1 ring-emerald/30 bg-mint-soft/20"
          : expiry.urgent
          ? "border-amber-300/80 hover:border-emerald"
          : "hover:border-emerald/70"
      }`}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <h3 className="sc-card-title truncate">{lot.title}</h3>
            <p className="mt-0.5 text-xs text-ink-muted capitalize">
              {lot.category.replace("_", " ")} •{" "}
              {lot.servings_estimate ?? Math.round(lot.quantity_kg * 3)} est. servings
            </p>
          </div>
          <StatusIndicator
            label={lot.status.replace(/_/g, " ")}
            tone={getLotStatusTone(lot.status)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5 rounded-xl bg-canvas p-3 text-xs">
          <div>
            <span className="text-ink-muted block">Quantity</span>
            <span className="font-semibold text-forest">{lot.quantity_kg} kg</span>
          </div>
          <div>
            <span className="text-ink-muted block">Storage</span>
            <span className="inline-flex items-center gap-1 font-semibold text-forest capitalize">
              <Snowflake className="h-3.5 w-3.5 text-emerald" />
              {lot.storage_requirement.replace("_", " ")}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-ink-muted">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span>
              Expires {new Date(lot.expires_at).toLocaleDateString()}
            </span>
          </span>
          <StatusIndicator label={expiry.label} tone={expiry.tone} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
        {onSelect ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onSelect(lot)}
          >
            <Eye className="h-3.5 w-3.5" />
            View Match
          </Button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-1.5">
          {onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(lot)}
              aria-label={`Edit ${lot.title}`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle text-forest hover:bg-mint-soft transition-colors cursor-pointer"
            >
              <Edit3 className="h-4 w-4" />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={() => onDelete(lot)}
              aria-label={`Delete ${lot.title}`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle text-danger hover:bg-danger-bg transition-colors cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

