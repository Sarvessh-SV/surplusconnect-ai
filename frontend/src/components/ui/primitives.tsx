"use client";

import React, { useState } from "react";
import { clsx } from "clsx";
import { Info } from "lucide-react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: Array<string | undefined | null | false>) {
  return twMerge(clsx(inputs));
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) {
  const variants = {
    primary:
      "bg-forest text-white hover:bg-forest-deep focus-visible:ring-emerald shadow-xs",
    secondary:
      "bg-emerald text-white hover:bg-forest focus-visible:ring-emerald shadow-xs",
    outline:
      "border border-border-subtle bg-white text-forest hover:bg-mint-soft/70 focus-visible:ring-emerald",
    ghost: "text-forest hover:bg-mint-soft/70 focus-visible:ring-emerald",
    danger: "bg-danger text-white hover:bg-red-800 focus-visible:ring-danger",
  };
  const sizes = {
    sm: "min-h-9 px-3.5 py-1.5 text-xs font-semibold rounded-xl",
    md: "min-h-10 px-4 py-2 text-sm font-semibold rounded-xl",
    lg: "min-h-11 px-5 py-2.5 text-sm font-semibold rounded-xl",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  className,
  children,
  onClick,
}: {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-2xl border border-border-subtle bg-surface p-5 shadow-[0_1px_3px_0_rgba(15,61,46,0.04),0_6px_18px_-8px_rgba(15,61,46,0.06)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  variant = "mint",
  className,
  children,
}: {
  variant?: "mint" | "forest" | "amber" | "danger" | "neutral";
  className?: string;
  children: React.ReactNode;
}) {
  const styles = {
    mint: "bg-mint-soft text-forest border border-emerald/25",
    forest: "bg-forest text-white border border-forest",
    amber: "bg-amber-bg/70 text-amber-safe border border-amber-200",
    danger: "bg-danger-bg/80 text-danger border border-red-200",
    neutral: "bg-surface-muted text-ink-muted border border-border-subtle",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        styles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export function StatusIndicator({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: StatusTone;
  className?: string;
}) {
  const dotColors: Record<StatusTone, string> = {
    success: "bg-emerald",
    warning: "bg-amber-600",
    danger: "bg-danger",
    info: "bg-forest",
    neutral: "bg-ink-muted/60",
  };
  const pillColors: Record<StatusTone, string> = {
    success: "bg-mint-soft text-forest border-emerald/20",
    warning: "bg-amber-bg/60 text-amber-safe border-amber-200",
    danger: "bg-danger-bg/70 text-danger border-red-200",
    info: "bg-surface-muted text-forest border-border-subtle",
    neutral: "bg-surface-muted/80 text-ink-muted border-border-subtle",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        pillColors[tone],
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColors[tone])} />
      <span>{label}</span>
    </span>
  );
}

export function ProgressBar({
  value,
  max = 100,
  label,
  sublabel,
}: {
  value: number;
  max?: number;
  label?: string;
  sublabel?: string;
}) {
  const pct = Math.min(100, Math.max(0, max > 0 ? (value / max) * 100 : 0));
  return (
    <div className="w-full space-y-1.5">
      {label || sublabel ? (
        <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
          <span className="truncate">{label}</span>
          <span className="font-semibold text-forest shrink-0">
            {sublabel || `${Math.round(pct)}%`}
          </span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          className="h-full rounded-full bg-emerald transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function InfoTooltip({
  text,
  label = "More information",
}: {
  text: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={label}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-muted hover:bg-mint-soft hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald cursor-pointer"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-40 mb-2 w-56 -translate-x-1/2 rounded-xl border border-border-subtle bg-forest px-3 py-2 text-[11px] font-normal leading-relaxed text-white shadow-lg"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-xl bg-surface-muted border border-border-subtle/50",
        className
      )}
    />
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading workspace data">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <Skeleton className="h-72 lg:col-span-5 w-full" />
        <Skeleton className="h-72 lg:col-span-7 w-full" />
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-subtle bg-surface-muted/35 px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-mint-soft text-emerald border border-emerald/20">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-forest">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-ink-muted leading-relaxed">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
