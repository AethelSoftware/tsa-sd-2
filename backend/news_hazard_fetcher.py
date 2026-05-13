"""
Crime & Emergency Hazard Fetcher for Tryver
Sources:
1. WPRDC CKAN - Pittsburgh
2. Socrata JSON - Philadelphia, Cincinnati, Columbus
3. ArcGIS REST - Cleveland
4. PulsePoint - Real-time fire/EMS incidents
5. GDELT - News hazards (handled separately)
"""
import os
import logging
import requests
import pandas as pd
from io import BytesIO
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import hashlib
import json
import time
import threading
from city_config import CITIES, get_city, get_cutoff_date, is_in_bounds

logger = logging.getLogger(__name__)


# WPRDC Crime Data URL (legacy, kept for reference)
CRIME_DATA_URL = "https://data.wprdc.org/dataset/65e69ee3-93b2-4f7a-b9cb-8ce977f15d9a/resource/bd41992a-987a-4cca-8798-fbe1cd946b07/download/monthly_crime_data_2024_2026.xlsx"

# PulsePoint API endpoints (public)
PULSEPOINT_BASE_URL = "https://api.pulsepoint.org/v1"

# HIGH SEVERITY (0.8-0.95) - Active threats to personal safety
HIGH_THREAT = {
    'HOMICIDE': 0.95,
    'SHOOTING': 0.95,
    'ASSAULT': 0.85,
    'AGGRAVATED ASSAULT': 0.9,
    'ROBBERY': 0.85,
    'CARJACKING': 0.85,
    'KIDNAPPING': 0.9,
    'SEXUAL ASSAULT': 0.9,
    'ARSON': 0.85,
    'AGGRAVATED ASSAULT FIREARM': 0.92,
    'RAPE': 0.92,
    'ROBBERY FIREARM': 0.90,
    'ROBBERY NO FIREARM': 0.80,
    'HOMICIDES': 0.95,
    'SHOOTINGS': 0.95,
    'FELONIOUS ASSAULT': 0.88,
    'AGGRAVATED ROBBERY': 0.87,
    'AGGRAVATED BURGLARY': 0.80,
    'MURDER/NON-NEGLIGENT HOMICIDE': 0.95,
    'RAPE/SEXUAL BATTERY': 0.92,
    'KIDNAPPING/ABDUCTION': 0.90,
    'WEAPON': 0.7,
    'WEAPONS VIOLATION': 0.7,
    # Philadelphia-specific additions
    'WEAPON VIOLATIONS': 0.7,
    'ROBBERY - FIREARM': 0.90,
    'ROBBERY - STRONG ARM': 0.80,
    'ASSAULT - OTHER': 0.80,
    'OTHER ASSAULTS': 0.75,
    'ASSAULT - AGGRAVATED': 0.90,
    'ASSAULT - SIMPLE': 0.70,
    # Cleveland NIBRS-specific (P1RMS dataset)
    'INTIMIDATION': 0.65,
    'JUSTIFIABLE HOMICIDE': 0.85,
    'NEGLIGENT MANSLAUGHTER': 0.85,
    'HUMAN TRAFFICKING': 0.92,
    'STATUTORY RAPE': 0.85,
    'SODOMY': 0.88,
    'SEXUAL ASSAULT WITH AN OBJECT': 0.88,
    'FONDLING': 0.75,
    'INCEST': 0.85,
    'EXTORTION': 0.78,
    'WEAPON LAW VIOLATIONS': 0.72,
    'SIMPLE ASSAULT': 0.65,  # Moved to HIGH so longest-match works
}

