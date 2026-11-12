"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock,
  Package,
  Plus,
  Sparkles,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
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
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { InventoryFormModal } from "@/components/inventory/InventoryFormModal";
import { getExpirySummary, getLotStatusTone } from "@/components/inventory/InventoryCard";
import { FallbackMatcherCard } from "@/components/agent/FallbackMatcherCard";
import { LogisticsMap, type MapMarkerNode, type MapRouteSegment } from "@/components/maps/LogisticsMap";

export default function BusinessDashboardPage() {
  const { user } = useAuth();
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [allocations, setAllocations] = useState<AllocationRecord[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
        err instanceof ApiError
          ? err.message
          : "Unable to load your business overview."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const metrics = useMemo(() => {
    const totalKg = lots.reduce((sum, l) => sum + (l.quantity_kg || 0), 0);
    const availableLots = lots.filter((l) =>
      ["listed", "analyzed", "matched", "partially_allocated"].includes(l.status)
    );
    const availableKg = availableLots.reduce((sum, l) => sum + (l.quantity_kg || 0), 0);
    const donatedKg = allocations
      .filter((a) => ["accepted", "confirmed", "in_delivery", "delivered"].includes(a.status))
      .reduce((sum, a) => sum + (a.allocated_kg || 0), 0);
    const pendingRequests = allocations.filter((a) =>
      ["proposed", "awaiting_safety_approval"].includes(a.status)
    ).length;
    return {
      totalKg: Math.round(totalKg * 10) / 10,
      availableKg: Math.round(availableKg * 10) / 10,
      availableCount: availableLots.length,
      donatedKg: Math.round(donatedKg * 10) / 10,
      pendingRequests,
    };
  }, [lots, allocations]);

  const urgentLots = useMemo(
    () =>
      lots
        .filter((l) => {
          const hrs = (new Date(l.expires_at).getTime() - Date.now()) / 3600000;
          return hrs > 0 && hrs <= 24 && l.status !== "completed";
        })
        .sort(
          (a, b) =>
            new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()
        )
        .slice(0, 4),
    [lots]
  );

  const featuredLot = lots[0] || null;
  const featuredAllocations = useMemo(
    () =>
      featuredLot
        ? allocations.filter((a) => a.inventory_id === featuredLot.id)
        : [],
    [allocations, featuredLot]
  );
  const featuredRun = useMemo(
    () =>
      featuredLot
        ? runs.find((r) => r.inventory_id === featuredLot.id) || null
        : null,
    [runs, featuredLot]
  );

  const mapMarkers: MapMarkerNode[] = useMemo(() => {
    const list: MapMarkerNode[] = [];
    if (featuredLot) {
      const lotConfirmed = featuredAllocations.some((a) =>
        ["accepted", "confirmed", "in_delivery", "delivered"].includes(a.status)
      );
      const lotPending = featuredAllocations.length > 0;
      list.push({
        id: featuredLot.id,
        label: featuredLot.business_name,
        sublabel: `${featuredLot.quantity_kg} kg available`,
        quantityLabel: `${featuredLot.quantity_kg} kg`,
        matchStatus: lotConfirmed ? "matched" : lotPending ? "pending" : "unmatched",
        kind: "donor",
        location: featuredLot.pickup_location,
      });
    } else if (user) {
      list.push({
        id: user.id,
        label: user.organization_name,
        sublabel: "Your location",
        quantityLabel: "Active donor",
        matchStatus: "unmatched",
        kind: "donor",
        location: user.location,
      });
    }
    for (const alloc of featuredAllocations) {
      const confirmed = ["accepted", "confirmed", "in_delivery", "delivered"].includes(
        alloc.status
      );
      list.push({
        id: alloc.id,
        label: alloc.organization_name,
        sublabel: `${alloc.allocated_kg} kg • ${alloc.distance_km} km`,
        quantityLabel: `${alloc.allocated_kg} kg`,
        distanceKm: alloc.distance_km,
        matchStatus: confirmed ? "matched" : "pending",
        kind: alloc.is_fallback_match ? "fallback_org" : "organization",
        location: alloc.dropoff_location,
      });
    }
    return list;
  }, [featuredLot, featuredAllocations, user]);

  const mapRoutes: MapRouteSegment[] = useMemo(
    () =>
      featuredAllocations.map((alloc) => {
        const confirmed = ["accepted", "confirmed", "in_delivery", "delivered"].includes(
          alloc.status
        );
        return {
          id: alloc.id,
          label: `${alloc.business_name} → ${alloc.organization_name}`,
          donorId: featuredLot?.id,
          recipientId: alloc.id,
          routeType: confirmed ? "confirmed" : "suggested",
          distanceKm: alloc.route?.distance_km ?? alloc.distance_km,
          durationMinutes: alloc.route?.duration_minutes ?? null,
          routeSource: alloc.route?.route_source ?? null,
          encodedPolyline: alloc.route?.encoded_polyline,
          points:
            alloc.route?.polyline_points && alloc.route.polyline_points.length >= 2
              ? alloc.route.polyline_points
              : [
                  { lat: alloc.pickup_location.lat, lng: alloc.pickup_location.lng },
                  { lat: alloc.dropoff_location.lat, lng: alloc.dropoff_location.lng },
                ],
          isFallback: alloc.is_fallback_match,
        };
      }),
    [featuredAllocations, featuredLot?.id]
  );

  const donationColumns: DataColumn<AllocationRecord>[] = [
    {
      key: "item",
      header: "Surplus Item",
      render: (a) => (
        <div>
          <div className="font-semibold text-forest">{a.inventory_title}</div>
          <div className="text-xs text-ink-muted">{a.organization_name}</div>
        </div>
      ),
    },
    {
      key: "qty",
      header: "Quantity",
      render: (a) => (
        <span className="font-semibold text-forest">{a.allocated_kg} kg</span>
      ),
    },
    {
      key: "distance",
      header: "Distance",
      render: (a) => <span className="text-ink-muted">{a.distance_km} km</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (a) => (
        <StatusIndicator
          label={a.status.replace(/_/g, " ")}
          tone={
            a.status === "delivered" || a.status === "confirmed" || a.status === "accepted"
              ? "success"
              : a.status === "awaiting_safety_approval"
              ? "danger"
              : "warning"
          }
        />
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={["business", "admin"]}>
      <AppShell
        title={`Welcome, ${user?.organization_name || "Business Partner"}`}
        subtitle="Track surplus inventory, respond to upcoming expiry alerts, and review recipient matches."
        actions={
          <>
            <Link href="/dashboard/business/inventory">
              <Button variant="outline">
                <Boxes className="h-4 w-4" />
                Manage Inventory
              </Button>
            </Link>
            <Button onClick={() => setAddModalOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Surplus
            </Button>
          </>
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

        {loading && lots.length === 0 ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* 4 Compact KPI Cards */}
            <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Total Surplus"
                value={`${metrics.totalKg} kg`}
                helper={`${lots.length} total batch${lots.length === 1 ? "" : "es"}`}
                icon={Package}
                tone="forest"
              />
              <KpiCard
                label="Available Inventory"
                value={`${metrics.availableKg} kg`}
                helper={`${metrics.availableCount} active listing${metrics.availableCount === 1 ? "" : "s"}`}
                icon={Boxes}
                tone="emerald"
              />
              <KpiCard
                label="Successfully Donated"
                value={`${metrics.donatedKg} kg`}
                helper="Confirmed & delivered"
                icon={CheckCircle2}
                tone="emerald"
              />
              <KpiCard
                label="Pending Requests"
                value={metrics.pendingRequests}
                helper="Awaiting review or pickup"
                icon={Clock}
                tone={metrics.pendingRequests > 0 ? "amber" : "forest"}
              />
            </section>

            {/* Expiry Alerts + Recent Inventory Activity */}
            <div className="grid gap-6 lg:grid-cols-12">
              <Card className="lg:col-span-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="sc-section-title">Upcoming Expiry Alerts</h2>
                  <Link
                    href="/dashboard/business/inventory"
                    className="text-xs font-semibold text-emerald hover:text-forest"
                  >
                    View all
                  </Link>
                </div>

                {urgentLots.length === 0 ? (
                  <EmptyState
                    icon={Clock}
                    title="No Urgent Expiries"
                    description="You have no active items expiring in the next 24 hours."
                  />
                ) : (
                  <div className="space-y-2.5">
                    {urgentLots.map((lot) => {
                      const exp = getExpirySummary(lot.expires_at);
                      return (
                        <div
                          key={lot.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-amber-200/80 bg-amber-bg/25 p-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-forest truncate">
                              {lot.title}
                            </div>
                            <div className="text-xs text-ink-muted">
                              {lot.quantity_kg} kg • {lot.storage_requirement.replace("_", " ")}
                            </div>
                          </div>
                          <StatusIndicator label={exp.label} tone={exp.tone} />
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="border-t border-border-subtle pt-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="sc-card-title">Recent Inventory Activity</h3>
                    <Link
                      href="/dashboard/agent"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald hover:text-forest"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Ask AI
                    </Link>
                  </div>
                  {lots.length === 0 ? (
                    <p className="text-xs text-ink-muted">
                      Add your first surplus batch to start automatic matching.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {lots.slice(0, 4).map((lot) => (
                        <div
                          key={lot.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-canvas/60 px-3 py-2.5 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-forest truncate">
                              {lot.title}
                            </div>
                            <div className="text-ink-muted">
                              {lot.quantity_kg} kg • {lot.category.replace("_", " ")}
                            </div>
                          </div>
                          <StatusIndicator
                            label={lot.status.replace(/_/g, " ")}
                            tone={getLotStatusTone(lot.status)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              <div className="lg:col-span-7 space-y-6">
                <LogisticsMap
                  center={
                    featuredLot
                      ? {
                          lat: featuredLot.pickup_location.lat,
                          lng: featuredLot.pickup_location.lng,
                        }
                      : user
                      ? { lat: user.location.lat, lng: user.location.lng }
                      : undefined
                  }
                  markers={mapMarkers}
                  routes={mapRoutes}
                  primaryRadiusKm={10}
                  fallbackRadiusKm={
                    featuredLot?.fallback_activated
                      ? featuredLot.expanded_radius_km
                      : undefined
                  }
                  onLocationUpdated={loadData}
                />

                {featuredLot ? (
                  <FallbackMatcherCard
                    lot={featuredLot}
                    allocations={featuredAllocations}
                    run={featuredRun}
                  />
                ) : null}
              </div>
            </div>

            {/* Donation History & Recipient Matches */}
            <Card className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="sc-section-title">Donation History</h2>
                  <p className="text-xs text-ink-muted">
                    Matched recipient organizations and current delivery status.
                  </p>
                </div>
                <Link href="/dashboard/business/inventory">
                  <Button variant="ghost" size="sm">
                    Open Inventory Manager
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>

              <DataTable
                rows={allocations.slice(0, 8)}
                columns={donationColumns}
                keyExtractor={(a) => a.id}
                caption="Recent surplus donations and recipient matches"
                emptyState={
                  <EmptyState
                    icon={Package}
                    title="No Donations Yet"
                    description="Add surplus inventory to automatically match eligible nearby organizations."
                    action={
                      <Button size="sm" onClick={() => setAddModalOpen(true)}>
                        <Plus className="h-4 w-4" />
                        Add Surplus
                      </Button>
                    }
                  />
                }
              />
            </Card>
          </>
        )}

        <InventoryFormModal
          open={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          onSaved={() => void loadData()}
        />
      </AppShell>
    </RoleGuard>
  );
}
