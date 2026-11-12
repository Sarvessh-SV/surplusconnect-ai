"use client";

import React, { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { renderToStaticMarkup } from "react-dom/server";
import { Clock, HeartHandshake, Store, Warehouse } from "lucide-react";
import type { GeoPoint } from "@/lib/types";
import { hasValidCoordinates } from "./polyline";

export type NetworkMarkerKind =
  | "donor"
  | "organization"
  | "fallback_org"
  | "hub";

export type MatchStatusKind = "matched" | "pending" | "unmatched";

export interface NormalizedMapMarker {
  id: string;
  label: string;
  sublabel: string;
  kind: NetworkMarkerKind;
  roleLabel: "Donor" | "Recipient" | "Storage Hub";
  quantityLabel?: string;
  distanceKm?: number | null;
  matchStatus: MatchStatusKind;
  location: GeoPoint;
}

export interface ResolvedRoadSegment {
  id: string;
  label: string;
  donorMarkerId?: string;
  recipientMarkerId?: string;
  routeType: "confirmed" | "suggested";
  roadPoints: Array<[number, number]>;
  distanceKm?: number | null;
  durationMinutes?: number | null;
  isFallback?: boolean;
}

interface LeafletNetworkCanvasProps {
  center: [number, number];
  markers: NormalizedMapMarker[];
  routes: ResolvedRoadSegment[];
  selectedMarkerId: string | null;
  onSelectMarker: (marker: NormalizedMapMarker) => void;
  fitTrigger: number;
  primaryRadiusKm?: number;
  fallbackRadiusKm?: number;
  heightClass: string;
}

// Configure default Leaflet icon paths cleanly for Next.js static assets
let leafletIconsConfigured = false;
function ensureLeafletAssetDefaults() {
  if (leafletIconsConfigured) return;
  leafletIconsConfigured = true;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "/leaflet/marker-icon-2x.png",
    iconUrl: "/leaflet/marker-icon.png",
    shadowUrl: "/leaflet/marker-shadow.png",
  });
}

function buildMarkerIcon(
  kind: NetworkMarkerKind,
  matchStatus: MatchStatusKind,
  selected: boolean
): L.DivIcon {
  const isPending = kind === "fallback_org" || (kind === "organization" && matchStatus === "pending");
  const bg =
    kind === "donor"
      ? "#0f3d2e"
      : kind === "hub"
      ? "#0369a1"
      : isPending
      ? "#d97706"
      : "#059669";

  const ring = selected
    ? "0 0 0 6px rgba(16, 185, 129, 0.32), 0 8px 18px rgba(9, 41, 31, 0.32)"
    : "0 4px 10px rgba(9, 41, 31, 0.24)";

  const IconEl =
    kind === "donor" ? (
      <Store size={16} strokeWidth={2.2} color="#ffffff" />
    ) : kind === "hub" ? (
      <Warehouse size={16} strokeWidth={2.2} color="#ffffff" />
    ) : isPending ? (
      <Clock size={16} strokeWidth={2.2} color="#ffffff" />
    ) : (
      <HeartHandshake size={16} strokeWidth={2.2} color="#ffffff" />
    );

  const svgHtml = renderToStaticMarkup(IconEl);
  const size = selected ? 40 : 34;

  return L.divIcon({
    className: "sc-div-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 2)],
    tooltipAnchor: [0, -(size / 2)],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:2.5px solid #ffffff;box-shadow:${ring};display:flex;align-items:center;justify-content:center;transition:transform 150ms ease;">${svgHtml}</div>`,
  });
}

function createClusterCustomIcon(cluster: { getChildCount: () => number }) {
  const count = cluster.getChildCount();
  const dim = count > 20 ? 44 : 38;
  return L.divIcon({
    html: `<div class="sc-cluster-badge" style="width:${dim}px;height:${dim}px;">${count}</div>`,
    className: "sc-div-marker",
    iconSize: L.point(dim, dim, true),
  });
}

function FitBoundsController({
  markers,
  routes,
  center,
  fitTrigger,
}: {
  markers: NormalizedMapMarker[];
  routes: ResolvedRoadSegment[];
  center: [number, number];
  fitTrigger: number;
}) {
  const map = useMap();

  useEffect(() => {
    const pts: Array<[number, number]> = [];
    for (const m of markers) {
      if (hasValidCoordinates(m.location)) {
        pts.push([Number(m.location.lat), Number(m.location.lng)]);
      }
    }
    for (const r of routes) {
      for (const p of r.roadPoints) {
        pts.push(p);
      }
    }

    if (pts.length >= 2) {
      const bounds = L.latLngBounds(pts);
      map.fitBounds(bounds, { padding: [44, 44], maxZoom: 14, animate: true });
    } else if (pts.length === 1) {
      map.setView(pts[0], 13, { animate: true });
    } else {
      map.setView(center, 11, { animate: true });
    }
  }, [map, markers, routes, center, fitTrigger]);

  return null;
}

