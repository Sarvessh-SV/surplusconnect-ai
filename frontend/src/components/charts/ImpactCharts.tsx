"use client";

import React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function DemandForecastChart({
  data,
}: {
  data: Array<{
    day_label: string;
    total_predicted_need_kg: number;
    total_confidence_low_kg: number;
    total_confidence_high_kg: number;
  }>;
}) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-60 items-center justify-center rounded-xl border border-dashed border-border-subtle text-sm text-ink-muted">
        No demand forecast data loaded yet.
      </div>
    );
  }

  return (
    <div className="h-64 w-full" aria-label="7-day predictive demand forecast chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 14, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="emeraldFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#059669" stopOpacity={0.32} />
              <stop offset="95%" stopColor="#059669" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#d9ece2" />
          <XAxis
            dataKey="day_label"
            tick={{ fontSize: 12, fill: "#425c52" }}
            axisLine={{ stroke: "#cce3d7" }}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "#425c52" }}
            axisLine={{ stroke: "#cce3d7" }}
            unit=" kg"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff",
              borderColor: "#cce3d7",
              borderRadius: "0.75rem",
              fontSize: "0.75rem",
            }}
          />
          <Area
            type="monotone"
            dataKey="total_confidence_high_kg"
            name="Upper Bound (kg)"
            stroke="#a7f3d0"
            fill="#ecfdf5"
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="total_predicted_need_kg"
            name="Predicted Demand (kg)"
            stroke="#0f3d2e"
            fill="url(#emeraldFill)"
            strokeWidth={2.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const CATEGORY_COLORS = [
  "#0f3d2e",
  "#059669",
  "#10b981",
  "#34d399",
  "#047857",
  "#6ee7b7",
];

export function CategoryBreakdownChart({
  data,
}: {
  data: Array<{ category: string; quantity_kg: number }>;
}) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-border-subtle text-sm text-ink-muted">
        List surplus batches to view category volume.
      </div>
    );
  }

  const formatted = data.map((d) => ({
    ...d,
    label: d.category.replace("_", " "),
  }));

  return (
    <div className="h-56 w-full" aria-label="Surplus weight breakdown by food category">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formatted} margin={{ top: 10, right: 14, left: -12, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#d9ece2" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#425c52" }}
            axisLine={{ stroke: "#cce3d7" }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#425c52" }}
            axisLine={{ stroke: "#cce3d7" }}
            unit=" kg"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff",
              borderColor: "#cce3d7",
              borderRadius: "0.75rem",
              fontSize: "0.75rem",
            }}
          />
          <Bar dataKey="quantity_kg" name="Quantity (kg)" radius={[8, 8, 0, 0]}>
            {formatted.map((entry, idx) => (
              <Cell
                key={entry.category}
                fill={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

