"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  DollarSign,
  HeartHandshake,
  Receipt,
  Sparkles,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { FundingCampaign, TransactionRecord } from "@/lib/types";
import { AppShell } from "@/components/layout/AppShell";
import { RoleGuard } from "@/components/layout/RoleGuard";
import {
  Button,
  Card,
  DashboardSkeleton,
  EmptyState,
  ProgressBar,
  StatusIndicator,
  type StatusTone,
} from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/KpiCard";
import { SearchFilterBar } from "@/components/ui/SearchFilterBar";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/ToastProvider";
import { PayPalCheckoutModal } from "@/components/paypal/PayPalCheckoutModal";

function getTransactionTone(status: string): StatusTone {
  const s = status.toUpperCase();
  if (s === "COMPLETED" || s === "SUCCESS") return "success";
  if (s === "FAILED" || s === "DENIED" || s === "CANCELLED" || s === "ERROR") {
    return "danger";
  }
  return "warning";
}

function getTransactionLabel(status: string): string {
  const s = status.toUpperCase();
  if (s === "COMPLETED" || s === "SUCCESS") return "Completed";
  if (s === "FAILED" || s === "DENIED" || s === "CANCELLED" || s === "ERROR") {
    return "Failed";
  }
  return "Pending";
}

export default function SponsorDashboardPage() {
  const { notify } = useToast();
  const [campaigns, setCampaigns] = useState<FundingCampaign[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [selectedCampaign, setSelectedCampaign] =
    useState<FundingCampaign | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [returnedPayPalOrder, setReturnedPayPalOrder] = useState<{
    orderId: string;
    campaignId: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [loading, setLoading] = useState(true);
  const [capturingReturn, setCapturingReturn] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [campRes, txnRes] = await Promise.all([
        api.listCampaigns(),
        api.listTransactions(),
      ]);
      setCampaigns(campRes.items);
      setTransactions(txnRes.items);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : "Unable to load sponsor funding opportunities."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const ppStatus = params.get("paypal_status");
      const token = params.get("token");
      const campId = params.get("campaign_id");
      if (ppStatus === "approved" && token && campId) {
        setReturnedPayPalOrder({ orderId: token, campaignId: campId });
      }
    }
  }, [loadData]);

  const handleCaptureReturnedOrder = async () => {
    if (!returnedPayPalOrder) return;
    setCapturingReturn(true);
    try {
      const res = await api.capturePayPalOrder({
        order_id: returnedPayPalOrder.orderId,
        campaign_id: returnedPayPalOrder.campaignId,
      });
      notify({
        tone: "success",
        title: "Payment completed",
        message: `Contributed $${res.transaction.amount_usd.toFixed(2)} USD via PayPal Sandbox.`,
      });
      setReturnedPayPalOrder(null);
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", "/dashboard/sponsor");
      }
      await loadData();
    } catch (err) {
      notify({
        tone: "error",
        title: "Payment confirmation failed",
        message:
          err instanceof ApiError
            ? err.message
            : "Unable to confirm PayPal contribution.",
      });
    } finally {
      setCapturingReturn(false);
    }
  };

  const metrics = useMemo(() => {
    const open = campaigns.filter((c) => c.status === "open").length;
    const funded = campaigns.filter((c) => c.status === "funded").length;
    const totalContributed = transactions
      .filter((t) => ["COMPLETED", "SUCCESS"].includes(t.status.toUpperCase()))
      .reduce((sum, t) => sum + (t.amount_usd || 0), 0);
    const totalKg = campaigns
      .filter((c) => c.status === "funded")
      .reduce((sum, c) => sum + (c.allocated_kg || 0), 0);
    return {
      open,
      funded,
      totalContributed,
      mealsSupported: Math.round(totalKg * 2.5),
    };
  }, [campaigns, transactions]);

  const filteredCampaigns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (
        q &&
        !c.title.toLowerCase().includes(q) &&
        !c.organization_name.toLowerCase().includes(q) &&
        !c.business_name.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [campaigns, searchQuery, statusFilter]);

  const txnColumns: DataColumn<TransactionRecord>[] = [
    {
      key: "payer",
      header: "Contributor",
      render: (t) => (
        <div>
          <div className="font-semibold text-forest">{t.payer_name || "Sponsor"}</div>
          <div className="text-xs text-ink-muted capitalize">
            {t.type.replace(/_/g, " ")}
          </div>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (t) => (
        <span className="font-semibold text-forest">
          ${t.amount_usd.toFixed(2)} {t.currency}
        </span>
      ),
    },
    {
      key: "method",
      header: "Payment Method",
      render: (t) => (
        <span className="text-xs text-ink-muted capitalize">
          {t.payment_mode.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      render: (t) => (
        <span className="text-xs text-ink-muted">
          {new Date(t.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      render: (t) => (
        <StatusIndicator
          label={getTransactionLabel(t.status)}
          tone={getTransactionTone(t.status)}
        />
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={["sponsor", "admin"]}>
      <AppShell
        title="Sponsor Funding Portal"
        subtitle="Support surplus delivery transportation via PayPal Sandbox and review settlement receipts."
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

        {returnedPayPalOrder ? (
          <Card className="border-emerald bg-mint-soft/60 flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-forest">
              <strong>PayPal Approval Received</strong> — Confirm your contribution below to finalize delivery funding.
            </div>
            <Button
              size="sm"
              disabled={capturingReturn}
              onClick={() => void handleCaptureReturnedOrder()}
            >
              {capturingReturn ? "Confirming..." : "Complete Payment"}
            </Button>
          </Card>
        ) : null}

        {loading && campaigns.length === 0 && transactions.length === 0 ? (
          <DashboardSkeleton />
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Open Campaigns"
                value={metrics.open}
                helper="Ready for support"
                icon={HeartHandshake}
                tone={metrics.open > 0 ? "amber" : "forest"}
              />
              <KpiCard
                label="Funded Rescues"
                value={metrics.funded}
                helper="Cleared for dispatch"
                icon={CheckCircle2}
                tone="emerald"
              />
              <KpiCard
                label="Total Contributed"
                value={`$${metrics.totalContributed.toFixed(2)}`}
                helper="Completed payments"
                icon={DollarSign}
                tone="forest"
              />
              <KpiCard
                label="Meals Supported"
                value={metrics.mealsSupported}
                helper="Estimated meals delivered"
                icon={Sparkles}
                tone="emerald"
              />
            </section>

            <SearchFilterBar
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search campaigns by organization or item..."
              filters={[
                {
                  id: "camp-status",
                  label: "Filter by campaign status",
                  value: statusFilter,
                  onChange: setStatusFilter,
                  options: [
                    { label: "Open Campaigns", value: "open" },
                    { label: "Funded Campaigns", value: "funded" },
                    { label: "All Campaigns", value: "all" },
                  ],
                },
              ]}
            />

            <Card className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="sc-section-title">Funding Opportunities</h2>
                  <p className="text-xs text-ink-muted">
                    Contributions fund verified delivery routes through PayPal Sandbox.
                  </p>
                </div>
                <StatusIndicator label="PayPal Sandbox" tone="info" />
              </div>

              {filteredCampaigns.length === 0 ? (
                <EmptyState
                  icon={HeartHandshake}
                  title="No Campaigns Match This View"
                  description="Open delivery funding requests will appear here as recipient organizations accept matches."
                  action={
                    statusFilter !== "all" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setStatusFilter("all")}
                      >
                        Show All Campaigns
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {filteredCampaigns.map((camp) => {
                    const gap = Math.max(
                      0,
                      Number(
                        (camp.required_amount_usd - camp.funded_amount_usd).toFixed(2)
                      )
                    );
                    const isFunded = camp.status === "funded";

                    return (
                      <div
                        key={camp.id}
                        className="flex flex-col justify-between gap-4 rounded-2xl border border-border-subtle bg-canvas/70 p-4"
                      >
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <StatusIndicator
                              label={isFunded ? "Funded" : camp.is_fallback_match ? "Expanded Urgent" : "Open"}
                              tone={isFunded ? "success" : camp.is_fallback_match ? "warning" : "info"}
                            />
                            <span className="text-xs font-medium text-ink-muted">
                              {camp.allocated_kg} kg • {camp.distance_km} km
                            </span>
                          </div>
                          <h3 className="sc-card-title">{camp.title}</h3>
                          <p className="text-xs text-ink-muted">
                            {camp.business_name} → <strong>{camp.organization_name}</strong>
                          </p>
                          <ProgressBar
                            value={camp.funded_amount_usd}
                            max={camp.required_amount_usd}
                            label={`$${camp.funded_amount_usd.toFixed(2)} of $${camp.required_amount_usd.toFixed(2)}`}
                            sublabel={isFunded ? "100% funded" : `$${gap.toFixed(2)} needed`}
                          />
                        </div>

                        {!isFunded ? (
                          <div className="flex justify-end border-t border-border-subtle pt-3">
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedCampaign(camp);
                                setModalOpen(true);
                              }}
                            >
                              <CreditCard className="h-4 w-4" />
                              Fund via PayPal
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card className="space-y-4">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-emerald" />
                <div>
                  <h2 className="sc-section-title">Transaction History</h2>
                  <p className="text-xs text-ink-muted">
                    Clear payment status across pending, completed, and failed transactions.
                  </p>
                </div>
              </div>

              <DataTable
                rows={transactions}
                columns={txnColumns}
                keyExtractor={(t) => t.id}
                caption="Sponsor funding transactions"
                emptyState={
                  <EmptyState
                    icon={Receipt}
                    title="No Transactions Recorded"
                    description="PayPal Sandbox contributions and delivery disbursements will appear here."
                  />
                }
              />
            </Card>

            <PayPalCheckoutModal
              campaign={selectedCampaign}
              open={modalOpen}
              onClose={() => setModalOpen(false)}
              onSuccess={() => void loadData()}
            />
          </>
        )}
      </AppShell>
    </RoleGuard>
  );
}
