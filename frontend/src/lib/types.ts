export type UserRole =
  | "business"
  | "organization"
  | "delivery_partner"
  | "sponsor"
  | "admin";

export type StorageType = "ambient" | "dry_bulk" | "refrigerated" | "frozen";

export type FoodCategory =
  | "bakery"
  | "produce"
  | "dairy"
  | "prepared_meals"
  | "groceries"
  | "frozen_goods"
  | "beverages";

export interface GeoPoint {
  lat: number;
  lng: number;
  address: string;
  city: string;
}

export interface UserPublic {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  organization_name: string;
  phone?: string | null;
  service_area?: string | null;
  verified: boolean;
  location: GeoPoint;
  business_type?: string | null;
  organization_type?: string | null;
  storage_capabilities: StorageType[];
  daily_capacity_kg?: number | null;
  vehicle_type?: string | null;
  vehicle_capacity_kg?: number | null;
  cold_chain_certified?: boolean | null;
  paypal_payout_email?: string | null;
  is_demo_seed?: boolean;
}

export interface StorageHub {
  id: string;
  name: string;
  location: GeoPoint;
  supported_storage: StorageType[];
  available_capacity_kg: number;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: UserPublic;
}

export interface HealthResponse {
  status: string;
  service: string;
  database_mode: string;
  database_error?: string | null;
  integrations: {
    mongodb_atlas: boolean;
    gemini_api: boolean;
    gemini_model: string;
    google_maps: boolean;
    paypal_sandbox: boolean;
  };
}

export interface SurplusAnalysis {
  is_eligible: boolean;
  safety_status: string;
  requires_safety_approval: boolean;
  surplus_probability: number;
  spoilage_urgency_score: number;
  hours_until_expiry: number;
  recommended_rescue_window_hours: number;
  quality_risk_flags: string[];
  storage_validation_notes: string;
  ai_explanation: string;
  ai_provider: string;
}

export interface InventoryLot {
  id: string;
  business_id: string;
  business_name: string;
  pickup_location: GeoPoint;
  title: string;
  description: string;
  category: FoodCategory;
  quantity_kg: number;
  servings_estimate: number;
  unit_label: string;
  storage_requirement: StorageType;
  prepared_at?: string | null;
  expires_at: string;
  pickup_window_start?: string | null;
  pickup_window_end?: string | null;
  packaging_type: string;
  allergens: string[];
  handling_notes?: string | null;
  estimated_retail_value_usd: number;
  historical_daily_turnover_kg: number;
  status: string;
  fallback_activated: boolean;
  expanded_radius_km: number;
  analysis?: SurplusAnalysis | null;
  is_demo_seed?: boolean;
  created_at: string;
}

export interface RouteInfo {
  distance_km: number;
  duration_minutes: number;
  encoded_polyline?: string | null;
  polyline_points?: Array<{ lat: number; lng: number }>;
  traffic_advisory?: string;
  route_source: string;
  travel_mode?: string;
}

export interface RecommendedPartner {
  partner_id: string;
  partner_name: string;
  vehicle_type: string;
  vehicle_capacity_kg: number;
  cold_chain_certified: boolean;
  rating: number;
  paypal_payout_email?: string;
  score: number;
}

export interface CostBreakdown {
  base_dispatch_fee_usd: number;
  distance_fee_usd: number;
  weight_handling_fee_usd: number;
  cold_chain_surcharge_usd: number;
  fallback_hub_handling_usd: number;
  total_estimated_cost_usd: number;
  vehicle_class: string;
}

export interface AllocationRecord {
  id: string;
  inventory_id: string;
  inventory_title: string;
  category: FoodCategory;
  business_id: string;
  business_name: string;
  organization_id: string;
  organization_name: string;
  organization_type?: string;
  allocated_kg: number;
  servings_estimate: number;
  storage_requirement: StorageType;
  distance_km: number;
  match_score: number;
  urgency_score: number;
  is_fallback_match: boolean;
  fallback_tier: string;
  fallback_radius_km: number;
  match_rationale: string;
  pickup_location: GeoPoint;
  dropoff_location: GeoPoint;
  route?: RouteInfo | null;
  cost_breakdown?: CostBreakdown | null;
  recommended_partner?: RecommendedPartner | null;
  funding_plan?: {
    recommended_mode: string;
    self_funded_share_pct: number;
    sponsor_share_pct: number;
    rationale: string;
  } | null;
  status: string;
  selected_funding_mode?: string | null;
  created_at: string;
}

export interface FundingCampaign {
  id: string;
  allocation_id: string;
  inventory_id: string;
  title: string;
  business_name: string;
  organization_id: string;
  organization_name: string;
  funding_mode: "self_funded" | "sponsor_funded" | "shared_funding";
  required_amount_usd: number;
  self_funded_committed_usd: number;
  sponsor_target_usd?: number;
  sponsor_target_amount_usd?: number;
  funded_amount_usd: number;
  status: "open" | "funded" | "cancelled";
  distance_km: number;
  allocated_kg: number;
  urgency_score: number;
  is_fallback_match: boolean;
  is_demo_seed?: boolean;
  created_at: string;
}

