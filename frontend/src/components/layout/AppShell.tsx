"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bot,
  Boxes,
  Building2,
  ChevronLeft,
  ChevronRight,
  HeartHandshake,
  LayoutDashboard,
  Leaf,
  LogOut,
  Menu,
  ShieldCheck,
  Truck,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import type { UserRole } from "@/lib/types";
import { Button } from "@/components/ui/primitives";

interface NavItem {
  label: string;
  shortLabel: string;
  href: string;
  roles: UserRole[];
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Donor Overview",
    shortLabel: "Overview",
    href: "/dashboard/business",
    roles: ["business", "admin"],
    icon: LayoutDashboard,
  },
  {
    label: "Inventory Manager",
    shortLabel: "Inventory",
    href: "/dashboard/business/inventory",
    roles: ["business", "admin"],
    icon: Boxes,
  },
  {
    label: "Recipient Hub",
    shortLabel: "Recipients",
    href: "/dashboard/organization",
    roles: ["organization", "admin"],
    icon: Building2,
  },
  {
    label: "Deliveries",
    shortLabel: "Deliveries",
    href: "/dashboard/delivery",
    roles: ["delivery_partner", "admin"],
    icon: Truck,
  },
  {
    label: "Sponsor Funding",
    shortLabel: "Funding",
    href: "/dashboard/sponsor",
    roles: ["sponsor", "admin"],
    icon: HeartHandshake,
  },
  {
    label: "Platform Governance",
    shortLabel: "Admin",
    href: "/dashboard/admin",
    roles: ["admin"],
    icon: ShieldCheck,
  },
  {
    label: "AI Assistant",
    shortLabel: "AI Agent",
    href: "/dashboard/agent",
    roles: ["business", "organization", "delivery_partner", "sponsor", "admin"],
    icon: Bot,
  },
];

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement | null>(null);
  const drawerTitleId = useId();

  useEffect(() => {
    const dlg = drawerRef.current;
    if (!dlg) return;
    if (drawerOpen && !dlg.open) {
      dlg.showModal();
    } else if (!drawerOpen && dlg.open) {
      dlg.close();
    }
  }, [drawerOpen]);

  const visibleNav = user
    ? NAV_ITEMS.filter((item) => item.roles.includes(user.role))
    : NAV_ITEMS;

  const mobileQuickNav = visibleNav.slice(0, 3);

  const handleSignOut = () => {
    setDrawerOpen(false);
    logout();
    router.push("/");
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-canvas text-ink">
      {/* Desktop Collapsible Left Sidebar */}
      <aside
        className={`hidden lg:flex lg:flex-col shrink-0 border-r border-border-subtle bg-white transition-[width] duration-200 ${
          sidebarCollapsed ? "lg:w-20" : "lg:w-64"
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-border-subtle px-4">
          <Link
            href="/"
            className={`flex items-center gap-2.5 overflow-hidden ${
              sidebarCollapsed ? "justify-center w-full" : ""
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-forest text-white">
              <Leaf className="h-5 w-5 text-mint" />
            </span>
            {!sidebarCollapsed ? (
              <span className="truncate text-sm font-bold tracking-tight text-forest">
                SurplusConnect AI
              </span>
            ) : null}
          </Link>
          {!sidebarCollapsed ? (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Collapse sidebar"
              className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-muted hover:text-forest cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <nav aria-label="Workspace Navigation" className="flex-1 p-3 space-y-1">
          {sidebarCollapsed ? (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expand sidebar"
              className="mb-2 flex w-full items-center justify-center rounded-xl p-2 text-ink-muted hover:bg-surface-muted hover:text-forest cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <div className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Navigation
            </div>
          )}

          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={sidebarCollapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  sidebarCollapsed ? "justify-center" : ""
                } ${
                  active
                    ? "bg-forest text-white shadow-xs"
                    : "text-ink-muted hover:bg-mint-soft/70 hover:text-forest"
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? "text-mint" : "text-emerald"
                  }`}
                />
                {!sidebarCollapsed ? (
                  <span className="truncate">{item.label}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border-subtle p-3 space-y-2">
          {!sidebarCollapsed && user ? (
            <div className="rounded-xl bg-surface-muted/70 px-3 py-2.5">
              <div className="truncate text-xs font-semibold text-forest">
                {user.organization_name}
              </div>
              <div className="truncate text-[11px] text-ink-muted capitalize">
                {user.role.replace("_", " ")} • {user.full_name}
              </div>
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            className="w-full"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
            {!sidebarCollapsed ? <span>Sign Out</span> : null}
          </Button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact Top Bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border-subtle bg-white/95 px-4 backdrop-blur-xs sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle text-forest hover:bg-surface-muted cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link href="/" className="flex items-center gap-2 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-forest text-white">
                <Leaf className="h-4 w-4 text-mint" />
              </span>
              <span className="text-sm font-bold text-forest truncate">
                SurplusConnect AI
              </span>
            </Link>
            <div className="hidden lg:block min-w-0">
              <div className="text-xs font-medium text-ink-muted truncate">
                {user ? user.organization_name : "SurplusConnect AI"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-2.5">
                <div className="hidden sm:block text-right">
                  <div className="text-xs font-semibold text-forest">
                    {user.full_name}
                  </div>
                  <div className="text-[11px] text-ink-muted capitalize">
                    {user.role.replace("_", " ")}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSignOut}
                  className="lg:hidden"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Sign Out</span>
                </Button>
              </div>
            ) : (
              <Link href="/">
                <Button size="sm">Sign In</Button>
              </Link>
            )}
          </div>
        </header>

        {/* Main Content Container */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:pb-10 space-y-6">
          <div className="flex flex-col gap-4 border-b border-border-subtle pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="sc-page-title">{title}</h1>
              {subtitle ? (
                <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">
                  {subtitle}
                </p>
              ) : null}
            </div>
            {actions ? (
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                {actions}
              </div>
            ) : null}
          </div>

          {children}
        </main>

        <footer className="hidden lg:block border-t border-border-subtle bg-white/70">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-4 text-xs text-ink-muted">
            <span>
              <strong className="text-forest">SurplusConnect AI</strong> — Intelligent
              surplus redistribution platform.
            </span>
            <span>Food safety &amp; logistics oversight active</span>
          </div>
        </footer>
      </div>

      {/* Mobile Native <dialog> Navigation Drawer */}
      <dialog
        ref={drawerRef}
        aria-labelledby={drawerTitleId}
        onClose={() => setDrawerOpen(false)}
        onClick={(e) => {
          if (e.target === drawerRef.current) {
            setDrawerOpen(false);
          }
        }}
        className="sc-drawer"
      >
        <div className="flex h-full flex-col justify-between p-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-forest text-white">
                  <Leaf className="h-5 w-5 text-mint" />
                </span>
                <div>
                  <h2 id={drawerTitleId} className="text-sm font-bold text-forest">
                    SurplusConnect AI
                  </h2>
                  {user ? (
                    <p className="text-[11px] text-ink-muted truncate max-w-44">
                      {user.organization_name}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-2 text-ink-muted hover:bg-surface-muted hover:text-forest cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav aria-label="Mobile Navigation" className="space-y-1">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-forest text-white"
                        : "text-ink-muted hover:bg-mint-soft/70 hover:text-forest"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
              <Link
                href="/"
                onClick={() => setDrawerOpen(false)}
                className="flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-ink-muted hover:bg-mint-soft/70 hover:text-forest"
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                <span>Switch Portal Role</span>
              </Link>
            </nav>
          </div>

          <div className="border-t border-border-subtle pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleSignOut}
              className="w-full"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </Button>
          </div>
        </div>
      </dialog>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Quick Mobile Navigation"
        className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-white/95 backdrop-blur-xs px-2 py-1.5"
      >
        <div className="mx-auto flex max-w-md items-center justify-around gap-1">
          {mobileQuickNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors ${
                  active ? "text-forest bg-mint-soft/80" : "text-ink-muted"
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? "text-emerald" : ""}`} />
                <span className="truncate">{item.shortLabel}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium text-ink-muted hover:text-forest cursor-pointer"
          >
            <Menu className="h-4 w-4" />
            <span>Menu</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
