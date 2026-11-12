"""Real PayPal Developer Sandbox REST API v2 (Orders) and v1 (Payouts) integration."""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, Optional

import httpx
from fastapi import HTTPException, status

from app.config import get_settings


class PayPalSandboxService:
    """Client for PayPal Developer Sandbox REST API (Orders API v2 and Payouts API v1)."""

    def __init__(self) -> None:
        self._access_token: Optional[str] = None
        self._token_expires_at: float = 0.0

    def ensure_configured(self) -> None:
        settings = get_settings()
        if not settings.has_paypal:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "PayPal Developer Sandbox credentials (PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET) "
                    "are not configured. Add your Sandbox REST app credentials to backend/.env to execute "
                    "live PayPal Orders & Payouts."
                ),
            )

    async def get_access_token(self, transport: Any = None) -> str:
        self.ensure_configured()
        settings = get_settings()
        now = time.time()
        if self._access_token and now < self._token_expires_at - 60:
            return self._access_token

        url = f"{settings.PAYPAL_BASE_URL.rstrip('/')}/v1/oauth2/token"
        async with httpx.AsyncClient(timeout=15.0, transport=transport) as client:
            resp = await client.post(
                url,
                auth=(settings.PAYPAL_CLIENT_ID, settings.PAYPAL_CLIENT_SECRET),
                headers={"Accept": "application/json", "Accept-Language": "en_US"},
                data={"grant_type": "client_credentials"},
            )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"PayPal Sandbox OAuth failed ({resp.status_code}): {resp.text}",
            )
        data = resp.json()
        self._access_token = data["access_token"]
        self._token_expires_at = now + float(data.get("expires_in", 3600))
        return self._access_token

    async def create_order(
        self,
        campaign_id: str,
        amount_usd: float,
        description: str,
        return_url: str,
        cancel_url: str,
        transport: Any = None,
    ) -> Dict[str, Any]:
        """Creates a real PayPal Sandbox Order (Orders API v2)."""
        settings = get_settings()
        token = await self.get_access_token(transport=transport)
        url = f"{settings.PAYPAL_BASE_URL.rstrip('/')}/v2/checkout/orders"
        request_id = f"sc-order-{campaign_id}-{uuid.uuid4().hex[:10]}"

        payload = {
            "intent": "CAPTURE",
            "purchase_units": [
                {
                    "reference_id": campaign_id,
                    "description": description[:127],
                    "custom_id": campaign_id,
                    "amount": {
                        "currency_code": "USD",
                        "value": f"{amount_usd:.2f}",
                    },
                }
            ],
            "application_context": {
                "brand_name": "SurplusConnect AI",
                "landing_page": "LOGIN",
                "user_action": "PAY_NOW",
                "return_url": return_url,
                "cancel_url": cancel_url,
            },
        }

        async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "PayPal-Request-Id": request_id,
                },
                json=payload,
            )

        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"PayPal Orders API create failed ({resp.status_code}): {resp.text}",
            )

        data = resp.json()
        approve_link = next(
            (lnk["href"] for lnk in data.get("links", []) if lnk.get("rel") in {"approve", "payer-action"}),
            None,
        )
        return {
            "order_id": data["id"],
            "status": data.get("status", "CREATED"),
            "approval_url": approve_link,
            "links": data.get("links", []),
            "environment": settings.PAYPAL_MODE,
            "request_id": request_id,
        }

    async def capture_order(self, order_id: str, transport: Any = None) -> Dict[str, Any]:
        """Captures an approved PayPal Sandbox Order (Orders API v2)."""
        settings = get_settings()
        token = await self.get_access_token(transport=transport)
        url = f"{settings.PAYPAL_BASE_URL.rstrip('/')}/v2/checkout/orders/{order_id}/capture"

        async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={},
            )

        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST if resp.status_code in (400, 422) else status.HTTP_502_BAD_GATEWAY,
                detail=f"PayPal Orders API capture failed ({resp.status_code}): {resp.text}",
            )

        data = resp.json()
        purchase_unit = (data.get("purchase_units") or [{}])[0]
        captures = ((purchase_unit.get("payments") or {}).get("captures")) or []
        capture = captures[0] if captures else {}
        capture_amount = float(((capture.get("amount") or {}).get("value")) or 0.0)
        payer = data.get("payer") or {}

        return {
            "order_id": data["id"],
            "status": data.get("status"),
            "capture_id": capture.get("id"),
            "capture_status": capture.get("status"),
            "amount_usd": capture_amount,
            "currency": ((capture.get("amount") or {}).get("currency_code")) or "USD",
            "payer_email": payer.get("email_address"),
            "payer_id": payer.get("payer_id"),
            "raw_status": data.get("status"),
        }

    async def create_payout(
        self,
        delivery_id: str,
        recipient_email: str,
        amount_usd: float,
        note: str,
        transport: Any = None,
    ) -> Dict[str, Any]:
        """Executes an eligible Delivery Partner payout using PayPal Payouts API v1 (Sandbox)."""
        settings = get_settings()
        token = await self.get_access_token(transport=transport)
        url = f"{settings.PAYPAL_BASE_URL.rstrip('/')}/v1/payments/payouts"
        sender_batch_id = f"sc-payout-{delivery_id}-{uuid.uuid4().hex[:8]}"

        payload = {
            "sender_batch_header": {
                "sender_batch_id": sender_batch_id,
                "email_subject": "SurplusConnect AI Delivery Partner Payout",
                "email_message": f"Payout for verified surplus rescue delivery {delivery_id}.",
            },
            "items": [
                {
                    "recipient_type": "EMAIL",
                    "amount": {"value": f"{amount_usd:.2f}", "currency": "USD"},
                    "note": note[:400],
                    "sender_item_id": f"item-{delivery_id}",
                    "receiver": recipient_email,
                }
            ],
        }

        async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"PayPal Payouts API failed ({resp.status_code}): {resp.text}",
            )

        data = resp.json()
        batch_header = data.get("batch_header") or {}
        return {
            "payout_batch_id": batch_header.get("payout_batch_id"),
            "batch_status": batch_header.get("batch_status", "PENDING"),
            "sender_batch_id": sender_batch_id,
            "recipient_email": recipient_email,
            "amount_usd": round(amount_usd, 2),
            "links": data.get("links", []),
        }

    async def get_payout_status(self, payout_batch_id: str, transport: Any = None) -> Dict[str, Any]:
        """Fetches live PayPal Sandbox Payout batch status."""
        settings = get_settings()
        token = await self.get_access_token(transport=transport)
        url = f"{settings.PAYPAL_BASE_URL.rstrip('/')}/v1/payments/payouts/{payout_batch_id}"

        async with httpx.AsyncClient(timeout=15.0, transport=transport) as client:
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"PayPal Payout status lookup failed ({resp.status_code}): {resp.text}",
            )
        data = resp.json()
        batch_header = data.get("batch_header") or {}
        return {
            "payout_batch_id": payout_batch_id,
            "batch_status": batch_header.get("batch_status"),
            "time_created": batch_header.get("time_created"),
            "items": data.get("items", []),
        }


paypal_service = PayPalSandboxService()

