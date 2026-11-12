"""CLI utility to securely provision an Administrator account in SurplusConnect AI."""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.auth import hash_password
from app.database import db_manager, get_db


async def provision_admin(email: str, password: str, full_name: str, org_name: str) -> None:
    await db_manager.connect()
    db = get_db()
    email_norm = email.strip().lower()
    existing = await db["users"].find_one({"email": email_norm})
    if existing:
        print(f"An account already exists for {email_norm} (role={existing.get('role')}).")
        await db_manager.disconnect()
        return

    now = datetime.now(timezone.utc)
    admin_id = f"user-adm-{uuid.uuid4().hex[:8]}"
    await db["users"].insert_one(
        {
            "id": admin_id,
            "email": email_norm,
            "password_hash": hash_password(password),
            "full_name": full_name.strip(),
            "role": "admin",
            "organization_name": org_name.strip(),
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
    await db_manager.disconnect()
    print(f"Provisioned administrator '{email_norm}' (id={admin_id}).")


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision a SurplusConnect AI Administrator account.")
    parser.add_argument("--email", required=True, help="Administrator email address")
    parser.add_argument("--name", default="Platform Administrator", help="Administrator full name")
    parser.add_argument("--org", default="SurplusConnect Governance", help="Organization name")
    parser.add_argument("--password", help="Password (min 8 chars). Prompts securely if omitted.")
    args = parser.parse_args()

    password = args.password or getpass.getpass("Administrator password (min 8 characters): ")
    if len(password) < 8:
        print("Error: password must be at least 8 characters.", file=sys.stderr)
        sys.exit(1)

    asyncio.run(provision_admin(args.email, password, args.name, args.org))


if __name__ == "__main__":
    main()
