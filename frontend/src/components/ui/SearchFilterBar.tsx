"use client";

import React from "react";
import { Search } from "lucide-react";

export interface FilterOption {
  label: string;
  value: string;
}

interface SearchFilterBarProps {
  searchValue: string;
  onSearchChange: (val: string) => void;
  searchPlaceholder?: string;
  filters?: Array<{
    id: string;
    label: string;
    value: string;
    options: FilterOption[];
    onChange: (val: string) => void;
  }>;
  sortOptions?: FilterOption[];
  sortValue?: string;
  onSortChange?: (val: string) => void;
  actions?: React.ReactNode;
}

export function SearchFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  filters = [],
  sortOptions,
  sortValue,
  onSortChange,
  actions,
}: SearchFilterBarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-white p-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="relative flex-1 min-w-52">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <input
          type="search"
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="min-h-10 w-full rounded-xl border border-border-subtle bg-canvas/60 pl-9 pr-3.5 text-sm text-ink placeholder:text-ink-muted/70"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {filters.map((f) => (
          <select
            key={f.id}
            aria-label={f.label}
            value={f.value}
            onChange={(e) => f.onChange(e.target.value)}
            className="min-h-10 rounded-xl border border-border-subtle bg-white px-3 text-xs font-medium text-forest"
          >
            {f.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ))}

        {sortOptions && onSortChange ? (
          <select
            aria-label="Sort items"
            value={sortValue}
            onChange={(e) => onSortChange(e.target.value)}
            className="min-h-10 rounded-xl border border-border-subtle bg-white px-3 text-xs font-medium text-forest"
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Sort: {opt.label}
              </option>
            ))}
          </select>
        ) : null}

        {actions}
      </div>
    </div>
  );
}