export default function LeafletNetworkCanvas({
  center,
  markers,
  routes,
  selectedMarkerId,
  onSelectMarker,
  fitTrigger,
  primaryRadiusKm,
  fallbackRadiusKm,
  heightClass,
}: LeafletNetworkCanvasProps) {
  ensureLeafletAssetDefaults();
  const [tileWarning, setTileWarning] = useState(false);

  const selectedMarker = useMemo(
    () => markers.find((m) => m.id === selectedMarkerId) || null,
    [markers, selectedMarkerId]
  );

  const donorAnchor = useMemo(
    () => markers.find((m) => m.kind === "donor") || null,
    [markers]
  );

  return (
    <div className={`relative w-full ${heightClass} overflow-hidden rounded-xl border border-border-subtle`}>
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom={true}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{
            tileerror: () => setTileWarning(true),
            tileload: () => setTileWarning(false),
          }}
        />

        <FitBoundsController
          markers={markers}
          routes={routes}
          center={center}
          fitTrigger={fitTrigger}
        />

        {/* Optional service coverage radius around primary donor */}
        {donorAnchor && primaryRadiusKm ? (
          <Circle
            center={[donorAnchor.location.lat, donorAnchor.location.lng]}
            radius={primaryRadiusKm * 1000}
            pathOptions={{
              color: "#059669",
              weight: 1.5,
              dashArray: "5 5",
              fillColor: "#10b981",
              fillOpacity: 0.06,
            }}
          />
        ) : null}

        {donorAnchor && fallbackRadiusKm && fallbackRadiusKm > (primaryRadiusKm || 0) ? (
          <Circle
            center={[donorAnchor.location.lat, donorAnchor.location.lng]}
            radius={fallbackRadiusKm * 1000}
            pathOptions={{
              color: "#d97706",
              weight: 1.5,
              dashArray: "6 6",
              fillColor: "#fef3c7",
              fillOpacity: 0.08,
            }}
          />
        ) : null}

        {/* Genuine OSRM / Encoded Road Geometry */}
        {routes.map((route) => {
          if (!route.roadPoints || route.roadPoints.length < 2) return null;
          const isHighlighted =
            selectedMarker &&
            (route.donorMarkerId === selectedMarker.id ||
              route.recipientMarkerId === selectedMarker.id ||
              (selectedMarker.kind === "donor" && !route.donorMarkerId));

          const dimUnrelated = Boolean(selectedMarker && !isHighlighted);
          const isConfirmed = route.routeType === "confirmed";

          return (
            <Polyline
              key={route.id}
              positions={route.roadPoints}
              pathOptions={{
                color: isHighlighted ? "#0f3d2e" : isConfirmed ? "#059669" : "#10b981",
                weight: isHighlighted ? 5.5 : isConfirmed ? 4 : 3.5,
                opacity: dimUnrelated ? 0.28 : isConfirmed ? 0.92 : 0.85,
                dashArray: isConfirmed ? undefined : "8 6",
              }}
            >
              <Tooltip sticky>
                <div className="space-y-0.5 text-xs">
                  <div className="font-semibold text-forest">{route.label}</div>
                  <div className="text-[11px] text-ink-muted">
                    {isConfirmed ? "Confirmed delivery route" : "Suggested road route"}
                    {route.distanceKm != null ? ` • ${route.distanceKm.toFixed(1)} km` : ""}
                    {route.durationMinutes != null ? ` • ~${route.durationMinutes} min` : ""}
                  </div>
                </div>
              </Tooltip>
            </Polyline>
          );
        })}

        {/* Clustered Donor & Recipient Markers */}
        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createClusterCustomIcon}
          showCoverageOnHover={false}
          maxClusterRadius={46}
        >
          {markers.map((marker) => {
            const selected = marker.id === selectedMarkerId;
            return (
              <Marker
                key={marker.id}
                position={[marker.location.lat, marker.location.lng]}
                icon={buildMarkerIcon(marker.kind, marker.matchStatus, selected)}
                zIndexOffset={selected ? 500 : 100}
                eventHandlers={{
                  click: () => onSelectMarker(marker),
                }}
              >
                <Tooltip direction="top" offset={[0, -18]}>
                  <span>{marker.label}</span>
                </Tooltip>

                <Popup>
                  <div className="min-w-48 max-w-64 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-bold text-forest text-[13px] leading-snug">
                        {marker.label}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          marker.roleLabel === "Donor"
                            ? "bg-emerald-950/10 text-forest"
                            : marker.kind === "fallback_org" || marker.matchStatus === "pending"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-50 text-emerald-800"
                        }`}
                      >
                        {marker.roleLabel}
                      </span>
                    </div>

                    <div className="text-[11px] text-ink-muted">
                      {marker.location.address}
                      {marker.location.city ? `, ${marker.location.city}` : ""}
                    </div>

                    <div className="border-t border-border-subtle pt-1.5 space-y-0.5 text-[11px]">
                      {marker.quantityLabel ? (
                        <div className="flex justify-between gap-2">
                          <span className="text-ink-muted">
                            {marker.roleLabel === "Donor" ? "Available surplus" : "Quantity"}
                          </span>
                          <span className="font-semibold text-forest">{marker.quantityLabel}</span>
                        </div>
                      ) : null}

                      {marker.distanceKm != null ? (
                        <div className="flex justify-between gap-2">
                          <span className="text-ink-muted">Distance</span>
                          <span className="font-semibold text-forest">
                            {marker.distanceKm.toFixed(1)} km
                          </span>
                        </div>
                      ) : null}

                      <div className="flex justify-between gap-2">
                        <span className="text-ink-muted">Match status</span>
                        <span className="font-semibold capitalize text-forest">
                          {marker.matchStatus === "unmatched" ? "Open" : marker.matchStatus}
                        </span>
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>

      {tileWarning ? (
        <div className="pointer-events-none absolute top-3 right-3 z-[400] rounded-lg border border-amber-300 bg-white/95 px-2.5 py-1 text-[11px] font-medium text-amber-safe shadow-sm">
          Map tiles slow or offline — marker coordinates remain active.
        </div>
      ) : null}
    </div>
  );
}

