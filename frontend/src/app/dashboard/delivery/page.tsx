"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Navigation,
  PackageCheck,
  ThermometerSnowflake,
  Truck,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { DeliveryRecord } from "@/lib/types";
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
import { ModalDialog } from "@/components/ui/ModalDialog";
import { useToast } from "@/components/ui/ToastProvider";
import { LogisticsMap, type MapMarkerNode, type MapRouteSegment } from "@/components/maps/LogisticsMap";

export default function DeliveryDashboardPage() {
  const { notify } = useToast();
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryRecord | null>(
    null
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDelivery, setConfirmDelivery] = useState<DeliveryRecord | null>(
    null
  );
  const [recipientName, setRecipientName] = useState("");
  const [tempC, setTempC] = useState("3.2");
  const [notes, setNotes] = useState("Handed over intact in sealed containers.");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.listDeliveries();
      setDeliveries(res.items);
      if (res.items.length > 0 && !selectedDelivery) {
        setSelectedDelivery(res.items[0]);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : "Unable to load delivery assignments."
      );
    } finally {
      setLoading(false);
    }
  }, [selectedDelivery]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const metrics = useMemo(() => {
    const open = deliveries.filter(
      (d) => d.status === "ready_for_dispatch" || d.status === "pickup_scheduled"
    ).length;
    const inTransit = deliveries.filter(
      (d) => d.status === "collected" || d.status === "in_transit"
    ).length;
    const completed = deliveries.filter((d) => d.status === "delivered").length;
    const earnings = deliveries
      .filter((d) => d.status === "delivered")
      .reduce((sum, d) => sum + (d.estimated_cost_usd || 0), 0);
    return { open, inTransit, completed, earnings };
  }, [deliveries]);

  const handleClaimDispatch = async (deliv: DeliveryRecord) => {
    setBusyId(deliv.id);
    try {
      await api.assignDeliveryPartner({ allocation_id: deliv.allocation_id });
      notify({
        tone: "success",
        title: "Assignment claimed",
        message: `You are assigned to deliver ${deliv.inventory_title}.`,
      });
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Could not claim assignment",
        message: err instanceof ApiError ? err.message : "Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleStatusStep = async (deliv: DeliveryRecord, nextStatus: string) => {
    setBusyId(deliv.id);
    try {
      await api.updateDeliveryStatus(deliv.id, {
        status: nextStatus,
        delivery_notes: `Delivery status updated to ${nextStatus.replace("_", " ")}.`,
      });
      notify({
        tone: "success",
        title: "Status updated",
        message: `${deliv.inventory_title} marked as ${nextStatus.replace("_", " ")}.`,
      });
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Status update blocked",
        message: err instanceof ApiError ? err.message : "Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmitConfirmation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmDelivery) return;
    setBusyId(confirmDelivery.id);
    try {
      await api.updateDeliveryStatus(confirmDelivery.id, {
        status: "delivered",
        recipient_confirmation_name: recipientName.trim(),
        temperature_verified_c: Number(tempC),
        delivery_notes: notes.trim(),
        proof_reference: `POD-${confirmDelivery.id.slice(-6).toUpperCase()}`,
      });
      setConfirmOpen(false);
      setRecipientName("");
      notify({
        tone: "success",
        title: "Delivery confirmed",
        message: `${confirmDelivery.inventory_title} marked delivered and payout-ready.`,
      });
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Confirmation failed",
        message: err instanceof ApiError ? err.message : "Please review details.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const markers: MapMarkerNode[] = useMemo(() => {
    const target = selectedDelivery || deliveries[0];
    if (!target) return [];
    const confirmed = [
      "ready_for_dispatch",
      "pickup_scheduled",
      "collected",
      "in_transit",
      "delivered",
    ].includes(target.status);
    return [
      {
        id: `${target.id}-pickup`,
        label: target.business_name,
        sublabel: `${target.allocated_kg} kg pickup`,
        quantityLabel: `${target.allocated_kg} kg`,
        matchStatus: confirmed ? "matched" : "pending",
        kind: "donor",
        location: target.pickup_location,
      },
      {
        id: `${target.id}-drop`,
        label: target.organization_name,
        sublabel: `${target.allocated_kg} kg drop-off`,
        quantityLabel: `${target.allocated_kg} kg`,
        distanceKm: target.route?.distance_km ?? null,
        matchStatus: confirmed ? "matched" : "pending",
        kind: "organization",
        location: target.dropoff_location,
      },
    ];
  }, [selectedDelivery, deliveries]);

  const routes: MapRouteSegment[] = useMemo(() => {
    const target = selectedDelivery || deliveries[0];
    if (!target) return [];
    const confirmed = [
      "ready_for_dispatch",
      "pickup_scheduled",
      "collected",
      "in_transit",
      "delivered",
    ].includes(target.status);
    return [
      {
        id: target.id,
        label: `${target.inventory_title}: ${target.business_name} → ${target.organization_name}`,
        donorId: `${target.id}-pickup`,
        recipientId: `${target.id}-drop`,
        routeType: confirmed ? "confirmed" : "suggested",
        distanceKm: target.route?.distance_km ?? null,
        durationMinutes: target.route?.duration_minutes ?? null,
        routeSource: target.route?.route_source ?? null,
        encodedPolyline: target.route?.encoded_polyline,
        points:
          target.route?.polyline_points && target.route.polyline_points.length >= 2
            ? target.route.polyline_points
            : [
                { lat: target.pickup_location.lat, lng: target.pickup_location.lng },
                { lat: target.dropoff_location.lat, lng: target.dropoff_location.lng },
              ],
      },
    ];
  }, [selectedDelivery, deliveries]);

  return (
    <RoleGuard allowedRoles={["delivery_partner", "admin"]}>
      <AppShell
        title="Delivery Assignments"
        subtitle="Manage active pickups, follow optimized routes, and confirm completed dropoffs."
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

        {loading && deliveries.length === 0 ? (
          <DashboardSkeleton />
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Ready for Pickup"
                value={metrics.open}
                helper="Awaiting collection"
                icon={Truck}
                tone={metrics.open > 0 ? "amber" : "forest"}
              />
              <KpiCard
                label="In Transit"
                value={metrics.inTransit}
                helper="Currently active"
                icon={Navigation}
                tone="emerald"
              />
              <KpiCard
                label="Completed"
                value={metrics.completed}
                helper="Confirmed deliveries"
                icon={CheckCircle2}
                tone="emerald"
              />
              <KpiCard
                label="Completed Fees"
                value={`$${metrics.earnings.toFixed(2)}`}
                helper="Eligible for payout"
                icon={DollarSign}
                tone="forest"
              />
            </section>

            <div className="grid gap-6 lg:grid-cols-12">
              <Card className="lg:col-span-7 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="sc-section-title">
                    Assignments ({deliveries.length})
                  </h2>
                </div>

                {deliveries.length === 0 ? (
                  <EmptyState
                    icon={Truck}
                    title="No Active Assignments"
                    description="New delivery routes will appear here once recipients confirm surplus matches."
                  />
                ) : (
                  <div className="space-y-3">
                    {deliveries.map((deliv) => (
                      <div
                        key={deliv.id}
                        onClick={() => setSelectedDelivery(deliv)}
                        className={`cursor-pointer rounded-2xl border p-4 space-y-3 transition-all ${
                          selectedDelivery?.id === deliv.id
                            ? "border-emerald bg-mint-soft/30 ring-1 ring-emerald/25"
                            : "border-border-subtle bg-white hover:border-emerald/70"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="sc-card-title">{deliv.inventory_title}</h3>
                            <p className="text-xs text-ink-muted mt-0.5">
                              {deliv.business_name} → {deliv.organization_name}
                            </p>
                          </div>
                          <StatusIndicator
                            label={deliv.status.replace(/_/g, " ")}
                            tone={
                              deliv.status === "delivered"
                                ? "success"
                                : deliv.status === "pending_funding"
                                ? "warning"
                                : "info"
                            }
                          />
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl bg-canvas p-3 text-xs">
                          <div>
                            <span className="text-ink-muted block">Weight</span>
                            <strong className="text-forest">{deliv.allocated_kg} kg</strong>
                          </div>
                          <div>
                            <span className="text-ink-muted block">Handling</span>
                            <strong className="text-forest capitalize">
                              {deliv.storage_requirement.replace("_", " ")}
                            </strong>
                          </div>
                          <div>
                            <span className="text-ink-muted block">Est. Time</span>
                            <strong className="text-forest">
                              {deliv.route?.duration_minutes ?? "—"} min
                            </strong>
                          </div>
                          <div>
                            <span className="text-ink-muted block">Delivery Fee</span>
                            <strong className="text-forest">
                              ${deliv.estimated_cost_usd.toFixed(2)}
                            </strong>
                          </div>
                        </div>

                        {deliv.recipient_confirmation_name ? (
                          <div className="rounded-xl bg-mint-soft/50 px-3 py-2 text-xs text-forest">
                            Signed by <strong>{deliv.recipient_confirmation_name}</strong>
                            {deliv.temperature_verified_c !== null &&
                            deliv.temperature_verified_c !== undefined
                              ? ` • Recorded temp: ${deliv.temperature_verified_c}°C`
                              : ""}
                          </div>
                        ) : null}

                        <div
                          className="flex flex-wrap gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {!deliv.partner_id ? (
                            <Button
                              size="sm"
                              disabled={busyId === deliv.id}
                              onClick={() => void handleClaimDispatch(deliv)}
                            >
                              Claim Assignment
                            </Button>
                          ) : null}

                          {deliv.status === "ready_for_dispatch" ||
                          deliv.status === "pickup_scheduled" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busyId === deliv.id}
                              onClick={() => void handleStatusStep(deliv, "collected")}
                            >
                              Mark Collected
                            </Button>
                          ) : null}

                          {deliv.status === "collected" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busyId === deliv.id}
                              onClick={() => void handleStatusStep(deliv, "in_transit")}
                            >
                              Start Transit
                            </Button>
                          ) : null}

                          {(deliv.status === "collected" ||
                            deliv.status === "in_transit" ||
                            deliv.status === "pickup_scheduled") &&
                          deliv.partner_id ? (
                            <Button
                              size="sm"
                              disabled={busyId === deliv.id}
                              onClick={() => {
                                setConfirmDelivery(deliv);
                                setTempC(
                                  deliv.storage_requirement === "frozen"
                                    ? "-18.2"
                                    : deliv.storage_requirement === "refrigerated"
                                    ? "3.4"
                                    : "19.0"
                                );
                                setConfirmOpen(true);
                              }}
                            >
                              <PackageCheck className="h-4 w-4" />
                              Confirm Delivery
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <div className="lg:col-span-5">
                <LogisticsMap
                  center={
                    selectedDelivery
                      ? {
                          lat: selectedDelivery.pickup_location.lat,
                          lng: selectedDelivery.pickup_location.lng,
                        }
                      : undefined
                  }
                  markers={markers}
                  routes={routes}
                  onLocationUpdated={loadData}
                />
              </div>
            </div>

            <ModalDialog
              open={confirmOpen}
              onClose={() => setConfirmOpen(false)}
              title="Confirm Completed Delivery"
              subtitle={
                confirmDelivery
                  ? `${confirmDelivery.inventory_title} → ${confirmDelivery.organization_name}`
                  : undefined
              }
            >
              <form onSubmit={handleSubmitConfirmation} className="space-y-4">
                <div>
                  <label htmlFor="pod-name" className="block text-xs font-semibold text-forest mb-1.5">
                    Recipient Signatory Name
                  </label>
                  <input
                    id="pod-name"
                    type="text"
                    required
                    minLength={2}
                    placeholder="Full name of person receiving items"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="pod-temp" className="flex items-center gap-1.5 text-xs font-semibold text-forest mb-1.5">
                    <ThermometerSnowflake className="h-4 w-4 text-emerald" />
                    Recorded Temperature (°C)
                  </label>
                  <input
                    id="pod-temp"
                    type="number"
                    step="0.1"
                    min={-30}
                    max={45}
                    required
                    value={tempC}
                    onChange={(e) => setTempC(e.target.value)}
                    className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="pod-notes" className="block text-xs font-semibold text-forest mb-1.5">
                    Delivery Notes
                  </label>
                  <textarea
                    id="pod-notes"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2 text-sm"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={Boolean(busyId)}>
                    Confirm Delivery
                  </Button>
                </div>
              </form>
            </ModalDialog>
          </>
        )}
      </AppShell>
    </RoleGuard>
  );
}
