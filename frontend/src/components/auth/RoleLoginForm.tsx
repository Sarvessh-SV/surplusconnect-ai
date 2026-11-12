"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Eye,
  EyeOff,
  HandCoins,
  HeartHandshake,
  Leaf,
  Lock,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { useAuth, ROLE_DASHBOARD_PATH } from "@/lib/auth-context";
import type { RolePortalMeta, RoleSlug } from "@/lib/roles";
import { Badge, Button, Card } from "@/components/ui/primitives";

const ROLE_ICONS: Record<RoleSlug, React.ComponentType<{ className?: string }>> = {
  business: Building2,
  organization: HeartHandshake,
  delivery: Truck,
  sponsor: HandCoins,
  admin: ShieldCheck,
};

export function RoleLoginForm({ portal }: { portal: RolePortalMeta }) {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const Icon = ROLE_ICONS[portal.slug];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password, portal.role);
      router.push(ROLE_DASHBOARD_PATH[user.role]);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : "Unable to sign in. Please verify your credentials and try again."
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
            <span className="text-base font-bold tracking-tight text-forest">
              SurplusConnect AI
            </span>
          </Link>

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-forest hover:text-emerald transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Role Selection</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <Card className="p-6 sm:p-8 space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-mint-soft text-forest border border-emerald/20">
                <Icon className="h-5 w-5 text-emerald" />
              </span>
              <Badge variant={portal.slug === "admin" ? "neutral" : "mint"}>
                {portal.title}
              </Badge>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-forest">
                Sign in as {portal.shortTitle}
              </h1>
              <p className="mt-1 text-sm text-ink-muted leading-relaxed">
                {portal.portalSubtitle}
              </p>
            </div>
          </div>

          {errorMsg ? (
            <div
              role="alert"
              aria-live="polite"
              className="rounded-xl border border-red-200 bg-danger-bg px-4 py-3 text-xs font-medium text-danger"
            >
              {errorMsg}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} method="POST" className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-bold text-forest mb-1.5"
              >
                Email Address
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="name@organization.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-bold text-forest"
                >
                  Password
                </label>
                <Link
                  href={`/forgot-password?role=${portal.slug}`}
                  className="text-xs font-semibold text-emerald hover:text-forest transition-colors"
                >
                  Forgot Password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="current-password"
                  placeholder="Enter your password"
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
              <Lock className="h-4 w-4" />
              {submitting ? "Verifying credentials..." : "Sign In"}
            </Button>
          </form>

          <div className="border-t border-border-subtle pt-4 text-center space-y-3">
            {portal.allowRegistration && portal.registerPath ? (
              <p className="text-xs text-ink-muted">
                New to SurplusConnect AI?{" "}
                <Link
                  href={portal.registerPath}
                  className="font-bold text-emerald hover:text-forest transition-colors"
                >
                  Create Account
                </Link>
              </p>
            ) : (
              <p className="text-xs text-ink-muted leading-relaxed">
                Administrator accounts are strictly provisioned by an authorized
                platform administrator and cannot be self-registered.
              </p>
            )}
            <div>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-forest hover:text-emerald transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to Role Selection</span>
              </Link>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
