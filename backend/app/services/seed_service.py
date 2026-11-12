"""Seeds realistic fictional hackathon demonstration accounts, historical demand, and initial workflow records."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from app.auth import hash_password
from app.database import db_manager
from app.ml.demand_forecaster import demand_forecaster
from app.ml.surplus_detector import surplus_detector


DEMO_PASSWORD = "SurplusDemo2026!"


async def seed_demo_data(db: Any) -> None:
    """Idempotently populates initial demo accounts, storage hubs, demand history, and sample rescue records."""
    existing_users = await db["users"].count_documents({})
    if existing_users > 0:
        history = await db["demand_history"].find({}).to_list(length=500)
        if history:
            demand_forecaster.retrain_with_history(history)
        return

    now = datetime.now(timezone.utc)
    pw_hash = hash_password(DEMO_PASSWORD)

    users: List[Dict[str, Any]] = [
        {
            "id": "user-biz-greenhearth",
            "email": "donor@greenhearthbakery.demo",
            "password_hash": pw_hash,
            "full_name": "Elena Rostova",
            "role": "business",
            "organization_name": "GreenHearth Artisan Bakery & Bistro",
            "business_type": "bakery_and_bistro",
            "verified": True,
            "location": {
                "lat": 37.7648,
                "lng": -122.4192,
                "address": "1840 Mission St, San Francisco, CA 94103",
                "city": "San Francisco",
            },
            "storage_capabilities": ["ambient", "refrigerated"],
            "is_demo_seed": True,
            "created_at": now - timedelta(days=30),
        },
        {
            "id": "user-biz-freshharvest",
            "email": "donor@freshharvestmarket.demo",
            "password_hash": pw_hash,
            "full_name": "Marcus Vance",
            "role": "business",
            "organization_name": "FreshHarvest Organic Supermarket",
            "business_type": "supermarket",
            "verified": True,
            "location": {
                "lat": 37.7879,
                "lng": -122.4043,
                "address": "520 Market St, San Francisco, CA 94104",
                "city": "San Francisco",
            },
            "storage_capabilities": ["ambient", "dry_bulk", "refrigerated", "frozen"],
            "is_demo_seed": True,
            "created_at": now - timedelta(days=28),
        },
        {
            "id": "user-org-hopehaven",
            "email": "org@hopehaven.demo",
            "password_hash": pw_hash,
            "full_name": "Sister Grace Okafor",
            "role": "organization",
            "organization_name": "HopeHaven Children & Elder Care",
            "organization_type": "orphanage",
            "verified": True,
            "location": {
                "lat": 37.7692,
                "lng": -122.4298,
                "address": "412 Guerrero St, San Francisco, CA 94110",
                "city": "San Francisco",
            },
            "storage_capabilities": ["ambient", "refrigerated"],
            "daily_capacity_kg": 65.0,
            "urgency_bias": 0.84,
            "monthly_logistics_budget_usd": 120.0,
            "preferred_categories": ["bakery", "produce", "dairy", "prepared_meals"],
            "is_demo_seed": True,
            "created_at": now - timedelta(days=45),
        },
        {
            "id": "user-org-stjude",
            "email": "org@stjudekitchen.demo",
            "password_hash": pw_hash,
            "full_name": "Chef Mateo Alvarez",
            "role": "organization",
            "organization_name": "St. Jude Community Kitchen",
            "organization_type": "community_kitchen",
            "verified": True,
            "location": {
                "lat": 37.7812,
                "lng": -122.4110,
                "address": "245 Turk St, San Francisco, CA 94102",
                "city": "San Francisco",
            },
            "storage_capabilities": ["ambient", "dry_bulk", "refrigerated"],
            "daily_capacity_kg": 95.0,
            "urgency_bias": 0.78,
            "monthly_logistics_budget_usd": 220.0,
            "preferred_categories": ["produce", "groceries", "bakery", "prepared_meals"],
            "is_demo_seed": True,
            "created_at": now - timedelta(days=42),
        },
        {
            "id": "user-org-silveroak",
            "email": "org@silveroakcare.demo",
            "password_hash": pw_hash,
            "full_name": "Hannah Lindqvist",
            "role": "organization",
            "organization_name": "SilverOak Old-Age Home",
            "organization_type": "old_age_home",
            "verified": True,
            "location": {
                "lat": 37.7599,
                "lng": -122.4410,
                "address": "890 Corbett Ave, San Francisco, CA 94131",
                "city": "San Francisco",
            },
            "storage_capabilities": ["ambient", "refrigerated"],
            "daily_capacity_kg": 55.0,
            "urgency_bias": 0.74,
            "monthly_logistics_budget_usd": 160.0,
            "preferred_categories": ["dairy", "bakery", "produce"],
            "is_demo_seed": True,
            "created_at": now - timedelta(days=39),
        },
        {
            "id": "user-org-cityshelter",
            "email": "org@cityshelter.demo",
            "password_hash": pw_hash,
            "full_name": "Devon Brooks",
            "role": "organization",
            "organization_name": "CityShelter Night Refuge",
            "organization_type": "homeless_shelter",
            "verified": True,
            "location": {
                "lat": 37.7845,
                "lng": -122.4079,
                "address": "155 6th St, San Francisco, CA 94103",
                "city": "San Francisco",
            },
            "storage_capabilities": ["ambient", "dry_bulk"],
            "daily_capacity_kg": 85.0,
            "urgency_bias": 0.89,
            "monthly_logistics_budget_usd": 90.0,
            "preferred_categories": ["bakery", "groceries", "beverages"],
            "is_demo_seed": True,
            "created_at": now - timedelta(days=35),
        },
        {
            "id": "user-org-eastbay",
            "email": "org@eastbayfoodbank.demo",
            "password_hash": pw_hash,
            "full_name": "Priya Nair",
            "role": "organization",
            "organization_name": "EastBay Regional Food Bank",
            "organization_type": "food_bank",
            "verified": True,
            "location": {
                "lat": 37.8044,
                "lng": -122.2712,
                "address": "790 14th St, Oakland, CA 94612",
                "city": "Oakland",
            },
            "storage_capabilities": ["ambient", "dry_bulk", "refrigerated", "frozen"],
            "daily_capacity_kg": 240.0,
            "urgency_bias": 0.81,
            "monthly_logistics_budget_usd": 480.0,
            "preferred_categories": ["frozen_goods", "dairy", "groceries", "produce"],
            "is_demo_seed": True,
            "created_at": now - timedelta(days=50),
        },
        {
            "id": "user-org-southbay",
            "email": "org@southbayngo.demo",
            "password_hash": pw_hash,
            "full_name": "Carlos Mendez",
            "role": "organization",
            "organization_name": "SouthBay Family Relief NGO",
            "organization_type": "ngo",
            "verified": True,
            "location": {
                "lat": 37.4419,
                "lng": -122.1430,
                "address": "310 University Ave, Palo Alto, CA 94301",
                "city": "Palo Alto",
            },
            "storage_capabilities": ["ambient", "refrigerated", "frozen"],
            "daily_capacity_kg": 180.0,
            "urgency_bias": 0.76,
            "monthly_logistics_budget_usd": 310.0,
            "preferred_categories": ["frozen_goods", "groceries", "produce"],
            "is_demo_seed": True,
            "created_at": now - timedelta(days=32),
        },
        {
            "id": "user-drv-ecohaul",
            "email": "driver@ecohaul.demo",
            "password_hash": pw_hash,
            "full_name": "Liam O'Connor",
            "role": "delivery_partner",
            "organization_name": "EcoHaul Cold-Chain Couriers",
            "verified": True,
            "location": {
                "lat": 37.7715,
                "lng": -122.4125,
                "address": "980 Howard St, San Francisco, CA 94103",
                "city": "San Francisco",
            },
            "vehicle_type": "refrigerated_van",
            "vehicle_capacity_kg": 450.0,
            "cold_chain_certified": True,
            "rating": 4.9,
            "paypal_payout_email": "sb-ecohaul-driver@business.example.com",
            "is_demo_seed": True,
            "created_at": now - timedelta(days=40),
        },
        {
            "id": "user-drv-swiftgreen",
            "email": "driver@swiftgreen.demo",
            "password_hash": pw_hash,
            "full_name": "Tariq Hassan",
            "role": "delivery_partner",
            "organization_name": "SwiftGreen Van Logistics",
            "verified": True,
            "location": {
                "lat": 37.7850,
                "lng": -122.4220,
                "address": "1120 Van Ness Ave, San Francisco, CA 94109",
                "city": "San Francisco",
            },
            "vehicle_type": "insulated_cargo_van",
            "vehicle_capacity_kg": 600.0,
            "cold_chain_certified": False,
            "rating": 4.7,
            "paypal_payout_email": "sb-swiftgreen-driver@business.example.com",
            "is_demo_seed": True,
            "created_at": now - timedelta(days=38),
        },
        {
            "id": "user-drv-urbanbike",
            "email": "driver@urbanbike.demo",
            "password_hash": pw_hash,
            "full_name": "Nadia Kim",
            "role": "delivery_partner",
            "organization_name": "UrbanBike Fresh Relief",
            "verified": True,
            "location": {
                "lat": 37.7765,
                "lng": -122.4170,
                "address": "640 Folsom St, San Francisco, CA 94107",
                "city": "San Francisco",
            },
            "vehicle_type": "cargo_ebike",
            "vehicle_capacity_kg": 45.0,
            "cold_chain_certified": False,
            "rating": 4.85,
            "paypal_payout_email": "sb-urbanbike-driver@business.example.com",
            "is_demo_seed": True,
            "created_at": now - timedelta(days=25),
        },
        {
            "id": "user-spn-emerald",
            "email": "sponsor@impactfund.demo",
            "password_hash": pw_hash,
            "full_name": "Clara Vance",
            "role": "sponsor",
            "organization_name": "Emerald Civic Foundation",
            "verified": True,
            "location": {
                "lat": 37.7918,
                "lng": -122.3990,
                "address": "101 California St, San Francisco, CA 94111",
                "city": "San Francisco",
            },
            "is_demo_seed": True,
            "created_at": now - timedelta(days=60),
        },
        {
            "id": "user-adm-maya",
            "email": "admin@surplusconnect.demo",
            "password_hash": pw_hash,
            "full_name": "Dr. Maya Lin",
            "role": "admin",
            "organization_name": "SurplusConnect Safety & Governance",
            "verified": True,
            "location": {
                "lat": 37.7793,
                "lng": -122.4193,
                "address": "1 Dr Carlton B Goodlett Pl, San Francisco, CA 94102",
                "city": "San Francisco",
            },
            "is_demo_seed": True,
            "created_at": now - timedelta(days=90),
        },
    ]
    await db["users"].insert_many(users)

    # Certified Intermediate Cold / Dry Storage Hubs (used by Intelligent Fallback Matching)
    storage_hubs = [
        {
            "id": "hub-soma-cold",
            "name": "SoMa Community Cold-Chain Staging Hub",
            "storage_capabilities": ["refrigerated", "frozen", "ambient"],
            "available_capacity_kg": 500.0,
            "location": {
                "lat": 37.7720,
                "lng": -122.4080,
                "address": "745 Bryant St, San Francisco, CA 94107",
                "city": "San Francisco",
            },
            "is_demo_seed": True,
        },
        {
            "id": "hub-oakland-port",
            "name": "Oakland Harbor Relief Cold Depot",
            "storage_capabilities": ["refrigerated", "frozen", "dry_bulk"],
            "available_capacity_kg": 1200.0,
            "location": {
                "lat": 37.7964,
                "lng": -122.2785,
                "address": "330 Embarcadero West, Oakland, CA 94607",
                "city": "Oakland",
            },
            "is_demo_seed": True,
        },
    ]
    await db["storage_hubs"].insert_many(storage_hubs)

    # Historical Demand records to enrich Scikit-learn demand forecaster
    demand_history = []
    for org in [u for u in users if u["role"] == "organization"]:
        for dow in range(7):
            for cat in org.get("preferred_categories", ["groceries"]):
                cap = float(org.get("daily_capacity_kg", 80.0))
                demand_history.append(
                    {
                        "organization_id": org["id"],
                        "org_type": org["organization_type"],
                        "category": cat,
                        "daily_capacity_kg": cap,
                        "current_utilization": 0.38 if dow in (4, 5, 6) else 0.52,
                        "urgency_bias": org.get("urgency_bias", 0.75),
                        "day_of_week": dow,
                        "observed_demand_kg": round(cap * (0.76 if dow in (4, 5, 6) else 0.62), 1),
                        "is_demo_seed": True,
                    }
                )
    await db["demand_history"].insert_many(demand_history)
    demand_forecaster.retrain_with_history(demand_history)

    # Seed realistic initial surplus inventory lots covering active, fallback, and completed states
    lot_completed = {
        "id": "lot-demo-completed-01",
        "business_id": "user-biz-greenhearth",
        "business_name": "GreenHearth Artisan Bakery & Bistro",
        "pickup_location": users[0]["location"],
        "title": "Artisan Sourdough Loaves & Whole-Grain Rolls",
        "description": "Day-end surplus batch of 72 sealed sourdough loaves and seeded multigrain rolls.",
        "category": "bakery",
        "quantity_kg": 48.0,
        "servings_estimate": 160,
        "unit_label": "kg",
        "storage_requirement": "ambient",
        "prepared_at": now - timedelta(hours=6),
        "expires_at": now + timedelta(hours=30),
        "pickup_window_start": now - timedelta(hours=2),
        "pickup_window_end": now + timedelta(hours=6),
        "packaging_type": "Food-grade breathable paper & sealed crates",
        "allergens": ["wheat", "sesame"],
        "handling_notes": "Keep dry at room temperature.",
        "estimated_retail_value_usd": 310.0,
        "historical_daily_turnover_kg": 40.0,
        "status": "completed",
        "fallback_activated": False,
        "expanded_radius_km": 10.0,
        "is_demo_seed": True,
        "created_at": now - timedelta(hours=5),
        "updated_at": now - timedelta(hours=1),
    }
    lot_completed["analysis"] = {
        **surplus_detector.validate_and_analyze(lot_completed),
        "ai_explanation": "Seeded demonstration lot: Ambient bakery surplus verified safe with 30h shelf life.",
        "ai_provider": "demo_seed",
    }

    lot_fallback_open = {
        "id": "lot-demo-frozen-02",
        "business_id": "user-biz-freshharvest",
        "business_name": "FreshHarvest Organic Supermarket",
        "pickup_location": users[1]["location"],
        "title": "Organic Frozen Vegetable & Protein Packs",
        "description": "Surplus pallet of IQF organic vegetables and plant-protein meal packs needing -18C cold chain.",
        "category": "frozen_goods",
        "quantity_kg": 140.0,
        "servings_estimate": 420,
        "unit_label": "kg",
        "storage_requirement": "frozen",
        "prepared_at": now - timedelta(days=2),
        "expires_at": now + timedelta(days=14),
        "pickup_window_start": now,
        "pickup_window_end": now + timedelta(hours=12),
        "packaging_type": "Insulated freezer cartons",
        "allergens": ["soy"],
        "handling_notes": "Requires -18C refrigerated/freezer truck throughout transit.",
        "estimated_retail_value_usd": 980.0,
        "historical_daily_turnover_kg": 65.0,
        "status": "awaiting_approval",
        "fallback_activated": True,
        "expanded_radius_km": 25.0,
        "storage_hub_options": [
            {
                "hub_id": "hub-oakland-port",
                "hub_name": "Oakland Harbor Relief Cold Depot",
                "location": storage_hubs[1]["location"],
                "distance_km": 11.4,
                "available_capacity_kg": 1200.0,
                "supported_storage": ["refrigerated", "frozen", "dry_bulk"],
                "safe_hold_hours": 48.0,
                "reason": "Frozen staging depot available across Bay Corridor if recipient intake shifts.",
            }
        ],
        "is_demo_seed": True,
        "created_at": now - timedelta(hours=2),
        "updated_at": now - timedelta(minutes=30),
    }
    lot_fallback_open["analysis"] = {
        **surplus_detector.validate_and_analyze(lot_fallback_open),
        "ai_explanation": "Seeded demonstration lot: 140 kg frozen surplus triggered Fallback Matching to EastBay Regional Food Bank (Oakland) after 0 SF organizations had frozen storage.",
        "ai_provider": "demo_seed",
    }

    await db["inventory_lots"].insert_many([lot_completed, lot_fallback_open])

    # Seed Allocations, Campaigns, Delivery, Approval & Demo Transaction (explicitly marked is_demo_seed=True)
    alloc_completed = {
        "id": "alloc-demo-01",
        "inventory_id": "lot-demo-completed-01",
        "inventory_title": lot_completed["title"],
        "category": "bakery",
        "storage_requirement": "ambient",
        "business_id": "user-biz-greenhearth",
        "business_name": "GreenHearth Artisan Bakery & Bistro",
        "pickup_location": users[0]["location"],
        "organization_id": "user-org-hopehaven",
        "organization_name": "HopeHaven Children & Elder Care",
        "organization_type": "orphanage",
        "dropoff_location": users[2]["location"],
        "allocated_kg": 48.0,
        "distance_km": 1.35,
        "match_score": 94.2,
        "urgency_score": 86.4,
        "is_fallback_match": False,
        "fallback_tier": None,
        "status": "delivered",
        "vehicle_requirements": {
            "required_vehicle_class": "insulated_cargo_van",
            "cold_chain_required": False,
            "target_temperature": "Ambient 15C to 22C",
            "estimated_crates": 4,
            "handling_crew": 1,
        },
        "route": {
            "distance_km": 1.8,
            "duration_minutes": 8,
            "route_source": "demo_seed_route",
            "waypoints": [
                {"lat": users[0]["location"]["lat"], "lng": users[0]["location"]["lng"]},
                {"lat": users[2]["location"]["lat"], "lng": users[2]["location"]["lng"]},
            ],
        },
        "cost_breakdown": {
            "base_dispatch_usd": 12.0,
            "distance_fee_usd": 2.25,
            "weight_handling_usd": 6.72,
            "cold_chain_surcharge_usd": 0.0,
            "fallback_corridor_usd": 0.0,
            "total_estimated_cost_usd": 20.97,
        },
        "recommended_partner": {
            "partner_id": "user-drv-swiftgreen",
            "partner_name": "SwiftGreen Van Logistics",
            "suitability_score": 92.4,
        },
        "funding_recommendation": {
            "recommended_mode": "sponsor_funded",
            "self_funded_share_pct": 0.0,
            "self_funded_amount_usd": 0.0,
            "sponsor_target_amount_usd": 20.97,
            "total_required_usd": 20.97,
            "rationale": "100% Sponsor-Funded rescue recommended for HopeHaven orphanage.",
        },
        "expires_at": lot_completed["expires_at"],
        "created_at": now - timedelta(hours=4),
        "updated_at": now - timedelta(hours=1),
        "is_demo_seed": True,
    }

    alloc_fallback = {
        "id": "alloc-demo-02",
        "inventory_id": "lot-demo-frozen-02",
        "inventory_title": lot_fallback_open["title"],
        "category": "frozen_goods",
        "storage_requirement": "frozen",
        "business_id": "user-biz-freshharvest",
        "business_name": "FreshHarvest Organic Supermarket",
        "pickup_location": users[1]["location"],
        "organization_id": "user-org-eastbay",
        "organization_name": "EastBay Regional Food Bank",
        "organization_type": "food_bank",
        "dropoff_location": users[6]["location"],
        "allocated_kg": 140.0,
        "distance_km": 11.86,
        "match_score": 88.7,
        "urgency_score": 81.2,
        "is_fallback_match": True,
        "fallback_tier": "tier_1_metro",
        "status": "awaiting_safety_approval",
        "vehicle_requirements": {
            "required_vehicle_class": "refrigerated_van",
            "cold_chain_required": True,
            "target_temperature": "-18C to -12C",
            "estimated_crates": 10,
            "handling_crew": 1,
        },
        "route": {
            "distance_km": 16.4,
            "duration_minutes": 26,
            "route_source": "demo_seed_route",
            "waypoints": [
                {"lat": users[1]["location"]["lat"], "lng": users[1]["location"]["lng"]},
                {"lat": users[6]["location"]["lat"], "lng": users[6]["location"]["lng"]},
            ],
        },
        "cost_breakdown": {
            "base_dispatch_usd": 12.0,
            "distance_fee_usd": 27.06,
            "weight_handling_usd": 19.6,
            "cold_chain_surcharge_usd": 8.5,
            "fallback_corridor_usd": 0.0,
            "total_estimated_cost_usd": 67.16,
        },
        "recommended_partner": {
            "partner_id": "user-drv-ecohaul",
            "partner_name": "EcoHaul Cold-Chain Couriers",
            "suitability_score": 96.1,
        },
        "funding_recommendation": {
            "recommended_mode": "shared_funding",
            "self_funded_share_pct": 40.0,
            "self_funded_amount_usd": 26.86,
            "sponsor_target_amount_usd": 40.30,
            "total_required_usd": 67.16,
            "rationale": "Fallback corridor rescue across San Francisco-Oakland Bay Bridge.",
        },
        "expires_at": lot_fallback_open["expires_at"],
        "created_at": now - timedelta(hours=1),
        "updated_at": now - timedelta(minutes=30),
        "is_demo_seed": True,
    }
    await db["allocations"].insert_many([alloc_completed, alloc_fallback])

    campaigns = [
        {
            "id": "camp-demo-01",
            "allocation_id": "alloc-demo-01",
            "inventory_id": "lot-demo-completed-01",
            "title": "Rescue 48.0 kg Artisan Sourdough -> HopeHaven Children & Elder Care",
            "business_name": "GreenHearth Artisan Bakery & Bistro",
            "organization_id": "user-org-hopehaven",
            "organization_name": "HopeHaven Children & Elder Care",
            "funding_mode": "sponsor_funded",
            "required_amount_usd": 20.97,
            "self_funded_committed_usd": 0.0,
            "sponsor_target_usd": 20.97,
            "funded_amount_usd": 20.97,
            "status": "funded",
            "distance_km": 1.8,
            "allocated_kg": 48.0,
            "urgency_score": 86.4,
            "is_fallback_match": False,
            "rationale": "Seeded completed demo rescue campaign.",
            "is_demo_seed": True,
            "created_at": now - timedelta(hours=4),
            "updated_at": now - timedelta(hours=2),
        },
        {
            "id": "camp-demo-02",
            "allocation_id": "alloc-demo-02",
            "inventory_id": "lot-demo-frozen-02",
            "title": "Fallback Cold-Chain Rescue: 140 kg Frozen Organic Packs -> EastBay Food Bank",
            "business_name": "FreshHarvest Organic Supermarket",
            "organization_id": "user-org-eastbay",
            "organization_name": "EastBay Regional Food Bank",
            "funding_mode": "shared_funding",
            "required_amount_usd": 67.16,
            "self_funded_committed_usd": 26.86,
            "sponsor_target_usd": 40.30,
            "funded_amount_usd": 26.86,
            "status": "open",
            "distance_km": 16.4,
            "allocated_kg": 140.0,
            "urgency_score": 81.2,
            "is_fallback_match": True,
            "rationale": "Open sponsor funding opportunity for Bay Bridge cold-chain delivery.",
            "is_demo_seed": True,
            "created_at": now - timedelta(hours=1),
            "updated_at": now - timedelta(minutes=25),
        },
    ]
    await db["funding_campaigns"].insert_many(campaigns)

    await db["deliveries"].insert_one(
        {
            "id": "deliv-demo-01",
            "allocation_id": "alloc-demo-01",
            "inventory_id": "lot-demo-completed-01",
            "inventory_title": lot_completed["title"],
            "business_name": "GreenHearth Artisan Bakery & Bistro",
            "organization_id": "user-org-hopehaven",
            "organization_name": "HopeHaven Children & Elder Care",
            "partner_id": "user-drv-swiftgreen",
            "partner_name": "SwiftGreen Van Logistics",
            "partner_payout_email": "sb-swiftgreen-driver@business.example.com",
            "pickup_location": users[0]["location"],
            "dropoff_location": users[2]["location"],
            "allocated_kg": 48.0,
            "storage_requirement": "ambient",
            "route": alloc_completed["route"],
            "estimated_cost_usd": 20.97,
            "status": "delivered",
            "temperature_verified_c": 19.4,
            "recipient_confirmation_name": "Sister Grace Okafor",
            "delivery_notes": "Delivered 4 crates intact at Guerrero St kitchen dock.",
            "payout_eligible": True,
            "payout_status": "demo_seed_settled",
            "is_demo_seed": True,
            "created_at": now - timedelta(hours=3),
            "updated_at": now - timedelta(hours=1),
        }
    )

    await db["transactions"].insert_one(
        {
            "id": "txn-demo-01",
            "campaign_id": "camp-demo-01",
            "allocation_id": "alloc-demo-01",
            "type": "sponsor_contribution",
            "payer_id": "user-spn-emerald",
            "payer_name": "Emerald Civic Foundation",
            "amount_usd": 20.97,
            "currency": "USD",
            "payment_mode": "demo_seed",
            "paypal_order_id": None,
            "paypal_capture_id": None,
            "status": "COMPLETED",
            "is_demo_seed": True,
            "created_at": now - timedelta(hours=2),
        }
    )

    await db["approval_requests"].insert_one(
        {
            "id": "appr-demo-01",
            "run_id": "run-demo-02",
            "inventory_id": "lot-demo-frozen-02",
            "allocation_id": "alloc-demo-02",
            "all_allocation_ids": ["alloc-demo-02"],
            "gate_type": "food_safety_approval",
            "title": "Food Safety Sign-Off: 140 kg Frozen Organic Packs (Fallback Bay Corridor)",
            "reason": "High-volume cold-chain lot (140 kg frozen) routed across 16.4 km fallback corridor requires temperature continuity sign-off.",
            "severity": "high",
            "status": "pending",
            "payload": {
                "storage_requirement": "frozen",
                "distance_km": 16.4,
                "recipient": "EastBay Regional Food Bank",
            },
            "is_demo_seed": True,
            "created_at": now - timedelta(minutes=45),
            "resolved_at": None,
            "resolved_by": None,
            "reviewer_notes": None,
        }
    )

    await db_manager.maybe_persist()

