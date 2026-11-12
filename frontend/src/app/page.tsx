"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  HandCoins,
  HeartHandshake,
  Leaf,
  LogOut,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { useAuth, ROLE_DASHBOARD_PATH } from "@/lib/auth-context";
import { ROLE_PORTALS, type RoleSlug } from "@/lib/roles";
import { Badge, Button, Card } from "@/components/ui/primitives";

const ROLE_ICONS: Record<RoleSlug, React.ComponentType<{ className?: string }>> = {
  business: Building2,
  organization: HeartHandshake,
  delivery: Truck,
  sponsor: HandCoins,
  admin: ShieldCheck,
};

export default function RoleSelectionLandingPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-20 border-b border-border-subtle bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-forest text-white shadow-xs">
              <Leaf className="h-5 w-5 text-mint" />
            </span>
            <div>
              <span className="block text-base font-bold tracking-tight text-forest">
                SurplusConnect AI
              </span>
              <span className="block text-[11px] font-medium text-ink-muted">
                Intelligent Surplus Redistribution &amp; Resource Coordination
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2.5">
            {user ? (
              <>
                <Link href={ROLE_DASHBOARD_PATH[user.role]}>
                  <Button size="sm">
                    Open Workspace <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={logout}
                  aria-label="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Sign Out</span>
                </Button>
              </>
            ) : (
              <Link href="/register">
                <Button variant="outline" size="sm">
                  Create Account
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-12 sm:px-6 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mx-auto max-w-2xl text-center space-y-4"
        >
          <Badge variant="mint">SurplusConnect AI Platform</Badge>
          <h1 className="text-3xl font-extrabold tracking-tight text-forest sm:text-5xl">
            Welcome to SurplusConnect
          </h1>
          <p className="text-base text-ink-muted sm:text-lg leading-relaxed">
            Connecting surplus resources with organizations that need them.
            Smarter redistribution. Measurable impact.
          </p>
        </motion.div>

        <section
          aria-label="Select your platform role"
          className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {ROLE_PORTALS.map((portal, index) => {
            const Icon = ROLE_ICONS[portal.slug];
            return (
              <motion.div
                key={portal.slug}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: index * 0.04 }}
                whileHover={{ y: -3 }}
                className="flex"
              >
                <Card className="flex w-full flex-col justify-between gap-6 p-6 transition-all duration-200 hover:border-emerald hover:shadow-[0_10px_28px_-8px_rgba(15,61,46,0.14)]">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-mint-soft text-forest border border-emerald/20">
                        <Icon className="h-6 w-6 text-emerald" />
                      </span>
                      {portal.slug === "admin" ? (
                        <Badge variant="neutral">Restricted Access</Badge>
                      ) : null}
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-forest">
                        {portal.title}
                      </h2>
                      <p className="mt-1.5 text-sm text-ink-muted leading-relaxed">
                        {portal.description}
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border-subtle/70">
                    <Link href={portal.loginPath} className="block">
                      <Button className="w-full justify-between" variant="primary">
                        <span>Continue</span>
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </section>
      </main>

      <footer className="border-t border-border-subtle bg-white/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-ink-muted sm:px-6">
          <span>
            <strong className="text-forest">SurplusConnect AI</strong> — An
            intelligent surplus redistribution and resource coordination platform.
          </span>
          <span>Role-Based Access Control • AI Logistics &amp; PayPal Settlement</span>
        </div>
      </footer>
    </div>
  );
}
