"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Leaf } from "lucide-react";
import { useAuth, ROLE_DASHBOARD_PATH } from "@/lib/auth-context";
import { ROLE_PORTALS } from "@/lib/roles";
import { Button, Card } from "@/components/ui/primitives";

export default function LoginIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace(ROLE_DASHBOARD_PATH[user.role]);
    }
  }, [loading, user, router]);

  return (
    <div className="min-h-screen bg-canvas px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-forest text-white">
            <Leaf className="h-5 w-5 text-mint" />
          </span>
          <span className="text-base font-bold text-forest">
            SurplusConnect AI
          </span>
        </Link>

        <Card className="p-6 sm:p-8 space-y-5">
          <div>
            <h1 className="sc-page-title">
              Choose Your Sign-In Portal
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              Select your organization role to open the dedicated authentication portal.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {ROLE_PORTALS.map((portal) => (
              <Link
                key={portal.slug}
                href={portal.loginPath}
                className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-muted/40 px-4 py-3.5 hover:border-emerald hover:bg-mint-soft/50 transition-colors"
              >
                <div className="min-w-0">
                  <div className="sc-card-title truncate">
                    {portal.title}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5 line-clamp-2">
                    {portal.description}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-emerald shrink-0" />
              </Link>
            ))}
          </div>

          <div className="pt-2">
            <Link href="/">
              <Button variant="outline" size="sm">
                Back to Role Selection
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
