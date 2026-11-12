"""MongoDB Atlas async database client with transparent disk-persisted dev fallback."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from mongomock_motor import AsyncMongoMockClient
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import BACKEND_DIR, get_settings

logger = logging.getLogger(__name__)

COLLECTIONS = [
    "users",
    "inventory_lots",
    "allocations",
    "demand_history",
    "demand_forecasts",
    "deliveries",
    "funding_campaigns",
    "transactions",
    "agent_runs",
    "approval_requests",
    "audit_logs",
    "storage_hubs",
]

LOCAL_STORE_PATH = BACKEND_DIR / "data" / "local_store.json"


def _json_default(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return {"__type__": "datetime", "value": obj.astimezone(timezone.utc).isoformat()}
    return str(obj)


def _json_object_hook(obj: Dict[str, Any]) -> Any:
    if obj.get("__type__") == "datetime" and "value" in obj:
        return datetime.fromisoformat(obj["value"])
    return obj


class DatabaseManager:
    def __init__(self) -> None:
        self.client: Any = None
        self.db: Any = None
        self.db_mode: str = "uninitialized"
        self.last_error: Optional[str] = None

    async def connect(self, force_mock: bool = False) -> None:
        settings = get_settings()
        if settings.has_mongodb_atlas and not force_mock:
            try:
                client = AsyncIOMotorClient(
                    settings.MONGODB_URI,
                    serverSelectionTimeoutMS=5000,
                    uuidRepresentation="standard",
                )
                await client.admin.command("ping")
                self.client = client
                self.db = client[settings.MONGODB_DB_NAME]
                self.db_mode = "mongodb_atlas"
                self.last_error = None
                await self._ensure_indexes()
                logger.info("Connected to MongoDB Atlas database '%s'.", settings.MONGODB_DB_NAME)
                return
            except Exception as exc:
                self.last_error = f"MongoDB Atlas connection failed ({exc}); falling back to local disk store."
                logger.warning(self.last_error)

        # Fallback: mongomock-motor with atomic JSON disk persistence for local development/testing
        self.client = AsyncMongoMockClient()
        self.db = self.client[settings.MONGODB_DB_NAME]
        self.db_mode = "local_disk_fallback"
        if not force_mock:
            await self.load_local_snapshot()
        await self._ensure_indexes()
        logger.info("Using local disk-persisted MongoDB-compatible store (%s).", LOCAL_STORE_PATH)

    async def disconnect(self) -> None:
        if self.db_mode == "local_disk_fallback":
            await self.persist_local_snapshot()
        if self.client is not None and self.db_mode == "mongodb_atlas":
            self.client.close()

    async def _ensure_indexes(self) -> None:
        if self.db is None:
            return
        try:
            await self.db["users"].create_index("email", unique=True)
            await self.db["users"].create_index("role")
            await self.db["inventory_lots"].create_index("business_id")
            await self.db["inventory_lots"].create_index("status")
            await self.db["allocations"].create_index("inventory_id")
            await self.db["allocations"].create_index("organization_id")
            await self.db["deliveries"].create_index("allocation_id")
            await self.db["deliveries"].create_index("partner_id")
            await self.db["funding_campaigns"].create_index("allocation_id")
            await self.db["transactions"].create_index("campaign_id")
            await self.db["approval_requests"].create_index("status")
            await self.db["audit_logs"].create_index("created_at")
        except Exception as exc:
            logger.debug("Index creation note: %s", exc)

    async def load_local_snapshot(self, path: Optional[Path] = None) -> None:
        target = path or LOCAL_STORE_PATH
        if not target.exists() or self.db is None:
            return
        try:
            raw = json.loads(target.read_text(encoding="utf-8"), object_hook=_json_object_hook)
            for name in COLLECTIONS:
                docs: List[Dict[str, Any]] = raw.get(name, [])
                if docs:
                    await self.db[name].delete_many({})
                    await self.db[name].insert_many(docs)
        except Exception as exc:
            logger.warning("Failed to load local Mongo snapshot: %s", exc)

    async def persist_local_snapshot(self, path: Optional[Path] = None) -> None:
        if self.db is None or self.db_mode != "local_disk_fallback":
            return
        target = path or LOCAL_STORE_PATH
        target.parent.mkdir(parents=True, exist_ok=True)
        payload: Dict[str, List[Dict[str, Any]]] = {}
        for name in COLLECTIONS:
            cursor = self.db[name].find({})
            docs = await cursor.to_list(length=10000)
            cleaned: List[Dict[str, Any]] = []
            for doc in docs:
                d = dict(doc)
                if "_id" in d:
                    d["_id"] = str(d["_id"])
                cleaned.append(d)
            payload[name] = cleaned
        tmp = target.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, default=_json_default, indent=2), encoding="utf-8")
        tmp.replace(target)

    async def maybe_persist(self) -> None:
        if self.db_mode == "local_disk_fallback":
            await self.persist_local_snapshot()


db_manager = DatabaseManager()


def get_db() -> AsyncIOMotorDatabase | Any:
    if db_manager.db is None:
        raise RuntimeError("Database has not been initialized.")
    return db_manager.db