# MEDIUM SEVERITY (0.5-0.7) - Situational awareness needed
MEDIUM_THREAT = {
    'BURGLARY': 0.65,
    'THEFT': 0.5,
    'STOLEN VEHICLE': 0.55,
    'TRESPASSING': 0.45,
    'DISORDERLY CONDUCT': 0.6,
    'DRUG': 0.55,
    'DRUG POSSESSION': 0.5,
    'DRUG TRAFFICKING': 0.7,
    'WEAPON': 0.7,
    'WEAPONS VIOLATION': 0.7,
    'BURGLARY NO FORCE': 0.60,
    'THEFTS': 0.48,
    'THEFT FROM VEHICLE': 0.52,
    'MOTOR VEHICLE THEFT': 0.58,
    'VANDALISM/CRIMINAL DAMAGE': 0.40,
    'CRIMINAL DAMAGING': 0.38,
    'RECEIVING STOLEN PROPERTY': 0.48,
    'CRIMINAL MISCHIEF': 0.38,
    'DISORDERLY PERSONS': 0.55,
    'WEAPONS OFFENSES': 0.72,
    'NARCOTICS': 0.52,
    'DRUG ABUSE VIOLATIONS': 0.50,
    # Philadelphia-specific additions
    'THEFT - ALL OTHER': 0.50,
    'BURGLARY - RESIDENTIAL': 0.65,
    'BURGLARY - COMMERCIAL': 0.60,
    'CRIMINAL MISCHIEF - VANDALISM': 0.40,
    'VANDALISM/CRIMINAL MISCHIEF': 0.40,
    'DRUG - POSSESSION': 0.50,
    'DRUG - TRAFFICKING': 0.65,
    'WEAPON - POSSESSION': 0.70,
    'DISORDERLY CONDUCT - OTHER': 0.55,
    # Columbus-specific additions
    'BREAKING AND ENTERING': 0.65,   # Columbus UCR term for burglary
    'CARRYING CONCEALED WEAPON': 0.65,
    'CRIMINAL TRESPASS': 0.50,
    'MENACING': 0.60,
    'OBSTRUCTING OFFICIAL': 0.45,
    'WEAPONS UNDER DISABILITY': 0.72,
    'TAMPERING WITH VEHICLE': 0.48,
    'UNAUTHORIZED USE VEHICLE': 0.52,
    'DRUG ABUSE POSSESS': 0.50,
    'DRUG ABUSE TRAFFICKING': 0.68,
    # Cleveland NIBRS-specific (P1RMS dataset)
    'LARCENY': 0.50,
    'ALL OTHER LARCENY': 0.48,
    'POCKET-PICKING': 0.55,
    'PURSE-SNATCHING': 0.62,
    'SHOPLIFTING': 0.45,
    'THEFT FROM BUILDING': 0.52,
    'THEFT FROM COIN': 0.40,
    'THEFT FROM MOTOR VEHICLE': 0.55,
    'THEFT OF MOTOR VEHICLE PARTS': 0.50,
    'STOLEN PROPERTY OFFENSES': 0.55,
    'BURGLARY/BREAKING & ENTERING': 0.65,
    'DESTRUCTION/DAMAGE/VANDALISM OF PROPERTY': 0.42,
    'DRUG/NARCOTIC VIOLATIONS': 0.55,
    'DRUG EQUIPMENT VIOLATIONS': 0.45,
    'PORNOGRAPHY/OBSCENE MATERIAL': 0.55,
    'PROSTITUTION OFFENSES': 0.50,
    'KIDNAPPING/ABDUCTION ATTEMPTED': 0.85,
}

# LOW SEVERITY (0.1-0.3) - Filtered out
LOW_THREAT = {
    'FRAUD': 0.2,
    'CREDIT CARD': 0.15,
    'FORGERY': 0.2,
    'COUNTERFEITING': 0.2,
    'EMBEZZLEMENT': 0.15,
    'BAD CHECK': 0.1,
    'PUBLIC DRUNKENNESS': 0.25,
    # Philadelphia additions
    'ALL OTHER OFFENSES': 0.25,
    'OTHER OFFENSES': 0.20,
    # Cleveland NIBRS-standard low-priority offenses (will be filtered out)
    'CURFEW/LOITERING': 0.20,
    'DRIVING UNDER THE INFLUENCE': 0.35,
    'FAMILY OFFENSES': 0.25,
    'LIQUOR LAW VIOLATIONS': 0.20,
    'TRESPASS OF REAL PROPERTY': 0.30,
    'GAMBLING OFFENSES': 0.15,
    'WIRE FRAUD': 0.20,
    'IDENTITY THEFT': 0.30,
    'HACKING/COMPUTER INVASION': 0.25,
    'CREDIT CARD/AUTOMATED TELLER MACHINE FRAUD': 0.20,
    'IMPERSONATION': 0.20,
    'FALSE PRETENSES': 0.20,
    'WELFARE FRAUD': 0.15,
    'BRIBERY': 0.20,
}

# Type mapping
TYPE_MAP = {
    'HOMICIDE': 'violent',
    'SHOOTING': 'violent',
    'ASSAULT': 'violent',
    'AGGRAVATED ASSAULT': 'violent',
    'ROBBERY': 'violent',
    'BURGLARY': 'property',
    'THEFT': 'property',
    'DRUG': 'drug',
    'WEAPON': 'weapon',
    'DISORDERLY CONDUCT': 'public_order',
    'DEFAULT': 'crime'
}

# PulsePoint type mapping
PULSEPOINT_TYPE_MAP = {
    'Fire': 'fire',
    'Structure Fire': 'fire',
    'Vehicle Fire': 'fire',
    'Traffic Accident': 'accident',
    'Motor Vehicle Accident': 'accident',
    'Rescue': 'rescue',
    'Hazmat': 'hazardous',
    'Medical': 'medical',
}

# Pittsburgh bounding box (legacy)
PITTSBURGH_BOUNDS = {
    'min_lat': 40.2,
    'max_lat': 40.8,
    'min_lng': -80.8,
    'max_lng': -79.5
}

# Cache configuration
CACHE_DURATION = 300  # 5 minutes
MIN_SEVERITY_THRESHOLD = 0.5

