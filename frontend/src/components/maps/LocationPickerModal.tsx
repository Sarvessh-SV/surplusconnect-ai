"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Crosshair, MapPin, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { GeoPoint, GeocodeCandidate } from "@/lib/types";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { useToast } from "@/components/ui/ToastProvider";
import { Button, Skeleton } from "@/components/ui/primitives";
import { hasValidCoordinates } from "./polyline";

const DynamicLocationPickerCanvas = dynamic(
  () => import("./LeafletLocationPickerCanvas"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64 w-full rounded-xl" />,
  }
);

interface LocationPickerModalProps {
  open: boolean;
  onClose: () => void;
  initialLocation?: Partial<GeoPoint> | null;
  /** If true, persists verified location directly to /api/auth/location before calling onSaved. */
  persistToAccount?: boolean;
  onSaved: (location: GeoPoint) => void | Promise<void>;
}

export function LocationPickerModal({
  open,
  onClose,
  initialLocation,
  persistToAccount = true,
  onSaved,
}: LocationPickerModalProps) {
  const { notify } = useToast();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);

  const [address, setAddress] = useState(initialLocation?.address || "");
  const [city, setCity] = useState(initialLocation?.city || "");
  const [lat, setLat] = useState<number | null>(
    hasValidCoordinates(initialLocation) ? Number(initialLocation?.lat) : null
  );
  const [lng, setLng] = useState<number | null>(
    hasValidCoordinates(initialLocation) ? Number(initialLocation?.lng) : null
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAddress(initialLocation?.address || "");
      setCity(initialLocation?.city || "");
      setLat(
        hasValidCoordinates(initialLocation) ? Number(initialLocation?.lat) : null
      );
      setLng(
        hasValidCoordinates(initialLocation) ? Number(initialLocation?.lng) : null
      );
      setCandidates([]);
      setSearchMessage(null);
      setQuery(
        [initialLocation?.address, initialLocation?.city]
          .filter(Boolean)
          .join(", ")
      );
    }
  }, [open, initialLocation]);

  const handleSearchAddress = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleaned = query.trim();
    if (cleaned.length < 3) {
      setSearchMessage("Enter at least 3 characters (street, city, or postcode).");
      return;
    }
    setSearching(true);
    setSearchMessage(null);
    try {
      const res = await api.geocodeAddress(cleaned);
      setCandidates(res.items || []);
      if (!res.available && res.reason) {
        setSearchMessage(res.reason);
      } else if (!res.items || res.items.length === 0) {
        setSearchMessage(
          "No matching address found. Try a broader query or click directly on the map."
        );
      }
    } catch {
      setSearchMessage(
        "Address lookup unavailable right now. Click directly on the map to place your pin."
      );
    } finally {
      setSearching(false);
    }
  };

  const applyCandidate = (cand: GeocodeCandidate) => {
    setLat(Number(cand.lat.toFixed(6)));
    setLng(Number(cand.lng.toFixed(6)));
    setAddress(cand.address);
    setCity(cand.city);
    setCandidates([]);
    setSearchMessage(null);
  };

  const handleUseCurrentLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setSearchMessage("Browser geolocation is unavailable. Search or click on the map.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(Number(pos.coords.latitude.toFixed(6)));
        setLng(Number(pos.coords.longitude.toFixed(6)));
        setSearchMessage("Pin placed at your current device coordinates. Drag to adjust.");
      },
      () => {
        setSearchMessage("Location access declined. Search for your address or click the map.");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lat === null || lng === null || !hasValidCoordinates({ lat, lng })) {
      notify({
        tone: "warning",
        title: "Pin required on map",
        message: "Search your address or click on the map to set exact coordinates.",
      });
      return;
    }
    if (address.trim().length < 3 || city.trim().length < 2) {
      notify({
        tone: "warning",
        title: "Address required",
        message: "Please enter a street address and city name.",
      });
      return;
    }

    const verifiedLocation: GeoPoint = {
      lat,
      lng,
      address: address.trim(),
      city: city.trim(),
    };

    setSaving(true);
    try {
      if (persistToAccount) {
        await api.updateLocation(verifiedLocation);
      }
      await onSaved(verifiedLocation);
      notify({
        tone: "success",
        title: "Location verified",
        message: `${verifiedLocation.address}, ${verifiedLocation.city} saved.`,
      });
      onClose();
    } catch (err) {
      notify({
        tone: "error",
        title: "Could not save location",
        message: err instanceof ApiError ? err.message : "Please verify location fields.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Set & Verify Location"
      subtitle="Search your street address or click directly on the map to position your exact pickup or drop-off pin."
    >
      <div className="space-y-4">
        <form onSubmit={handleSearchAddress} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="text"
              aria-label="Search street address or city"
              placeholder="Search address, neighborhood, or city..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-h-10 w-full rounded-xl border border-border-subtle bg-white pl-9 pr-3 text-sm text-ink"
            />
          </div>
          <Button type="submit" variant="secondary" size="md" disabled={searching}>
            {searching ? "Searching..." : "Search"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleUseCurrentLocation}
            title="Use browser GPS"
          >
            <Crosshair className="h-4 w-4" />
            <span className="sm:hidden lg:inline">Use GPS</span>
          </Button>
        </form>

        {searchMessage ? (
          <p className="rounded-xl border border-border-subtle bg-surface-muted/70 px-3 py-2 text-xs text-ink-muted">
            {searchMessage}
          </p>
        ) : null}

        {candidates.length > 0 ? (
          <div className="max-h-40 overflow-y-auto rounded-xl border border-border-subtle divide-y divide-border-subtle bg-canvas/40">
            {candidates.map((cand, idx) => (
              <button
                key={`${cand.lat}-${cand.lng}-${idx}`}
                type="button"
                onClick={() => applyCandidate(cand)}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-xs hover:bg-mint-soft/70 transition-colors cursor-pointer"
              >
                <MapPin className="h-3.5 w-3.5 text-emerald shrink-0 mt-0.5" />
                <span className="text-forest font-medium leading-snug">
                  {cand.display_name}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <DynamicLocationPickerCanvas
            lat={lat}
            lng={lng}
            onCoordinateChange={(newLat, newLng) => {
              setLat(newLat);
              setLng(newLng);
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted">
            <span>Click anywhere on the map or drag the pin to fine-tune position.</span>
            <span className="font-medium text-forest">
              {lat !== null && lng !== null
                ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
                : "No coordinates selected yet"}
            </span>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-3 border-t border-border-subtle pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-forest mb-1">
                Street Address
              </label>
              <input
                type="text"
                required
                minLength={3}
                placeholder="Street address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-forest mb-1">
                City / Locality
              </label>
              <input
                type="text"
                required
                minLength={2}
                placeholder="City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || lat === null || lng === null}>
              {saving ? "Saving location..." : "Confirm Verified Location"}
            </Button>
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}

