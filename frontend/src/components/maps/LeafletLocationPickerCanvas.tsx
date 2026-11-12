"use client";

import React, { useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { renderToStaticMarkup } from "react-dom/server";
import { MapPin } from "lucide-react";

interface LeafletLocationPickerCanvasProps {
  lat: number | null;
  lng: number | null;
  onCoordinateChange: (lat: number, lng: number) => void;
}

const PIN_ICON = L.divIcon({
  className: "sc-div-marker",
  iconSize: [36, 36],
  iconAnchor: [18, 34],
  html: `<div style="width:36px;height:36px;border-radius:9999px;background:#0f3d2e;border:2.5px solid #ffffff;box-shadow:0 6px 14px rgba(9,41,31,0.3);display:flex;align-items:center;justify-content:center;">${renderToStaticMarkup(
    <MapPin size={18} color="#d1fae5" strokeWidth={2.2} />
  )}</div>`,
});

function MapInteractionBridge({
  lat,
  lng,
  onCoordinateChange,
}: LeafletLocationPickerCanvasProps) {
  const map = useMap();

  useMapEvents({
    click(e) {
      onCoordinateChange(
        Number(e.latlng.lat.toFixed(6)),
        Number(e.latlng.lng.toFixed(6))
      );
    },
  });

  useEffect(() => {
    if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
      map.setView([lat, lng], Math.max(map.getZoom(), 13), { animate: true });
    }
  }, [map, lat, lng]);

  return null;
}

export default function LeafletLocationPickerCanvas({
  lat,
  lng,
  onCoordinateChange,
}: LeafletLocationPickerCanvasProps) {
  const hasCoords =
    lat !== null &&
    lng !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001);

  const initialCenter: [number, number] = hasCoords
    ? [lat as number, lng as number]
    : [39.5, -98.35];

  return (
    <div className="h-64 w-full overflow-hidden rounded-xl border border-border-subtle">
      <MapContainer
        center={initialCenter}
        zoom={hasCoords ? 14 : 4}
        scrollWheelZoom={true}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapInteractionBridge
          lat={hasCoords ? lat : null}
          lng={hasCoords ? lng : null}
          onCoordinateChange={onCoordinateChange}
        />
        {hasCoords ? (
          <Marker
            position={[lat as number, lng as number]}
            draggable={true}
            icon={PIN_ICON}
            eventHandlers={{
              dragend(e) {
                const pos = (e.target as L.Marker).getLatLng();
                onCoordinateChange(
                  Number(pos.lat.toFixed(6)),
                  Number(pos.lng.toFixed(6))
                );
              },
            }}
          />
        ) : null}
      </MapContainer>
    </div>
  );
}