# Singleton detection counter
_init_counter = 0 

class NewsHazardFetcher:
    def __init__(self):
        global _init_counter
        _init_counter += 1
        if _init_counter > 1:
            logger.warning(
                f"NewsHazardFetcher.__init__ called {_init_counter} "
                f"times — singleton is broken. Caller stack:"
            )
            import traceback
            for line in traceback.format_stack()[-6:-1]:
                logger.warning(f"  {line.strip()}")

        # Legacy Pittsburgh-only cache (kept for backward compatibility)
        self.cache = []
        self.last_cache_time = None

        # Per-city cache: { city_key: {'hazards': [...], 'timestamp': datetime} }
        self._city_cache: dict = {}
        self._city_cache_lock = threading.Lock()
        self.pulsepoint_agency_id = None
        self._pulsepoint_backoff_until = 0.0
        self._init_pulsepoint()

        # Track ongoing requests to prevent duplicates
        self._pending_requests = {}

        logger.info("Hazard Fetcher initialized for multi-city")
        logger.info(f"Minimum severity threshold: {MIN_SEVERITY_THRESHOLD}")
        logger.info(f"Cache duration: {CACHE_DURATION}s")

    def _init_pulsepoint(self):
        """Initialize PulsePoint agency ID for Pittsburgh/Allegheny County"""
        if self._pulsepoint_backoff_until > time.time():
            return
        try:
            url = f"{PULSEPOINT_BASE_URL}/agencies"
            params = {'near': '40.4406,-79.9959', 'radius': 25}
            response = requests.get(url, params=params, timeout=10)

            if response.status_code == 401:
                self._pulsepoint_backoff_until = time.time() + 86400  # 24h
                logger.warning("PulsePoint 401 — backing off for 24 hours")
                return

            if response.status_code == 200:
                agencies = response.json()
                for agency in agencies:
                    name = agency.get('name', '').lower()
                    if 'allegheny' in name or 'pittsburgh' in name:
                        self.pulsepoint_agency_id = agency.get('id')
                        logger.info(f"Found PulsePoint agency: {agency.get('name')} (ID: {self.pulsepoint_agency_id})")
                        return

                if agencies:
                    self.pulsepoint_agency_id = agencies[0].get('id')
                    logger.info(f"Using fallback PulsePoint agency ID: {self.pulsepoint_agency_id}")
            else:
                logger.warning(f"PulsePoint agency fetch returned {response.status_code}")

        except Exception as e:
            logger.warning(f"PulsePoint initialization failed (will continue without real-time data): {e}")

    
    def fetch_hazards(self, force_refresh: bool = False, city_key: str = "pittsburgh") -> List[Dict[str, Any]]:
        """
        Public entry point. For Pittsburgh uses the legacy single-cache path for
        backward compatibility. For all other cities delegates to fetch_hazards_for_city.
        """
        if city_key and city_key != "pittsburgh":
            return self.fetch_hazards_for_city(city_key, force_refresh=force_refresh)

        # ── Pittsburgh legacy path 
        if not force_refresh and self.last_cache_time:
            age = (datetime.now() - self.last_cache_time).seconds
            if age < CACHE_DURATION:
                return self.cache

        try:
            all_hazards = []
            cfg = get_city("pittsburgh")
            crime_hazards = self._fetch_wprdc_crime(cfg, "pittsburgh")
            all_hazards.extend(crime_hazards)
            if self._pulsepoint_backoff_until <= time.time():
                pp = self._fetch_pulsepoint_for_coords(cfg["pulsepoint_search_coords"])
                all_hazards.extend(pp)
            filtered = [h for h in all_hazards if h.get("severity", 0) >= MIN_SEVERITY_THRESHOLD]
            self.cache = self.deduplicate_hazards(filtered)
            self.last_cache_time = datetime.now()
            return self.cache
        except Exception as exc:
            logger.error(f"Pittsburgh hazard fetch error: {exc}")
            return self.cache or []

    def fetch_hazards_for_city(
        self,
        city_key: str = "pittsburgh",
        force_refresh: bool = False
    ) -> list:
        """
        Fetch and return all hazards for the given city.

        Uses a per-city in-memory cache (TTL = CACHE_DURATION seconds).
        Falls back to the city's last good cache on network error.
        Falls back to GDELT if the primary crime endpoint fails.
        """
        city_key = city_key.lower().strip()

        # Cache check
        if not force_refresh:
            with self._city_cache_lock:
                entry = self._city_cache.get(city_key)
            if entry:
                age = (datetime.now() - entry["timestamp"]).total_seconds()
                if age < CACHE_DURATION:
                    logger.debug(
                        f"[{city_key}] cache hit — {len(entry['hazards'])} hazards "
                        f"(age {age:.0f}s)"
                    )
                    return entry["hazards"]

        try:
            cfg = get_city(city_key)
        except KeyError:
            logger.warning(f"Unknown city '{city_key}' — falling back to Pittsburgh")
            cfg = get_city("pittsburgh")
            city_key = "pittsburgh"

        logger.info(f"[{city_key}] fetching fresh hazards from {cfg['crime_source']}")
        all_hazards: list = []

        # Primary crime data
        source = cfg["crime_source"]
        try:
            if source == "wprdc_ckan":
                crime = self._fetch_wprdc_crime(cfg, city_key)
            elif source == "socrata_json":
                crime = self._fetch_socrata_crime(cfg)
            elif source == "arcgis_rest":
                crime = self._fetch_arcgis_crime(cfg)
            elif source == "gdelt_only":
                logger.info(f"[{city_key}] crime_source=gdelt_only — skipping primary crime fetch")
                crime = []
            else:
                logger.warning(f"[{city_key}] unknown crime_source '{source}'")
                crime = []
            all_hazards.extend(crime)
            logger.info(f"[{city_key}] primary crime: {len(crime)} hazards")
        except Exception as exc:
            logger.error(f"[{city_key}] crime fetch failed: {exc}")

        # GDELT news hazards (all cities)
        try:
            from gdelt_fetcher import get_gdelt_fetcher
            gdelt_hazards = get_gdelt_fetcher().fetch_hazards_for_city(
                city_key, cfg, force_refresh=force_refresh
            )
            all_hazards.extend(gdelt_hazards)
            logger.info(f"[{city_key}] GDELT: {len(gdelt_hazards)} hazards")
        except Exception as exc:
            logger.warning(f"[{city_key}] GDELT fetch failed: {exc}")

        # PulsePoint real-time (skip if in backoff)
        if self._pulsepoint_backoff_until <= time.time():
            try:
                pp = self._fetch_pulsepoint_for_coords(
                    cfg["pulsepoint_search_coords"]
                )
                all_hazards.extend(pp)
                logger.info(f"[{city_key}] PulsePoint: {len(pp)} hazards")
            except Exception as exc:
                logger.warning(f"[{city_key}] PulsePoint failed: {exc}")

        # Filter + deduplicate
        filtered = [h for h in all_hazards if h.get("severity", 0) >= MIN_SEVERITY_THRESHOLD]
        deduped = self.deduplicate_hazards(filtered)
        logger.info(
            f"[{city_key}] total after filter+dedup: {len(deduped)} "
            f"(dropped {len(all_hazards) - len(deduped)} low-threat/dups)"
        )

        # Store in per-city cache
        with self._city_cache_lock:
            self._city_cache[city_key] = {
                "hazards": deduped,
                "timestamp": datetime.now(),
            }

        # Also keep Pittsburgh in the legacy single cache for backward compat
        if city_key == "pittsburgh":
            self.cache = deduped
            self.last_cache_time = datetime.now()

        return deduped

    def get_hazards_in_area(
        self,
        lat: float,
        lng: float,
        radius_meters: float = 1000,
        city_key: str = "pittsburgh",
    ) -> List[Dict]:
        """Return hazards within radius_meters of (lat, lng) for the given city."""
        def _haversine(lat1, lng1, lat2, lng2):
            from math import radians, sin, cos, sqrt, atan2
            R = 6371000
            p1, p2 = radians(lat1), radians(lat2)
            dp = radians(lat2 - lat1)
            dl = radians(lng2 - lng1)
            a = sin(dp/2)**2 + cos(p1) * cos(p2) * sin(dl/2)**2
            return R * 2 * atan2(sqrt(a), sqrt(1 - a))

        hazards = self.fetch_hazards(city_key=city_key)
        nearby = []
        for h in hazards:
            d = _haversine(lat, lng, h["lat"], h["lng"])
            if d <= radius_meters:
                nearby.append({**h, "distance_meters": round(d, 1)})
        return nearby

    def force_refresh_cache(self, city_key: str = None):
        """
        Invalidate cache for one city (or all cities if city_key is None).
        Called by the routing pipeline before calculating a new route.
        """
        with self._city_cache_lock:
            if city_key:
                self._city_cache.pop(city_key, None)
                if city_key == "pittsburgh":
                    self.last_cache_time = None
            else:
                self._city_cache.clear()
                self.last_cache_time = None
        logger.info(f"Cache invalidated: city_key={city_key or 'ALL'}")

    def deduplicate_hazards(self, hazards: List[Dict]) -> List[Dict]:
        """Remove duplicate hazards."""
        unique = []
        seen = set()
        for hazard in hazards:
            key = f"{hazard['type']}_{hazard['lat']}_{hazard['lng']}_{hazard['source']}"
            if key not in seen:
                seen.add(key)
                unique.append(hazard)
        return unique


    # Crime data fetchers
    def _fetch_wprdc_crime(self, cfg: dict, city_key: str) -> List[Dict[str, Any]]:
        """Fetch crime data from WPRDC CKAN SQL API. Used by Pittsburgh."""
        hazards = []
        try:
            cutoff_date = get_cutoff_date(city_key)  # pass the key, not display_name
            resource_id = cfg.get("crime_resource_id", "bd41992a-987a-4cca-8798-fbe1cd946b07")
            date_col = cfg.get("crime_date_col", "ReportedDate")
            sql = (
                f"SELECT * FROM \"{resource_id}\" "
                f"WHERE \"{date_col}\" >= '{cutoff_date}' "
                f"LIMIT {cfg.get('crime_limit', 500)}"
            )
            url = cfg.get("crime_endpoint", "https://data.wprdc.org/api/3/action/datastore_search_sql")
            logger.info(f"Fetching crime data from WPRDC SQL API (cutoff: {cutoff_date})...")
            response = requests.get(url, params={"sql": sql}, timeout=15)
            response.raise_for_status()
            data = response.json()
            if not data.get('success'):
                logger.error(f"WPRDC API returned success=false: {data.get('error')}")
                return []
            records = data.get('result', {}).get('records', [])
            logger.info(f"WPRDC returned {len(records)} crime records")
            filtered_low_threat = 0
            offense_col = cfg.get("crime_offense_col", "NIBRS_Coded_Offense")
            lat_col = cfg.get("crime_lat_col", "YCOORD")
            lng_col = cfg.get("crime_lng_col", "XCOORD")
            address_col = cfg.get("crime_address_col", "Block_Address")
            neighborhood_col = cfg.get("crime_neighborhood_col", "Neighborhood")
            bbox = cfg.get("bbox", PITTSBURGH_BOUNDS)

            for row in records:
                try:
                    x_coord = row.get(lng_col)
                    y_coord = row.get(lat_col)
                    if x_coord is None or y_coord is None:
                        continue
                    try:
                        lng = float(x_coord)
                        lat = float(y_coord)
                    except (ValueError, TypeError):
                        continue
                    if not (bbox['min_lat'] <= lat <= bbox['max_lat'] and
                            bbox['min_lng'] <= lng <= bbox['max_lng']):
                        continue
                    offense = row.get(offense_col) or 'Unknown'
                    severity, hazard_type = self._get_severity_and_type(offense)
                    if severity < MIN_SEVERITY_THRESHOLD:
                        filtered_low_threat += 1
                        continue
                    neighborhood = row.get(neighborhood_col) or cfg["display_name"]
                    block_address = row.get(address_col) or ''
                    threat_level = "HIGH" if severity >= 0.8 else "MEDIUM" if severity >= 0.6 else "CAUTION"
                    reported_date_str = row.get(date_col, '')
                    try:
                        reported_date = pd.to_datetime(reported_date_str)
                        pub_date = reported_date.isoformat()
                    except:
                        pub_date = reported_date_str
                    hazards.append({
                        'type': hazard_type,
                        'description': f"[{threat_level}] {offense}",
                        'full_description': f"{offense} at {block_address} in {neighborhood}" if block_address else f"{offense} in {neighborhood}",
                        'lat': lat,
                        'lng': lng,
                        'location_name': neighborhood,
                        'severity': severity,
                        'source': 'wprdc_crime_data',
                        'title': f"{threat_level}: {offense}",
                        'url': '',
                        'publisher': f"{cfg['display_name']} Bureau of Police",
                        'published_date': pub_date,
                        'is_active': True,
                        'city': cfg["display_name"],
                    })
                except Exception as row_error:
                    logger.debug(f"Error processing record: {row_error}")
                    continue
            logger.info(f"Crime data: {len(records)} records, filtered {filtered_low_threat} low-threat, created {len(hazards)} hazards")
        except Exception as e:
            logger.error(f"Failed to fetch crime data: {e}", exc_info=True)
        return hazards

    # Alias for backward compatibility
    _fetch_crime_data = _fetch_wprdc_crime

    def _fetch_socrata_crime(self, cfg: dict) -> List[Dict[str, Any]]:
        """
        Fetch crime data from any Socrata JSON endpoint using the city config.
        Used by: Philadelphia, Cincinnati, Columbus.
        """
        hazards: List[Dict] = []
        endpoint  = cfg["crime_endpoint"]
        fallback  = cfg.get("crime_fallback_endpoint")
        limit     = cfg.get("crime_limit", 500)
        days      = cfg.get("crime_lookback_days", 14)
        cutoff    = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
        date_col  = cfg["crime_date_col"]
        where_tpl = cfg.get("crime_where_template", f"{date_col} >= '{{cutoff}}'")
        where     = where_tpl.format(cutoff=cutoff)

        lat_col   = cfg["crime_lat_col"]
        lng_col   = cfg["crime_lng_col"]
        off_col   = cfg["crime_offense_col"]
        addr_col  = cfg.get("crime_address_col", "address")
        nbhd_col  = cfg.get("crime_neighborhood_col", "")
        bbox      = cfg["bbox"]

        endpoints_to_try = [endpoint] + ([fallback] if fallback else [])

        for url in endpoints_to_try:
            try:
                params = {
                    "$limit": limit,
                    "$where": where,
                }
                if cfg.get("crime_supports_order", True):
                    params["$order"] = f"{date_col} DESC"

                response = requests.get(url, params=params, timeout=15)
                logger.info(
                    f"Socrata [{cfg['display_name']}] → {response.status_code} "
                    f"from {url}"
                )
                if response.status_code == 200:
                    # Guard 1: non-JSON content-type
                    content_type = response.headers.get("content-type", "")
                    if "json" not in content_type and "javascript" not in content_type:
                        logger.warning(
                            f"Socrata [{cfg['display_name']}] non-JSON content-type "
                            f"'{content_type}' from {url}. "
                            f"Preview: {response.text[:200]!r}"
                        )
                        continue

                    # Guard 2: empty body
                    if not response.text or not response.text.strip():
                        logger.warning(
                            f"Socrata [{cfg['display_name']}] empty body from {url}"
                        )
                        continue

                    # Guard 3: JSON parse failure
                    try:
                        records = response.json()
                    except ValueError as json_err:
                        logger.warning(
                            f"Socrata [{cfg['display_name']}] JSON parse failed "
                            f"({json_err}). Preview: {response.text[:200]!r}"
                        )
                        continue

                    logger.info(
                        f"Socrata [{cfg['display_name']}] → {len(records)} records"
                    )

                    # Diagnostic sample logging
                    if records and isinstance(records, list):
                        sample = records[0]
                        sample_offense = sample.get(off_col, "<<MISSING FIELD>>")
                        sample_lat = sample.get(lat_col, "<<MISSING FIELD>>")
                        sample_lng = sample.get(lng_col, "<<MISSING FIELD>>")
                        logger.info(
                            f"Socrata [{cfg['display_name']}] sample row: "
                            f"offense={sample_offense!r} lat={sample_lat!r} lng={sample_lng!r} "
                            f"keys={sorted(sample.keys())[:8]}..."
                        )

                    # Diagnostic counters
                    filtered_low      = 0
                    dropped_no_coords = 0
                    dropped_bad_coords= 0
                    dropped_oob       = 0

                    for row in records:
                        try:
                            raw_lat = row.get(lat_col)
                            raw_lng = row.get(lng_col)
                            if raw_lat is None or raw_lng is None:
                                dropped_no_coords += 1
                                continue
                            try:
                                lat = float(raw_lat)
                                lng = float(raw_lng)
                            except (ValueError, TypeError):
                                dropped_bad_coords += 1
                                continue
                            if not (bbox["min_lat"] <= lat <= bbox["max_lat"] and
                                    bbox["min_lng"] <= lng <= bbox["max_lng"]):
                                dropped_oob += 1
                                continue
                            offense = str(row.get(off_col) or "Unknown").strip()
                            severity, hazard_type = self._get_severity_and_type(offense)
                            if severity < MIN_SEVERITY_THRESHOLD:
                                filtered_low += 1
                                continue
                            address   = str(row.get(addr_col) or "").strip()
                            nbhd      = str(row.get(nbhd_col) or cfg["display_name"]).strip()
                            pub_date  = str(row.get(date_col) or "")
                            threat    = ("HIGH" if severity >= 0.8 else
                                         "MEDIUM" if severity >= 0.6 else "CAUTION")
                            hazards.append({
                                "type":             hazard_type,
                                "description":      f"[{threat}] {offense}",
                                "full_description": (
                                    f"{offense} at {address} in {nbhd}"
                                    if address else f"{offense} in {nbhd}"
                                ),
                                "lat":              lat,
                                "lng":              lng,
                                "location_name":    nbhd or cfg["display_name"],
                                "severity":         severity,
                                "source":           "socrata_crime",
                                "title":            f"{threat}: {offense}",
                                "url":              "",
                                "publisher":        f"{cfg['display_name']} Police Department",
                                "published_date":   pub_date,
                                "is_active":        True,
                                "city":             cfg["display_name"],
                            })
                        except (ValueError, TypeError) as row_err:
                            logger.debug(f"Socrata row parse error: {row_err}")
                            continue

                    logger.info(
                        f"Socrata [{cfg['display_name']}]: {len(records)} records → "
                        f"{len(hazards)} hazards "
                        f"(low_threat={filtered_low}, no_coords={dropped_no_coords}, "
                        f"bad_coords={dropped_bad_coords}, out_of_bbox={dropped_oob})"
                    )
                    return hazards   # success — no need to try fallback
                else:
                    logger.warning(
                        f"Socrata [{cfg['display_name']}] returned {response.status_code} "
                        f"from {url}, trying fallback"
                    )
            except requests.exceptions.Timeout:
                logger.warning(f"Socrata [{cfg['display_name']}] timeout: {url}")
            except Exception as exc:
                logger.error(f"Socrata [{cfg['display_name']}] error: {exc}")

        logger.error(f"All Socrata endpoints failed for {cfg['display_name']}")
        return hazards

    def _fetch_arcgis_crime(self, cfg: dict) -> List[Dict[str, Any]]:
        """
        Fetch crime data from an ArcGIS REST FeatureServer endpoint.
        Used by: Cleveland, OH (and any future ArcGIS-based city).
        """
        hazards: List[Dict] = []
        endpoint  = cfg["crime_endpoint"]
        limit     = cfg.get("crime_limit", 500)
        days      = cfg.get("crime_lookback_days", 14)
        cutoff    = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        where_tpl = cfg.get("crime_where_template", "ReportedDate >= TIMESTAMP '{cutoff} 00:00:00'")
        where     = where_tpl.format(cutoff=cutoff)

        lat_col  = cfg["crime_lat_col"]
        lng_col  = cfg["crime_lng_col"]
        off_col  = cfg["crime_offense_col"]
        addr_col = cfg.get("crime_address_col", "Address_Public")
        nbhd_col = cfg.get("crime_neighborhood_col", "NEIGHBORHOOD")
        date_col = cfg["crime_date_col"]
        bbox     = cfg["bbox"]
        city_name = cfg["display_name"]

        try:
            params = {
                "where":             where,
                "outFields":         "*",
                "f":                 "json",
                "resultRecordCount": limit,
                "outSR":             "4326",
                "returnGeometry":    "true",
            }
            if cfg.get("crime_supports_order", True):
                params["orderByFields"] = f"{date_col} DESC"

            response = requests.get(endpoint, params=params, timeout=25)

            if response.status_code != 200:
                logger.warning(f"ArcGIS [{city_name}] HTTP {response.status_code}")
                raise ValueError(f"ArcGIS HTTP {response.status_code}")

            if not response.text or not response.text.strip():
                logger.warning(f"ArcGIS [{city_name}] empty response body")
                raise ValueError("Empty ArcGIS response")

            _resp_json = response.json()
            if "error" in _resp_json:
                _code = _resp_json["error"].get("code", "?")
                _msg  = _resp_json["error"].get("message", "unknown")
                logger.warning(
                    f"ArcGIS [{city_name}] error envelope: code={_code} msg={_msg}"
                )
                raise ValueError(f"ArcGIS error {_code}: {_msg}")
            data = _resp_json

            features = data.get("features", [])
            logger.info(f"ArcGIS [{city_name}] → {len(features)} features")
            filtered_low = 0
            for feat in features:
                attrs = feat.get("attributes") or feat.get("properties") or {}
                geom  = feat.get("geometry", {})
                try:
                    # Prefer direct LAT/LON fields over geometry
                    lat = attrs.get(lat_col)
                    lng = attrs.get(lng_col)
                    if lat is None or lng is None:
                        # Fall back to geometry coordinates if available
                        if geom and "y" in geom and "x" in geom:
                            lat = float(geom["y"])
                            lng = float(geom["x"])
                        else:
                            continue
                    
                    lat = float(lat)
                    lng = float(lng)
                    
                    if not (bbox["min_lat"] <= lat <= bbox["max_lat"] and
                            bbox["min_lng"] <= lng <= bbox["max_lng"]):
                        continue
                    
                    offense = str(attrs.get(off_col) or "Unknown").strip()
                    severity, hazard_type = self._get_severity_and_type(offense)
                    if severity < MIN_SEVERITY_THRESHOLD:
                        filtered_low += 1
                        continue
                    
                    address = str(attrs.get(addr_col) or "").strip()
                    nbhd = str(attrs.get(nbhd_col) or city_name.split(",")[0]).strip()
                    raw_date = attrs.get(date_col)
                    if isinstance(raw_date, (int, float)):
                        from datetime import timezone
                        pub_date = datetime.fromtimestamp(
                            raw_date / 1000, tz=timezone.utc
                        ).isoformat()
                    else:
                        pub_date = str(raw_date or "")
                    
                    threat = ("HIGH" if severity >= 0.8 else
                              "MEDIUM" if severity >= 0.6 else "CAUTION")
                    hazards.append({
                        "type":             hazard_type,
                        "description":      f"[{threat}] {offense}",
                        "full_description": (
                            f"{offense} at {address} in {nbhd}"
                            if address else f"{offense} in {nbhd}"
                        ),
                        "lat":              lat,
                        "lng":              lng,
                        "location_name":    nbhd or city_name,
                        "severity":         severity,
                        "source":           "arcgis_crime",
                        "title":            f"{threat}: {offense}",
                        "url":              "",
                        "publisher":        f"{city_name} Division of Police",
                        "published_date":   pub_date,
                        "is_active":        True,
                        "city":             city_name,
                    })
                except (ValueError, TypeError) as feat_err:
                    logger.debug(f"ArcGIS feature parse error: {feat_err}")
                    continue
            
            logger.info(
                f"ArcGIS [{city_name}]: {len(features)} features → {len(hazards)} hazards "
                f"({filtered_low} filtered)"
            )
            return hazards
            
        except requests.exceptions.Timeout:
            logger.warning(f"ArcGIS [{city_name}] timeout")
        except Exception as exc:
            logger.error(f"ArcGIS [{city_name}] error: {exc}")

        # ── Fallback if configured 
        fallback_url = cfg.get("crime_fallback_endpoint")
        if fallback_url:
            logger.info(f"ArcGIS [{city_name}] → falling back to fallback endpoint")
            # Recursively call appropriate fetcher based on fallback source
            return self._fetch_socrata_crime({**cfg, "crime_endpoint": fallback_url})
        
        return hazards

    # PulsePoint fetcher (city‑aware)
    def _fetch_pulsepoint_for_coords(self, coords_str: str) -> List[Dict[str, Any]]:
        """Fetch live PulsePoint incidents for a given lat,lng coordinate string."""
        if self._pulsepoint_backoff_until > time.time():
            return []

        try:
            agency_url = f"{PULSEPOINT_BASE_URL}/agencies"
            params = {"near": coords_str, "radius": 25}
            r = requests.get(agency_url, params=params, timeout=8)

            if r.status_code == 401:
                self._pulsepoint_backoff_until = time.time() + 86400
                logger.warning("PulsePoint 401 — backing off 24h")
                return []

            if r.status_code != 200:
                return []

            agencies = r.json()
            if not agencies:
                return []

            agency_id = agencies[0].get("id")
            if not agency_id:
                return []

            inc_url = f"{PULSEPOINT_BASE_URL}/agencies/{agency_id}/incidents"
            r2 = requests.get(inc_url, timeout=10)

            if r2.status_code == 401:
                self._pulsepoint_backoff_until = time.time() + 86400
                logger.warning("PulsePoint incidents 401 — backing off 24h")
                return []

            if r2.status_code != 200:
                return []

            hazards = []
            for inc in r2.json():
                lat = inc.get("latitude")
                lng = inc.get("longitude")
                if not lat or not lng:
                    continue
                inc_type = inc.get("type", "Emergency")
                sev = 0.75
                lt = inc_type.lower()
                if "fire" in lt or "structure" in lt:
                    sev = 0.88
                elif "hazmat" in lt:
                    sev = 0.90
                elif "accident" in lt or "crash" in lt or "mvc" in lt:
                    sev = 0.78
                hazards.append({
                    "type":           PULSEPOINT_TYPE_MAP.get(inc_type, "emergency"),
                    "description":    f"[REAL-TIME] {inc_type}: {inc.get('description', inc_type)}",
                    "lat":            float(lat),
                    "lng":            float(lng),
                    "severity":       sev,
                    "source":         "pulsepoint",
                    "title":          f"🚨 ACTIVE: {inc_type}",
                    "url":            "",
                    "publisher":      "PulsePoint",
                    "published_date": datetime.now().isoformat(),
                    "is_active":      True,
                    "units":          inc.get("units", []),
                })
            return hazards
        except requests.exceptions.Timeout:
            logger.warning("PulsePoint request timed out")
            return []
        except Exception as exc:
            logger.warning(f"PulsePoint fetch error: {exc}")
            return []

   
    def _get_severity_and_type(self, offense: str) -> tuple:
        """Determine severity and type based on offense description.
        Uses longest-match-first to ensure specific offenses are correctly
        classified (e.g., 'AGGRAVATED ASSAULT' vs 'ASSAULT').
        """
        offense_upper = str(offense).upper()

        # Sort keys by length descending so more-specific matches win
        for key in sorted(HIGH_THREAT, key=len, reverse=True):
            if key in offense_upper:
                return HIGH_THREAT[key], TYPE_MAP.get(key, TYPE_MAP['DEFAULT'])

        for key in sorted(MEDIUM_THREAT, key=len, reverse=True):
            if key in offense_upper:
                return MEDIUM_THREAT[key], TYPE_MAP.get(key, TYPE_MAP['DEFAULT'])

        for key in sorted(LOW_THREAT, key=len, reverse=True):
            if key in offense_upper:
                return LOW_THREAT[key], TYPE_MAP.get('DEFAULT', 'crime')

        return 0.4, 'crime'


# Singleton instance with thread lock
_news_fetcher = None
_news_fetcher_lock = threading.Lock()

def get_news_fetcher() -> NewsHazardFetcher:
    global _news_fetcher
    if _news_fetcher is None:
        with _news_fetcher_lock:
            if _news_fetcher is None:
                _news_fetcher = NewsHazardFetcher()
    return _news_fetcher