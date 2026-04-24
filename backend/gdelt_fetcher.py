"""
gdelt_fetcher.py — GDELT GKG v2 hazard source for any city
Queries https://api.gdeltproject.org/api/v2/doc/doc for real-time news
extracting violence/accident/protest themes and geocoding to hazard points.

GDELT API endpoint:
  GET https://api.gdeltproject.org/api/v2/doc/doc
  ?query=<city name> <themes>
  &mode=artlist
  &maxrecords=50
  &format=json
  &timespan=24H
  &sourcelang=eng
  &trans=googtrans(en)

Relevant GCAM themes to filter for safety:
  PROTEST, CRISISLEX_CRISISLEXREC, TAX_FNCACT_POLICE, GENERAL_GOVERNMENT,
  CRISISLEX_O01_CONFLICT, WB_868_CRIME_AND_VIOLENCE, TAX_FNCACT_CRIMINAL,
  ENV_FIRE, ENV_FLOOD, TRANSPORT_ACCIDENT
"""
import os
import logging
import requests
import hashlib
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import math

logger = logging.getLogger(__name__)

# Theme to hazard type mapping
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

GDELT_CACHE_DURATION = 600  # 10 minutes
GDELT_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc"

class GDELTFetcher:
    """Fetch real-time hazards from GDELT for any city."""
    
    def __init__(self):
        self._cache: Dict[str, Dict] = {}
        self._geocode_cache: Dict[str, Optional[Dict]] = {}
        self.tomtom_key = os.getenv("TOMTOM_API_KEY", "pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM")
        logger.info("GDELT Fetcher initialized")
    
    def fetch_hazards_for_city(
        self,
        city_key: str,
        city_config: Dict[str, Any],
        force_refresh: bool = False
    ) -> List[Dict[str, Any]]:
        """Fetch GDELT hazards for a given city config."""
        cache_key = f"gdelt_{city_key}"
        
        if not force_refresh and cache_key in self._cache:
            cached = self._cache[cache_key]
            age = (datetime.now() - cached["timestamp"]).total_seconds()
            if age < GDELT_CACHE_DURATION:
                logger.debug(f"GDELT cache hit for {city_key}: {len(cached['hazards'])} hazards")
                return cached["hazards"]
        
        themes = " OR ".join([
            "CRISISLEX_O01_CONFLICT", "WB_868_CRIME_AND_VIOLENCE",
            "ENV_FIRE", "ENV_FLOOD", "TRANSPORT_ACCIDENT",
            "PROTEST", "TAX_FNCACT_CRIMINAL"
        ])
        query = f'"{city_config["gdelt_geoname"]}" ({themes})'
        
        try:
            params = {
                "query": query,
                "mode": "artlist",
                "maxrecords": 50,
                "format": "json",
                "timespan": "24H",
                "sourcelang": "eng",
            }
            resp = requests.get(GDELT_BASE_URL, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            
            articles = data.get("articles", [])
            logger.info(f"GDELT returned {len(articles)} articles for {city_key}")
            
            hazards = []
            for article in articles:
                hazard = self._article_to_hazard(article, city_config)
                if hazard:
                    hazards.append(hazard)
            
            # Deduplicate by lat/lng proximity (within 200m)
            hazards = self._deduplicate_proximity(hazards)
            
            self._cache[cache_key] = {"hazards": hazards, "timestamp": datetime.now()}
            logger.info(f"GDELT: {len(hazards)} hazards extracted for {city_key}")
            return hazards
        
        except requests.exceptions.Timeout:
            logger.warning(f"GDELT API timeout for {city_key}")
            return self._cache.get(cache_key, {}).get("hazards", [])
        except Exception as e:
            logger.error(f"GDELT fetch failed for {city_key}: {e}")
            return self._cache.get(cache_key, {}).get("hazards", [])
    
    def _article_to_hazard(
        self,
        article: Dict,
        city_config: Dict
    ) -> Optional[Dict[str, Any]]:
        """Convert a GDELT article to a Tryver hazard dict."""
        title = article.get("title", "")
        url = article.get("url", "")
        
        # Determine hazard type and severity from themes
        themes_str = " ".join(article.get("themes", "").split(";") if isinstance(article.get("themes"), str) else [])
        hazard_type = "crime"
        severity = 0.55
        
        for theme_key, mapping in GDELT_THEME_MAP.items():
            if theme_key in themes_str:
                if mapping["severity"] > severity:
                    hazard_type = mapping["type"]
                    severity = mapping["severity"]
        
        # Try to geocode from article location fields
        lat = article.get("latitude")
        lng = article.get("longitude")
        
        if lat and lng:
            try:
                lat_f = float(lat)
                lng_f = float(lng)
                # Validate it's within city bbox
                bbox = city_config["bbox"]
                if not (bbox["min_lat"] <= lat_f <= bbox["max_lat"] and
                        bbox["min_lng"] <= lng_f <= bbox["max_lng"]):
                    # Snap to city center with small random offset based on article hash
                    h = int(hashlib.md5(title.encode()).hexdigest(), 16)
                    lat_f = city_config["center_lat"] + ((h % 200) - 100) * 0.0003
                    lng_f = city_config["center_lng"] + (((h >> 8) % 200) - 100) * 0.0003
            except (ValueError, TypeError):
                lat_f = city_config["center_lat"]
                lng_f = city_config["center_lng"]
        else:
            # Fall back to city center with hash-based jitter
            h = int(hashlib.md5(title.encode()).hexdigest(), 16)
            lat_f = city_config["center_lat"] + ((h % 200) - 100) * 0.0003
            lng_f = city_config["center_lng"] + (((h >> 8) % 200) - 100) * 0.0003
        
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
    
    def _deduplicate_proximity(
        self,
        hazards: List[Dict],
        radius_m: float = 200.0
    ) -> List[Dict]:
        """Remove duplicate hazards that are within radius_m of each other."""
        unique = []
        for h in hazards:
            is_dup = False
            for u in unique:
                dist = self._haversine(h["lat"], h["lng"], u["lat"], u["lng"])
                if dist < radius_m:
                    # Keep the higher-severity one
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