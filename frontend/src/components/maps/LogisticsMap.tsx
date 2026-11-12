"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  ArrowRight,
  Clock,
  HeartHandshake,
  LocateFixed,
  MapPin,
  Route,
  Store,
  Warehouse,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { GeoPoint, RoadRouteResult } from "@/lib/types";
import { ModalDialog } from "@/components/ui/ModalDialog";
import {
  Button,
  Card,
  EmptyState,
  Skeleton,
  StatusIndicator,
} from "@/components/ui/primitives";
import type {
  MatchStatusKind,
  NormalizedMapMarker,
  ResolvedRoadSegment,
} from "./LeafletNetworkCanvas";
import { LocationPickerModal } from "./LocationPickerModal";
import { decodeEncodedPolyline, hasValidCoordinates } from "./polyline";

const DynamicLeafletNetwork = dynamic(() => import("./LeafletNetworkCanvas"), {
  ssr: false,
  loading: () => (
    <Skeleton className="h-[360px] sm:h-[420px] lg:h-[460px] w-full rounded-xl" />
  ),
});

export interface MapMarkerNode {
  id: string;
  label: string;
  sublabel: string;
  kind: "donor" | "organization" | "hub" | "fallback_org";
  location: GeoPoint;
  quantityLabel?: string;
  distanceKm?: number | null;
  matchStatus?: MatchStatusKind;
}

export interface MapRouteSegment {
  id: string;
  label: string;
  donorId?: string;
  recipientId?: string;
  encodedPolyline?: string | null;
  points: Array<{ lat: number; lng: number }>;
  distanceKm?: number | null;
  durationMinutes?: number | null;
  routeSource?: string | null;
  routeType?: "confirmed" | "suggested";
  isFallback?: boolean;
}

type MapFilterMode = "all" | "donors" | "recipients" | "matched" | "pending";

interface LogisticsMapProps {
  center?: { lat: number; lng: number };
  markers: MapMarkerNode[];
  routes?: MapRouteSegment[];
  primaryRadiusKm?: number;
  fallbackRadiusKm?: number;
  heightClass?: string;
  title?: string;
  subtitle?: string;
  onViewDetails?: (marker: NormalizedMapMarker) => void;
  onLocationUpdated?: (location: GeoPoint) => void | Promise<void>;
}

const FILTER_OPTIONS: Array<{ id: MapFilterMode; label: string }> = [
  { id: "all", label: "All locations" },
  { id: "donors", label: "Donors" },
  { id: "recipients", label: "Recipients" },
  { id: "matched", label: "Matched locations" },
  { id: "pending", label: "Pending matches" },
];

