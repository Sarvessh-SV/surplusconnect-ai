import type {
  AgentRun,
  AllocationRecord,
  ApprovalRequest,
  AuthResponse,
  DeliveryRecord,
  FundingCampaign,
  GeocodeCandidate,
  HealthResponse,
  ImpactAnalyticsResponse,
  InventoryLot,
  NetworkMapData,
  OrganizationDemandForecast,
  RoadRouteResult,
  StorageHub,
  StorageType,
  TransactionRecord,
  UserPublic,
  UserRole,
} from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

const TOKEN_STORAGE_KEY = "surplusconnect_jwt";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const { auth = true, headers = {}, ...rest } = options;
  const reqHeaders = new Headers(headers);
  if (!reqHeaders.has("Content-Type") && rest.body) {
    reqHeaders.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = getStoredToken();
    if (token) {
      reqHeaders.set("Authorization", `Bearer ${token}`);
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: reqHeaders,
      cache: "no-store",
    });
  } catch (err) {
    throw new ApiError(
      0,
      `Unable to reach SurplusConnect backend (${API_BASE}). Ensure FastAPI is running.`,
      err
    );
  }

  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { detail: text };
    }
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    const detail = parsed?.detail;
    if (typeof detail === "string") {
      msg = detail;
    } else if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      msg = first?.msg || JSON.stringify(detail);
    } else if (detail && typeof detail === "object") {
      const obj = detail as { message?: string; quality_risk_flags?: string[] };
      msg = obj.message || JSON.stringify(detail);
    }
    throw new ApiError(res.status, msg, detail);
  }

  return (parsed as unknown) as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health", { auth: false }),

  // Auth
  login: (email: string, password: string, expectedRole?: UserRole) =>
    request<AuthResponse>("/api/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({
        email,
        password,
        ...(expectedRole ? { expected_role: expectedRole } : {}),
      }),
    }),
  register: (payload: Record<string, unknown>) =>
    request<AuthResponse>("/api/auth/register", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  forgotPassword: (email: string) =>
    request<{ status: string; message: string }>("/api/auth/forgot-password", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, newPassword: string) =>
    request<{ status: string; message: string }>("/api/auth/reset-password", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ token, new_password: newPassword }),
    }),
  me: () => request<UserPublic>("/api/auth/me"),

  // Analytics
  impact: () =>
    request<ImpactAnalyticsResponse>("/api/analytics/impact", { auth: false }),

  // Inventory
  listInventory: (mineOnly = false) =>
    request<{ items: InventoryLot[]; total: number }>(
      `/api/inventory?mine_only=${mineOnly}`
    ),
  createInventory: (payload: Record<string, unknown>) =>
    request<{ lot: InventoryLot; coordination: Record<string, unknown> | null }>(
      "/api/inventory",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),
  analyzeInventory: (lotId: string) =>
    request<{ inventory_id: string; status: string; analysis: Record<string, unknown> }>(
      `/api/inventory/${lotId}/analyze`,
      { method: "POST" }
    ),
  getInventoryDetail: (lotId: string) =>
    request<{
      lot: InventoryLot;
      allocations: AllocationRecord[];
      agent_runs: AgentRun[];
    }>(`/api/inventory/${lotId}`),
  updateInventory: (lotId: string, payload: Record<string, unknown>) =>
    request<{ lot: InventoryLot }>(`/api/inventory/${lotId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteInventory: (lotId: string) =>
    request<{ deleted: boolean; id: string }>(`/api/inventory/${lotId}`, {
      method: "DELETE",
    }),

  // Matching & Fallback
  runMatching: (
    lotId: string,
    payload: {
      primary_radius_km?: number;
      allow_split_allocation?: boolean;
      activate_fallback_if_needed?: boolean;
      max_fallback_radius_km?: number;
    } = {}
  ) =>
    request<Record<string, unknown>>(`/api/matching/inventory/${lotId}/run`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listAllocations: () =>
    request<{ items: AllocationRecord[]; total: number }>("/api/matching/allocations"),
  respondAllocation: (
    allocationId: string,
    payload: {
      action: "accept" | "decline";
      funding_mode?: string;
      self_funded_share_pct?: number;
      notes?: string;
    }
  ) =>
    request<{
      allocation_id: string;
      status: string;
      campaign?: FundingCampaign;
      delivery?: DeliveryRecord;
    }>(`/api/matching/allocations/${allocationId}/respond`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Demand Intelligence
  getDemandIntelligence: (category = "prepared_meals") =>
    request<{
      model: string;
      category_evaluated: string;
      organizations: OrganizationDemandForecast[];
      regional_7d_forecast: Array<{
        date: string;
        day_label: string;
        total_predicted_need_kg: number;
        total_confidence_low_kg: number;
        total_confidence_high_kg: number;
      }>;
    }>(`/api/demand/intelligence?category=${encodeURIComponent(category)}`),
  submitDemandSignal: (payload: {
    category: string;
    daily_capacity_kg: number;
    urgency_bias: number;
  }) =>
    request<{ updated_forecast: OrganizationDemandForecast }>("/api/demand/signals", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Logistics & Routes
  listDeliveryPartners: () =>
    request<{ items: UserPublic[]; total: number }>("/api/logistics/partners"),
  listDeliveries: () =>
    request<{ items: DeliveryRecord[]; total: number }>("/api/logistics/deliveries"),
  assignDeliveryPartner: (payload: {
    allocation_id: string;
    partner_id?: string;
    travel_mode?: string;
  }) =>
    request<{ delivery: DeliveryRecord }>("/api/logistics/assign", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateDeliveryStatus: (
    deliveryId: string,
    payload: {
      status: string;
      temperature_verified_c?: number;
      recipient_confirmation_name?: string;
      delivery_notes?: string;
      proof_reference?: string;
    }
  ) =>
    request<{ delivery: DeliveryRecord }>(
      `/api/logistics/deliveries/${deliveryId}/status`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),
  updateLocation: (payload: {
    lat: number;
    lng: number;
    address: string;
    city: string;
  }) =>
    request<UserPublic>("/api/auth/location", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  geocodeAddress: (q: string) =>
    request<{ available: boolean; items: GeocodeCandidate[]; reason?: string | null }>(
      `/api/logistics/geocode?q=${encodeURIComponent(q)}`
    ),
  computeRoadRoute: (payload: {
    origin_lat: number;
    origin_lng: number;
    dest_lat: number;
    dest_lng: number;
    profile?: "driving" | "cycling" | "walking";
  }) =>
    request<RoadRouteResult>("/api/logistics/road-route", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  networkMap: () => request<NetworkMapData>("/api/logistics/network-map"),

  // Funding & PayPal Sandbox
  listCampaigns: () =>
    request<{ items: FundingCampaign[]; total: number }>("/api/funding/campaigns"),
  updateFundingPlan: (
    campaignId: string,
    payload: {
      funding_mode: string;
      self_funded_amount_usd?: number;
      sponsor_target_amount_usd?: number;
    }
  ) =>
    request<{ campaign: FundingCampaign }>(
      `/api/funding/campaigns/${campaignId}/plan`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    ),
  createPayPalOrder: (payload: {
    campaign_id: string;
    amount_usd: number;
    return_url?: string;
    cancel_url?: string;
    contributor_note?: string;
  }) =>
    request<{
      order_id: string;
      status: string;
      approval_url: string | null;
      environment: string;
    }>("/api/funding/paypal/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  capturePayPalOrder: (payload: { order_id: string; campaign_id: string }) =>
    request<{
      capture?: Record<string, unknown>;
      transaction: TransactionRecord;
      campaign: FundingCampaign;
    }>("/api/funding/paypal/orders/capture", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  triggerPayPalPayout: (payload: { delivery_id: string; note?: string }) =>
    request<{ payout: Record<string, unknown>; transaction: TransactionRecord }>(
      "/api/funding/paypal/payouts",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),
  listTransactions: () =>
    request<{ items: TransactionRecord[]; total: number }>("/api/funding/transactions"),

  // Agent & HITL
  coordinateAgent: (payload: {
    inventory_id: string;
    primary_radius_km?: number;
    max_fallback_radius_km?: number;
    preferred_funding_mode?: string;
  }) =>
    request<Record<string, unknown>>("/api/agent/coordinate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  chatAgent: (instruction: string) =>
    request<{
      answer: string;
      tool_calls: Array<{ name: string; args: Record<string, unknown>; result_preview: unknown }>;
      ai_provider: string;
      model: string;
    }>("/api/agent/chat", {
      method: "POST",
      body: JSON.stringify({ instruction }),
    }),
  listAgentRuns: () =>
    request<{ items: AgentRun[]; total: number }>("/api/agent/runs"),
  listApprovals: () =>
    request<{ items: ApprovalRequest[]; total: number }>("/api/agent/approvals"),
  resolveApproval: (
    approvalId: string,
    payload: { decision: "approve" | "reject"; reviewer_notes: string }
  ) =>
    request<{ approval: ApprovalRequest }>(
      `/api/agent/approvals/${approvalId}/decision`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  // Admin
  adminOverview: () =>
    request<{
      users: UserPublic[];
      approvals: ApprovalRequest[];
      deliveries: DeliveryRecord[];
      audit_logs: Array<{
        id: string;
        actor_role: string;
        action: string;
        target_id: string;
        details: string;
        created_at: string;
      }>;
      integrations: Record<string, unknown>;
    }>("/api/admin/overview"),
  verifyUser: (userId: string, payload: { verified: boolean; notes?: string }) =>
    request<{ user: UserPublic }>(`/api/admin/users/${userId}/verify`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  provisionAdmin: (payload: {
    email: string;
    password: string;
    full_name: string;
    organization_name: string;
    phone?: string;
  }) =>
    request<{ user: UserPublic }>("/api/admin/users/provision-admin", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listStorageHubs: () =>
    request<{ items: StorageHub[] }>("/api/admin/storage-hubs"),
  createStorageHub: (payload: {
    name: string;
    location: { lat: number; lng: number; address: string; city: string };
    supported_storage: StorageType[];
    available_capacity_kg: number;
  }) =>
    request<{ hub: StorageHub }>("/api/admin/storage-hubs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

