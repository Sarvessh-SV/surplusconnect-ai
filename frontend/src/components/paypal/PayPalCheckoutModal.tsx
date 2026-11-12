"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { FundingCampaign } from "@/lib/types";
import { Button, ProgressBar, StatusIndicator } from "@/components/ui/primitives";
import { ModalDialog } from "@/components/ui/ModalDialog";

interface PayPalCheckoutModalProps {
  campaign: FundingCampaign | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function PayPalCheckoutModal({
  campaign,
  open,
  onClose,
  onSuccess,
}: PayPalCheckoutModalProps) {
  const remaining = campaign
    ? Math.max(
        0,
        Number(
          (
            campaign.required_amount_usd - (campaign.funded_amount_usd || 0)
          ).toFixed(2)
        )
      )
    : 0;

  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("Contribution for surplus delivery");
  const [orderId, setOrderId] = useState<string>("");
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [capturedMsg, setCapturedMsg] = useState<string | null>(null);

  if (!campaign) return null;

  const effectiveAmount = amount ? Number(amount) : remaining;

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setCapturedMsg(null);
    setBusy(true);
    try {
      const origin =
        typeof window !== "undefined"
          ? window.location.origin
          : "http://localhost:3000";
      const res = await api.createPayPalOrder({
        campaign_id: campaign.id,
        amount_usd: effectiveAmount,
        return_url: `${origin}/dashboard/sponsor?campaign_id=${campaign.id}&paypal_status=approved`,
        cancel_url: `${origin}/dashboard/sponsor?campaign_id=${campaign.id}&paypal_status=cancelled`,
        contributor_note: note,
      });
      setOrderId(res.order_id);
      setApprovalUrl(res.approval_url);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Unable to start PayPal payment. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCaptureOrder = async () => {
    if (!orderId) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await api.capturePayPalOrder({
        order_id: orderId,
        campaign_id: campaign.id,
      });
      setCapturedMsg(
        `Payment of $${res.transaction.amount_usd.toFixed(2)} USD completed. Delivery funding is now updated.`
      );
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Unable to complete payment confirmation.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={() => {
        setOrderId("");
        setApprovalUrl(null);
        setErrorMsg(null);
        setCapturedMsg(null);
        onClose();
      }}
      title="Fund Delivery with PayPal"
      subtitle={campaign.organization_name}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-border-subtle bg-canvas p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-forest">
              {campaign.title}
            </span>
            <StatusIndicator
              label={campaign.status === "funded" ? "Funded" : "Open"}
              tone={campaign.status === "funded" ? "success" : "warning"}
            />
          </div>
          <div className="text-xs text-ink-muted">
            {campaign.business_name} • {campaign.allocated_kg} kg • {campaign.distance_km} km
          </div>
          <ProgressBar
            value={campaign.funded_amount_usd}
            max={campaign.required_amount_usd}
            label={`$${campaign.funded_amount_usd.toFixed(2)} funded of $${campaign.required_amount_usd.toFixed(2)} USD`}
          />
        </div>

        {errorMsg ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-danger-bg px-3.5 py-3 text-xs text-danger"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>{errorMsg}</div>
          </div>
        ) : null}

        {capturedMsg ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald/30 bg-mint-soft px-3.5 py-3 text-xs text-forest">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald" />
            <div>{capturedMsg}</div>
          </div>
        ) : null}

        {!orderId ? (
          <form onSubmit={handleCreateOrder} className="space-y-4">
            <div>
              <label
                htmlFor="pp-amount"
                className="block text-xs font-semibold text-forest mb-1.5"
              >
                Contribution Amount (USD) — Remaining ${remaining.toFixed(2)}
              </label>
              <input
                id="pp-amount"
                type="number"
                step="0.01"
                min="0.51"
                max={remaining > 0 ? remaining : 25000}
                required
                value={amount || String(remaining)}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink"
              />
            </div>

            <div>
              <label
                htmlFor="pp-note"
                className="block text-xs font-semibold text-forest mb-1.5"
              >
                Optional Note
              </label>
              <input
                id="pp-note"
                type="text"
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink"
              />
            </div>

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                <ShieldCheck className="h-4 w-4 text-emerald shrink-0" />
                <span>Processed via PayPal Sandbox</span>
              </div>
              <Button type="submit" disabled={busy || remaining <= 0}>
                <CreditCard className="h-4 w-4" />
                {busy ? "Preparing Payment..." : "Continue to PayPal"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 rounded-xl border border-border-subtle bg-white p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-forest">Payment Ready</span>
              <StatusIndicator label="Pending Approval" tone="warning" />
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              Approve the contribution in the PayPal window, then confirm payment below to update the campaign.
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              {approvalUrl ? (
                <a
                  href={approvalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border-subtle bg-mint-soft px-4 py-2 text-xs font-semibold text-forest hover:bg-mint transition-colors"
                >
                  Open PayPal Approval
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
              <Button
                variant="secondary"
                disabled={busy}
                onClick={handleCaptureOrder}
              >
                {busy ? "Confirming..." : "Confirm Payment"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