export function LogisticsMap({
  center,
  markers,
  routes = [],
  primaryRadiusKm,
  fallbackRadiusKm,
  heightClass = "h-[360px] sm:h-[420px] lg:h-[460px]",
  title = "Donation Network",
  subtitle = "Explore donors, recipients and active matches",
  onViewDetails,
  onLocationUpdated,
}: LogisticsMapProps) {
  const { user, refreshUser } = useAuth();
  const [filterMode, setFilterMode] = useState<MapFilterMode>("all");
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [fitTrigger, setFitTrigger] = useState(0);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [detailModalMarker, setDetailModalMarker] =
    useState<NormalizedMapMarker | null>(null);

  // Cache of fetched OSRM road routes by segment cache key
  const osrmCacheRef = useRef<Record<string, RoadRouteResult>>({});
  const [osrmMap, setOsrmMap] = useState<Record<string, RoadRouteResult>>({});

  // Separate valid-coordinate markers from records missing coordinates
  const { validMarkers, invalidMarkers } = useMemo(() => {
    const valid: NormalizedMapMarker[] = [];
    const invalid: MapMarkerNode[] = [];

    for (const m of markers) {
      if (!hasValidCoordinates(m.location)) {
        invalid.push(m);
        continue;
      }

      const inferredStatus: MatchStatusKind =
        m.matchStatus ||
        (m.kind === "fallback_org"
          ? "pending"
          : routes.some(
              (r) =>
                (r.donorId === m.id || r.recipientId === m.id) &&
                r.routeType === "confirmed"
            )
          ? "matched"
          : routes.some(
              (r) =>
                r.donorId === m.id ||
                r.recipientId === m.id ||
                m.kind === "organization"
            )
          ? m.kind === "donor" && routes.length > 0
            ? "matched"
            : "pending"
          : "unmatched");

      valid.push({
        id: m.id,
        label: m.label,
        sublabel: m.sublabel,
        kind: m.kind,
        roleLabel:
          m.kind === "donor"
            ? "Donor"
            : m.kind === "hub"
            ? "Storage Hub"
            : "Recipient",
        quantityLabel: m.quantityLabel || m.sublabel,
        distanceKm: m.distanceKm ?? null,
        matchStatus: inferredStatus,
        location: m.location,
      });
    }

    return { validMarkers: valid, invalidMarkers: invalid };
  }, [markers, routes]);

  // Apply filter mode dynamically
  const filteredMarkers = useMemo(() => {
    return validMarkers.filter((m) => {
      if (filterMode === "all") return true;
      if (filterMode === "donors") return m.kind === "donor";
      if (filterMode === "recipients") {
        return m.kind === "organization" || m.kind === "fallback_org";
      }
      if (filterMode === "matched") return m.matchStatus === "matched";
      if (filterMode === "pending") {
        return m.matchStatus === "pending" || m.kind === "fallback_org";
      }
      return true;
    });
  }, [validMarkers, filterMode]);

  // Keep selectedMarker synchronized with visible filtered markers
  useEffect(() => {
    if (
      selectedMarkerId &&
      !filteredMarkers.some((m) => m.id === selectedMarkerId)
    ) {
      setSelectedMarkerId(filteredMarkers[0]?.id || null);
    } else if (!selectedMarkerId && filteredMarkers.length > 0) {
      setSelectedMarkerId(filteredMarkers[0].id);
    }
  }, [filteredMarkers, selectedMarkerId]);

  const selectedMarker = useMemo(
    () =>
      filteredMarkers.find((m) => m.id === selectedMarkerId) ||
      filteredMarkers[0] ||
      null,
    [filteredMarkers, selectedMarkerId]
  );

  // Fetch genuine OSRM road route geometries for segments that do not already carry a real encodedPolyline
  useEffect(() => {
    let cancelled = false;
    const validRoutes = routes.filter(
      (r) =>
        r.points &&
        r.points.length >= 2 &&
        hasValidCoordinates(r.points[0]) &&
        hasValidCoordinates(r.points[r.points.length - 1])
    );

    const toFetch = validRoutes.filter((r) => {
      const encoded = r.encodedPolyline
        ? decodeEncodedPolyline(r.encodedPolyline)
        : [];
      if (encoded.length >= 2) return false;
      const o = r.points[0];
      const d = r.points[r.points.length - 1];
      const key = `${o.lat.toFixed(5)},${o.lng.toFixed(5)}->${d.lat.toFixed(5)},${d.lng.toFixed(5)}`;
      return !osrmCacheRef.current[key];
    });

    if (toFetch.length === 0) return;

    (async () => {
      const updates: Record<string, RoadRouteResult> = {};
      await Promise.all(
        toFetch.slice(0, 12).map(async (r) => {
          const o = r.points[0];
          const d = r.points[r.points.length - 1];
          const key = `${o.lat.toFixed(5)},${o.lng.toFixed(5)}->${d.lat.toFixed(5)},${d.lng.toFixed(5)}`;
          try {
            const res = await api.computeRoadRoute({
              origin_lat: o.lat,
              origin_lng: o.lng,
              dest_lat: d.lat,
              dest_lng: d.lng,
              profile: "driving",
            });
            osrmCacheRef.current[key] = res;
            updates[key] = res;
          } catch {
            const fail: RoadRouteResult = {
              available: false,
              source: "unavailable",
              distance_km: null,
              duration_minutes: null,
              geometry: [],
              reason: "Road routing service unavailable",
            };
            osrmCacheRef.current[key] = fail;
            updates[key] = fail;
          }
        })
      );
      if (!cancelled && Object.keys(updates).length > 0) {
        setOsrmMap((prev) => ({ ...prev, ...updates }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routes]);

  // Build resolved road polylines ONLY from genuine OSRM or encoded road geometries
  const { resolvedRoutes, routingUnavailableCount } = useMemo(() => {
    const visibleIds = new Set(filteredMarkers.map((m) => m.id));
    const list: ResolvedRoadSegment[] = [];
    let unavailable = 0;

    for (const r of routes) {
      if (!r.points || r.points.length < 2) continue;
      if (
        (r.donorId && !visibleIds.has(r.donorId)) &&
        (r.recipientId && !visibleIds.has(r.recipientId))
      ) {
        continue;
      }

      const decoded = r.encodedPolyline
        ? decodeEncodedPolyline(r.encodedPolyline)
        : [];
      if (decoded.length >= 2) {
        list.push({
          id: r.id,
          label: r.label,
          donorMarkerId: r.donorId,
          recipientMarkerId: r.recipientId,
          routeType: r.routeType || (r.isFallback ? "suggested" : "confirmed"),
          roadPoints: decoded,
          distanceKm: r.distanceKm ?? null,
          durationMinutes: r.durationMinutes ?? null,
          isFallback: r.isFallback,
        });
        continue;
      }

      const o = r.points[0];
      const d = r.points[r.points.length - 1];
      if (!hasValidCoordinates(o) || !hasValidCoordinates(d)) continue;
      const key = `${o.lat.toFixed(5)},${o.lng.toFixed(5)}->${d.lat.toFixed(5)},${d.lng.toFixed(5)}`;
      const cached = osrmMap[key] || osrmCacheRef.current[key];

      if (cached?.available && cached.geometry.length >= 2) {
        list.push({
          id: r.id,
          label: r.label,
          donorMarkerId: r.donorId,
          recipientMarkerId: r.recipientId,
          routeType: r.routeType || (r.isFallback ? "suggested" : "confirmed"),
          roadPoints: cached.geometry.map((p) => [p.lat, p.lng]),
          distanceKm: cached.distance_km ?? r.distanceKm ?? null,
          durationMinutes: cached.duration_minutes ?? r.durationMinutes ?? null,
          isFallback: r.isFallback,
        });
      } else if (cached && !cached.available) {
        unavailable += 1;
      }
    }

    return { resolvedRoutes: list, routingUnavailableCount: unavailable };
  }, [routes, filteredMarkers, osrmMap]);

  const effectiveCenter: [number, number] = useMemo(() => {
    if (center && hasValidCoordinates(center)) {
      return [center.lat, center.lng];
    }
    if (filteredMarkers[0]) {
      return [
        filteredMarkers[0].location.lat,
        filteredMarkers[0].location.lng,
      ];
    }
    if (user?.location && hasValidCoordinates(user.location)) {
      return [user.location.lat, user.location.lng];
    }
    return [37.7749, -122.4194];
  }, [center, filteredMarkers, user?.location]);

  const userMissingCoords = Boolean(user && !hasValidCoordinates(user.location));

  const selectedMarkerRoutes = useMemo(() => {
    if (!selectedMarker) return [];
    return resolvedRoutes.filter(
      (r) =>
        r.donorMarkerId === selectedMarker.id ||
        r.recipientMarkerId === selectedMarker.id ||
        (selectedMarker.kind === "donor" && !r.donorMarkerId)
    );
  }, [selectedMarker, resolvedRoutes]);

  const primaryRouteMetrics = selectedMarkerRoutes[0] || resolvedRoutes[0] || null;

  return (
    <Card className="p-4 sm:p-5 space-y-4 overflow-hidden">
      {/* Top Header, Legend & Controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="sc-section-title">{title}</h2>
          <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-canvas/70 px-3 py-1.5 text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-forest">
              <Store className="h-3.5 w-3.5 text-forest" /> Donor
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald">
              <HeartHandshake className="h-3.5 w-3.5 text-emerald" /> Recipient
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium text-amber-safe">
              <Clock className="h-3.5 w-3.5 text-amber-600" /> Pending
            </span>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setFitTrigger((c) => c + 1)}
            disabled={filteredMarkers.length === 0}
          >
            <LocateFixed className="h-3.5 w-3.5" />
            Fit to Markers
          </Button>

          {user ? (
            <Button
              type="button"
              size="sm"
              variant={userMissingCoords ? "secondary" : "ghost"}
              onClick={() => setLocationPickerOpen(true)}
            >
              <MapPin className="h-3.5 w-3.5" />
              {userMissingCoords ? "Set Location" : "Edit Pin"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Interactive Filter Pills */}
      <div
        role="group"
        aria-label="Map location filters"
        className="flex flex-wrap items-center gap-2"
      >
        {FILTER_OPTIONS.map((opt) => {
          const active = filterMode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFilterMode(opt.id)}
              className={`min-h-9 rounded-full px-3.5 text-xs font-semibold transition-colors cursor-pointer ${
                active
                  ? "bg-forest text-white shadow-xs"
                  : "border border-border-subtle bg-white text-ink-muted hover:bg-mint-soft/70 hover:text-forest"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Missing Coordinates / Route Fallback Alerts */}
      {userMissingCoords || invalidMarkers.length > 0 ? (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 rounded-xl border border-amber-200 bg-amber-bg/50 px-3.5 py-2.5 text-xs text-amber-safe">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {userMissingCoords
                ? "Your organization profile does not have verified map coordinates yet."
                : `${invalidMarkers.length} record${invalidMarkers.length > 1 ? "s lack" : " lacks"} verified coordinates and cannot be plotted until confirmed.`}
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLocationPickerOpen(true)}
          >
            Verify Location on Map
          </Button>
        </div>
      ) : null}

      {routingUnavailableCount > 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-muted/70 px-3.5 py-2 text-xs text-ink-muted">
          <Route className="h-4 w-4 text-forest shrink-0" />
          <span>
            Road-route geometry is temporarily unavailable for {routingUnavailableCount}{" "}
            segment{routingUnavailableCount > 1 ? "s" : ""}; geographical pins remain exact.
          </span>
        </div>
      ) : null}

      {/* Real Geographical OpenStreetMap + Leaflet Canvas */}
      {filteredMarkers.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No mapped locations for this filter"
          description={
            validMarkers.length === 0
              ? "Add your verified street location on the map to view regional donation matches."
              : "Switch the filter above to view all donors and recipient organizations."
          }
          action={
            userMissingCoords ? (
              <Button size="sm" onClick={() => setLocationPickerOpen(true)}>
                Pin My Location
              </Button>
            ) : filterMode !== "all" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setFilterMode("all")}
              >
                Show All Locations
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DynamicLeafletNetwork
          center={effectiveCenter}
          markers={filteredMarkers}
          routes={resolvedRoutes}
          selectedMarkerId={selectedMarker?.id || null}
          onSelectMarker={(m) => setSelectedMarkerId(m.id)}
          fitTrigger={fitTrigger}
          primaryRadiusKm={primaryRadiusKm}
          fallbackRadiusKm={fallbackRadiusKm}
          heightClass={heightClass}
        />
      )}

      {/* Bottom Selected Location Panel (Desktop Bar / Mobile Compact Sheet) */}
      {selectedMarker ? (
        <div className="rounded-xl border border-border-subtle bg-canvas/70 p-3.5 sm:p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${
                selectedMarker.kind === "donor"
                  ? "bg-forest"
                  : selectedMarker.kind === "hub"
                  ? "bg-sky-700"
                  : selectedMarker.matchStatus === "pending" ||
                    selectedMarker.kind === "fallback_org"
                  ? "bg-amber-600"
                  : "bg-emerald"
              }`}
            >
              {selectedMarker.kind === "donor" ? (
                <Store className="h-4 w-4" />
              ) : selectedMarker.kind === "hub" ? (
                <Warehouse className="h-4 w-4" />
              ) : (
                <HeartHandshake className="h-4 w-4" />
              )}
            </span>

            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="sc-card-title truncate">{selectedMarker.label}</span>
                <StatusIndicator
                  label={
                    selectedMarker.matchStatus === "matched"
                      ? "Matched"
                      : selectedMarker.matchStatus === "pending"
                      ? "Pending Match"
                      : selectedMarker.roleLabel
                  }
                  tone={
                    selectedMarker.matchStatus === "matched"
                      ? "success"
                      : selectedMarker.matchStatus === "pending"
                      ? "warning"
                      : "neutral"
                  }
                />
              </div>

              <div className="text-xs text-ink-muted truncate">
                {selectedMarker.location.address}
                {selectedMarker.location.city
                  ? `, ${selectedMarker.location.city}`
                  : ""}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-forest font-medium pt-0.5">
                {selectedMarker.quantityLabel ? (
                  <span>
                    {selectedMarker.roleLabel === "Donor"
                      ? "Surplus:"
                      : "Allocation / Need:"}{" "}
                    {selectedMarker.quantityLabel}
                  </span>
                ) : null}

                {primaryRouteMetrics?.distanceKm != null &&
                primaryRouteMetrics?.durationMinutes != null ? (
                  <span className="inline-flex items-center gap-1 text-emerald">
                    <Route className="h-3.5 w-3.5" />
                    {primaryRouteMetrics.distanceKm.toFixed(1)} km · ~
                    {primaryRouteMetrics.durationMinutes} min by road
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => {
              if (onViewDetails) {
                onViewDetails(selectedMarker);
              } else {
                setDetailModalMarker(selectedMarker);
              }
            }}
          >
            View details
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      {/* Location Details Dialog (default View Details action) */}
      <ModalDialog
        open={Boolean(detailModalMarker)}
        onClose={() => setDetailModalMarker(null)}
        title={detailModalMarker?.label || "Location Details"}
        subtitle={detailModalMarker?.roleLabel}
      >
        {detailModalMarker ? (
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-canvas p-3">
                <div className="text-xs text-ink-muted">Street Address</div>
                <div className="mt-0.5 font-semibold text-forest">
                  {detailModalMarker.location.address}
                </div>
                <div className="text-xs text-ink-muted">
                  {detailModalMarker.location.city}
                </div>
              </div>
              <div className="rounded-xl bg-canvas p-3">
                <div className="text-xs text-ink-muted">
                  {detailModalMarker.roleLabel === "Donor"
                    ? "Listed Surplus"
                    : "Quantity / Capacity"}
                </div>
                <div className="mt-0.5 font-semibold text-forest">
                  {detailModalMarker.quantityLabel || "Active"}
                </div>
                <div className="text-xs text-ink-muted capitalize">
                  Match status:{" "}
                  {detailModalMarker.matchStatus === "unmatched"
                    ? "Open"
                    : detailModalMarker.matchStatus}
                </div>
              </div>
            </div>

            {selectedMarkerRoutes.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-forest">
                  Connected Road Routes
                </h4>
                <div className="space-y-2">
                  {selectedMarkerRoutes.map((seg) => (
                    <div
                      key={seg.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-border-subtle px-3 py-2 text-xs"
                    >
                      <span className="font-medium text-forest truncate">
                        {seg.label}
                      </span>
                      <span className="shrink-0 text-ink-muted">
                        {seg.routeType === "confirmed" ? "Confirmed" : "Suggested"}
                        {seg.distanceKm != null ? ` · ${seg.distanceKm.toFixed(1)} km` : ""}
                        {seg.durationMinutes != null ? ` · ~${seg.durationMinutes} min` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={() => setDetailModalMarker(null)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </ModalDialog>

      {/* Geocoding & Pin Verification Modal */}
      <LocationPickerModal
        open={locationPickerOpen}
        onClose={() => setLocationPickerOpen(false)}
        initialLocation={user?.location}
        persistToAccount={Boolean(user)}
        onSaved={async (newLoc) => {
          if (user) {
            await refreshUser();
          }
          if (onLocationUpdated) {
            await onLocationUpdated(newLoc);
          }
        }}
      />
    </Card>
  );
}
