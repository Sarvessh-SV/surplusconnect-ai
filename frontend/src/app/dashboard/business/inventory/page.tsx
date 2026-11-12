"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Edit3,
  Eye,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AgentRun, AllocationRecord, InventoryLot } from "@/lib/types";
import { AppShell } from "@/components/layout/AppShell";
import { RoleGuard } from "@/components/layout/RoleGuard";
import {
  Button,
  Card,
  DashboardSkeleton,
  EmptyState,
  StatusIndicator,
} from "@/components/ui/primitives";
import { SearchFilterBar } from "@/components/ui/SearchFilterBar";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { useToast } from "@/components/ui/ToastProvider";
import { InventoryFormModal } from "@/components/inventory/InventoryFormModal";
import {
  InventoryCard,
  getExpirySummary,
  getLotStatusTone,
} from "@/components/inventory/InventoryCard";
import { FallbackMatcherCard } from "@/components/agent/FallbackMatcherCard";
import { LogisticsMap } from "@/components/maps/LogisticsMap";

export default function InventoryManagementPage() {
  const { notify } = useToast();
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [allocations, setAllocations] = useState<AllocationRecord[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Controls
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editingLot, setEditingLot] = useState<InventoryLot | null>(null);
  const [deletingLot, setDeletingLot] = useState<InventoryLot | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [inspectLot, setInspectLot] = useState<InventoryLot | null>(null);
  const [matchingBusy, setMatchingBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [invRes, allocRes, runsRes] = await Promise.all([
        api.listInventory(true),
        api.listAllocations(),
        api.listAgentRuns(),
      ]);
      setLots(invRes.items);
      setAllocations(allocRes.items);
      setRuns(runsRes.items);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : "Unable to load inventory."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredLots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = lots.filter((l) => {
      if (q && !l.title.toLowerCase().includes(q) && !l.category.toLowerCase().includes(q)) {
        return false;
      }
      if (categoryFilter !== "all" && l.category !== categoryFilter) {
        return false;
      }
      if (statusFilter !== "all" && l.status !== statusFilter) {
        return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === "expiry") {
        return new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime();
      }
      if (sortBy === "quantity") {
        return b.quantity_kg - a.quantity_kg;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return list;
  }, [lots, searchQuery, categoryFilter, statusFilter, sortBy]);

  const handleConfirmDelete = async () => {
    if (!deletingLot) return;
    setDeleteBusy(true);
    try {
      await api.deleteInventory(deletingLot.id);
      notify({
        tone: "success",
        title: "Inventory removed",
        message: `${deletingLot.title} was deleted.`,
      });
      setDeletingLot(null);
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Could not delete item",
        message:
          err instanceof ApiError ? err.message : "Item may already be in transit.",
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleRerunMatch = async (lot: InventoryLot) => {
    setMatchingBusy(true);
    try {
      await api.runMatching(lot.id, {
        primary_radius_km: 10,
        allow_split_allocation: true,
        activate_fallback_if_needed: true,
        max_fallback_radius_km: 75,
      });
      notify({
        tone: "success",
        title: "Recipient matching updated",
        message: `Refreshed matches for ${lot.title}.`,
      });
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Matching failed",
        message: err instanceof ApiError ? err.message : "Unable to update matches.",
      });
    } finally {
      setMatchingBusy(false);
    }
  };

  const inspectAllocations = useMemo(
    () =>
      inspectLot ? allocations.filter((a) => a.inventory_id === inspectLot.id) : [],
    [inspectLot, allocations]
  );
  const inspectRun = useMemo(
    () =>
      inspectLot ? runs.find((r) => r.inventory_id === inspectLot.id) || null : null,
    [inspectLot, runs]
  );

  const tableColumns: DataColumn<InventoryLot>[] = [
    {
      key: "name",
      header: "Product",
      render: (l) => (
        <div>
          <div className="font-semibold text-forest">{l.title}</div>
          <div className="text-xs text-ink-muted capitalize">
            {l.category.replace("_", " ")} • {l.storage_requirement.replace("_", " ")}
          </div>
        </div>
      ),
    },
    {
      key: "qty",
      header: "Quantity",
      render: (l) => <span className="font-semibold text-forest">{l.quantity_kg} kg</span>,
    },
    {
      key: "expiry",
      header: "Expiry",
      render: (l) => {
        const exp = getExpirySummary(l.expires_at);
        return <StatusIndicator label={exp.label} tone={exp.tone} />;
      },
    },
    {
      key: "status",
      header: "Status",
      render: (l) => (
        <StatusIndicator
          label={l.status.replace(/_/g, " ")}
          tone={getLotStatusTone(l.status)}
        />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (l) => (
        <div className="inline-flex items-center justify-end gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setInspectLot(l)}>
            <Eye className="h-3.5 w-3.5" />
            Match
          </Button>
          <button
            type="button"
            aria-label={`Edit ${l.title}`}
            onClick={() => {
              setEditingLot(l);
              setFormOpen(true);
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle text-forest hover:bg-mint-soft cursor-pointer"
          >
            <Edit3 className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={`Delete ${l.title}`}
            onClick={() => setDeletingLot(l)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle text-danger hover:bg-danger-bg cursor-pointer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={["business", "admin"]}>
      <AppShell
        title="Inventory Management"
        subtitle="Add, update, and monitor surplus items, expiry timelines, and recipient matches."
        actions={
          <Button
            onClick={() => {
              setEditingLot(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Add Surplus
          </Button>
        }
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

        <SearchFilterBar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search inventory by name or category..."
          filters={[
            {
              id: "category-filter",
              label: "Filter by category",
              value: categoryFilter,
              onChange: setCategoryFilter,
              options: [
                { label: "All Categories", value: "all" },
                { label: "Bakery", value: "bakery" },
                { label: "Produce", value: "produce" },
                { label: "Prepared Meals", value: "prepared_meals" },
                { label: "Dairy", value: "dairy" },
                { label: "Groceries", value: "groceries" },
                { label: "Frozen Goods", value: "frozen_goods" },
                { label: "Beverages", value: "beverages" },
              ],
            },
            {
              id: "status-filter",
              label: "Filter by status",
              value: statusFilter,
              onChange: setStatusFilter,
              options: [
                { label: "All Statuses", value: "all" },
                { label: "Matched", value: "matched" },
                { label: "Awaiting Approval", value: "awaiting_approval" },
                { label: "Analyzed", value: "analyzed" },
                { label: "Completed", value: "completed" },
              ],
            },
          ]}
          sortValue={sortBy}
          onSortChange={setSortBy}
          sortOptions={[
            { label: "Newest First", value: "newest" },
            { label: "Expiring Soonest", value: "expiry" },
            { label: "Highest Quantity", value: "quantity" },
          ]}
          actions={
            <div className="inline-flex rounded-xl border border-border-subtle bg-canvas p-0.5">
              <button
                type="button"
                aria-label="Card view"
                onClick={() => setViewMode("cards")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold cursor-pointer ${
                  viewMode === "cards"
                    ? "bg-forest text-white"
                    : "text-ink-muted hover:text-forest"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Cards</span>
              </button>
              <button
                type="button"
                aria-label="Table view"
                onClick={() => setViewMode("table")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold cursor-pointer ${
                  viewMode === "table"
                    ? "bg-forest text-white"
                    : "text-ink-muted hover:text-forest"
                }`}
              >
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Table</span>
              </button>
            </div>
          }
        />

        {loading && lots.length === 0 ? (
          <DashboardSkeleton />
        ) : filteredLots.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={lots.length === 0 ? "No Surplus Inventory Yet" : "No Matching Items"}
            description={
              lots.length === 0
                ? "Add your first surplus batch to check eligibility and match with local recipient organizations."
                : "Try adjusting your search or filter selections."
            }
            action={
              lots.length === 0 ? (
                <Button
                  onClick={() => {
                    setEditingLot(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add Surplus
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setCategoryFilter("all");
                    setStatusFilter("all");
                  }}
                >
                  Clear Filters
                </Button>
              )
            }
          />
        ) : viewMode === "cards" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredLots.map((lot) => (
              <InventoryCard
                key={lot.id}
                lot={lot}
                onSelect={(l) => setInspectLot(l)}
                onEdit={(l) => {
                  setEditingLot(l);
                  setFormOpen(true);
                }}
                onDelete={(l) => setDeletingLot(l)}
              />
            ))}
          </div>
        ) : (
          <DataTable
            rows={filteredLots}
            columns={tableColumns}
            keyExtractor={(l) => l.id}
            caption="Registered surplus inventory lots"
          />
        )}

        <InventoryFormModal
          open={formOpen}
          editingLot={editingLot}
          onClose={() => {
            setFormOpen(false);
            setEditingLot(null);
          }}
          onSaved={() => void loadData()}
        />

        <ConfirmDialog
          open={Boolean(deletingLot)}
          onClose={() => setDeletingLot(null)}
          onConfirm={handleConfirmDelete}
          busy={deleteBusy}
          title="Delete Surplus Item?"
          description={`Remove "${deletingLot?.title || ""}" from active surplus inventory? Any open unconfirmed match requests for this batch will also be cancelled.`}
          confirmLabel="Delete Item"
        />

        <ModalDialog
          open={Boolean(inspectLot)}
          onClose={() => setInspectLot(null)}
          title={inspectLot?.title || "Match Overview"}
          subtitle={
            inspectLot
              ? `${inspectLot.quantity_kg} kg • ${inspectLot.category.replace("_", " ")} • ${inspectLot.storage_requirement.replace("_", " ")}`
              : undefined
          }
        >
          {inspectLot ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusIndicator
                  label={inspectLot.status.replace(/_/g, " ")}
                  tone={getLotStatusTone(inspectLot.status)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={matchingBusy}
                  onClick={() => void handleRerunMatch(inspectLot)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {matchingBusy ? "Updating..." : "Refresh Recipient Match"}
                </Button>
              </div>

              <LogisticsMap
                center={{
                  lat: inspectLot.pickup_location.lat,
                  lng: inspectLot.pickup_location.lng,
                }}
                markers={[
                  {
                    id: inspectLot.id,
                    label: inspectLot.business_name,
                    sublabel: `${inspectLot.quantity_kg} kg`,
                    quantityLabel: `${inspectLot.quantity_kg} kg`,
                    matchStatus: inspectAllocations.some((a) =>
                      ["accepted", "confirmed", "in_delivery", "delivered"].includes(a.status)
                    )
                      ? "matched"
                      : inspectAllocations.length > 0
                      ? "pending"
                      : "unmatched",
                    kind: "donor",
                    location: inspectLot.pickup_location,
                  },
                  ...inspectAllocations.map((a) => {
                    const confirmed = ["accepted", "confirmed", "in_delivery", "delivered"].includes(
                      a.status
                    );
                    return {
                      id: a.id,
                      label: a.organization_name,
                      sublabel: `${a.allocated_kg} kg • ${a.distance_km} km`,
                      quantityLabel: `${a.allocated_kg} kg`,
                      distanceKm: a.distance_km,
                      matchStatus: (confirmed ? "matched" : "pending") as "matched" | "pending",
                      kind: (a.is_fallback_match ? "fallback_org" : "organization") as
                        | "fallback_org"
                        | "organization",
                      location: a.dropoff_location,
                    };
                  }),
                ]}
                routes={inspectAllocations.map((a) => {
                  const confirmed = ["accepted", "confirmed", "in_delivery", "delivered"].includes(
                    a.status
                  );
                  return {
                    id: a.id,
                    label: `${inspectLot.business_name} → ${a.organization_name}`,
                    donorId: inspectLot.id,
                    recipientId: a.id,
                    routeType: (confirmed ? "confirmed" : "suggested") as "confirmed" | "suggested",
                    distanceKm: a.route?.distance_km ?? a.distance_km,
                    durationMinutes: a.route?.duration_minutes ?? null,
                    routeSource: a.route?.route_source ?? null,
                    encodedPolyline: a.route?.encoded_polyline,
                    points:
                      a.route?.polyline_points && a.route.polyline_points.length >= 2
                        ? a.route.polyline_points
                        : [
                            {
                              lat: a.pickup_location.lat,
                              lng: a.pickup_location.lng,
                            },
                            {
                              lat: a.dropoff_location.lat,
                              lng: a.dropoff_location.lng,
                            },
                          ],
                    isFallback: a.is_fallback_match,
                  };
                })}
                primaryRadiusKm={10}
                fallbackRadiusKm={
                  inspectLot.fallback_activated ? inspectLot.expanded_radius_km : undefined
                }
                heightClass="h-[340px]"
              />

              <FallbackMatcherCard
                lot={inspectLot}
                allocations={inspectAllocations}
                run={inspectRun}
              />

              {inspectAllocations.length === 0 ? (
                <Card className="p-4 text-center text-xs text-ink-muted">
                  No recipient allocations yet. Click &ldquo;Refresh Recipient Match&rdquo; to scan nearby organizations.
                </Card>
              ) : null}
            </div>
          ) : null}
        </ModalDialog>
      </AppShell>
    </RoleGuard>
  );
}

