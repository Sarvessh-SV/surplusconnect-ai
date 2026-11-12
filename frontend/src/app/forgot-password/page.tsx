"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, KeyRound, Leaf, Mail } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { ROLE_PORTAL_BY_SLUG, type RoleSlug } from "@/lib/roles";
import { Button, Card } from "@/components/ui/primitives";

function ForgotPasswordContent() {
  const searchParams = useSearchParams();
  const roleParam = searchParams.get("role") as RoleSlug | null;
  const backLoginPath =
    roleParam && roleParam in ROLE_PORTAL_BY_SLUG
      ? ROLE_PORTAL_BY_SLUG[roleParam].loginPath
      : "/";

  const [mode, setMode] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setSubmitting(true);
    try {
      const res = await api.forgotPassword(email.trim());
      setStatusMsg(res.message);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : "Unable to process request."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setSubmitting(true);
    try {
      const res = await api.resetPassword(token.trim(), newPassword);
      setStatusMsg(res.message);
      setToken("");
      setNewPassword("");
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : "Unable to reset password."
      );
    } finally {
      setSubmitting(false);
    }
  };

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
            href={backLoginPath}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-forest hover:text-emerald"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Sign In</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <Card className="p-6 sm:p-8 space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-forest">
              Account Password Recovery
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              Request a password reset or apply a recovery token issued for your account.
            </p>
          </div>

          <div className="flex rounded-xl border border-border-subtle bg-surface-muted/60 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode("request");
                setErrorMsg(null);
                setStatusMsg(null);
              }}
              className={`flex-1 rounded-lg py-2 transition-colors cursor-pointer ${
                mode === "request"
                  ? "bg-forest text-white shadow-xs"
                  : "text-ink-muted hover:text-forest"
              }`}
            >
              Request Reset
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("reset");
                setErrorMsg(null);
                setStatusMsg(null);
              }}
              className={`flex-1 rounded-lg py-2 transition-colors cursor-pointer ${
                mode === "reset"
                  ? "bg-forest text-white shadow-xs"
                  : "text-ink-muted hover:text-forest"
              }`}
            >
              Enter Reset Token
            </button>
          </div>

          {errorMsg ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-danger-bg px-4 py-3 text-xs font-medium text-danger"
            >
              {errorMsg}
            </div>
          ) : null}

          {statusMsg ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-emerald/30 bg-mint-soft px-4 py-3 text-xs font-medium text-forest"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald shrink-0 mt-0.5" />
              <span>{statusMsg}</span>
            </div>
          ) : null}

          {mode === "request" ? (
            <form onSubmit={handleRequestReset} method="POST" className="space-y-4">
              <div>
                <label
                  htmlFor="fp-email"
                  className="block text-xs font-bold text-forest mb-1.5"
                >
                  Registered Email Address
                </label>
                <input
                  id="fp-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@organization.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                <Mail className="h-4 w-4" />
                {submitting ? "Submitting..." : "Send Reset Instructions"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleConfirmReset} method="POST" className="space-y-4">
              <div>
                <label
                  htmlFor="fp-token"
                  className="block text-xs font-bold text-forest mb-1.5"
                >
                  Recovery Token
                </label>
                <input
                  id="fp-token"
                  name="token"
                  type="text"
                  required
                  placeholder="Paste recovery token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm font-mono text-ink focus:border-emerald focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="fp-pw"
                  className="block text-xs font-bold text-forest mb-1.5"
                >
                  New Password (min 8 characters)
                </label>
                <input
                  id="fp-pw"
                  name="new_password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Choose a new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                <KeyRound className="h-4 w-4" />
                {submitting ? "Updating..." : "Reset Password"}
              </Button>
            </form>
          )}

          <div className="border-t border-border-subtle pt-4 flex items-center justify-between text-xs">
            <Link
              href={backLoginPath}
              className="font-semibold text-forest hover:text-emerald"
            >
              Return to Sign In
            </Link>
            <Link
              href="/"
              className="font-semibold text-ink-muted hover:text-forest"
            >
              Role Selection
            </Link>
          </div>
        </Card>
      </main>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-canvas text-sm text-forest">
          Loading recovery workspace...
        </div>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  );
}
