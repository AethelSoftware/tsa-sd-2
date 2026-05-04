"""
gdelt_fetcher.py — GDELT GKG v2 hazard source for any city
Queries https://api.gdeltproject.org/api/v2/doc/doc for real-time news
extracting violence/accident/protest themes and geocoding to hazard points.
"""
import os
import logging
import requests
import hashlib
import time
import random
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import math
import concurrent.futures

logger = logging.getLogger(__name__)

# GDELT API configuration
GDELT_CACHE_DURATION = 1800  # 30 minutes (increased from 600 due to rate limits)
GDELT_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc"

# Theme to hazard type mapping (legacy, kept for compatibility)
GDELT_THEME_MAP = {
    "CRISISLEX_O01_CONFLICT": {"type": "violent", "severity": 0.80},
    "WB_868_CRIME_AND_VIOLENCE": {"type": "crime", "severity": 0.75},
    "TAX_FNCACT_CRIMINAL": {"type": "crime", "severity": 0.65},
    "TAX_FNCACT_POLICE": {"type": "crime", "severity": 0.55},
    "PROTEST": {"type": "protest", "severity": 0.60},
    "ENV_FIRE": {"type": "fire", "severity": 0.85},
    "ENV_FLOOD": {"type": "hazardous", "severity": 0.80},
    "TRANSPORT_ACCIDENT": {"type": "accident", "severity": 0.70},
    "CRISISLEX_CRISISLEXREC": {"type": "emergency", "severity": 0.75},
}

# Try to import city_config
try:
    from city_config import CITIES, get_city
    _CITY_CONFIG_AVAILABLE = True
except ImportError:
    _CITY_CONFIG_AVAILABLE = False
    logger.warning("city_config not available, GDELT will use fallback config")

