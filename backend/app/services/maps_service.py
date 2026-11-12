"""Google Maps Platform Routes API and Geocoding API backend service."""

from __future__ import annotations

import asyncio
import math
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.config import get_settings


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two coordinates in kilometers."""
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


def _parse_duration_seconds(duration_str: Optional[str]) -> int:
    if not duration_str:
        return 0
    cleaned = str(duration_str).strip()
    if cleaned.endswith("s"):
        cleaned = cleaned[:-1]
    try:
        return int(float(cleaned))
    except ValueError:
        return 0


class MapsService:
    """Server-side wrapper for Google Maps Platform Routes API v2 and Geocoding API."""

    ROUTES_COMPUTE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
    ROUTES_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
    GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
    OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1"
    NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"

    def __init__(self) -> None:
        self._osrm_cache: Dict[Tuple[float, float, float, float, str], Tuple[float, Dict[str, Any]]] = {}
        self._nominatim_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._nominatim_lock = asyncio.Lock()
        self._last_nominatim_ts: float = 0.0

    async def compute_route(
        self,
        origin_lat: float,
        origin_lng: float,
        dest_lat: float,
        dest_lng: float,
        travel_mode: str = "DRIVE",
        intermediates: Optional[List[Dict[str, float]]] = None,
    ) -> Dict[str, Any]:
        """Calls Google Routes API computeRoutes, with transparent geodesic estimate if key is unset."""
        settings = get_settings()
        straight_km = haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)

        if settings.has_google_maps:
            headers = {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": settings.GOOGLE_MAPS_API_KEY,
                "X-Goog-FieldMask": (
                    "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,"
                    "routes.routeLabels,routes.legs.distanceMeters,routes.legs.duration"
                ),
                "X-Goog-Maps-Solution-ID": "gmp_git_agentskills_v1",
            }
            payload: Dict[str, Any] = {
                "origin": {
                    "location": {"latLng": {"latitude": origin_lat, "longitude": origin_lng}}
                },
                "destination": {
                    "location": {"latLng": {"latitude": dest_lat, "longitude": dest_lng}}
                },
                "travelMode": travel_mode if travel_mode in {"DRIVE", "BICYCLE", "WALK", "TWO_WHEELER"} else "DRIVE",
                "routingPreference": "TRAFFIC_AWARE" if travel_mode in {"DRIVE", "TWO_WHEELER"} else "ROUTING_PREFERENCE_UNSPECIFIED",
                "computeAlternativeRoutes": False,
                "languageCode": "en-US",
                "units": "METRIC",
            }
            if payload["routingPreference"] == "ROUTING_PREFERENCE_UNSPECIFIED":
                payload.pop("routingPreference")
            if intermediates:
                payload["intermediates"] = [
                    {"location": {"latLng": {"latitude": pt["lat"], "longitude": pt["lng"]}}}
                    for pt in intermediates
                ]

            try:
                async with httpx.AsyncClient(timeout=12.0) as client:
                    resp = await client.post(self.ROUTES_COMPUTE_URL, headers=headers, json=payload)
                    if resp.status_code == 200:
                        data = resp.json()
                        routes = data.get("routes") or []
                        if routes:
                            primary = routes[0]
                            dist_m = int(primary.get("distanceMeters", 0))
                            dur_s = _parse_duration_seconds(primary.get("duration"))
                            poly = (primary.get("polyline") or {}).get("encodedPolyline")
                            return {
                                "distance_km": round(dist_m / 1000.0, 2),
                                "distance_meters": dist_m,
                                "duration_minutes": max(1, round(dur_s / 60.0)),
                                "duration_seconds": dur_s,
                                "encoded_polyline": poly,
                                "travel_mode": travel_mode,
                                "route_source": "google_routes_api_v2",
                                "waypoints": [
                                    {"lat": origin_lat, "lng": origin_lng},
                                    *(intermediates or []),
                                    {"lat": dest_lat, "lng": dest_lng},
                                ],
                            }
            except Exception as exc:
                # Fall through transparently with error note if network/API call fails
                fallback_note = f"haversine_estimate (Routes API request failed: {exc})"
            else:
                fallback_note = "haversine_estimate (Routes API returned no routes)"
        else:
            fallback_note = "haversine_estimate (GOOGLE_MAPS_API_KEY not configured)"

        # Transparent geodesic estimate (1.28x urban road factor)
        est_road_km = max(0.4, round(straight_km * 1.28, 2))
        avg_speed_kmh = 28.0 if travel_mode == "DRIVE" else 18.0
        est_minutes = max(4, round((est_road_km / avg_speed_kmh) * 60.0))
        return {
            "distance_km": est_road_km,
            "distance_meters": int(est_road_km * 1000),
            "duration_minutes": est_minutes,
            "duration_seconds": est_minutes * 60,
            "encoded_polyline": None,
            "travel_mode": travel_mode,
            "route_source": fallback_note,
            "waypoints": [
                {"lat": origin_lat, "lng": origin_lng},
                *(intermediates or []),
                {"lat": dest_lat, "lng": dest_lng},
            ],
        }

    async def compute_route_matrix(
        self,
        origin: Dict[str, float],
        destinations: List[Dict[str, float]],
        travel_mode: str = "DRIVE",
    ) -> List[Dict[str, Any]]:
        """Calls Google Routes API computeRouteMatrix for multi-destination ETA comparison."""
        settings = get_settings()
        if settings.has_google_maps and destinations:
            headers = {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": settings.GOOGLE_MAPS_API_KEY,
                "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status,condition",
                "X-Goog-Maps-Solution-ID": "gmp_git_agentskills_v1",
            }
            payload = {
                "origins": [
                    {"waypoint": {"location": {"latLng": {"latitude": origin["lat"], "longitude": origin["lng"]}}}}
                ],
                "destinations": [
                    {"waypoint": {"location": {"latLng": {"latitude": d["lat"], "longitude": d["lng"]}}}}
                    for d in destinations[:25]
                ],
                "travelMode": travel_mode,
                "routingPreference": "TRAFFIC_AWARE",
            }
            try:
                async with httpx.AsyncClient(timeout=12.0) as client:
                    resp = await client.post(self.ROUTES_MATRIX_URL, headers=headers, json=payload)
                    if resp.status_code == 200 and isinstance(resp.json(), list):
                        results = []
                        for item in resp.json():
                            dist_m = int(item.get("distanceMeters", 0))
                            dur_s = _parse_duration_seconds(item.get("duration"))
                            results.append(
                                {
                                    "destination_index": item.get("destinationIndex", 0),
                                    "distance_km": round(dist_m / 1000.0, 2),
                                    "duration_minutes": max(1, round(dur_s / 60.0)),
                                    "condition": item.get("condition", "ROUTE_EXISTS"),
                                    "route_source": "google_routes_matrix_v2",
                                }
                            )
                        return sorted(results, key=lambda x: x["destination_index"])
            except Exception:
                pass

        out: List[Dict[str, Any]] = []
        for idx, dest in enumerate(destinations):
            km = round(haversine_km(origin["lat"], origin["lng"], dest["lat"], dest["lng"]) * 1.28, 2)
            out.append(
                {
                    "destination_index": idx,
                    "distance_km": km,
                    "duration_minutes": max(4, round((km / 28.0) * 60.0)),
                    "condition": "ESTIMATED",
                    "route_source": "haversine_estimate",
                }
            )
        return out

    async def geocode_address(self, address: str) -> Dict[str, Any]:
        """Geocodes a postal address using Google Geocoding REST API."""
        settings = get_settings()
        if not settings.has_google_maps:
            return {
                "geocoded": False,
                "reason": "GOOGLE_MAPS_API_KEY not configured",
                "address": address,
            }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    self.GEOCODE_URL,
                    params={"address": address, "key": settings.GOOGLE_MAPS_API_KEY},
                )
                data = resp.json()
                results = data.get("results") or []
                if data.get("status") == "OK" and results:
                    top = results[0]
                    loc = top["geometry"]["location"]
                    return {
                        "geocoded": True,
                        "lat": loc["lat"],
                        "lng": loc["lng"],
                        "formatted_address": top.get("formatted_address", address),
                        "place_id": top.get("place_id"),
                    }
                return {"geocoded": False, "reason": data.get("status", "NO_RESULTS"), "address": address}
        except Exception as exc:
            return {"geocoded": False, "reason": str(exc), "address": address}

    async def compute_osrm_road_route(
        self,
        origin_lat: float,
        origin_lng: float,
        dest_lat: float,
        dest_lng: float,
        profile: str = "driving",
    ) -> Dict[str, Any]:
        """Fetches real road geometry, distance, and duration from OSRM without inventing fallback geometry."""
        if (abs(origin_lat) < 0.0001 and abs(origin_lng) < 0.0001) or (
            abs(dest_lat) < 0.0001 and abs(dest_lng) < 0.0001
        ):
            return {
                "available": False,
                "source": "unavailable",
                "distance_km": None,
                "duration_minutes": None,
                "geometry": [],
                "reason": "Missing valid coordinates for route endpoints.",
            }

        cache_key = (
            round(origin_lat, 5),
            round(origin_lng, 5),
            round(dest_lat, 5),
            round(dest_lng, 5),
            profile,
        )
        now = time.monotonic()
        cached = self._osrm_cache.get(cache_key)
        if cached and (now - cached[0]) < 1800:
            return cached[1]

        url = f"{self.OSRM_ROUTE_URL}/{profile}/{origin_lng},{origin_lat};{dest_lng},{dest_lat}"
        try:
            async with httpx.AsyncClient(
                timeout=8.0,
                headers={"User-Agent": "SurplusConnectAI/1.0 (logistics-routing)"},
            ) as client:
                resp = await client.get(
                    url,
                    params={"overview": "full", "geometries": "geojson", "steps": "false"},
                )
                if resp.status_code != 200:
                    return {
                        "available": False,
                        "source": "unavailable",
                        "distance_km": None,
                        "duration_minutes": None,
                        "geometry": [],
                        "reason": f"Routing service returned HTTP {resp.status_code}.",
                    }
                data = resp.json()
                routes = data.get("routes") or []
                if data.get("code") != "Ok" or not routes:
                    return {
                        "available": False,
                        "source": "unavailable",
                        "distance_km": None,
                        "duration_minutes": None,
                        "geometry": [],
                        "reason": "No drivable road route found between these coordinates.",
                    }
                primary = routes[0]
                coords = (primary.get("geometry") or {}).get("coordinates") or []
                geometry = [{"lat": float(c[1]), "lng": float(c[0])} for c in coords if len(c) >= 2]
                if len(geometry) < 2:
                    return {
                        "available": False,
                        "source": "unavailable",
                        "distance_km": None,
                        "duration_minutes": None,
                        "geometry": [],
                        "reason": "Routing service returned empty geometry.",
                    }
                dist_km = round(float(primary.get("distance", 0.0)) / 1000.0, 2)
                dur_min = max(1, round(float(primary.get("duration", 0.0)) / 60.0))
                result = {
                    "available": True,
                    "source": "osrm",
                    "distance_km": dist_km,
                    "duration_minutes": dur_min,
                    "geometry": geometry,
                    "reason": None,
                }
                if len(self._osrm_cache) >= 500:
                    self._osrm_cache.clear()
                self._osrm_cache[cache_key] = (now, result)
                return result
        except Exception:
            return {
                "available": False,
                "source": "unavailable",
                "distance_km": None,
                "duration_minutes": None,
                "geometry": [],
                "reason": "Road routing service is currently unreachable.",
            }

    async def search_nominatim(self, query: str, limit: int = 5) -> Dict[str, Any]:
        """Responsible geocoding search via OpenStreetMap Nominatim with caching & rate-limit spacing."""
        norm_q = " ".join(query.strip().lower().split())
        if len(norm_q) < 3:
            return {"available": False, "items": [], "reason": "Enter at least 3 characters to search."}

        now = time.monotonic()
        cached = self._nominatim_cache.get(norm_q)
        if cached and (now - cached[0]) < 3600:
            return cached[1]

        async with self._nominatim_lock:
            now_locked = time.monotonic()
            cached_locked = self._nominatim_cache.get(norm_q)
            if cached_locked and (now_locked - cached_locked[0]) < 3600:
                return cached_locked[1]

            elapsed = now_locked - self._last_nominatim_ts
            if elapsed < 1.05:
                await asyncio.sleep(1.05 - elapsed)

            self._last_nominatim_ts = time.monotonic()
            try:
                async with httpx.AsyncClient(
                    timeout=8.0,
                    headers={"User-Agent": "SurplusConnectAI/1.0 (support@surplusconnect.org)"},
                ) as client:
                    resp = await client.get(
                        self.NOMINATIM_SEARCH_URL,
                        params={
                            "q": query.strip(),
                            "format": "jsonv2",
                            "addressdetails": 1,
                            "limit": min(max(1, limit), 6),
                        },
                    )
                    if resp.status_code != 200:
                        return {
                            "available": False,
                            "items": [],
                            "reason": "Address lookup service is temporarily busy. Please try again or place your pin directly on the map.",
                        }
                    rows = resp.json()
                    items: List[Dict[str, Any]] = []
                    for r in rows if isinstance(rows, list) else []:
                        addr = r.get("address") or {}
                        road = " ".join(
                            p for p in [addr.get("house_number"), addr.get("road")] if p
                        ).strip()
                        locality = (
                            addr.get("city")
                            or addr.get("town")
                            or addr.get("village")
                            or addr.get("suburb")
                            or addr.get("county")
                            or ""
                        )
                        items.append(
                            {
                                "display_name": r.get("display_name", query.strip()),
                                "lat": float(r["lat"]),
                                "lng": float(r["lon"]),
                                "address": road or (r.get("name") or r.get("display_name", "").split(",")[0]),
                                "city": locality or "Unknown City",
                            }
                        )
                    payload = {"available": True, "items": items, "reason": None}
                    if len(self._nominatim_cache) >= 300:
                        self._nominatim_cache.clear()
                    self._nominatim_cache[norm_q] = (time.monotonic(), payload)
                    return payload
            except Exception:
                return {
                    "available": False,
                    "items": [],
                    "reason": "Address search unavailable right now. You can click directly on the map to place your pin.",
                }


maps_service = MapsService()

