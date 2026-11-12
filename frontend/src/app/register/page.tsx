"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Eye,
  EyeOff,
  HandCoins,
  HeartHandshake,
  Leaf,
  MapPin,
  ShieldAlert,
  Truck,
  UserPlus,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { useAuth, ROLE_DASHBOARD_PATH } from "@/lib/auth-context";
import { ROLE_PORTAL_BY_SLUG, type RoleSlug } from "@/lib/roles";
import type { StorageType, UserRole } from "@/lib/types";
import { LocationPickerModal } from "@/components/maps/LocationPickerModal";
import { Badge, Button, Card } from "@/components/ui/primitives";

type RegistrableSlug = "business" | "organization" | "delivery" | "sponsor";

const REGISTRABLE_ROLES: Array<{
  slug: RegistrableSlug;
  apiRole: Exclude<UserRole, "admin">;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { slug: "business", apiRole: "business", label: "Business / Donor", icon: Building2 },
  {
    slug: "organization",
    apiRole: "organization",
    label: "Recipient Organization",
    icon: HeartHandshake,
  },
  {
    slug: "delivery",
    apiRole: "delivery_partner",
    label: "Delivery Partner",
    icon: Truck,
  },
  { slug: "sponsor", apiRole: "sponsor", label: "Sponsor", icon: HandCoins },
];

const STORAGE_OPTIONS: Array<{ value: StorageType; label: string }> = [
  { value: "ambient", label: "Ambient / Shelf-Stable" },
  { value: "dry_bulk", label: "Dry Bulk Warehouse" },
  { value: "refrigerated", label: "Refrigerated (0°C to 4°C)" },
  { value: "frozen", label: "Frozen (-18°C)" },
];

