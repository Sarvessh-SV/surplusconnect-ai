"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Award,
  CheckCircle2,
  CreditCard,
  Scale,
  ShieldCheck,
  UserPlus,
  Users,
  Warehouse,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { RoleGuard } from "@/components/layout/RoleGuard";
import { CategoryBreakdownChart } from "@/components/charts/ImpactCharts";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataColumn, DataTable } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import {
  LogisticsMap,
  type MapMarkerNode,
  type MapRouteSegment,
} from "@/components/maps/LogisticsMap";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { SearchFilterBar } from "@/components/ui/SearchFilterBar";
import { useToast } from "@/components/ui/ToastProvider";
import {
  Badge,
  Button,
  Card,
  DashboardSkeleton,
  EmptyState,
  StatusIndicator,
} from "@/components/ui/primitives";
import { api } from "@/lib/api";
import type {
  ApprovalRequest,
  DeliveryRecord,
  ImpactAnalyticsResponse,
  NetworkMapData,
  StorageHub,
  StorageType,
  UserPublic,
} from "@/lib/types";

type AdminTab = "approvals" | "network" | "payouts" | "partners" | "hubs";

export default function AdminGovernancePage() {
  const { notify } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("approvals");

  const [overview, setOverview] = useState<{
    users: UserPublic[];
    approvals: ApprovalRequest[];
    deliveries: DeliveryRecord[];
    audit_logs: Array<{
      id: string;
      actor_role: string;
      action: string;
      target_id: string;
      details: string;
      created_at: string;
    }>;
    integrations: Record<string, unknown>;
  } | null>(null);
  const [impact, setImpact] = useState<ImpactAnalyticsResponse | null>(null);
  const [hubs, setHubs] = useState<StorageHub[]>([]);
  const [networkData, setNetworkData] = useState<NetworkMapData | null>(null);

  const [gateNotes, setGateNotes] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [rejectConfirmGate, setRejectConfirmGate] = useState<ApprovalRequest | null>(null);

  const [partnerSearch, setPartnerSearch] = useState("");
  const [partnerRoleFilter, setPartnerRoleFilter] = useState("all");

  // Modal: Provision Admin
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [adminOrgName, setAdminOrgName] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [adminFormBusy, setAdminFormBusy] = useState(false);

  // Modal: Create Storage Hub
  const [hubModalOpen, setHubModalOpen] = useState(false);
  const [hubName, setHubName] = useState("");
  const [hubAddress, setHubAddress] = useState("");
  const [hubCity, setHubCity] = useState("");
  const [hubLat, setHubLat] = useState("37.7749");
  const [hubLng, setHubLng] = useState("-122.4194");
  const [hubCapacity, setHubCapacity] = useState("1500");
  const [hubStorageTypes, setHubStorageTypes] = useState<StorageType[]>(["refrigerated"]);
  const [hubFormBusy, setHubFormBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, imp, hubRes, netRes] = await Promise.all([
        api.adminOverview(),
        api.impact(),
        api.listStorageHubs(),
        api.networkMap().catch(() => null),
      ]);
      setOverview(ov);
      setImpact(imp);
      setHubs(hubRes.items);
      setNetworkData(netRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load platform governance data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleResolveGate = async (gate: ApprovalRequest, decision: "approve" | "reject") => {
    setActionBusy(gate.id);
    try {
      await api.resolveApproval(gate.id, {
        decision,
        reviewer_notes:
          gateNotes[gate.id] ||
          (decision === "approve"
            ? "Verified by platform administrator for compliance and cold-chain safety."
            : "Held pending additional compliance review."),
      });
      notify({
        tone: decision === "approve" ? "success" : "warning",
        title: decision === "approve" ? "Approval confirmed" : "Approval declined",
        message: `${gate.title} has been ${decision === "approve" ? "approved" : "declined"}.`,
      });
      setRejectConfirmGate(null);
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Review update failed",
        message: err instanceof Error ? err.message : "Unable to update approval status.",
      });
    } finally {
      setActionBusy(null);
    }
  };

  const handleToggleVerify = async (u: UserPublic) => {
    setActionBusy(u.id);
    try {
      await api.verifyUser(u.id, {
        verified: !u.verified,
        notes: !u.verified
          ? "Verified by platform administrator"
          : "Verification paused for review",
      });
      notify({
        tone: "success",
        title: !u.verified ? "Partner verified" : "Verification paused",
        message: `${u.organization_name} status updated.`,
      });
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Verification failed",
        message: err instanceof Error ? err.message : "Unable to update partner verification.",
      });
    } finally {
      setActionBusy(null);
    }
  };

  const handleTriggerPayout = async (deliveryId: string) => {
    setActionBusy(deliveryId);
    try {
      const res = await api.triggerPayPalPayout({
        delivery_id: deliveryId,
        note: "Administrator disbursement for completed delivery",
      });
      notify({
        tone: "success",
        title: "Disbursement initiated",
        message: `Payout of $${res.transaction.amount_usd.toFixed(2)} processed.`,
      });
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Disbursement failed",
        message: err instanceof Error ? err.message : "Unable to process delivery payout.",
      });
    } finally {
      setActionBusy(null);
    }
  };

  const handleProvisionAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminFormBusy(true);
    try {
      await api.provisionAdmin({
        email: adminEmail.trim(),
        password: adminPassword,
        full_name: adminFullName.trim(),
        organization_name: adminOrgName.trim() || "SurplusConnect Operations",
        phone: adminPhone.trim(),
      });
      notify({
        tone: "success",
        title: "Administrator provisioned",
        message: `${adminEmail.trim()} now has platform oversight access.`,
      });
      setAdminEmail("");
      setAdminPassword("");
      setAdminFullName("");
      setAdminOrgName("");
      setAdminPhone("");
      setAdminModalOpen(false);
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Provisioning failed",
        message: err instanceof Error ? err.message : "Unable to provision administrator.",
      });
    } finally {
      setAdminFormBusy(false);
    }
  };

  const toggleHubStorageType = (st: StorageType) => {
    setHubStorageTypes((prev) =>
      prev.includes(st) ? prev.filter((item) => item !== st) : [...prev, st]
    );
  };

  const handleCreateHub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hubStorageTypes.length === 0) {
      notify({
        tone: "warning",
        title: "Select a storage capability",
        message: "Choose at least one storage environment for the hub.",
      });
      return;
    }
    setHubFormBusy(true);
    try {
      await api.createStorageHub({
        name: hubName.trim(),
        location: {
          lat: Number(hubLat) || 37.7749,
          lng: Number(hubLng) || -122.4194,
          address: hubAddress.trim(),
          city: hubCity.trim(),
        },
        supported_storage: hubStorageTypes,
        available_capacity_kg: Number(hubCapacity) || 1000,
      });
      notify({
        tone: "success",
        title: "Storage hub added",
        message: `${hubName.trim()} is now active in the regional network.`,
      });
      setHubName("");
      setHubAddress("");
      setHubCity("");
      setHubCapacity("1500");
      setHubModalOpen(false);
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Unable to create hub",
        message: err instanceof Error ? err.message : "Failed to register storage hub.",
      });
    } finally {
      setHubFormBusy(false);
    }
  };

  const pendingApprovals = useMemo(
    () => (overview?.approvals || []).filter((a) => a.status === "pending"),
    [overview?.approvals]
  );

  const verifiedPartnerCount = useMemo(
    () => (overview?.users || []).filter((u) => u.verified).length,
    [overview?.users]
  );

  const filteredPartners = useMemo(() => {
    const q = partnerSearch.trim().toLowerCase();
    return (overview?.users || []).filter((u) => {
      if (partnerRoleFilter !== "all" && u.role !== partnerRoleFilter) return false;
      if (!q) return true;
      return (
        u.organization_name.toLowerCase().includes(q) ||
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    });
  }, [overview?.users, partnerSearch, partnerRoleFilter]);

  const payoutColumns: DataColumn<DeliveryRecord>[] = [
    {
      key: "route",
      header: "Delivery Route",
      render: (d) => (
        <div className="min-w-0">
          <div className="font-semibold text-forest">{d.inventory_title}</div>
          <div className="text-xs text-ink-muted">
            {d.pickup_location?.city || "Pickup"} to {d.dropoff_location?.city || "Recipient"}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Delivery Status",
      render: (d) => (
        <StatusIndicator
          label={d.status.replace(/_/g, " ")}
          tone={d.status === "delivered" ? "success" : "info"}
        />
      ),
    },
    {
      key: "cost",
      header: "Logistics Fee",
      render: (d) => (
        <span className="font-semibold text-forest">${d.estimated_cost_usd.toFixed(2)}</span>
      ),
    },
    {
      key: "payout",
      header: "Disbursement",
      render: (d) => (
        <StatusIndicator
          label={d.payout_status === "paid" ? "Disbursed" : d.payout_status}
          tone={
            d.payout_status === "paid"
              ? "success"
              : d.payout_status === "failed"
              ? "danger"
              : "warning"
          }
        />
      ),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (d) =>
        d.payout_status !== "paid" ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={actionBusy === d.id}
            onClick={() => handleTriggerPayout(d.id)}
          >
            <CreditCard className="h-3.5 w-3.5" />
            {actionBusy === d.id ? "Sending..." : "Release Payout"}
          </Button>
        ) : (
          <span className="text-xs font-medium text-emerald">Paid</span>
        ),
    },
  ];

  const adminMapMarkers: MapMarkerNode[] = useMemo(() => {
    if (!networkData) return [];
    return networkData.markers.map((m) => ({
      id: m.id,
      label: m.label,
      sublabel:
        m.role === "donor"
          ? `${m.quantity_kg} kg listed`
          : `${m.quantity_kg} kg/day capacity`,
      quantityLabel:
        m.role === "donor" ? `${m.quantity_kg} kg` : `${m.quantity_kg} kg/day`,
      distanceKm: m.distance_km ?? null,
      matchStatus: m.match_status,
      kind:
        m.kind === "donor"
          ? "donor"
          : m.kind === "pending_recipient"
          ? "fallback_org"
          : "organization",
      location: m.location,
    }));
  }, [networkData]);

  const adminMapRoutes: MapRouteSegment[] = useMemo(() => {
    if (!networkData) return [];
    return networkData.routes.map((r) => ({
      id: r.id,
      label: `${r.donor_name || "Donor"} → ${r.recipient_name || "Recipient"}`,
      donorId: r.donor_id || undefined,
      recipientId: r.recipient_id || undefined,
      routeType: r.route_type,
      distanceKm: r.distance_km ?? null,
      durationMinutes: r.duration_minutes ?? null,
      routeSource: r.route_source ?? null,
      encodedPolyline: r.encoded_polyline,
      points: [r.origin, r.destination],
    }));
  }, [networkData]);

  const tabs: Array<{ id: AdminTab; label: string; count?: number }> = [
    { id: "approvals", label: "Safety & Approvals", count: pendingApprovals.length },
    { id: "network", label: "Donation Network", count: adminMapMarkers.length },
    { id: "payouts", label: "Delivery Payouts", count: overview?.deliveries.length || 0 },
    { id: "partners", label: "Partner Registry", count: overview?.users.length || 0 },
    { id: "hubs", label: "Storage Hubs & Activity", count: hubs.length },
  ];

  return (
    <RoleGuard allowedRoles={["admin"]}>
      <AppShell
        title="Platform Governance"
        subtitle="Review safety approvals, verify partner organizations, oversee payouts, and manage regional hubs."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setHubModalOpen(true)}>
              <Warehouse className="h-4 w-4" />
              Add Storage Hub
            </Button>
            <Button size="sm" onClick={() => setAdminModalOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Provision Admin
            </Button>
          </div>
        }
      >
        {loading ? (
          <DashboardSkeleton />
        ) : error ? (
          <Card className="border-danger/30 bg-danger-bg/50">
            <p className="text-sm font-medium text-danger">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={loadData}>
              Retry
            </Button>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Compact KPI Overview */}
            <section aria-label="Governance key metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Rescued Volume"
                value={`${impact?.combined_metrics.rescued_kg.toLocaleString() || 0} kg`}
                helper="Verified surplus redistributed"
                icon={Scale}
                tone="forest"
              />
              <KpiCard
                label="Estimated Meals"
                value={impact?.combined_metrics.meals_equivalent.toLocaleString() || 0}
                helper={`${impact?.combined_metrics.co2e_avoided_kg.toLocaleString() || 0} kg emissions avoided`}
                icon={Award}
                tone="emerald"
              />
              <KpiCard
                label="Pending Approvals"
                value={pendingApprovals.length}
                helper={
                  pendingApprovals.length > 0
                    ? "Requires administrator review"
                    : "All compliance checks cleared"
                }
                icon={ShieldCheck}
                tone={pendingApprovals.length > 0 ? "amber" : "emerald"}
              />
              <KpiCard
                label="Verified Partners"
                value={`${verifiedPartnerCount} / ${overview?.users.length || 0}`}
                helper="Active organizations & drivers"
                icon={Users}
                tone="forest"
              />
            </section>

            {/* Section Tab Bar */}
            <nav
              aria-label="Governance sections"
              className="flex flex-wrap gap-2 rounded-2xl border border-border-subtle bg-white p-2"
            >
              {tabs.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-semibold transition-colors cursor-pointer ${
                      active
                        ? "bg-forest text-white"
                        : "text-forest hover:bg-mint-soft/70"
                    }`}
                  >
                    <span>{tab.label}</span>
                    {typeof tab.count === "number" ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          active
                            ? "bg-white/20 text-white"
                            : "bg-surface-muted text-ink-muted"
                        }`}
                      >
                        {tab.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            {/* Tab 1: Safety & Approvals */}
            {activeTab === "approvals" ? (
              <section className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="sc-section-title">Compliance & Match Approvals</h2>
                    <StatusIndicator
                      label={`${pendingApprovals.length} Pending`}
                      tone={pendingApprovals.length > 0 ? "warning" : "success"}
                    />
                  </div>

                  {!overview?.approvals.length ? (
                    <EmptyState
                      icon={ShieldCheck}
                      title="No approval requests yet"
                      description="Safety verification requests and large-lot match reviews appear here automatically."
                    />
                  ) : (
                    <div className="space-y-3">
                      {overview.approvals.map((gate) => (
                        <Card key={gate.id} className="space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="sc-card-title">{gate.title}</h3>
                              <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                                {gate.summary}
                              </p>
                            </div>
                            <StatusIndicator
                              label={gate.status}
                              tone={
                                gate.status === "pending"
                                  ? "warning"
                                  : gate.status === "approved"
                                  ? "success"
                                  : "danger"
                              }
                            />
                          </div>

                          {gate.status === "pending" ? (
                            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                              <input
                                type="text"
                                aria-label={`Review notes for ${gate.title}`}
                                placeholder="Add verification notes (optional)..."
                                value={gateNotes[gate.id] || ""}
                                onChange={(e) =>
                                  setGateNotes((prev) => ({
                                    ...prev,
                                    [gate.id]: e.target.value,
                                  }))
                                }
                                className="min-h-10 flex-1 rounded-xl border border-border-subtle bg-canvas/70 px-3 text-xs text-ink"
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={actionBusy === gate.id}
                                  onClick={() => handleResolveGate(gate, "approve")}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={actionBusy === gate.id}
                                  onClick={() => setRejectConfirmGate(gate)}
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  Decline
                                </Button>
                              </div>
                            </div>
                          ) : gate.reviewer_notes ? (
                            <p className="rounded-xl bg-surface-muted/70 px-3 py-2 text-xs text-ink-muted">
                              Note: {gate.reviewer_notes}
                            </p>
                          ) : null}
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <h2 className="sc-section-title">Category Distribution</h2>
                  <CategoryBreakdownChart data={impact?.category_breakdown || []} />
                </div>
              </section>
            ) : null}

            {/* Tab: Donation Network Map */}
            {activeTab === "network" ? (
              <section>
                <LogisticsMap
                  markers={adminMapMarkers}
                  routes={adminMapRoutes}
                  onLocationUpdated={loadData}
                />
              </section>
            ) : null}

            {/* Tab 2: Delivery Payouts */}
            {activeTab === "payouts" ? (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="sc-section-title">Delivery Disbursements</h2>
                    <p className="text-xs text-ink-muted mt-0.5">
                      Release verified logistics payouts to delivery partners upon route completion.
                    </p>
                  </div>
                </div>
                <DataTable
                  rows={overview?.deliveries || []}
                  columns={payoutColumns}
                  keyExtractor={(d) => d.id}
                  caption="Delivery disbursements table"
                  emptyState={
                    <EmptyState
                      icon={CreditCard}
                      title="No delivery disbursements queued"
                      description="Scheduled and completed delivery payouts appear here."
                    />
                  }
                />
              </section>
            ) : null}

            {/* Tab 3: Partner Registry */}
            {activeTab === "partners" ? (
              <section className="space-y-4">
                <SearchFilterBar
                  searchValue={partnerSearch}
                  onSearchChange={setPartnerSearch}
                  searchPlaceholder="Search organizations, contacts, or emails..."
                  filters={[
                    {
                      id: "role-filter",
                      label: "Filter by role",
                      value: partnerRoleFilter,
                      onChange: setPartnerRoleFilter,
                      options: [
                        { label: "All Roles", value: "all" },
                        { label: "Business Donors", value: "business" },
                        { label: "Recipient Organizations", value: "organization" },
                        { label: "Delivery Partners", value: "delivery" },
                        { label: "Sponsors", value: "sponsor" },
                        { label: "Administrators", value: "admin" },
                      ],
                    },
                  ]}
                />

                {filteredPartners.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No matching partners"
                    description="Try clearing your search or role filter."
                  />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {filteredPartners.map((u) => (
                      <Card key={u.id} className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="sc-card-title truncate">{u.organization_name}</span>
                            <Badge variant="neutral" className="capitalize">
                              {u.role}
                            </Badge>
                          </div>
                          <div className="text-xs text-ink-muted truncate">
                            {u.full_name} · {u.email}
                          </div>
                          <div className="pt-1">
                            <StatusIndicator
                              label={u.verified ? "Verified Partner" : "Pending Verification"}
                              tone={u.verified ? "success" : "warning"}
                            />
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={u.verified ? "outline" : "secondary"}
                          disabled={actionBusy === u.id}
                          onClick={() => handleToggleVerify(u)}
                        >
                          {u.verified ? "Pause" : "Verify"}
                        </Button>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {/* Tab 4: Storage Hubs & Recent Activity */}
            {activeTab === "hubs" ? (
              <section className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="sc-section-title">Regional Storage Hubs</h2>
                    <Button size="sm" variant="outline" onClick={() => setHubModalOpen(true)}>
                      <Warehouse className="h-3.5 w-3.5" />
                      Add Hub
                    </Button>
                  </div>
                  {hubs.length === 0 ? (
                    <EmptyState
                      icon={Warehouse}
                      title="No storage hubs registered"
                      description="Register cold-chain or dry storage hubs to support multi-leg redistribution."
                      action={
                        <Button size="sm" variant="outline" onClick={() => setHubModalOpen(true)}>
                          Add Storage Hub
                        </Button>
                      }
                    />
                  ) : (
                    <div className="space-y-3">
                      {hubs.map((hub) => (
                        <Card key={hub.id} className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="sc-card-title">{hub.name}</h3>
                              <p className="text-xs text-ink-muted mt-0.5">
                                {hub.location.address}, {hub.location.city}
                              </p>
                            </div>
                            <StatusIndicator label={`${hub.available_capacity_kg} kg open`} tone="success" />
                          </div>
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {hub.supported_storage.map((st) => (
                              <Badge key={st} variant="neutral" className="capitalize">
                                {st}
                              </Badge>
                            ))}
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <h2 className="sc-section-title">Recent Governance Activity</h2>
                  {!overview?.audit_logs.length ? (
                    <EmptyState
                      icon={Activity}
                      title="No governance events logged"
                      description="Administrative approvals, verifications, and disbursements appear here."
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {overview.audit_logs.slice(0, 12).map((log) => (
                        <Card key={log.id} className="p-4">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-forest capitalize">
                              {log.action.replace(/_/g, " ")}
                            </span>
                            <span className="text-ink-muted">
                              {new Date(log.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-ink-muted">{log.details}</p>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            ) : null}
          </div>
        )}

        {/* Confirm Rejection Dialog */}
        <ConfirmDialog
          open={Boolean(rejectConfirmGate)}
          onClose={() => setRejectConfirmGate(null)}
          onConfirm={() =>
            rejectConfirmGate ? handleResolveGate(rejectConfirmGate, "reject") : Promise.resolve()
          }
          title="Decline approval request?"
          description={`Declining "${rejectConfirmGate?.title || "this request"}" will hold the batch from moving forward until resubmitted.`}
          confirmLabel="Decline Request"
          cancelLabel="Keep Pending"
          variant="danger"
          busy={Boolean(rejectConfirmGate && actionBusy === rejectConfirmGate.id)}
        />

        {/* Modal: Provision Administrator */}
        <ModalDialog
          open={adminModalOpen}
          onClose={() => setAdminModalOpen(false)}
          title="Provision Administrator"
          subtitle="Create a new platform administrator account with full oversight privileges."
        >
          <form onSubmit={handleProvisionAdmin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-forest mb-1.5">Full Name</label>
              <input
                type="text"
                required
                placeholder="Operations Lead"
                value={adminFullName}
                onChange={(e) => setAdminFullName(e.target.value)}
                className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-forest mb-1.5">
                Work Email Address
              </label>
              <input
                type="email"
                required
                placeholder="ops.admin@company.com"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-forest mb-1.5">
                Department / Unit
              </label>
              <input
                type="text"
                placeholder="SurplusConnect Operations"
                value={adminOrgName}
                onChange={(e) => setAdminOrgName(e.target.value)}
                className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3.5 text-sm"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-forest mb-1.5">
                  Temporary Password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="Min 8 characters"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-forest mb-1.5">
                  Phone Number
                </label>
                <input
                  type="text"
                  placeholder="+1 (555) 000-0000"
                  value={adminPhone}
                  onChange={(e) => setAdminPhone(e.target.value)}
                  className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3.5 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={adminFormBusy}
                onClick={() => setAdminModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={adminFormBusy}>
                {adminFormBusy ? "Provisioning..." : "Create Administrator"}
              </Button>
            </div>
          </form>
        </ModalDialog>

        {/* Modal: Add Storage Hub */}
        <ModalDialog
          open={hubModalOpen}
          onClose={() => setHubModalOpen(false)}
          title="Add Regional Storage Hub"
          subtitle="Register a cold-chain or dry storage facility for multi-leg logistics."
        >
          <form onSubmit={handleCreateHub} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-forest mb-1.5">Hub Name</label>
              <input
                type="text"
                required
                placeholder="Bayview Cold Storage Annex"
                value={hubName}
                onChange={(e) => setHubName(e.target.value)}
                className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3.5 text-sm"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-forest mb-1.5">
                  Street Address
                </label>
                <input
                  type="text"
                  required
                  placeholder="450 Harbor Way"
                  value={hubAddress}
                  onChange={(e) => setHubAddress(e.target.value)}
                  className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-forest mb-1.5">City</label>
                <input
                  type="text"
                  required
                  placeholder="San Francisco"
                  value={hubCity}
                  onChange={(e) => setHubCity(e.target.value)}
                  className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3.5 text-sm"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-forest mb-1.5">
                  Capacity (kg)
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  value={hubCapacity}
                  onChange={(e) => setHubCapacity(e.target.value)}
                  className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-forest mb-1.5">Latitude</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={hubLat}
                  onChange={(e) => setHubLat(e.target.value)}
                  className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-forest mb-1.5">Longitude</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={hubLng}
                  onChange={(e) => setHubLng(e.target.value)}
                  className="min-h-10 w-full rounded-xl border border-border-subtle bg-white px-3.5 text-sm"
                />
              </div>
            </div>

            <div>
              <span className="block text-xs font-semibold text-forest mb-2">
                Supported Storage Environments
              </span>
              <div className="flex flex-wrap gap-2">
                {(["ambient", "refrigerated", "frozen", "dry"] as StorageType[]).map((st) => {
                  const selected = hubStorageTypes.includes(st);
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => toggleHubStorageType(st)}
                      className={`min-h-9 rounded-xl border px-3 text-xs font-medium capitalize transition-colors cursor-pointer ${
                        selected
                          ? "border-forest bg-mint-soft text-forest"
                          : "border-border-subtle bg-white text-ink-muted hover:bg-canvas"
                      }`}
                    >
                      {st}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={hubFormBusy}
                onClick={() => setHubModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={hubFormBusy}>
                {hubFormBusy ? "Saving..." : "Register Storage Hub"}
              </Button>
            </div>
          </form>
        </ModalDialog>
      </AppShell>
    </RoleGuard>
  );
}
