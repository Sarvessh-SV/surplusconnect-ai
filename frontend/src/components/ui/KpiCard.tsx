"use client";

import React from "react";
import { Card, cn } from "@/components/ui/primitives";

interface KpiCardProps {
  label: string;
  value: string | number;
  helper?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "forest" | "emerald" | "amber" | "danger";
  className?: string;
}

export function KpiCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = "forest",
  className,
}: KpiCardProps) {
  const iconStyles = {
    forest: "bg-surface-muted text-forest",
    emerald: "bg-mint-soft text-emerald",
    amber: "bg-amber-bg/70 text-amber-safe",
    danger: "bg-danger-bg/80 text-danger",
  };
  const valueStyles = {
    forest: "text-forest",
    emerald: "text-emerald",
    amber: "text-amber-safe",
    danger: "text-danger",
  };

  return (
    <Card className={cn("p-4 sm:p-5 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <div className="text-xs font-medium text-ink-muted truncate">{label}</div>
        <div className={cn("mt-1.5 text-2xl font-bold tracking-tight", valueStyles[tone])}>
          {value}
        </div>
        {helper ? (
          <div className="mt-1 text-xs text-ink-muted truncate">{helper}</div>
        ) : null}
      </div>
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          iconStyles[tone]
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
    </Card>
  );
}

