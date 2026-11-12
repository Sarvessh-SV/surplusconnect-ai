"""Shared pytest fixtures for SurplusConnect AI end-to-end backend tests."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import AsyncGenerator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

TEST_STORE_PATH = BACKEND_DIR / "data" / "test_local_store.json"
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-surplusconnect-pytest")
os.environ["APP_ENV"] = "development"
os.environ["ENABLE_DEV_SEED"] = "true"


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    import app.database as db_mod
    from app.config import get_settings
    from app.main import app
    from app.services.seed_service import seed_demo_data

    get_settings.cache_clear()

    original_path = db_mod.LOCAL_STORE_PATH
    db_mod.LOCAL_STORE_PATH = TEST_STORE_PATH
    if TEST_STORE_PATH.exists():
        TEST_STORE_PATH.unlink()

    await db_mod.db_manager.disconnect()
    await db_mod.db_manager.connect(force_mock=True)
    db = db_mod.get_db()
    for coll in await db.list_collection_names():
        await db[coll].delete_many({})
    await seed_demo_data(db)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as async_client:
        yield async_client

    await db_mod.db_manager.disconnect()
    db_mod.LOCAL_STORE_PATH = original_path
    if TEST_STORE_PATH.exists():
        TEST_STORE_PATH.unlink()
