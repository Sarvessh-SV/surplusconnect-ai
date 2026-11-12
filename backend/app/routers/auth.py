"""Authentication, role-validated login, registration, and password recovery endpoints."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    serialize_user,
    verify_password,
)
from app.config import get_settings
from app.database import db_manager, get_db
from app.models.schemas import (
    AuthResponse,
    ForgotPasswordRequest,
    LocationUpdateRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    UserPublic,
    UserRole,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest) -> AuthResponse:
    if payload.role == UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator accounts cannot be self-registered and must be provisioned by an existing administrator.",
        )

    db = get_db()
    existing = await db["users"].find_one({"email": payload.email.lower()})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    now = datetime.now(timezone.utc)
    user_id = f"user-{payload.role.value[:3]}-{uuid.uuid4().hex[:8]}"
    user_doc: Dict[str, Any] = {
        "id": user_id,
        "email": payload.email.lower(),
        "password_hash": hash_password(payload.password),
        "full_name": payload.full_name,
        "role": payload.role.value,
        "organization_name": payload.organization_name,
        "phone": payload.phone,
        "service_area": payload.service_area,
        "verified": True,
        "location": payload.location.model_dump(),
        "business_type": payload.business_type,
        "organization_type": payload.organization_type,
        "storage_capabilities": [s.value for s in payload.storage_capabilities],
        "daily_capacity_kg": payload.daily_capacity_kg,
        "urgency_bias": 0.75,
        "monthly_logistics_budget_usd": 180.0,
        "vehicle_type": payload.vehicle_type,
        "vehicle_capacity_kg": payload.vehicle_capacity_kg,
        "cold_chain_certified": payload.cold_chain_certified,
        "paypal_payout_email": payload.paypal_payout_email or payload.email.lower(),
        "rating": 4.8,
        "is_demo_seed": False,
        "created_at": now,
    }
    await db["users"].insert_one(dict(user_doc))
    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": user_id,
            "actor_role": payload.role.value,
            "action": "user_registered",
            "target_id": user_id,
            "details": f"Registered {payload.role.value}: {payload.organization_name}",
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()

    token = create_access_token(user_id, user_doc["email"], payload.role)
    return AuthResponse(access_token=token, user=serialize_user(user_doc))


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest) -> AuthResponse:
    db = get_db()
    user = await db["users"].find_one({"email": payload.email.lower()})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    if payload.expected_role is not None and user["role"] != payload.expected_role.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Role verification failed: this account is registered as "
                f"'{str(user['role']).replace('_', ' ')}', not '{payload.expected_role.value.replace('_', ' ')}'."
            ),
        )

    token = create_access_token(user["id"], user["email"], user["role"])
    return AuthResponse(access_token=token, user=serialize_user(user))


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest) -> Dict[str, Any]:
    """Initiates a secure password reset request with a time-limited token stored in DB."""
    db = get_db()
    email_norm = payload.email.lower()
    user = await db["users"].find_one({"email": email_norm})
    now = datetime.now(timezone.utc)
    if user:
        reset_token = secrets.token_urlsafe(32)
        await db["password_resets"].insert_one(
            {
                "id": f"reset-{uuid.uuid4().hex[:10]}",
                "user_id": user["id"],
                "email": email_norm,
                "token": reset_token,
                "used": False,
                "expires_at": now + timedelta(minutes=30),
                "created_at": now,
            }
        )
        await db["audit_logs"].insert_one(
            {
                "id": f"audit-{uuid.uuid4().hex[:10]}",
                "actor_id": user["id"],
                "actor_role": user["role"],
                "action": "password_reset_requested",
                "target_id": user["id"],
                "details": "Generated 30-minute password reset token.",
                "created_at": now,
            }
        )
        await db_manager.maybe_persist()

    return {
        "status": "accepted",
        "message": (
            "If an account exists for that email address, password reset instructions "
            "have been issued. Contact your workspace administrator if you need immediate access."
        ),
    }


@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest) -> Dict[str, Any]:
    """Completes a password reset using a valid, non-expired token."""
    db = get_db()
    record = await db["password_resets"].find_one({"token": payload.token, "used": False})
    if not record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or already used password reset token.",
        )

    expires_at = record["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password reset token has expired.",
        )

    now = datetime.now(timezone.utc)
    await db["users"].update_one(
        {"id": record["user_id"]},
        {"$set": {"password_hash": hash_password(payload.new_password), "updated_at": now}},
    )
    await db["password_resets"].update_one(
        {"id": record["id"]},
        {"$set": {"used": True, "used_at": now}},
    )
    await db_manager.maybe_persist()
    return {"status": "ok", "message": "Password updated successfully. You may now sign in."}


@router.get("/me", response_model=UserPublic)
async def get_me(current_user: Dict[str, Any] = Depends(get_current_user)) -> UserPublic:
    return serialize_user(current_user)


@router.patch("/location", response_model=UserPublic)
async def update_my_location(
    payload: LocationUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> UserPublic:
    """Persists verified map coordinates and street address for the signed-in user."""
    db = get_db()
    now = datetime.now(timezone.utc)
    new_location = {
        "lat": round(float(payload.lat), 6),
        "lng": round(float(payload.lng), 6),
        "address": payload.address.strip(),
        "city": payload.city.strip(),
    }

    await db["users"].update_one(
        {"id": current_user["id"]},
        {"$set": {"location": new_location, "location_verified": True, "updated_at": now}},
    )

    if current_user["role"] == UserRole.BUSINESS.value:
        await db["inventory_lots"].update_many(
            {"business_id": current_user["id"], "status": {"$nin": ["completed", "expired"]}},
            {"$set": {"pickup_location": new_location, "updated_at": now}},
        )
        await db["allocations"].update_many(
            {"business_id": current_user["id"], "status": {"$in": ["proposed", "accepted", "awaiting_safety_approval"]}},
            {"$set": {"pickup_location": new_location, "updated_at": now}},
        )
    elif current_user["role"] == UserRole.ORGANIZATION.value:
        await db["allocations"].update_many(
            {"organization_id": current_user["id"], "status": {"$in": ["proposed", "accepted", "awaiting_safety_approval"]}},
            {"$set": {"dropoff_location": new_location, "updated_at": now}},
        )
        await db["deliveries"].update_many(
            {"organization_id": current_user["id"], "status": {"$in": ["pending_funding", "ready_for_dispatch", "pickup_scheduled"]}},
            {"$set": {"dropoff_location": new_location, "updated_at": now}},
        )

    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": "location_updated",
            "target_id": current_user["id"],
            "details": f"Updated verified coordinates to {new_location['lat']}, {new_location['lng']} ({new_location['city']}).",
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()
    refreshed = await db["users"].find_one({"id": current_user["id"]})
    return serialize_user(refreshed or {**current_user, "location": new_location})


@router.get("/demo-accounts")
async def list_demo_accounts() -> Dict[str, Any]:
    """Development-only endpoint disabled in production and whenever dev seeding is off."""
    settings = get_settings()
    if not settings.is_dev_seed_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")

    from app.services.seed_service import DEMO_PASSWORD

    db = get_db()
    demo_users = await db["users"].find({"is_demo_seed": True}).to_list(length=50)
    personas: List[Dict[str, Any]] = []
    for u in demo_users:
        personas.append(
            {
                "id": u["id"],
                "email": u["email"],
                "role": u["role"],
                "full_name": u["full_name"],
                "organization_name": u["organization_name"],
                "city": (u.get("location") or {}).get("city", "San Francisco"),
                "demo_password": DEMO_PASSWORD,
            }
        )
    return {"demo_password": DEMO_PASSWORD, "accounts": personas}