function RegisterContent() {
  const { register } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryRole = (searchParams.get("role") || "business") as RoleSlug | "delivery_partner";

  const isAdminAttempt = queryRole === "admin";
  const normalizeSlug = (val: string): RegistrableSlug => {
    if (val === "organization" || val === "delivery" || val === "sponsor" || val === "business") {
      return val;
    }
    if (val === "delivery_partner") return "delivery";
    return "business";
  };

  const [selectedSlug, setSelectedSlug] = useState<RegistrableSlug>(
    normalizeSlug(queryRole)
  );

  useEffect(() => {
    if (!isAdminAttempt) {
      setSelectedSlug(normalizeSlug(queryRole));
    }
  }, [queryRole, isAdminAttempt]);

  const activeMeta =
    REGISTRABLE_ROLES.find((r) => r.slug === selectedSlug) || REGISTRABLE_ROLES[0];
  const activePortal = ROLE_PORTAL_BY_SLUG[selectedSlug];

  // Shared fields
  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Location fields (never pre-populated with hardcoded coordinates)
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [mapPickerOpen, setMapPickerOpen] = useState(false);

  // Role-specific fields
  const [businessCategory, setBusinessCategory] = useState("restaurant");
  const [organizationType, setOrganizationType] = useState("food_bank");
  const [beneficiaryCapacityKg, setBeneficiaryCapacityKg] = useState("150");
  const [serviceArea, setServiceArea] = useState("");
  const [vehicleType, setVehicleType] = useState("refrigerated_van");
  const [vehicleCapacityKg, setVehicleCapacityKg] = useState("450");
  const [coldChainCertified, setColdChainCertified] = useState(false);
  const [payoutEmail, setPayoutEmail] = useState("");
  const [storageCaps, setStorageCaps] = useState<StorageType[]>([
    "ambient",
    "refrigerated",
  ]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleStorage = (st: StorageType) => {
    setStorageCaps((prev) =>
      prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const parsedLat = Number(lat);
      const parsedLng = Number(lng);
      const hasExplicitCoords =
        lat.trim() !== "" &&
        lng.trim() !== "" &&
        Number.isFinite(parsedLat) &&
        Number.isFinite(parsedLng) &&
        !(Math.abs(parsedLat) < 0.0001 && Math.abs(parsedLng) < 0.0001);

      if (selectedSlug !== "sponsor" && !hasExplicitCoords) {
        setErrorMsg(
          "Please verify your exact pickup or delivery coordinates using the interactive map picker."
        );
        setSubmitting(false);
        return;
      }

      const payload: Record<string, unknown> = {
        role: activeMeta.apiRole,
        organization_name: orgName.trim(),
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        password,
        location: {
          lat: hasExplicitCoords ? parsedLat : 0,
          lng: hasExplicitCoords ? parsedLng : 0,
          address:
            address.trim() ||
            (city.trim() ? `${city.trim()} Operations` : "Billing / Regional Office"),
          city: city.trim() || "Unspecified",
        },
      };

      if (selectedSlug === "business") {
        payload.business_type = businessCategory;
        payload.storage_capabilities = storageCaps.length > 0 ? storageCaps : ["ambient"];
      } else if (selectedSlug === "organization") {
        payload.organization_type = organizationType;
        payload.daily_capacity_kg = Number(beneficiaryCapacityKg) || 120;
        payload.storage_capabilities = storageCaps.length > 0 ? storageCaps : ["ambient"];
      } else if (selectedSlug === "delivery") {
        payload.service_area = serviceArea.trim() || city.trim();
        payload.vehicle_type = vehicleType;
        payload.vehicle_capacity_kg = Number(vehicleCapacityKg) || 350;
        payload.cold_chain_certified = coldChainCertified;
        payload.storage_capabilities = storageCaps.length > 0 ? storageCaps : ["ambient"];
        if (payoutEmail.trim()) {
          payload.paypal_payout_email = payoutEmail.trim();
        }
      } else if (selectedSlug === "sponsor") {
        payload.storage_capabilities = ["ambient"];
      }

      const user = await register(payload);
      router.push(ROLE_DASHBOARD_PATH[user.role]);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : "Registration could not be completed. Please review your details."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (isAdminAttempt) {
    return (
      <div className="min-h-screen flex flex-col bg-canvas text-ink">
        <header className="border-b border-border-subtle bg-white/95">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-forest text-white">
                <Leaf className="h-5 w-5 text-mint" />
              </span>
              <span className="text-base font-bold text-forest">
                SurplusConnect AI
              </span>
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-forest hover:text-emerald"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Role Selection</span>
            </Link>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-12">
          <Card className="w-full text-center p-8 space-y-4">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-bg text-amber-safe">
              <ShieldAlert className="h-6 w-6" />
            </span>
            <h1 className="text-xl font-bold text-forest">
              Administrator Self-Registration Disabled
            </h1>
            <p className="text-sm text-ink-muted leading-relaxed">
              Administrator accounts have governance privileges and cannot be
              created via public registration. Contact an existing platform
              administrator for provisioning.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Link href="/login/admin">
                <Button size="sm">Administrator Sign In</Button>
              </Link>
              <Link href="/">
                <Button variant="outline" size="sm">
                  Role Selection
                </Button>
              </Link>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink">
      <header className="border-b border-border-subtle bg-white/95">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-forest text-white">
              <Leaf className="h-5 w-5 text-mint" />
            </span>
            <span className="text-base font-bold text-forest">
              SurplusConnect AI
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-forest"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Role Selection</span>
            </Link>
            <Link href={activePortal.loginPath}>
              <Button variant="outline" size="sm">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <Card className="p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <Badge variant="mint">Account Onboarding</Badge>
            <h1 className="text-2xl font-bold text-forest">
              Create Your {activeMeta.label} Account
            </h1>
            <p className="text-sm text-ink-muted">
              Complete the onboarding profile below to join the SurplusConnect AI
              network. Administrator accounts are provisioned separately by platform
              administrators.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-bold text-forest uppercase tracking-wider">
              Account Role
            </legend>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {REGISTRABLE_ROLES.map((r) => {
                const Icon = r.icon;
                const active = selectedSlug === r.slug;
                return (
                  <button
                    key={r.slug}
                    type="button"
                    onClick={() => setSelectedSlug(r.slug)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition-colors cursor-pointer ${
                      active
                        ? "border-forest bg-forest text-white shadow-xs"
                        : "border-border-subtle bg-white text-ink hover:bg-mint-soft/60"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        active ? "text-mint" : "text-emerald"
                      }`}
                    />
                    <span>{r.label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {errorMsg ? (
            <div
              role="alert"
              aria-live="polite"
              className="rounded-xl border border-red-200 bg-danger-bg px-4 py-3 text-xs font-medium text-danger"
            >
              {errorMsg}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} method="POST" className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="reg-org"
                  className="block text-xs font-bold text-forest mb-1.5"
                >
                  {selectedSlug === "business"
                    ? "Business Name"
                    : selectedSlug === "organization"
                    ? "Organization Name"
                    : selectedSlug === "delivery"
                    ? "Individual or Company Name"
                    : "Sponsor / Individual or Company Name"}
                </label>
                <input
                  id="reg-org"
                  name="organization_name"
                  type="text"
                  required
                  minLength={2}
                  autoComplete="organization"
                  placeholder={
                    selectedSlug === "business"
                      ? "Enter legal business name"
                      : selectedSlug === "organization"
                      ? "Enter recipient organization name"
                      : selectedSlug === "delivery"
                      ? "Enter carrier or individual name"
                      : "Enter sponsor or organization name"
                  }
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="reg-name"
                  className="block text-xs font-bold text-forest mb-1.5"
                >
                  {selectedSlug === "sponsor" ? "Primary Contact Name" : "Contact Person"}
                </label>
                <input
                  id="reg-name"
                  name="full_name"
                  type="text"
                  required
                  minLength={2}
                  autoComplete="name"
                  placeholder="Full contact name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="reg-email"
                  className="block text-xs font-bold text-forest mb-1.5"
                >
                  {selectedSlug === "business" ? "Business Email" : "Email Address"}
                </label>
                <input
                  id="reg-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="name@organization.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="reg-phone"
                  className="block text-xs font-bold text-forest mb-1.5"
                >
                  Phone Number
                </label>
                <input
                  id="reg-phone"
                  name="phone"
                  type="tel"
                  required={selectedSlug !== "sponsor"}
                  autoComplete="tel"
                  placeholder="+1 (555) 000-0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                />
              </div>
            </div>

            {selectedSlug === "business" ? (
              <div>
                <label
                  htmlFor="reg-biz-cat"
                  className="block text-xs font-bold text-forest mb-1.5"
                >
                  Business Category
                </label>
                <select
                  id="reg-biz-cat"
                  name="business_type"
                  value={businessCategory}
                  onChange={(e) => setBusinessCategory(e.target.value)}
                  className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                >
                  <option value="restaurant">Restaurant</option>
                  <option value="bakery">Bakery &amp; Cafe</option>
                  <option value="supermarket">Supermarket</option>
                  <option value="grocery_store">Grocery Store</option>
                  <option value="retailer">Retailer</option>
                  <option value="caterer">Commercial Kitchen / Caterer</option>
                  <option value="wholesale_distributor">Wholesale Distributor</option>
                </select>
              </div>
            ) : null}

            {selectedSlug === "organization" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="reg-org-type"
                    className="block text-xs font-bold text-forest mb-1.5"
                  >
                    Organization Type
                  </label>
                  <select
                    id="reg-org-type"
                    name="organization_type"
                    value={organizationType}
                    onChange={(e) => setOrganizationType(e.target.value)}
                    className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                  >
                    <option value="orphanage">Orphanage</option>
                    <option value="old_age_home">Old-Age Home</option>
                    <option value="ngo">NGO / Nonprofit Relief</option>
                    <option value="homeless_shelter">Homeless Shelter</option>
                    <option value="food_bank">Food Bank</option>
                    <option value="community_kitchen">Community Kitchen</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="reg-cap"
                    className="block text-xs font-bold text-forest mb-1.5"
                  >
                    Beneficiary Capacity (kg / day)
                  </label>
                  <input
                    id="reg-cap"
                    name="daily_capacity_kg"
                    type="number"
                    min={5}
                    max={20000}
                    required
                    value={beneficiaryCapacityKg}
                    onChange={(e) => setBeneficiaryCapacityKg(e.target.value)}
                    className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                  />
                </div>
              </div>
            ) : null}

            {selectedSlug === "delivery" ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="reg-service-area"
                      className="block text-xs font-bold text-forest mb-1.5"
                    >
                      Service Area
                    </label>
                    <input
                      id="reg-service-area"
                      name="service_area"
                      type="text"
                      required
                      placeholder="e.g., Greater Metro Corridor (up to 40 km)"
                      value={serviceArea}
                      onChange={(e) => setServiceArea(e.target.value)}
                      className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="reg-payout-email"
                      className="block text-xs font-bold text-forest mb-1.5"
                    >
                      PayPal Payout Email (Optional)
                    </label>
                    <input
                      id="reg-payout-email"
                      name="paypal_payout_email"
                      type="email"
                      placeholder="Defaults to account email if left blank"
                      value={payoutEmail}
                      onChange={(e) => setPayoutEmail(e.target.value)}
                      className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="reg-veh-type"
                      className="block text-xs font-bold text-forest mb-1.5"
                    >
                      Vehicle Type
                    </label>
                    <select
                      id="reg-veh-type"
                      name="vehicle_type"
                      value={vehicleType}
                      onChange={(e) => setVehicleType(e.target.value)}
                      className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                    >
                      <option value="refrigerated_van">Refrigerated Van</option>
                      <option value="insulated_box_truck">Insulated Box Truck</option>
                      <option value="cargo_van">Standard Cargo Van</option>
                      <option value="electric_cargo_bike">Electric Cargo Bike</option>
                      <option value="sedan_courier">Courier Vehicle</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="reg-veh-cap"
                      className="block text-xs font-bold text-forest mb-1.5"
                    >
                      Vehicle Capacity (kg)
                    </label>
                    <input
                      id="reg-veh-cap"
                      name="vehicle_capacity_kg"
                      type="number"
                      min={10}
                      max={10000}
                      required
                      value={vehicleCapacityKg}
                      onChange={(e) => setVehicleCapacityKg(e.target.value)}
                      className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {/* Address & Location */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="reg-address"
                  className="block text-xs font-bold text-forest mb-1.5"
                >
                  {selectedSlug === "sponsor"
                    ? "City / Billing Address (Optional)"
                    : "Street Address"}
                </label>
                <input
                  id="reg-address"
                  name="address"
                  type="text"
                  required={selectedSlug !== "sponsor"}
                  autoComplete="street-address"
                  placeholder="Street address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="reg-city"
                  className="block text-xs font-bold text-forest mb-1.5"
                >
                  City / Region
                </label>
                <input
                  id="reg-city"
                  name="city"
                  type="text"
                  required={selectedSlug !== "sponsor"}
                  autoComplete="address-level2"
                  placeholder="City"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                />
              </div>
            </div>

            {selectedSlug !== "sponsor" ? (
              <div className="space-y-3 rounded-2xl border border-border-subtle bg-canvas/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-forest">
                      Verified Map Coordinates
                    </div>
                    <p className="text-[11px] text-ink-muted">
                      Search your address or place your pin directly on the OpenStreetMap canvas.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setMapPickerOpen(true)}
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    {lat && lng ? "Adjust Pin on Map" : "Set Location on Map"}
                  </Button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="reg-lat"
                      className="block text-xs font-bold text-forest mb-1.5"
                    >
                      Latitude
                    </label>
                    <input
                      id="reg-lat"
                      name="lat"
                      type="number"
                      step="0.000001"
                      required
                      placeholder="Select on map or enter latitude"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="reg-lng"
                      className="block text-xs font-bold text-forest mb-1.5"
                    >
                      Longitude
                    </label>
                    <input
                      id="reg-lng"
                      name="lng"
                      type="number"
                      step="0.000001"
                      required
                      placeholder="Select on map or enter longitude"
                      value={lng}
                      onChange={(e) => setLng(e.target.value)}
                      className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {selectedSlug !== "sponsor" ? (
              <fieldset className="space-y-2.5">
                <legend className="text-xs font-bold text-forest">
                  {selectedSlug === "organization"
                    ? "Available Storage Facilities"
                    : "Storage Capabilities"}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {STORAGE_OPTIONS.map((opt) => {
                    const checked = storageCaps.includes(opt.value);
                    return (
                      <label
                        key={opt.value}
                        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold cursor-pointer transition-colors ${
                          checked
                            ? "border-emerald bg-mint-soft text-forest"
                            : "border-border-subtle bg-white text-ink-muted hover:bg-surface-muted"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStorage(opt.value)}
                          className="accent-emerald"
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
                {selectedSlug === "delivery" ? (
                  <label className="inline-flex items-center gap-2 pt-1 text-xs font-semibold text-forest cursor-pointer">
                    <input
                      type="checkbox"
                      checked={coldChainCertified}
                      onChange={(e) => setColdChainCertified(e.target.checked)}
                      className="accent-emerald"
                    />
                    <span>Vehicle is temperature-monitored / cold-chain certified</span>
                  </label>
                ) : null}
              </fieldset>
            ) : null}

            <div>
              <label
                htmlFor="reg-password"
                className="block text-xs font-bold text-forest mb-1.5"
              >
                Password (minimum 8 characters)
              </label>
              <div className="relative">
                <input
                  id="reg-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-border-subtle bg-white py-2.5 pl-3.5 pr-11 text-sm text-ink focus:border-emerald focus:outline-none"
                />
                <button
                  type="button"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-ink-muted hover:text-forest cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={submitting}>
              <UserPlus className="h-4 w-4" />
              {submitting
                ? "Creating account..."
                : `Create ${activeMeta.label} Account`}
            </Button>
          </form>

          <div className="border-t border-border-subtle pt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <Link
              href={activePortal.loginPath}
              className="inline-flex min-h-9 items-center font-semibold text-emerald hover:text-forest"
            >
              Already registered as {activeMeta.label}? Sign In
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-9 items-center font-semibold text-ink-muted hover:text-forest"
            >
              Back to Role Selection
            </Link>
          </div>
        </Card>
      </main>

      <LocationPickerModal
        open={mapPickerOpen}
        onClose={() => setMapPickerOpen(false)}
        persistToAccount={false}
        initialLocation={{
          address,
          city,
          lat: lat ? Number(lat) : undefined,
          lng: lng ? Number(lng) : undefined,
        }}
        onSaved={(loc) => {
          setAddress(loc.address);
          setCity(loc.city);
          setLat(String(loc.lat));
          setLng(String(loc.lng));
        }}
      />
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-canvas text-sm text-forest">
          Loading registration form...
        </div>
      }
    >
      <RegisterContent />
    </Suspense>
  );
}
