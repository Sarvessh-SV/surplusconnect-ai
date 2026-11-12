"use client";

import React from "react";

export interface DataColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => React.ReactNode;
  mobileHide?: boolean;
}

interface DataTableProps<T> {
  rows: T[];
  columns: DataColumn<T>[];
  keyExtractor: (row: T) => string;
  caption: string;
  emptyState?: React.ReactNode;
  onRowClick?: (row: T) => void;
}

/**
 * Responsive SaaS DataTable:
 * - Desktop / Tablet (md+): crisp border-light table.
 * - Mobile (<md): vertically stacked cards with clear labels and zero horizontal scrolling.
 */
export function DataTable<T>({
  rows,
  columns,
  keyExtractor,
  caption,
  emptyState,
  onRowClick,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <>{emptyState || null}</>;
  }

  return (
    <>
      {/* Desktop / Tablet View */}
      <div className="hidden md:block sc-table-region">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-border-subtle bg-surface-muted/60 text-xs font-semibold text-ink-muted">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/80 bg-white">
            {rows.map((row) => (
              <tr
                key={keyExtractor(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={
                  onRowClick
                    ? "cursor-pointer transition-colors hover:bg-mint-soft/35"
                    : "hover:bg-canvas/50"
                }
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3.5 align-middle text-xs sm:text-sm ${
                      col.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Stacked Card View */}
      <div className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <div
            key={keyExtractor(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`rounded-2xl border border-border-subtle bg-white p-4 space-y-2.5 ${
              onRowClick ? "cursor-pointer active:bg-mint-soft/40" : ""
            }`}
          >
            {columns
              .filter((c) => !c.mobileHide)
              .map((col) => (
                <div
                  key={col.key}
                  className="flex items-start justify-between gap-3 text-xs"
                >
                  <span className="font-medium text-ink-muted shrink-0">
                    {col.header}
                  </span>
                  <div className="text-right min-w-0">{col.render(row)}</div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </>
  );
}

