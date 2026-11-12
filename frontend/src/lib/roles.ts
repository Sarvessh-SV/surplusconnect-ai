import type { UserRole } from "./types";

export type RoleSlug = "business" | "organization" | "delivery" | "sponsor" | "admin";

export interface RolePortalMeta {
  slug: RoleSlug;
  role: UserRole;
  title: string;
  shortTitle: string;
  description: string;
  portalSubtitle: string;
  allowRegistration: boolean;
  loginPath: string;
  registerPath: string | null;
  dashboardPath: string;
}

export const ROLE_PORTALS: RolePortalMeta[] = [
  {
    slug: "business",
    role: "business",
    title: "Business / Donor",
    shortTitle: "Business Donor",
    description: "List surplus inventory and connect with eligible organizations.",
    portalSubtitle:
      "Sign in to add surplus inventory, track expiry alerts, and review recipient matches.",
    allowRegistration: true,
    loginPath: "/login/business",
    registerPath: "/register?role=business",
    dashboardPath: "/dashboard/business",
  },
  {
    slug: "organization",
    role: "organization",
    title: "Recipient Organization",
    shortTitle: "Recipient Organization",
    description: "Discover and request available surplus resources.",
    portalSubtitle:
      "Sign in to review incoming donations, manage storage capacity, and confirm pickups.",
    allowRegistration: true,
    loginPath: "/login/organization",
    registerPath: "/register?role=organization",
    dashboardPath: "/dashboard/organization",
  },
  {
    slug: "delivery",
    role: "delivery_partner",
    title: "Delivery Partner",
    shortTitle: "Delivery Partner",
    description: "Manage collection and delivery assignments.",
    portalSubtitle:
      "Sign in to view pickup routes, update delivery status, and confirm dropoffs.",
    allowRegistration: true,
    loginPath: "/login/delivery",
    registerPath: "/register?role=delivery",
    dashboardPath: "/dashboard/delivery",
  },
  {
    slug: "sponsor",
    role: "sponsor",
    title: "Sponsor",
    shortTitle: "Sponsor",
    description: "Support redistribution through logistics funding.",
    portalSubtitle:
      "Sign in to browse open funding campaigns and contribute delivery support via PayPal.",
    allowRegistration: true,
    loginPath: "/login/sponsor",
    registerPath: "/register?role=sponsor",
    dashboardPath: "/dashboard/sponsor",
  },
  {
    slug: "admin",
    role: "admin",
    title: "Administrator",
    shortTitle: "Administrator",
    description: "Manage and oversee the platform.",
    portalSubtitle:
      "Sign in to review safety approvals, verify partner accounts, and manage payouts.",
    allowRegistration: false,
    loginPath: "/login/admin",
    registerPath: null,
    dashboardPath: "/dashboard/admin",
  },
];

export const ROLE_PORTAL_BY_SLUG: Record<RoleSlug, RolePortalMeta> = {
  business: ROLE_PORTALS[0],
  organization: ROLE_PORTALS[1],
  delivery: ROLE_PORTALS[2],
  sponsor: ROLE_PORTALS[3],
  admin: ROLE_PORTALS[4],
};

export const ROLE_PORTAL_BY_ROLE: Record<UserRole, RolePortalMeta> = {
  business: ROLE_PORTALS[0],
  organization: ROLE_PORTALS[1],
  delivery_partner: ROLE_PORTALS[2],
  sponsor: ROLE_PORTALS[3],
  admin: ROLE_PORTALS[4],
};
