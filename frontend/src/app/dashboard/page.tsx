"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, ROLE_DASHBOARD_PATH } from "@/lib/auth-context";

export default function DashboardRedirectPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/");
    } else {
      router.replace(ROLE_DASHBOARD_PATH[user.role]);
    }
  }, [user, loading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas text-sm font-semibold text-forest">
      Routing to role workspace...
    </div>
  );
}

