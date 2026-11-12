"use client";

import React, { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { useAuth, ROLE_DASHBOARD_PATH } from "@/lib/auth-context";
import type { UserRole } from "@/lib/types";
import { Button, Card } from "@/components/ui/primitives";

function resolveLoginRouteForPath(pathname: string | null): string {
  if (!pathname) return "/";
  if (pathname.startsWith("/dashboard/business")) return "/login/business";
  if (pathname.startsWith("/dashboard/organization")) return "/login/organization";
  if (pathname.startsWith("/dashboard/delivery")) return "/login/delivery";
  if (pathname.startsWith("/dashboard/sponsor")) return "/login/sponsor";
  if (pathname.startsWith("/dashboard/admin")) return "/login/admin";
  return "/";
}

export function RoleGuard({
  allowedRoles,
  children,
}: {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(resolveLoginRouteForPath(pathname));
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas text-forest font-semibold">
        Verifying workspace session...
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!allowedRoles.includes(user.role) && user.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas p-6">
        <Card className="max-w-md text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-bg text-amber-safe">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold text-forest">
            Role Access Restricted
          </h2>
          <p className="text-sm text-ink-muted">
            Your account is authorized for the{" "}
            <strong className="text-forest">{user.role.replace("_", " ")}</strong>{" "}
            workspace and does not have permission to view this portal.
          </p>
          <div className="flex justify-center gap-3">
            <Link href={ROLE_DASHBOARD_PATH[user.role]}>
              <Button>Go to My Dashboard</Button>
            </Link>
            <Link href="/">
              <Button variant="outline">Role Selection</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
