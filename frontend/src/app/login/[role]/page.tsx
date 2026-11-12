import { notFound } from "next/navigation";
import { ROLE_PORTAL_BY_SLUG, type RoleSlug } from "@/lib/roles";
import { RoleLoginForm } from "@/components/auth/RoleLoginForm";

const VALID_SLUGS: RoleSlug[] = [
  "business",
  "organization",
  "delivery",
  "sponsor",
  "admin",
];

export function generateStaticParams() {
  return VALID_SLUGS.map((role) => ({ role }));
}

export default async function RoleLoginPage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role } = await params;
  if (!VALID_SLUGS.includes(role as RoleSlug)) {
    notFound();
  }
  const portal = ROLE_PORTAL_BY_SLUG[role as RoleSlug];
  return <RoleLoginForm portal={portal} />;
}
