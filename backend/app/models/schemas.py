"""Pydantic v2 request, response, and domain schemas for SurplusConnect AI."""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class UserRole(str, Enum):
    BUSINESS = "business"
    ORGANIZATION = "organization"
    DELIVERY_PARTNER = "delivery_partner"
    SPONSOR = "sponsor"
    ADMIN = "admin"


class StorageType(str, Enum):
    AMBIENT = "ambient"
    DRY_BULK = "dry_bulk"
    REFRIGERATED = "refrigerated"
    FROZEN = "frozen"


class FoodCategory(str, Enum):
    BAKERY = "bakery"
    PRODUCE = "produce"
    DAIRY = "dairy"
    PREPARED_MEALS = "prepared_meals"
    GROCERIES = "groceries"
    FROZEN_GOODS = "frozen_goods"
    BEVERAGES = "beverages"


class InventoryStatus(str, Enum):
    LISTED = "listed"
    ANALYZED = "analyzed"
    MATCHED = "matched"
    PARTIALLY_ALLOCATED = "partially_allocated"
    AWAITING_APPROVAL = "awaiting_approval"
    DISPATCHED = "dispatched"
    COMPLETED = "completed"
    BLOCKED_UNSAFE = "blocked_unsafe"
    EXPIRED = "expired"


class AllocationStatus(str, Enum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    AWAITING_SAFETY_APPROVAL = "awaiting_safety_approval"
    CONFIRMED = "confirmed"
    IN_DELIVERY = "in_delivery"
    DELIVERED = "delivered"


class FundingMode(str, Enum):
    SELF_FUNDED = "self_funded"
    SPONSOR_FUNDED = "sponsor_funded"
    SHARED_FUNDING = "shared_funding"


class DeliveryStatus(str, Enum):
    PENDING_FUNDING = "pending_funding"
    READY_FOR_DISPATCH = "ready_for_dispatch"
    PICKUP_SCHEDULED = "pickup_scheduled"
    COLLECTED = "collected"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class GeoPoint(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    address: str = Field(..., min_length=3, max_length=300)
    city: str = Field(default="San Francisco", max_length=120)


# --- Authentication & Registration ---

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=2, max_length=120)
    role: UserRole
    organization_name: str = Field(..., min_length=2, max_length=160)
    phone: Optional[str] = Field(default=None, max_length=40)
    location: GeoPoint
    # Role-specific onboarding metadata
    business_type: Optional[str] = Field(default=None, max_length=80)
    organization_type: Optional[str] = Field(default=None, max_length=80)
    service_area: Optional[str] = Field(default=None, max_length=160)
    storage_capabilities: List[StorageType] = Field(
        default_factory=lambda: [StorageType.AMBIENT, StorageType.REFRIGERATED]
    )
    daily_capacity_kg: float = Field(default=120.0, ge=5.0, le=20000.0)
    vehicle_type: Optional[str] = Field(default="refrigerated_van", max_length=80)
    vehicle_capacity_kg: float = Field(default=350.0, ge=10.0, le=10000.0)
    cold_chain_certified: bool = False
    paypal_payout_email: Optional[EmailStr] = None

    @field_validator("role")
    @classmethod
    def disallow_self_admin_registration(cls, v: UserRole) -> UserRole:
        if v == UserRole.ADMIN:
            raise ValueError("Admin accounts cannot be self-registered; use verified platform provisioning.")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)
    expected_role: Optional[UserRole] = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=8, max_length=256)
    new_password: str = Field(..., min_length=8, max_length=128)


class AdminProvisionRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=2, max_length=120)
    organization_name: str = Field(default="SurplusConnect Governance", min_length=2, max_length=160)
    phone: Optional[str] = Field(default=None, max_length=40)


class StorageHubCreateRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=160)
    location: GeoPoint
    supported_storage: List[StorageType] = Field(default_factory=lambda: [StorageType.REFRIGERATED])
    available_capacity_kg: float = Field(..., gt=1.0, le=100000.0)


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    role: UserRole
    organization_name: str
    phone: Optional[str] = None
    service_area: Optional[str] = None
    verified: bool
    location: GeoPoint
    business_type: Optional[str] = None
    organization_type: Optional[str] = None
    storage_capabilities: List[StorageType] = Field(default_factory=list)
    daily_capacity_kg: Optional[float] = None
    vehicle_type: Optional[str] = None
    vehicle_capacity_kg: Optional[float] = None
    cold_chain_certified: Optional[bool] = None
    paypal_payout_email: Optional[str] = None
    is_demo_seed: bool = False


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


# --- Inventory & AI Surplus Detection ---

class InventoryCreateRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=160)
    description: str = Field(..., min_length=5, max_length=800)
    category: FoodCategory
    quantity_kg: float = Field(..., gt=0.1, le=25000.0)
    servings_estimate: Optional[int] = Field(default=None, ge=1, le=200000)
    unit_label: str = Field(default="kg", max_length=30)
    storage_requirement: StorageType
    prepared_at: Optional[datetime] = None
    expires_at: datetime
    pickup_window_start: Optional[datetime] = None
    pickup_window_end: Optional[datetime] = None
    packaging_type: str = Field(default="Sealed food-grade crates", max_length=120)
    allergens: List[str] = Field(default_factory=list)
    handling_notes: Optional[str] = Field(default=None, max_length=400)
    estimated_retail_value_usd: float = Field(default=150.0, ge=1.0, le=500000.0)
    historical_daily_turnover_kg: float = Field(default=80.0, gt=0.5, le=25000.0)
    auto_coordinate: bool = True

    @field_validator("expires_at")
    @classmethod
    def ensure_not_already_expired(cls, v: datetime) -> datetime:
        dt = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        if dt <= now:
            raise ValueError("Expired inventory cannot be listed for redistribution (expires_at must be in the future).")
        return dt

    @model_validator(mode="after")
    def validate_windows(self) -> "InventoryCreateRequest":
        exp = self.expires_at if self.expires_at.tzinfo else self.expires_at.replace(tzinfo=timezone.utc)
        if self.prepared_at:
            prep = self.prepared_at if self.prepared_at.tzinfo else self.prepared_at.replace(tzinfo=timezone.utc)
            if prep > exp:
                raise ValueError("prepared_at cannot be after expires_at.")
        if self.pickup_window_start and self.pickup_window_end:
            p_start = (
                self.pickup_window_start
                if self.pickup_window_start.tzinfo
                else self.pickup_window_start.replace(tzinfo=timezone.utc)
            )
            p_end = (
                self.pickup_window_end
                if self.pickup_window_end.tzinfo
                else self.pickup_window_end.replace(tzinfo=timezone.utc)
            )
            if p_end <= p_start:
                raise ValueError("pickup_window_end must be after pickup_window_start.")
            if p_end > exp:
                raise ValueError("pickup_window_end cannot exceed item expires_at.")
        return self


class InventoryUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=160)
    description: Optional[str] = Field(default=None, min_length=5, max_length=800)
    category: Optional[FoodCategory] = None
    quantity_kg: Optional[float] = Field(default=None, gt=0.1, le=25000.0)
    storage_requirement: Optional[StorageType] = None
    expires_at: Optional[datetime] = None
    packaging_type: Optional[str] = Field(default=None, max_length=120)
    allergens: Optional[List[str]] = None
    handling_notes: Optional[str] = Field(default=None, max_length=400)
    estimated_retail_value_usd: Optional[float] = Field(default=None, ge=1.0, le=500000.0)

    @field_validator("expires_at")
    @classmethod
    def ensure_updated_expiry_future(cls, v: Optional[datetime]) -> Optional[datetime]:
        if v is None:
            return None
        dt = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        if dt <= datetime.now(timezone.utc):
            raise ValueError("Updated expiry time must be in the future.")
        return dt


class SurplusAnalysisResult(BaseModel):
    is_eligible: bool
    safety_status: str  # "safe" | "requires_human_review" | "blocked_expired" | "blocked_unsafe"
    requires_safety_approval: bool
    surplus_probability: float
    spoilage_urgency_score: float
    hours_until_expiry: float
    recommended_rescue_window_hours: float
    quality_risk_flags: List[str] = Field(default_factory=list)
    storage_validation_notes: str
    ai_explanation: str
    ai_provider: str


