"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  GitBranch,
  Package,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type {
  AllocationRecord,
  DeliveryRecord,
  FoodCategory,
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
  ProgressBar,
  StatusIndicator,
} from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { useToast } from "@/components/ui/ToastProvider";
import { DemandForecastChart } from "@/components/charts/ImpactCharts";
import {
  LogisticsMap,
  type MapMarkerNode,
  type MapRouteSegment,
} from "@/components/maps/LogisticsMap";

export default function OrganizationDashboardPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [allocations, setAllocations] = useState<AllocationRecord[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [nearbyLots, setNearbyLots] = useState<InventoryLot[]>([]);
  const [forecasts, setForecasts] = useState<OrganizationDemandForecast[]>([]);
  const [regional7d, setRegional7d] = useState<
    Array<{
      day_label: string;
      total_predicted_need_kg: number;
      total_confidence_low_kg: number;
      total_confidence_high_kg: number;
    }>
  >([]);

  const [evalCategory, setEvalCategory] = useState<FoodCategory>("prepared_meals");
  const [dailyCapInput, setDailyCapInput] = useState("150");
  const [urgencyInput, setUrgencyInput] = useState("0.85");
  const [capacityModalOpen, setCapacityModalOpen] = useState(false);

  const [fundingSelection, setFundingSelection] = useState<
    Record<string, { mode: string; selfShare: number }>
  >({});
  const [declineTarget, setDeclineTarget] = useState<AllocationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [allocRes, delivRes, invRes, demRes] = await Promise.all([
        api.listAllocations(),
        api.listDeliveries().catch(() => ({ items: [] as DeliveryRecord[], total: 0 })),
        api.listInventory(false).catch(() => ({ items: [] as InventoryLot[], total: 0 })),
        api.getDemandIntelligence(evalCategory),
      ]);
      setAllocations(allocRes.items);
      setDeliveries(delivRes.items || []);
      setNearbyLots(
        (invRes.items || []).filter((l) =>
          ["listed", "analyzed", "matched", "partially_allocated"].includes(l.status)
        )
      );
      setForecasts(demRes.organizations);
      setRegional7d(demRes.regional_7d_forecast);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : "Unable to load recipient dashboard."
      );
    } finally {
      setLoading(false);
    }
  }, [evalCategory]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleAccept = async (alloc: AllocationRecord) => {
    setBusyId(alloc.id);
    const chosen = fundingSelection[alloc.id] || {
      mode: alloc.funding_plan?.recommended_mode || "sponsor_funded",
      selfShare: alloc.funding_plan?.self_funded_share_pct ?? 40,
    };

    try {
      await api.respondAllocation(alloc.id, {
        action: "accept",
        funding_mode: chosen.mode,
        self_funded_share_pct: chosen.selfShare,
        notes: `Accepted with ${chosen.mode.replace("_", " ")} funding.`,
      });
      notify({
        tone: "success",
        title: "Donation accepted",
        message: `${alloc.allocated_kg} kg from ${alloc.business_name} is now scheduled.`,
      });
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Action could not be completed",
        message: err instanceof ApiError ? err.message : "Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDecline = async () => {
    if (!declineTarget) return;
    setBusyId(declineTarget.id);
    try {
      await api.respondAllocation(declineTarget.id, {
        action: "decline",
        notes: "Capacity unavailable for this window.",
      });
      notify({
        tone: "info",
        title: "Request declined",
        message: `${declineTarget.inventory_title} was declined.`,
      });
      setDeclineTarget(null);
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Could not decline request",
        message: err instanceof ApiError ? err.message : "Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdateCapacity = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId("capacity");
    try {
      await api.submitDemandSignal({
        category: evalCategory,
        daily_capacity_kg: Number(dailyCapInput),
        urgency_bias: Number(urgencyInput),
      });
      setCapacityModalOpen(false);
      notify({
        tone: "success",
        title: "Storage capacity updated",
        message: `Updated receiving capacity to ${dailyCapInput} kg/day.`,
      });
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Update failed",
        message: err instanceof ApiError ? err.message : "Unable to save capacity.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const myForecast =
    forecasts.find((f) => f.organization_id === user?.id) || forecasts[0];

  const incomingRequests = useMemo(
    () =>
      allocations.filter(
        (a) => a.status === "proposed" || a.status === "awaiting_safety_approval"
      ),
    [allocations]
  );

  const acceptedDonations = useMemo(
    () =>
      allocations.filter((a) =>
        ["accepted", "confirmed", "in_delivery", "delivered"].includes(a.status)
      ),
    [allocations]
  );

  const orgMapMarkers: MapMarkerNode[] = useMemo(() => {
    const list: MapMarkerNode[] = [];
    if (user?.location) {
      list.push({
        id: user.id,
        label: user.organization_name,
        sublabel: `${myForecast?.daily_capacity_kg || user.daily_capacity_kg || 150} kg daily capacity`,
        quantityLabel: `${myForecast?.remaining_capacity_kg ?? (user.daily_capacity_kg || 150)} kg open capacity`,
        matchStatus:
          acceptedDonations.length > 0
            ? "matched"
            : incomingRequests.length > 0
            ? "pending"
            : "unmatched",
        kind: "organization",
        location: user.location,
      });
    }
    const seenDonors = new Set<string>();
    for (const alloc of allocations) {
      if (seenDonors.has(alloc.business_id)) continue;
      seenDonors.add(alloc.business_id);
      const isConfirmed = ["accepted", "confirmed", "in_delivery", "delivered"].includes(
        alloc.status
      );
      list.push({
        id: alloc.business_id,
        label: alloc.business_name,
        sublabel: `${alloc.allocated_kg} kg • ${alloc.distance_km} km`,
        quantityLabel: `${alloc.allocated_kg} kg`,
        distanceKm: alloc.distance_km,
        matchStatus: isConfirmed ? "matched" : "pending",
        kind: "donor",
        location: alloc.pickup_location,
      });
    }
    for (const lot of nearbyLots.slice(0, 6)) {
      if (seenDonors.has(lot.business_id)) continue;
      seenDonors.add(lot.business_id);
      list.push({
        id: lot.business_id,
        label: lot.business_name,
        sublabel: `${lot.quantity_kg} kg available`,
        quantityLabel: `${lot.quantity_kg} kg`,
        matchStatus: "unmatched",
        kind: "donor",
        location: lot.pickup_location,
      });
    }
    return list;
  }, [user, myForecast, allocations, nearbyLots, acceptedDonations.length, incomingRequests.length]);

  const orgMapRoutes: MapRouteSegment[] = useMemo(
    () =>
      allocations.map((a) => {
        const isConfirmed = ["accepted", "confirmed", "in_delivery", "delivered"].includes(
          a.status
        );
        return {
          id: a.id,
          label: `${a.business_name} → ${a.organization_name}`,
          donorId: a.business_id,
          recipientId: user?.id || a.organization_id,
          routeType: isConfirmed ? "confirmed" : "suggested",
          distanceKm: a.route?.distance_km ?? a.distance_km,
          durationMinutes: a.route?.duration_minutes ?? null,
          routeSource: a.route?.route_source ?? null,
          encodedPolyline: a.route?.encoded_polyline,
          points:
            a.route?.polyline_points && a.route.polyline_points.length >= 2
              ? a.route.polyline_points
              : [
                  { lat: a.pickup_location.lat, lng: a.pickup_location.lng },
                  { lat: a.dropoff_location.lat, lng: a.dropoff_location.lng },
                ],
          isFallback: a.is_fallback_match,
        };
      }),
    [allocations, user?.id]
  );

  const historyColumns: DataColumn<AllocationRecord>[] = [
    {
      key: "item",
      header: "Donation",
      render: (a) => (
        <div>
          <div className="font-semibold text-forest">{a.inventory_title}</div>
          <div className="text-xs text-ink-muted">{a.business_name}</div>
        </div>
      ),
    },
    {
      key: "qty",
      header: "Quantity",
      render: (a) => <span className="font-semibold text-forest">{a.allocated_kg} kg</span>,
    },
    {
      key: "eta",
      header: "Transit Estimate",
      render: (a) => (
        <span className="text-ink-muted">
          {a.route?.duration_minutes ? `${a.route.duration_minutes} min` : `${a.distance_km} km`}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (a) => (
        <StatusIndicator
          label={a.status.replace(/_/g, " ")}
          tone={a.status === "delivered" || a.status === "confirmed" ? "success" : "info"}
        />
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={["organization", "admin"]}>
      <AppShell
        title={`Welcome, ${user?.organization_name || "Recipient Partner"}`}
        subtitle="Review incoming surplus requests, manage storage capacity, and track scheduled deliveries."
        actions={
          <Button onClick={() => setCapacityModalOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" />
            Update Storage Capacity
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

        {loading && allocations.length === 0 && forecasts.length === 0 ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* 4 Compact KPI Cards */}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Incoming Requests"
                value={incomingRequests.length}
                helper="Awaiting response"
                icon={Package}
                tone={incomingRequests.length > 0 ? "amber" : "forest"}
              />
              <KpiCard
                label="Accepted Donations"
                value={acceptedDonations.length}
                helper="Confirmed rescues"
                icon={CheckCircle2}
                tone="emerald"
              />
              <KpiCard
                label="Available Capacity"
                value={
                  myForecast ? `${myForecast.remaining_capacity_kg} kg` : "Configured"
                }
                helper={
                  myForecast
                    ? `Of ${myForecast.daily_capacity_kg} kg daily capacity`
                    : "Update capacity anytime"
                }
                icon={Building2}
                tone="forest"
              />
              <KpiCard
                label="Collection Schedule"
                value={deliveries.filter((d) => d.status !== "delivered").length}
                helper="Active pickups"
                icon={CalendarClock}
                tone="emerald"
              />
            </section>

            {/* Incoming Donation Requests */}
            <Card className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="sc-section-title">Incoming Donation Requests</h2>
                  <p className="text-xs text-ink-muted">
                    Review matched surplus batches and choose how transport should be funded.
                  </p>
                </div>
                <StatusIndicator
                  label={`${incomingRequests.length} pending`}
                  tone={incomingRequests.length > 0 ? "warning" : "neutral"}
                />
              </div>

              {incomingRequests.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="No Pending Requests"
                  description="Matched surplus items directed to your organization will appear here."
                />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {incomingRequests.map((alloc) => {
                    const chosen = fundingSelection[alloc.id] || {
                      mode: alloc.funding_plan?.recommended_mode || "sponsor_funded",
                      selfShare: alloc.funding_plan?.self_funded_share_pct ?? 40,
                    };
                    const needsSafetyApproval =
                      alloc.status === "awaiting_safety_approval";
                    const cost =
                      alloc.cost_breakdown?.total_estimated_cost_usd ?? 25.0;

                    return (
                      <div
                        key={alloc.id}
                        className="flex flex-col justify-between gap-4 rounded-2xl border border-border-subtle bg-canvas/70 p-4"
                      >
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="sc-card-title">{alloc.inventory_title}</h3>
                              <p className="text-xs text-ink-muted">
                                From <strong>{alloc.business_name}</strong> • {alloc.distance_km} km
                              </p>
                            </div>
                            <StatusIndicator
                              label={
                                needsSafetyApproval
                                  ? "Safety Review Pending"
                                  : alloc.is_fallback_match
                                  ? "Expanded Match"
                                  : "Ready to Accept"
                              }
                              tone={
                                needsSafetyApproval
                                  ? "danger"
                                  : alloc.is_fallback_match
                                  ? "warning"
                                  : "success"
                              }
                            />
                          </div>

                          <div className="grid grid-cols-3 gap-2 rounded-xl bg-white p-3 text-xs border border-border-subtle">
                            <div>
                              <span className="text-ink-muted block">Quantity</span>
                              <span className="font-semibold text-forest">
                                {alloc.allocated_kg} kg
                              </span>
                            </div>
                            <div>
                              <span className="text-ink-muted block">Storage</span>
                              <span className="font-semibold text-forest capitalize">
                                {alloc.storage_requirement.replace("_", " ")}
                              </span>
                            </div>
                            <div>
                              <span className="text-ink-muted block">Delivery Est.</span>
                              <span className="font-semibold text-forest">
                                ${cost.toFixed(2)}
                              </span>
                            </div>
                          </div>

                          {alloc.is_fallback_match ? (
                            <div className="flex items-center gap-2 text-xs text-amber-safe">
                              <GitBranch className="h-3.5 w-3.5 shrink-0" />
                              <span>
                                Matched via expanded {alloc.fallback_radius_km} km search.
                              </span>
                            </div>
                          ) : null}

                          {needsSafetyApproval ? (
                            <div className="rounded-xl border border-red-200 bg-danger-bg/70 px-3 py-2 text-xs text-danger">
                              Awaiting administrator safety verification before confirmation is enabled.
                            </div>
                          ) : (
                            <div className="grid gap-2.5 sm:grid-cols-2">
                              <div>
                                <label
                                  htmlFor={`fund-${alloc.id}`}
                                  className="block text-[11px] font-semibold text-forest mb-1"
                                >
                                  Delivery Funding
                                </label>
                                <select
                                  id={`fund-${alloc.id}`}
                                  value={chosen.mode}
                                  onChange={(e) =>
                                    setFundingSelection((prev) => ({
                                      ...prev,
                                      [alloc.id]: {
                                        ...chosen,
                                        mode: e.target.value,
                                      },
                                    }))
                                  }
                                  className="min-h-9 w-full rounded-xl border border-border-subtle bg-white px-3 text-xs font-medium text-forest"
                                >
                                  <option value="sponsor_funded">Request Sponsor Funding</option>
                                  <option value="shared_funding">Share Cost with Sponsor</option>
                                  <option value="self_funded">Self-Funded Delivery</option>
                                </select>
                              </div>
                              {chosen.mode === "shared_funding" ? (
                                <div>
                                  <label
                                    htmlFor={`share-${alloc.id}`}
                                    className="block text-[11px] font-semibold text-forest mb-1"
                                  >
                                    Your Share (%)
                                  </label>
                                  <input
                                    id={`share-${alloc.id}`}
                                    type="number"
                                    min={10}
                                    max={90}
                                    value={chosen.selfShare}
                                    onChange={(e) =>
                                      setFundingSelection((prev) => ({
                                        ...prev,
                                        [alloc.id]: {
                                          ...chosen,
                                          selfShare: Number(e.target.value),
                                        },
                                      }))
                                    }
                                    className="min-h-9 w-full rounded-xl border border-border-subtle bg-white px-3 text-xs"
                                  />
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === alloc.id}
                            onClick={() => setDeclineTarget(alloc)}
                          >
                            Decline
                          </Button>
                          <Button
                            size="sm"
                            disabled={busyId === alloc.id || needsSafetyApproval}
                            onClick={() => void handleAccept(alloc)}
                          >
                            {busyId === alloc.id ? "Confirming..." : "Accept Donation"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Storage Capacity & Available Nearby Surplus */}
            <div className="grid gap-6 lg:grid-cols-12">
              <Card className="lg:col-span-7 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-emerald" />
                    <div>
                      <h2 className="sc-section-title">Storage &amp; 7-Day Need Forecast</h2>
                      <p className="text-xs text-ink-muted">
                        Projected community demand based on recent utilization.
                      </p>
                    </div>
                  </div>
                  <select
                    aria-label="Filter category forecast"
                    value={evalCategory}
                    onChange={(e) => setEvalCategory(e.target.value as FoodCategory)}
                    className="min-h-9 rounded-xl border border-border-subtle bg-white px-3 text-xs font-medium text-forest"
                  >
                    <option value="prepared_meals">Prepared Meals</option>
                    <option value="produce">Produce</option>
                    <option value="bakery">Bakery</option>
                    <option value="dairy">Dairy</option>
                    <option value="frozen_goods">Frozen Goods</option>
                    <option value="groceries">Groceries</option>
                  </select>
                </div>

                {myForecast ? (
                  <ProgressBar
                    value={myForecast.daily_capacity_kg - myForecast.remaining_capacity_kg}
                    max={myForecast.daily_capacity_kg}
                    label="Daily Storage Capacity Used"
                    sublabel={`${myForecast.remaining_capacity_kg} kg open of ${myForecast.daily_capacity_kg} kg`}
                  />
                ) : null}

                <DemandForecastChart data={regional7d} />
              </Card>

              <Card className="lg:col-span-5 space-y-4">
                <div>
                  <h2 className="sc-section-title">Available Surplus Nearby</h2>
                  <p className="text-xs text-ink-muted">
                    Active surplus listings currently in the redistribution network.
                  </p>
                </div>

                {nearbyLots.length === 0 ? (
                  <EmptyState
                    icon={Package}
                    title="No Available Lots Right Now"
                    description="New surplus items posted by local businesses will appear here."
                  />
                ) : (
                  <div className="space-y-2.5">
                    {nearbyLots.slice(0, 5).map((lot) => (
                      <div
                        key={lot.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-canvas/70 px-3.5 py-2.5 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-forest truncate">
                            {lot.title}
                          </div>
                          <div className="text-ink-muted truncate">
                            {lot.business_name} • {lot.quantity_kg} kg ({lot.storage_requirement.replace("_", " ")})
                          </div>
                        </div>
                        <StatusIndicator
                          label={lot.category.replace("_", " ")}
                          tone="info"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Donation Network Geographical Map */}
            <LogisticsMap
              center={
                user?.location
                  ? { lat: user.location.lat, lng: user.location.lng }
                  : undefined
              }
              markers={orgMapMarkers}
              routes={orgMapRoutes}
              onLocationUpdated={loadData}
            />

            {/* Accepted Donations & History */}
            <Card className="space-y-4">
              <div>
                <h2 className="sc-section-title">Accepted Donations &amp; Collection History</h2>
                <p className="text-xs text-ink-muted">
                  Track confirmed donations and delivery arrival estimates.
                </p>
              </div>
              <DataTable
                rows={acceptedDonations}
                columns={historyColumns}
                keyExtractor={(a) => a.id}
                caption="Accepted donations and delivery status"
                emptyState={
                  <EmptyState
                    icon={CheckCircle2}
                    title="No Accepted Donations Yet"
                    description="Accepted donation matches will appear here with transit updates."
                  />
                }
              />
            </Card>
          </>
        )}

        <ConfirmDialog
          open={Boolean(declineTarget)}
          onClose={() => setDeclineTarget(null)}
          onConfirm={handleConfirmDecline}
          busy={Boolean(busyId)}
          title="Decline Donation Request?"
          description={`Declining "${declineTarget?.inventory_title || ""}" will allow the platform to reassign it to another organization.`}
          confirmLabel="Decline Donation"
        />

        <ModalDialog
          open={capacityModalOpen}
          onClose={() => setCapacityModalOpen(false)}
          title="Update Storage Capacity"
          subtitle="Keep your daily receiving capacity current for accurate surplus matching."
        >
          <form onSubmit={handleUpdateCapacity} className="space-y-4">
            <div>
              <label htmlFor="org-cap" className="block text-xs font-semibold text-forest mb-1.5">
                Daily Receiving Capacity (kg)
              </label>
              <input
                id="org-cap"
                type="number"
                min={10}
                max={20000}
                required
                value={dailyCapInput}
                onChange={(e) => setDailyCapInput(e.target.value)}
                className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm"
              />
            </div>

            <div>
              <label htmlFor="org-urg" className="block text-xs font-semibold text-forest mb-1.5">
                Urgency Priority (0.10 – 1.00)
              </label>
              <input
                id="org-urg"
                type="number"
                step="0.05"
                min={0.1}
                max={1.0}
                required
                value={urgencyInput}
                onChange={(e) => setUrgencyInput(e.target.value)}
                className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm"
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCapacityModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busyId === "capacity"}>
                {busyId === "capacity" ? "Saving..." : "Save Capacity"}
              </Button>
            </div>
          </form>
        </ModalDialog>
      </AppShell>
    </RoleGuard>
  );
}