export interface DeliveryRecord {
  id: string;
  allocation_id: string;
  inventory_id: string;
  inventory_title: string;
  business_name: string;
  organization_id: string;
  organization_name: string;
  partner_id?: string | null;
  partner_name?: string | null;
  partner_payout_email?: string | null;
  pickup_location: GeoPoint;
  dropoff_location: GeoPoint;
  allocated_kg: number;
  storage_requirement: StorageType;
  route?: RouteInfo | null;
  estimated_cost_usd: number;
  status: string;
  temperature_verified_c?: number | null;
  recipient_confirmation_name?: string | null;
  delivery_notes?: string | null;
  proof_reference?: string | null;
  payout_eligible: boolean;
  payout_status: string;
  paypal_payout_batch_id?: string | null;
  is_demo_seed?: boolean;
  created_at: string;
}

export interface ApprovalRequest {
  id: string;
  inventory_id: string;
  allocation_id?: string | null;
  all_allocation_ids?: string[];
  gate_type: string;
  title: string;
  summary: string;
  risk_flags: string[];
  estimated_financial_exposure_usd?: number;
  status: "pending" | "approved" | "rejected";
  resolved_at?: string | null;
  resolved_by_name?: string | null;
  reviewer_notes?: string | null;
  is_demo_seed?: boolean;
  created_at: string;
}

export interface AgentRun {
  id: string;
  inventory_id: string;
  inventory_title: string;
  triggered_by: string;
  node_trace: Array<{
    node: string;
    status: string;
    detail: string;
    timestamp: string;
  }>;
  safety_analysis: SurplusAnalysis;
  fallback_activated: boolean;
  expanded_radius_km: number;
  storage_hub_options: Array<{
    id?: string;
    hub_id?: string;
    name?: string;
    hub_name?: string;
    city?: string;
    distance_km: number;
    available_kg?: number;
    available_capacity_kg?: number;
    capabilities?: string[];
    supported_storage?: string[];
    location: GeoPoint;
  }>;
  future_matching_windows: Array<{
    window_label: string;
    starts_at?: string;
    window_start?: string;
    note?: string;
    recommendation?: string;
  }>;
  executive_summary: string;
  ai_provider: string;
  is_demo_seed?: boolean;
  created_at: string;
}

export interface DemandDayPoint {
  date: string;
  day_label: string;
  predicted_need_kg: number;
  confidence_low_kg: number;
  confidence_high_kg: number;
}

export interface OrganizationDemandForecast {
  organization_id: string;
  organization_name: string;
  organization_type: string;
  city: string;
  daily_capacity_kg: number;
  active_allocated_kg: number;
  remaining_capacity_kg: number;
  predicted_daily_demand_kg: number;
  urgency_score: number;
  model_name: string;
  location?: GeoPoint;
  storage_capabilities?: StorageType[];
  forecast_7d: DemandDayPoint[];
}

export interface ImpactMetricsBucket {
  completed_deliveries: number;
  rescued_kg: number;
  meals_equivalent: number;
  co2e_avoided_kg: number;
  funding_volume_usd: number;
}

export interface ImpactAnalyticsResponse {
  live_metrics: ImpactMetricsBucket;
  demo_seed_metrics: ImpactMetricsBucket;
  combined_metrics: ImpactMetricsBucket;
  registered_organizations: number;
  registered_businesses: number;
  active_inventory_lots: number;
  fallback_activations: number;
  category_breakdown: Array<{ category: string; quantity_kg: number }>;
}

export interface TransactionRecord {
  id: string;
  campaign_id?: string | null;
  allocation_id?: string | null;
  delivery_id?: string | null;
  type: string;
  payer_name?: string;
  recipient_email?: string;
  amount_usd: number;
  currency: string;
  payment_mode: string;
  paypal_order_id?: string | null;
  paypal_capture_id?: string | null;
  paypal_payout_batch_id?: string | null;
  status: string;
  contributor_note?: string | null;
  is_demo_seed?: boolean;
  created_at: string;
}

export interface GeocodeCandidate {
  display_name: string;
  lat: number;
  lng: number;
  address: string;
  city: string;
}

export interface RoadRouteResult {
  available: boolean;
  source: string;
  distance_km: number | null;
  duration_minutes: number | null;
  geometry: Array<{ lat: number; lng: number }>;
  reason?: string | null;
}

export interface NetworkMapMarker {
  id: string;
  label: string;
  role: "donor" | "recipient";
  kind: "donor" | "recipient" | "pending_recipient";
  quantity_kg: number;
  distance_km?: number | null;
  match_status: "matched" | "pending" | "unmatched";
  location: GeoPoint;
  is_current_user?: boolean;
}

export interface NetworkMapRoute {
  id: string;
  donor_id?: string | null;
  recipient_id?: string | null;
  donor_name?: string | null;
  recipient_name?: string | null;
  inventory_title?: string | null;
  allocated_kg: number;
  route_type: "confirmed" | "suggested";
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  encoded_polyline?: string | null;
  distance_km?: number | null;
  duration_minutes?: number | null;
  route_source?: string | null;
}

export interface NetworkMapData {
  markers: NetworkMapMarker[];
  routes: NetworkMapRoute[];
  missing_locations: Array<{ id: string; name: string; role: string }>;
  current_user_has_coordinates: boolean;
}


