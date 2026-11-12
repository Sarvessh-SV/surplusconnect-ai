"""Admin governance, user verification, audit logs, and platform health endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import hash_password, require_roles, serialize_user
from app.config import get_settings
from app.database import db_manager, get_db
from app.models.schemas import (
    AdminProvisionRequest,
    AdminUserVerifyRequest,
    StorageHubCreateRequest,
    UserRole,
)

router = APIRouter(prefix="/api/admin", tags=["Admin & Governance"])


@router.get("/overview")
async def get_admin_overview(
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    settings = get_settings()
    users = await db["users"].find({}).sort("created_at", -1).to_list(length=300)
    approvals = await db["approval_requests"].find({}).sort("created_at", -1).to_list(length=100)
    audits = await db["audit_logs"].find({}).sort("created_at", -1).to_list(length=100)
    deliveries = await db["deliveries"].find({}).sort("created_at", -1).to_list(length=200)

    return {
        "users": [serialize_user(u).model_dump() for u in users],
        "approvals": [{k: v for k, v in a.items() if k != "_id"} for a in approvals],
        "deliveries": [{k: v for k, v in d.items() if k != "_id"} for d in deliveries],
        "audit_logs": [{k: v for k, v in l.items() if k != "_id"} for l in audits],
        "integrations": {
            "database_mode": db_manager.db_mode,
            "mongodb_atlas_configured": settings.has_mongodb_atlas,
            "gemini_configured": settings.has_gemini,
            "gemini_model": settings.GEMINI_MODEL,
            "google_maps_configured": settings.has_google_maps,
            "paypal_sandbox_configured": settings.has_paypal,
            "paypal_mode": settings.PAYPAL_MODE,
        },
    }


@router.post("/users/{user_id}/verify")
async def verify_or_suspend_user(
    user_id: str,
    payload: AdminUserVerifyRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    user = await db["users"].find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    now = datetime.now(timezone.utc)
    await db["users"].update_one(
        {"id": user_id},
        {"$set": {"verified": payload.verified, "verification_notes": payload.notes, "updated_at": now}},
    )
    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": "user_verification_updated",
            "target_id": user_id,
            "details": f"Set verified={payload.verified}. {payload.notes or ''}".strip(),
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()
    updated = await db["users"].find_one({"id": user_id})
    return {"user": serialize_user(updated or user).model_dump()}


@router.post("/users/provision-admin", status_code=status.HTTP_201_CREATED)
async def provision_admin_account(
    payload: AdminProvisionRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
) -> Dict[str, Any]:
    """Allows an authenticated administrator to provision another administrator account."""
    db = get_db()
    email_norm = payload.email.lower()
    if await db["users"].find_one({"email": email_norm}):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    now = datetime.now(timezone.utc)
    admin_id = f"user-adm-{uuid.uuid4().hex[:8]}"
    admin_doc: Dict[str, Any] = {
        "id": admin_id,
        "email": email_norm,
        "password_hash": hash_password(payload.password),
        "full_name": payload.full_name,
        "role": UserRole.ADMIN.value,
        "organization_name": payload.organization_name,
        "phone": payload.phone,
        "verified": True,
        "location": {
            "lat": 37.7749,
            "lng": -122.4194,
            "address": "Platform Operations",
            "city": "San Francisco",
        },
        "storage_capabilities": ["ambient", "dry_bulk", "refrigerated", "frozen"],
        "is_demo_seed": False,
        "created_at": now,
    }
    await db["users"].insert_one(dict(admin_doc))
    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": "admin_account_provisioned",
            "target_id": admin_id,
            "details": f"Provisioned administrator account: {email_norm}",
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()
    return {"user": serialize_user(admin_doc).model_dump()}


@router.get("/storage-hubs")
async def list_storage_hubs(
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
) -> Dict[str, Any]:
    db = get_db()
    hubs = await db["storage_hubs"].find({}).to_list(length=100)
    return {"items": [{k: v for k, v in h.items() if k != "_id"} for h in hubs]}


@router.post("/storage-hubs", status_code=status.HTTP_201_CREATED)
async def create_storage_hub(
    payload: StorageHubCreateRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
) -> Dict[str, Any]:
    """Registers a verified intermediate storage hub for fallback cold-chain staging."""
    db = get_db()
    now = datetime.now(timezone.utc)
    hub_doc: Dict[str, Any] = {
        "id": f"hub-{uuid.uuid4().hex[:8]}",
        "name": payload.name,
        "location": payload.location.model_dump(),
        "supported_storage": [s.value for s in payload.supported_storage],
        "available_capacity_kg": payload.available_capacity_kg,
        "is_demo_seed": False,
        "created_at": now,
    }
    await db["storage_hubs"].insert_one(dict(hub_doc))
    await db["audit_logs"].insert_one(
        {
            "id": f"audit-{uuid.uuid4().hex[:10]}",
            "actor_id": current_user["id"],
            "actor_role": current_user["role"],
            "action": "storage_hub_created",
            "target_id": hub_doc["id"],
            "details": f"Registered storage hub: {payload.name} ({payload.available_capacity_kg} kg)",
            "created_at": now,
        }
    )
    await db_manager.maybe_persist()
    return {"hub": hub_doc}

