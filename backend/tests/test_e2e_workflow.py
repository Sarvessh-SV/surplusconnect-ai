"""End-to-end verification tests for SurplusConnect AI backend workflows."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict

import pytest
from httpx import AsyncClient


async def login_demo(client: AsyncClient, email: str) -> Dict[str, str]:
    resp = await client.post("/api/auth/login", json={"email": email, "password": "SurplusDemo2026!"})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_health_and_demo_accounts_and_rbac(client: AsyncClient) -> None:
    health = await client.get("/api/health")
    assert health.status_code == 200
    body = health.json()
    assert body["status"] == "ok"
    assert "database_mode" in body
    assert body["integrations"]["gemini_model"] == "gemini-3.8-flash"

    # Admin self-registration must be blocked
    bad_reg = await client.post(
        "/api/auth/register",
        json={
            "email": "rogue@admin.test",
            "password": "StrongPassword123!",
            "full_name": "Rogue User",
            "role": "admin",
            "organization_name": "Rogue Org",
            "location": {"lat": 37.77, "lng": -122.41, "address": "100 Market St", "city": "San Francisco"},
        },
    )
    assert bad_reg.status_code == 422

    # Demo accounts list available for login UI
    demos = await client.get("/api/auth/demo-accounts")
    assert demos.status_code == 200
    assert len(demos.json()["accounts"]) >= 10

    # Sponsor cannot access admin overview or list surplus inventory
    sponsor_hdrs = await login_demo(client, "sponsor@impactfund.demo")
    forbidden_admin = await client.get("/api/admin/overview", headers=sponsor_hdrs)
    assert forbidden_admin.status_code == 403

    forbidden_inv = await client.post(
        "/api/inventory",
        headers=sponsor_hdrs,
        json={
            "title": "Blocked Inv",
            "description": "Sponsor should not list donor inventory",
            "category": "bakery",
            "quantity_kg": 20.0,
            "storage_requirement": "ambient",
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=18)).isoformat(),
        },
    )
    assert forbidden_inv.status_code == 403


@pytest.mark.asyncio
async def test_expiry_and_storage_food_safety_validation(client: AsyncClient) -> None:
    donor_hdrs = await login_demo(client, "donor@greenhearthbakery.demo")

    # 1. Expired item rejected by schema validator
    expired = await client.post(
        "/api/inventory",
        headers=donor_hdrs,
        json={
            "title": "Expired Bread",
            "description": "Past expiry batch",
            "category": "bakery",
            "quantity_kg": 15.0,
            "storage_requirement": "ambient",
            "expires_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        },
    )
    assert expired.status_code == 422

    # 2. Unsafe chilled/frozen dairy stored at ambient rejected by AI SurplusDetector
    unsafe_ambient_dairy = await client.post(
        "/api/inventory",
        headers=donor_hdrs,
        json={
            "title": "Unchilled Yogurt Cases",
            "description": "Dairy stored ambient without refrigeration",
            "category": "dairy",
            "quantity_kg": 25.0,
            "storage_requirement": "ambient",
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=18)).isoformat(),
        },
    )
    assert unsafe_ambient_dairy.status_code == 422


@pytest.mark.asyncio
async def test_full_e2e_redistribution_matching_funding_delivery_payout(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    donor_hdrs = await login_demo(client, "donor@freshharvestmarket.demo")
    org_hdrs = await login_demo(client, "org@hopehaven.demo")
    sponsor_hdrs = await login_demo(client, "sponsor@impactfund.demo")
    driver_hdrs = await login_demo(client, "driver@ecohaul.demo")
    admin_hdrs = await login_demo(client, "admin@surplusconnect.demo")

    # Step 1-4: Business lists chilled produce surplus -> triggers AI Surplus Detection + Matching + Logistics + Funding
    now = datetime.now(timezone.utc)
    create_resp = await client.post(
        "/api/inventory",
        headers=donor_hdrs,
        json={
            "title": "Organic Harvest Produce & Greens",
            "description": "Fresh chilled produce pallets from afternoon supermarket rotation.",
            "category": "produce",
            "quantity_kg": 75.0,
            "storage_requirement": "refrigerated",
            "prepared_at": (now - timedelta(hours=2)).isoformat(),
            "expires_at": (now + timedelta(hours=36)).isoformat(),
            "packaging_type": "Vented refrigerated crates",
            "estimated_retail_value_usd": 420.0,
            "historical_daily_turnover_kg": 80.0,
            "auto_coordinate": True,
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    lot_id = created["lot"]["id"]
    coord = created["coordination"]
    assert coord is not None
    assert len(coord["allocations"]) >= 1
    assert coord["run_summary"]["ai_provider"]

    # Pick Hope Haven allocation or first allocation (use admin if org differs)
    allocs_resp = await client.get(f"/api/inventory/{lot_id}", headers=admin_hdrs)
    assert allocs_resp.status_code == 200
    allocs = allocs_resp.json()["allocations"]
    assert len(allocs) >= 1
    target_alloc = next((a for a in allocs if a["organization_id"] == "user-org-hopehaven"), allocs[0])

    # Predictive demand check
    demand_resp = await client.get("/api/demand/intelligence?category=produce", headers=org_hdrs)
    assert demand_resp.status_code == 200
    assert len(demand_resp.json()["regional_7d_forecast"]) == 7

    # Step 6 & 8: Organization accepts donation & chooses sponsor_funded
    respond_headers = org_hdrs if target_alloc["organization_id"] == "user-org-hopehaven" else admin_hdrs
    accept_resp = await client.post(
        f"/api/matching/allocations/{target_alloc['id']}/respond",
        headers=respond_headers,
        json={"action": "accept", "funding_mode": "sponsor_funded", "notes": "Morning receiving dock open."},
    )
    assert accept_resp.status_code == 200, accept_resp.text
    camp = accept_resp.json()["campaign"]
    delivery = accept_resp.json()["delivery"]
    assert camp["status"] == "open"
    assert delivery["status"] == "pending_funding"

    # Step 9-10: Unconfigured PayPal Sandbox fails cleanly with 503 (never faking a live payment!)
    from app.services.paypal_service import paypal_service

    unconf_order = await client.post(
        "/api/funding/paypal/orders",
        headers=sponsor_hdrs,
        json={"campaign_id": camp["id"], "amount_usd": float(camp["required_amount_usd"])},
    )
    assert unconf_order.status_code == 503

    # Now test PayPal Orders v2 & Payouts v1 endpoint integration with mocked PayPal API methods
    async def mock_create_order(*args, **kwargs):
        return {
            "order_id": "MOCK-SBX-ORDER-001",
            "status": "CREATED",
            "approval_url": "https://www.sandbox.paypal.com/checkoutnow?token=MOCK-SBX-ORDER-001",
            "links": [],
            "environment": "sandbox",
            "request_id": "req-test-1",
        }

    async def mock_capture_order(*args, **kwargs):
        return {
            "order_id": "MOCK-SBX-ORDER-001",
            "status": "COMPLETED",
            "capture_id": "MOCK-CAP-001",
            "capture_status": "COMPLETED",
            "amount_usd": float(camp["required_amount_usd"]),
            "currency": "USD",
            "payer_email": "sb-sponsor@personal.example.com",
            "payer_id": "PAYER123",
            "raw_status": "COMPLETED",
        }

    async def mock_create_payout(*args, **kwargs):
        return {
            "payout_batch_id": "MOCK-PAYOUT-BATCH-99",
            "sender_batch_id": "sc-payout-test",
            "batch_status": "PENDING",
            "amount_usd": float(camp["required_amount_usd"]),
            "recipient_email": "driver-ecohaul@sandbox.example.com",
            "environment": "sandbox",
        }

    monkeypatch.setattr(paypal_service, "create_order", mock_create_order)
    monkeypatch.setattr(paypal_service, "capture_order", mock_capture_order)
    monkeypatch.setattr(paypal_service, "create_payout", mock_create_payout)

    order_resp = await client.post(
        "/api/funding/paypal/orders",
        headers=sponsor_hdrs,
        json={"campaign_id": camp["id"], "amount_usd": float(camp["required_amount_usd"])},
    )
    assert order_resp.status_code == 200
    assert order_resp.json()["order_id"] == "MOCK-SBX-ORDER-001"

    # Delivery cannot start while funding is still pending!
    blocked_dispatch = await client.post(
        f"/api/logistics/deliveries/{delivery['id']}/status",
        headers=admin_hdrs,
        json={"status": "collected"},
    )
    assert blocked_dispatch.status_code == 409

    # Capture PayPal Sandbox Order -> completes campaign & unlocks delivery
    capture_resp = await client.post(
        "/api/funding/paypal/orders/capture",
        headers=sponsor_hdrs,
        json={"order_id": "MOCK-SBX-ORDER-001", "campaign_id": camp["id"]},
    )
    assert capture_resp.status_code == 200, capture_resp.text
    assert capture_resp.json()["campaign"]["status"] == "funded"

    # Step 11: Delivery partner assigned + collects + cold-chain verified delivery confirmation
    assign_resp = await client.post(
        "/api/logistics/assign",
        headers=driver_hdrs,
        json={"allocation_id": target_alloc["id"]},
    )
    assert assign_resp.status_code == 200, assign_resp.text
    deliv_id = assign_resp.json()["delivery"]["id"]

    collected_resp = await client.post(
        f"/api/logistics/deliveries/{deliv_id}/status",
        headers=driver_hdrs,
        json={"status": "collected", "delivery_notes": "Loaded into refrigerated van at 3C."},
    )
    assert collected_resp.status_code == 200

    # Delivering chilled produce without temperature_verified_c must fail 422!
    missing_temp = await client.post(
        f"/api/logistics/deliveries/{deliv_id}/status",
        headers=driver_hdrs,
        json={"status": "delivered", "recipient_confirmation_name": "Elena Rostova"},
    )
    assert missing_temp.status_code == 422

    delivered_resp = await client.post(
        f"/api/logistics/deliveries/{deliv_id}/status",
        headers=driver_hdrs,
        json={
            "status": "delivered",
            "temperature_verified_c": 3.4,
            "recipient_confirmation_name": "Elena Rostova",
            "delivery_notes": "All crates scanned intact.",
        },
    )
    assert delivered_resp.status_code == 200, delivered_resp.text
    assert delivered_resp.json()["delivery"]["payout_eligible"] is True

    # Step 10 Payouts API: Admin triggers Payout for eligible completed delivery
    payout_resp = await client.post(
        "/api/funding/paypal/payouts",
        headers=admin_hdrs,
        json={"delivery_id": deliv_id, "note": "Verified cold-chain completion."},
    )
    assert payout_resp.status_code == 200, payout_resp.text
    assert payout_resp.json()["payout"]["payout_batch_id"] == "MOCK-PAYOUT-BATCH-99"

    # Step 12: Live impact metrics increment separately from demo_seed_metrics
    impact_resp = await client.get("/api/analytics/impact")
    assert impact_resp.status_code == 200
    impact = impact_resp.json()
    assert impact["live_metrics"]["completed_deliveries"] == 1
    assert impact["live_metrics"]["rescued_kg"] >= target_alloc["allocated_kg"]
    assert impact["live_metrics"]["funding_volume_usd"] == pytest.approx(float(camp["required_amount_usd"]), abs=0.01)


@pytest.mark.asyncio
async def test_intelligent_fallback_matching_and_human_safety_gate(client: AsyncClient) -> None:
    donor_hdrs = await login_demo(client, "donor@greenhearthbakery.demo")
    org_hdrs = await login_demo(client, "org@hopehaven.demo")
    admin_hdrs = await login_demo(client, "admin@surplusconnect.demo")

    now = datetime.now(timezone.utc)
    # Urgent prepared meals (< 5 hours left) triggers HITL Food Safety Approval gate
    urgent_resp = await client.post(
        "/api/inventory",
        headers=donor_hdrs,
        json={
            "title": "Chef Prepared Warm Bento Trays",
            "description": "High-urgency prepared meals requiring quick hot/cold chain verification.",
            "category": "prepared_meals",
            "quantity_kg": 40.0,
            "storage_requirement": "refrigerated",
            "prepared_at": (now - timedelta(hours=3)).isoformat(),
            "expires_at": (now + timedelta(hours=4.5)).isoformat(),
            "packaging_type": "Foil gastro pans",
            "estimated_retail_value_usd": 360.0,
            "historical_daily_turnover_kg": 35.0,
            "auto_coordinate": True,
        },
    )
    assert urgent_resp.status_code == 201, urgent_resp.text
    coord = urgent_resp.json()["coordination"]
    assert coord["safety_analysis"]["requires_safety_approval"] is True
    assert len(coord["approval_requests"]) >= 1
    safety_gate = next(g for g in coord["approval_requests"] if g["gate_type"] == "food_safety_approval")

    # Organization cannot accept allocation until Admin resolves food safety gate
    alloc_id = coord["allocations"][0]["id"]
    alloc_org_id = coord["allocations"][0]["organization_id"]
    responder_hdrs = org_hdrs if alloc_org_id == "user-org-hopehaven" else admin_hdrs

    blocked_accept = await client.post(
        f"/api/matching/allocations/{alloc_id}/respond",
        headers=responder_hdrs,
        json={"action": "accept", "funding_mode": "sponsor_funded"},
    )
    assert blocked_accept.status_code == 409

    # Admin approves safety gate -> unblocks organization acceptance
    approve_resp = await client.post(
        f"/api/agent/approvals/{safety_gate['id']}/decision",
        headers=admin_hdrs,
        json={"decision": "approve", "reviewer_notes": "Thermometer log confirmed 2.8C."},
    )
    assert approve_resp.status_code == 200
    assert approve_resp.json()["approval"]["status"] == "approved"

    unblocked_accept = await client.post(
        f"/api/matching/allocations/{alloc_id}/respond",
        headers=responder_hdrs,
        json={"action": "accept", "funding_mode": "shared_funding", "self_funded_share_pct": 50.0},
    )
    assert unblocked_accept.status_code == 200, unblocked_accept.text

    # Large frozen batch triggers Intelligent Fallback Matching on seeded/new lot
    frozen_resp = await client.post(
        "/api/inventory",
        headers=donor_hdrs,
        json={
            "title": "Deep-Frozen Vegetable & Protein Cases",
            "description": "Bulk frozen surplus requiring radius expansion & cold-storage hubs.",
            "category": "frozen_goods",
            "quantity_kg": 420.0,
            "storage_requirement": "frozen",
            "expires_at": (now + timedelta(hours=180)).isoformat(),
            "packaging_type": "Sealed insulated cartons",
            "estimated_retail_value_usd": 1900.0,
            "historical_daily_turnover_kg": 200.0,
            "auto_coordinate": True,
        },
    )
    assert frozen_resp.status_code == 201, frozen_resp.text
    f_coord = frozen_resp.json()["coordination"]
    assert f_coord["fallback"]["fallback_activated"] is True
    assert f_coord["fallback"]["expanded_radius_km"] > 10.0
    assert len(f_coord["fallback"]["storage_hub_options"]) >= 1


@pytest.mark.asyncio
async def test_role_validated_login_forgot_password_and_admin_provisioning(client: AsyncClient) -> None:
    from app.config import get_settings

    # Cross-role portal login must be rejected by backend
    mismatch = await client.post(
        "/api/auth/login",
        json={
            "email": "donor@greenhearthbakery.demo",
            "password": "SurplusDemo2026!",
            "expected_role": "admin",
        },
    )
    assert mismatch.status_code == 403

    # Matching role succeeds
    matched = await client.post(
        "/api/auth/login",
        json={
            "email": "donor@greenhearthbakery.demo",
            "password": "SurplusDemo2026!",
            "expected_role": "business",
        },
    )
    assert matched.status_code == 200
    assert matched.json()["user"]["role"] == "business"

    # Forgot password works neutrally
    fp_resp = await client.post(
        "/api/auth/forgot-password",
        json={"email": "donor@greenhearthbakery.demo"},
    )
    assert fp_resp.status_code == 200
    assert fp_resp.json()["status"] == "accepted"

    # Authorized admin can provision another admin; non-admin cannot
    donor_hdrs = await login_demo(client, "donor@greenhearthbakery.demo")
    blocked_prov = await client.post(
        "/api/admin/users/provision-admin",
        headers=donor_hdrs,
        json={
            "email": "newadmin@surplusconnect.org",
            "password": "StrongAdminPass123!",
            "full_name": "Governance Officer",
            "organization_name": "SurplusConnect Governance",
        },
    )
    assert blocked_prov.status_code == 403

    admin_hdrs = await login_demo(client, "admin@surplusconnect.demo")
    prov_resp = await client.post(
        "/api/admin/users/provision-admin",
        headers=admin_hdrs,
        json={
            "email": "newadmin@surplusconnect.org",
            "password": "StrongAdminPass123!",
            "full_name": "Governance Officer",
            "organization_name": "SurplusConnect Governance",
        },
    )
    assert prov_resp.status_code == 201
    assert prov_resp.json()["user"]["role"] == "admin"

    # Production mode blocks /api/auth/demo-accounts
    settings = get_settings()
    prev_env, prev_seed = settings.APP_ENV, settings.ENABLE_DEV_SEED
    settings.APP_ENV = "production"
    settings.ENABLE_DEV_SEED = False
    try:
        blocked_demos = await client.get("/api/auth/demo-accounts")
        assert blocked_demos.status_code == 404
    finally:
        settings.APP_ENV = prev_env
        settings.ENABLE_DEV_SEED = prev_seed


@pytest.mark.asyncio
async def test_inventory_update_and_delete(client: AsyncClient) -> None:
    donor_hdrs = await login_demo(client, "donor@greenhearthbakery.demo")
    org_hdrs = await login_demo(client, "org@hopehaven.demo")
    now = datetime.now(timezone.utc)

    create_resp = await client.post(
        "/api/inventory",
        headers=donor_hdrs,
        json={
            "title": "Artisan Whole Wheat Loaves",
            "description": "Same-day bakery surplus ready for redistribution.",
            "category": "bakery",
            "quantity_kg": 28.0,
            "storage_requirement": "ambient",
            "expires_at": (now + timedelta(hours=30)).isoformat(),
            "packaging_type": "Food-safe crates",
            "estimated_retail_value_usd": 140.0,
            "auto_coordinate": True,
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    lot_id = create_resp.json()["lot"]["id"]

    # Non-owner recipient organization cannot update or delete business donor's lot
    forbidden_patch = await client.patch(
        f"/api/inventory/{lot_id}",
        headers=org_hdrs,
        json={"title": "Unauthorized Edit"},
    )
    assert forbidden_patch.status_code == 403

    # Owner updates title and quantity
    patch_resp = await client.patch(
        f"/api/inventory/{lot_id}",
        headers=donor_hdrs,
        json={
            "title": "Artisan Whole Wheat & Rye Loaves",
            "quantity_kg": 34.5,
            "handling_notes": "Packed cleanly at loading bay B.",
        },
    )
    assert patch_resp.status_code == 200, patch_resp.text
    updated_lot = patch_resp.json()["lot"]
    assert updated_lot["title"] == "Artisan Whole Wheat & Rye Loaves"
    assert updated_lot["quantity_kg"] == 34.5

    # Owner deletes the draft/coordinated lot cleanly
    del_resp = await client.delete(f"/api/inventory/{lot_id}", headers=donor_hdrs)
    assert del_resp.status_code == 200, del_resp.text
    assert del_resp.json()["deleted"] is True
    assert del_resp.json()["id"] == lot_id

    # Subsequent lookup returns 404
    missing_resp = await client.get(f"/api/inventory/{lot_id}", headers=donor_hdrs)
    assert missing_resp.status_code == 404


@pytest.mark.asyncio
async def test_geospatial_network_map_location_update_and_road_route(client: AsyncClient) -> None:
    donor_hdrs = await login_demo(client, "donor@greenhearthbakery.demo")

    # Reject invalid null-island coordinates when explicitly saving verified location
    bad_loc = await client.patch(
        "/api/auth/location",
        headers=donor_hdrs,
        json={"lat": 0.0, "lng": 0.0, "address": "Unknown Street", "city": "Nowhere"},
    )
    assert bad_loc.status_code == 422

    # Save verified location coordinates to MongoDB / store
    good_loc = await client.patch(
        "/api/auth/location",
        headers=donor_hdrs,
        json={
            "lat": 37.7689,
            "lng": -122.4215,
            "address": "742 Valencia St",
            "city": "San Francisco",
        },
    )
    assert good_loc.status_code == 200, good_loc.text
    assert good_loc.json()["location"]["address"] == "742 Valencia St"
    assert abs(good_loc.json()["location"]["lat"] - 37.7689) < 1e-4

    # Network map endpoint returns DB-backed markers and routes
    net_resp = await client.get("/api/logistics/network-map", headers=donor_hdrs)
    assert net_resp.status_code == 200, net_resp.text
    net_data = net_resp.json()
    assert net_data["current_user_has_coordinates"] is True
    assert len(net_data["markers"]) >= 2

    # Road route endpoint validates coordinates and handles OSRM cleanly
    route_resp = await client.post(
        "/api/logistics/road-route",
        headers=donor_hdrs,
        json={
            "origin_lat": 37.7689,
            "origin_lng": -122.4215,
            "dest_lat": 37.7812,
            "dest_lng": -122.4051,
            "profile": "driving",
        },
    )
    assert route_resp.status_code == 200, route_resp.text
    route_body = route_resp.json()
    assert "available" in route_body
    if route_body["available"]:
        assert len(route_body["geometry"]) >= 2
        assert route_body["distance_km"] > 0
    else:
        assert route_body["geometry"] == []