# --- Matching, Multi-Split & Intelligent Fallback ---

class MatchingRequest(BaseModel):
    primary_radius_km: float = Field(default=10.0, ge=1.0, le=100.0)
    allow_split_allocation: bool = True
    activate_fallback_if_needed: bool = True
    max_fallback_radius_km: float = Field(default=75.0, ge=10.0, le=250.0)


class OrganizationResponseRequest(BaseModel):
    action: str = Field(..., pattern="^(accept|decline)$")
    funding_mode: FundingMode = FundingMode.SPONSOR_FUNDED
    self_funded_share_pct: float = Field(default=0.0, ge=0.0, le=100.0)
    notes: Optional[str] = Field(default=None, max_length=400)


# --- Logistics & Delivery ---

class DeliveryAssignmentRequest(BaseModel):
    allocation_id: str
    partner_id: Optional[str] = None
    travel_mode: str = Field(default="DRIVE", pattern="^(DRIVE|TWO_WHEELER|BICYCLE)$")


class DeliveryStatusUpdateRequest(BaseModel):
    status: DeliveryStatus
    temperature_verified_c: Optional[float] = Field(default=None, ge=-30.0, le=45.0)
    recipient_confirmation_name: Optional[str] = Field(default=None, max_length=120)
    delivery_notes: Optional[str] = Field(default=None, max_length=500)
    proof_reference: Optional[str] = Field(default=None, max_length=250)


# --- Funding & PayPal Sandbox ---

class FundingPlanUpdateRequest(BaseModel):
    funding_mode: FundingMode
    self_funded_amount_usd: Optional[float] = Field(default=None, ge=0.0, le=50000.0)
    sponsor_target_amount_usd: Optional[float] = Field(default=None, ge=0.0, le=50000.0)


class PayPalOrderCreateRequest(BaseModel):
    campaign_id: str
    amount_usd: float = Field(..., gt=0.5, le=25000.0)
    return_url: Optional[str] = None
    cancel_url: Optional[str] = None
    contributor_note: Optional[str] = Field(default=None, max_length=300)


class PayPalOrderCaptureRequest(BaseModel):
    order_id: str
    campaign_id: str


class PayPalPayoutRequest(BaseModel):
    delivery_id: str
    note: Optional[str] = Field(default=None, max_length=300)


# --- Autonomous Agent & Human Approval Gates ---

class AgentCoordinationRequest(BaseModel):
    inventory_id: Optional[str] = None
    instruction: Optional[str] = Field(default=None, max_length=1000)
    primary_radius_km: float = Field(default=10.0, ge=1.0, le=100.0)
    max_fallback_radius_km: float = Field(default=75.0, ge=10.0, le=250.0)
    preferred_funding_mode: Optional[FundingMode] = None


class ApprovalDecisionRequest(BaseModel):
    decision: str = Field(..., pattern="^(approve|reject)$")
    reviewer_notes: str = Field(..., min_length=3, max_length=500)


class AdminUserVerifyRequest(BaseModel):
    verified: bool
    notes: Optional[str] = Field(default=None, max_length=300)


class LocationUpdateRequest(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    address: str = Field(..., min_length=3, max_length=300)
    city: str = Field(..., min_length=2, max_length=120)

    @model_validator(mode="after")
    def reject_null_island(self) -> "LocationUpdateRequest":
        if abs(self.lat) < 0.0001 and abs(self.lng) < 0.0001:
            raise ValueError("Please select a valid geographical location on the map.")
        return self


class RoadRouteRequest(BaseModel):
    origin_lat: float = Field(..., ge=-90.0, le=90.0)
    origin_lng: float = Field(..., ge=-180.0, le=180.0)
    dest_lat: float = Field(..., ge=-90.0, le=90.0)
    dest_lng: float = Field(..., ge=-180.0, le=180.0)
    profile: str = Field(default="driving", pattern="^(driving|cycling|walking)$")