class GDELTFetcher:
    """Fetch real-time hazards from GDELT for any city with rate limiting and retries."""

    def __init__(self):
        self._cache: Dict[str, Dict] = {}
        self._geocode_cache: Dict[str, Optional[Dict]] = {}
        self.tomtom_key = os.getenv("TOMTOM_API_KEY", "pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM")
        # Rate limiting state
        self._rate_limit_backoff_until: float = 0.0
        self._last_request_time: float = 0.0
        self._min_request_spacing_seconds: float = 4.0  # GDELT free tier recommendation
        logger.info("GDELT Fetcher initialized with rate limiting, cache duration 30min")

    def fetch_hazards_for_city(
        self,
        city_key: str,
        city_config: Dict[str, Any],
        force_refresh: bool = False
    ) -> List[Dict[str, Any]]:
        """Fetch GDELT hazards for a given city using keyword full-text search."""
        cache_key = f"gdelt_{city_key}"

        # Backoff guard
        now = time.time()
        if now < self._rate_limit_backoff_until:
            remaining = int(self._rate_limit_backoff_until - now)
            logger.debug(f"GDELT [{city_key}] in backoff for {remaining}s")
            return self._cache.get(cache_key, {}).get("hazards", [])

        if not force_refresh and cache_key in self._cache:
            cached = self._cache[cache_key]
            age = (datetime.now() - cached["timestamp"]).total_seconds()
            if age < GDELT_CACHE_DURATION:
                logger.debug(
                    f"GDELT cache hit for {city_key}: {len(cached['hazards'])} hazards"
                )
                return cached["hazards"]

        geoname = city_config.get("gdelt_geoname", city_key)

        # artlist mode is a full-text search — use natural language keywords
        keywords = (
            "shooting OR homicide OR stabbing OR robbery OR assault OR "
            "arrest OR crime OR fire OR explosion OR emergency OR "
            "accident OR hazmat OR flooding OR protest"
        )
        city_term = geoname.replace('"', '').strip()
        query = f"({keywords}) {city_term}"

        # Request spacing
        elapsed = now - self._last_request_time
        if elapsed < self._min_request_spacing_seconds:
            sleep_for = self._min_request_spacing_seconds - elapsed
            logger.debug(f"GDELT spacing: sleeping {sleep_for:.2f}s")
            time.sleep(sleep_for)
        self._last_request_time = time.time()

        # Retry loop for SSL errors and timeouts
        for attempt in range(3):
            try:
                params = {
                    "query":      query,
                    "mode":       "artlist",
                    "maxrecords": "25",      # must be string
                    "format":     "json",
                    "timespan":   "24H",     # back to 24H (original default)
                    "sourcelang": "English",
                    "sort":       "DateDesc",
                }
                resp = requests.get(
                    GDELT_BASE_URL,
                    params=params,
                    timeout=15,
                    headers={"Accept": "application/json", "User-Agent": "Tryver/1.0"},
                )
                break  # success, exit retry loop
            except requests.exceptions.SSLError as ssl_err:
                if attempt == 2:
                    logger.warning(f"GDELT [{city_key}] SSL failed after 3 attempts: {ssl_err}")
                    return self._cache.get(cache_key, {}).get("hazards", [])
                sleep_for = (2 ** attempt) + random.uniform(0, 1)
                logger.debug(f"GDELT SSL retry {attempt+1} in {sleep_for:.1f}s")
                time.sleep(sleep_for)
            except requests.exceptions.Timeout:
                logger.warning(f"GDELT [{city_key}] timeout on attempt {attempt+1}")
                if attempt == 2:
                    return self._cache.get(cache_key, {}).get("hazards", [])
                time.sleep(2 ** attempt)
        else:
            # Loop completed without break (should not happen)
            return self._cache.get(cache_key, {}).get("hazards", [])

        if resp.status_code == 429:
            self._rate_limit_backoff_until = time.time() + 300  # 5 minutes
            logger.warning(
                f"GDELT [{city_key}] HTTP 429 — backing off for 5 minutes"
            )
            return self._cache.get(cache_key, {}).get("hazards", [])

        if resp.status_code != 200:
            logger.warning(f"GDELT [{city_key}] HTTP {resp.status_code}")
            return self._cache.get(cache_key, {}).get("hazards", [])

        # Guard: empty body
        if not resp.text or not resp.text.strip():
            logger.warning(f"GDELT [{city_key}] empty response body")
            return self._cache.get(cache_key, {}).get("hazards", [])

        try:
            data = resp.json()
        except ValueError as json_err:
            logger.warning(f"GDELT [{city_key}] JSON parse error: {json_err}")
            return self._cache.get(cache_key, {}).get("hazards", [])

        # GDELT returns {"articles": null} when no results
        articles = data.get("articles") or []
        if not isinstance(articles, list):
            articles = []

        logger.info(f"GDELT returned {len(articles)} articles for {city_key}")

        hazards = []
        for article in articles:
            hazard = self._article_to_hazard(article, city_config)
            if hazard:
                hazards.append(hazard)

        hazards = self._deduplicate_proximity(hazards)

        self._cache[cache_key] = {"hazards": hazards, "timestamp": datetime.now()}
        logger.info(f"GDELT: {len(hazards)} hazards extracted for {city_key}")
        return hazards

    def fetch_all_cities(self, force_refresh: bool = False) -> dict:
        """Fetch GDELT hazards for ALL configured cities in parallel."""
        results = {}

        cities_to_fetch = CITIES if _CITY_CONFIG_AVAILABLE else {
            "pittsburgh": {
                "gdelt_geoname": "Pittsburgh Pennsylvania",
                "center_lat": 40.4406, "center_lng": -79.9959,
                "bbox": {"min_lat":40.2,"max_lat":40.8,"min_lng":-80.8,"max_lng":-79.5}
            }
        }

        def _fetch_one(city_key, cfg):
            try:
                return city_key, self.fetch_hazards_for_city(
                    city_key, cfg, force_refresh=force_refresh
                )
            except Exception as exc:
                logger.warning(f"GDELT [{city_key}] parallel fetch failed: {exc}")
                return city_key, []

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            futures = {
                pool.submit(_fetch_one, k, v): k
                for k, v in cities_to_fetch.items()
            }
            for fut in concurrent.futures.as_completed(futures, timeout=25):
                city_key, hazards = fut.result()
                results[city_key] = hazards

        total = sum(len(v) for v in results.values())
        logger.info(f"GDELT all-city fetch complete: {total} total hazards across {len(results)} cities")
        return results

    def _article_to_hazard(
        self,
        article: Dict,
        city_config: Dict
    ) -> Optional[Dict[str, Any]]:
        """Convert a GDELT article to a Tryver hazard dict."""
        title = article.get("title", "")
        url = article.get("url", "")

        # ── Severity + type detection ─────────────────────────────────────
        title_lower = title.lower()
        hazard_type = "crime"
        severity    = 0.55

        # 1. Theme tags (optional, often not present in artlist mode)
        themes_raw = article.get("themes", "") or ""
        themes_str = " ".join(
            themes_raw.split(";") if isinstance(themes_raw, str) else []
        )
        for theme_key, mapping in GDELT_THEME_MAP.items():
            if theme_key in themes_str and mapping["severity"] > severity:
                hazard_type = mapping["type"]
                severity    = mapping["severity"]

        # 2. Title keyword detection (primary signal)
        TITLE_KEYWORD_MAP = [
            (["shooting", "shot", "gunshot", "gunfire"],       "violent",   0.90),
            (["homicide", "murder", "killed", "fatal"],        "violent",   0.92),
            (["stabbing", "stabbed", "knife attack"],          "violent",   0.85),
            (["robbery", "robbed", "armed robbery"],           "violent",   0.83),
            (["assault", "attack", "beaten"],                  "violent",   0.82),
            (["fire", "blaze", "flames", "arson"],             "fire",      0.85),
            (["explosion", "blast", "bomb", "detonation"],     "hazardous", 0.88),
            (["flood", "flooding", "water main break"],        "hazardous", 0.72),
            (["hazmat", "chemical spill", "gas leak"],         "hazardous", 0.80),
            (["crash", "collision", "car accident"],           "accident",  0.70),
            (["protest", "demonstration", "riot", "unrest"],   "protest",   0.62),
            (["arrest", "charged", "suspect", "indicted"],     "crime",     0.58),
        ]
        for kw_list, h_type, h_sev in TITLE_KEYWORD_MAP:
            if any(kw in title_lower for kw in kw_list):
                if h_sev > severity:
                    hazard_type = h_type
                    severity    = h_sev
                break

        # Geocode to city center with hash-based jitter
        lat_lng = self._geocode_article(article, city_config, title)
        if lat_lng is None:
            return None
        lat_f, lng_f = lat_lng

        if not title:
            return None

        return {
            "type": hazard_type,
            "description": f"[NEWS] {title[:120]}",
            "full_description": title,
            "lat": lat_f,
            "lng": lng_f,
            "severity": severity,
            "source": "gdelt",
            "url": url,
            "publisher": article.get("domain", "GDELT"),
            "published_date": article.get("seendate", datetime.now().isoformat()),
            "is_active": True,
            "radius": 150,
        }

    def _geocode_article(self, article: Dict, city_config: Dict, title: str) -> Optional[tuple]:
        """Return (lat, lng) for article, falling back to city center with jitter."""
        lat = article.get("latitude")
        lng = article.get("longitude")
        center_lat = city_config["center_lat"]
        center_lng = city_config["center_lng"]
        bbox = city_config["bbox"]

        if lat and lng:
            try:
                lat_f = float(lat)
                lng_f = float(lng)
                if (bbox["min_lat"] <= lat_f <= bbox["max_lat"] and
                    bbox["min_lng"] <= lng_f <= bbox["max_lng"]):
                    return (lat_f, lng_f)
            except (ValueError, TypeError):
                pass

        # Fallback: city center with deterministic jitter
        jitter_input = f"{title}:{city_config.get('gdelt_geoname','')}"
        h = int(hashlib.md5(jitter_input.encode()).hexdigest(), 16)
        jitter_lat = ((h % 400) - 200) * 0.00025
        jitter_lng = (((h >> 12) % 400) - 200) * 0.00025
        return (center_lat + jitter_lat, center_lng + jitter_lng)

    def _deduplicate_proximity(
        self,
        hazards: List[Dict],
        radius_m: float = 200.0
    ) -> List[Dict]:
        """Remove duplicate hazards within radius_m of each other."""
        unique = []
        for h in hazards:
            is_dup = False
            for u in unique:
                dist = self._haversine(h["lat"], h["lng"], u["lat"], u["lng"])
                if dist < radius_m:
                    if h["severity"] > u["severity"]:
                        unique.remove(u)
                        unique.append(h)
                    is_dup = True
                    break
            if not is_dup:
                unique.append(h)
        return unique

    def _haversine(self, lat1, lng1, lat2, lng2) -> float:
        R = 6371000
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lng2 - lng1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


_gdelt_fetcher = None

def get_gdelt_fetcher() -> GDELTFetcher:
    global _gdelt_fetcher
    if _gdelt_fetcher is None:
        _gdelt_fetcher = GDELTFetcher()
    return _gdelt_fetcher