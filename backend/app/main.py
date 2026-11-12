"""SurplusConnect AI FastAPI entrypoint."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import hash_password
from app.config import get_settings
from app.database import db_manager, get_db
from app.ml.demand_forecaster import demand_forecaster
from app.routers import admin, agent, analytics, auth, demand, funding, inventory, logistics, matching
from app.services.seed_service import seed_demo_data


async def _ensure_bootstrap_admin() -> None:
    """Optionally creates an initial administrator account from secure env vars when none exists."""
    settings = get_settings()
    if not (settings.BOOTSTRAP_ADMIN_EMAIL.strip() and settings.BOOTSTRAP_ADMIN_PASSWORD.strip()):
        return
    db = get_db()
    existing_admin = await db["users"].find_one({"role": "admin", "is_demo_seed": {"$ne": True}})
    if existing_admin:
        return
    email_norm = settings.BOOTSTRAP_ADMIN_EMAIL.strip().lower()
    if await db["users"].find_one({"email": email_norm}):
        return
    now = datetime.now(timezone.utc)
    admin_id = f"user-adm-{uuid.uuid4().hex[:8]}"
    await db["users"].insert_one(
        {
            "id": admin_id,
            "email": email_norm,
            "password_hash": hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD),
            "full_name": settings.BOOTSTRAP_ADMIN_NAME,
            "role": "admin",
            "organization_name": settings.BOOTSTRAP_ADMIN_ORG,
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
    )
    await db_manager.maybe_persist()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    await db_manager.connect()
    db = get_db()
    if settings.is_dev_seed_enabled:
        await seed_demo_data(db)
    else:
        history = await db["demand_history"].find({}).to_list(length=500)
        if history:
            demand_forecaster.retrain_with_history(history)
    await _ensure_bootstrap_admin()
    yield
    await db_manager.disconnect()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="SurplusConnect AI API",
        version="1.0.0",
        description="AI-powered surplus inventory redistribution platform with Gemini, LangGraph, Scikit-learn, Google Maps Routes API, MongoDB Atlas, and PayPal Sandbox.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(inventory.router)
    app.include_router(matching.router)
    app.include_router(demand.router)
    app.include_router(logistics.router)
    app.include_router(funding.router)
    app.include_router(agent.router)
    app.include_router(admin.router)
    app.include_router(analytics.router)

    @app.get("/api/health")
    async def health() -> Dict[str, Any]:
        return {
            "status": "ok",
            "service": settings.APP_NAME,
            "database_mode": db_manager.db_mode,
            "database_error": db_manager.last_error,
            "integrations": {
                "mongodb_atlas": settings.has_mongodb_atlas,
                "gemini_api": settings.has_gemini,
                "gemini_model": settings.GEMINI_MODEL,
                "google_maps": settings.has_google_maps,
                "paypal_sandbox": settings.has_paypal,
            },
        }

    return app


app = create_app()

