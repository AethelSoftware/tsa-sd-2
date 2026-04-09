# news_hazard_fetcher.py
"""
Crime & Emergency Hazard Fetcher for Pittsburgh
Sources: 
1. WPRDC CKAN - Recent crime incidents (last 7 days)
2. PulsePoint - Real-time fire/EMS incidents (direct API)
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

logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

# WPRDC Crime Data URL
CRIME_DATA_URL = "https://data.wprdc.org/dataset/65e69ee3-93b2-4f7a-b9cb-8ce977f15d9a/resource/bd41992a-987a-4cca-8798-fbe1cd946b07/download/monthly_crime_data_2024_2026.xlsx"

# PulsePoint API endpoints (public)
PULSEPOINT_BASE_URL = "https://api.pulsepoint.org/v1"

# ============================================================================
# SEVERITY MAPPING
# ============================================================================

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

# Pittsburgh bounding box
PITTSBURGH_BOUNDS = {
    'min_lat': 40.2,
    'max_lat': 40.8,
    'min_lng': -80.8,
    'max_lng': -79.5
}

# Cache configuration
CACHE_DURATION = 300  # 5 minutes (increased from 300 seconds)
MIN_SEVERITY_THRESHOLD = 0.6

# ============================================================================
# HAZARD FETCHER CLASS
# ============================================================================

class NewsHazardFetcher:
    def __init__(self):
        self.cache = []
        self.last_cache_time = None
        self.pulsepoint_agency_id = None
        self._init_pulsepoint()
        
        # Track ongoing requests to prevent duplicates
        self._pending_requests = {}
        
        logger.info("Hazard Fetcher initialized with WPRDC Crime Data + PulsePoint")
        logger.info(f"Minimum severity threshold: {MIN_SEVERITY_THRESHOLD}")
        logger.info(f"Cache duration: {CACHE_DURATION}s")

    def _init_pulsepoint(self):
        """Initialize PulsePoint agency ID for Pittsburgh/Allegheny County"""
        try:
            url = f"{PULSEPOINT_BASE_URL}/agencies"
            params = {'near': '40.4406,-79.9959', 'radius': 25}
            response = requests.get(url, params=params, timeout=10)
            
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

    def fetch_hazards(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Fetch hazards from both CKAN crime data and PulsePoint real-time incidents."""
        
        # Check cache first (unless force refresh)
        if not force_refresh and self.last_cache_time:
            cache_age = (datetime.now() - self.last_cache_time).seconds
            if cache_age < CACHE_DURATION:
                logger.info(f"Returning {len(self.cache)} cached hazards (age: {cache_age}s)")
                return self.cache
        
        # Prevent multiple simultaneous fetches with the same key
        request_key = "fetch_hazards"
        if request_key in self._pending_requests:
            logger.info("Fetch already in progress, waiting for result...")
            return self._pending_requests[request_key]
        
        logger.info("Cache expired. Fetching fresh hazards...")
        
        # Create a future-like object
        result_holder = []
        self._pending_requests[request_key] = result_holder
        
        try:
            all_hazards = []
            
            # Fetch crime data from WPRDC
            crime_hazards = self._fetch_crime_data()
            all_hazards.extend(crime_hazards)
            logger.info(f"Crime hazards: {len(crime_hazards)}")
            
            # Fetch real-time incidents from PulsePoint
            # pulsepoint_hazards = self._fetch_pulsepoint_incidents()
            # all_hazards.extend(pulsepoint_hazards)
            # logger.info(f"PulsePoint real-time hazards: {len(pulsepoint_hazards)}")

            gdelt_hazards = self._fetch_gdelt_doc()
            all_hazards.extend(gdelt_hazards)

            logger.info(f"GDELT hazards: {len(gdelt_hazards)}")
            
            # Filter by severity threshold
            filtered_hazards = [h for h in all_hazards if h.get('severity', 0) >= MIN_SEVERITY_THRESHOLD]
            
            self.cache = self.deduplicate_hazards(filtered_hazards)
            self.last_cache_time = datetime.now()
            
            logger.info(f"Total hazards after filtering: {len(self.cache)}")
            logger.info(f"Filtered out {len(all_hazards) - len(self.cache)} low-threat incidents")
            
            result_holder[:] = self.cache
            return self.cache
            
        except Exception as e:
            logger.error(f"Error fetching hazards: {e}")
            # Return cached data if available, even if expired
            if self.cache:
                logger.warning(f"Returning stale cache due to error: {e}")
                return self.cache
            return []
        finally:
            # Clean up pending request
            self._pending_requests.pop(request_key, None)

    def _fetch_gdelt_doc(self) -> List[Dict[str, Any]]:
        hazards = []

        try:
            url = "https://api.gdeltproject.org/api/v2/doc/doc"

            params = {
                "query": "crime OR shooting OR robbery OR accident",
                "format": "json",
                "maxrecords": 50,
                "sort": "datedesc",
                "format": "json"
            }

            resp = requests.get(url, params=params, timeout=10)

            # 🔥 IMPORTANT DEBUG STEP
            if resp.status_code != 200:
                logger.error(f"GDELT HTTP {resp.status_code}: {resp.text[:200]}")
                return []

            # 🔥 SAFE JSON PARSE
            try:
                data = resp.json()
            except Exception:
                logger.error(f"GDELT returned non-JSON: {resp.text[:200]}")
                return []

            articles = data.get("articles", [])
            logger.info(f"GDELT DOC returned {len(articles)} articles")

            for a in articles:
                title = (a.get("title") or "").lower()

                # keep it simple first (DON'T over-filter yet)
                if not title:
                    continue

                severity = 0.5
                if "shooting" in title or "homicide" in title:
                    severity = 0.85
                elif "robbery" in title or "assault" in title:
                    severity = 0.7
                elif "accident" in title:
                    severity = 0.6

                hazards.append({
                    "type": "news",
                    "description": a.get("title", ""),
                    "lat": 40.4406,
                    "lng": -79.9959,
                    "severity": severity,
                    "source": "gdelt",
                    "url": a.get("url"),
                    "published_date": a.get("seendate"),
                    "is_active": True
                })

        except Exception as e:
            logger.error(f"GDELT failed completely: {e}")

        return hazards


    def _get_severity_and_type(self, offense: str) -> tuple:
        """Determine severity and type based on offense description."""
        offense_upper = str(offense).upper()
        
        for key, value in HIGH_THREAT.items():
            if key in offense_upper:
                return value, TYPE_MAP.get(key, TYPE_MAP['DEFAULT'])
        
        for key, value in MEDIUM_THREAT.items():
            if key in offense_upper:
                return value, TYPE_MAP.get(key, TYPE_MAP['DEFAULT'])
        
        for key, value in LOW_THREAT.items():
            if key in offense_upper:
                return value, TYPE_MAP.get('DEFAULT', 'crime')
        
        return 0.4, 'crime'

    def _fetch_crime_data(self) -> List[Dict[str, Any]]:
        """Download crime data from WPRDC and parse incidents from last 7 days."""
        hazards = []
        
        try:
            logger.info(f"Downloading crime data from WPRDC...")
            response = requests.get(CRIME_DATA_URL, timeout=30)
            response.raise_for_status()
            
            excel_data = BytesIO(response.content)
            df = pd.read_excel(excel_data)
            
            logger.info(f"Loaded {len(df)} total crime records")
            
            cutoff_date = datetime.now() - timedelta(days=10)
            recent_incidents = 0
            filtered_low_threat = 0
            
            for _, row in df.iterrows():
                try:
                    reported_date_str = row.get('ReportedDate')
                    if pd.isna(reported_date_str):
                        continue
                    
                    try:
                        if isinstance(reported_date_str, datetime):
                            reported_date = reported_date_str
                        else:
                            reported_date = pd.to_datetime(reported_date_str)
                    except Exception:
                        continue
                    
                    if reported_date < cutoff_date:
                        continue
                    
                    recent_incidents += 1
                    
                    lng = None
                    lat = None
                    
                    x_coord = row.get('XCOORD')
                    y_coord = row.get('YCOORD')
                    
                    if pd.notna(x_coord) and pd.notna(y_coord):
                        try:
                            lng = float(x_coord)
                            lat = float(y_coord)
                        except (ValueError, TypeError):
                            continue
                    
                    if lat is None or lng is None:
                        continue
                    
                    if not (PITTSBURGH_BOUNDS['min_lat'] <= lat <= PITTSBURGH_BOUNDS['max_lat'] and
                            PITTSBURGH_BOUNDS['min_lng'] <= lng <= PITTSBURGH_BOUNDS['max_lng']):
                        continue
                    
                    offense = row.get('NIBRS_Coded_Offense', 'Unknown')
                    if pd.isna(offense):
                        offense = 'Unknown'
                    
                    severity, hazard_type = self._get_severity_and_type(offense)
                    
                    if severity < MIN_SEVERITY_THRESHOLD:
                        filtered_low_threat += 1
                        continue
                    
                    neighborhood = row.get('Neighborhood', 'Pittsburgh')
                    if pd.isna(neighborhood):
                        neighborhood = 'Pittsburgh'
                    
                    block_address = row.get('Block_Address', '')
                    if pd.isna(block_address):
                        block_address = ''
                    
                    threat_level = "HIGH" if severity >= 0.8 else "MEDIUM" if severity >= 0.6 else "CAUTION"
                    
                    hazard = {
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
                        'publisher': 'Pittsburgh Bureau of Police',
                        'published_date': reported_date.isoformat(),
                        'is_active': True
                    }
                    hazards.append(hazard)
                    
                except Exception as row_error:
                    logger.debug(f"Error processing row: {row_error}")
                    continue
            
            logger.info(f"Crime data: {recent_incidents} incidents in last 7 days, filtered {filtered_low_threat} low-threat, created {len(hazards)} hazards")
            
            high_count = len([h for h in hazards if h['severity'] >= 0.8])
            medium_count = len([h for h in hazards if 0.6 <= h['severity'] < 0.8])
            logger.info(f"Crime severity: High: {high_count}, Medium: {medium_count}")
            
        except Exception as e:
            logger.error(f"Failed to fetch crime data: {e}")
        
        return hazards

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

    def get_hazards_in_area(self, lat: float, lng: float, radius_meters: float = 1000) -> List[Dict]:
        """Get hazards near a specific location."""
        def haversine_distance(lat1, lng1, lat2, lng2):
            from math import radians, sin, cos, sqrt, atan2
            R = 6371000
            lat1_rad = radians(lat1)
            lat2_rad = radians(lat2)
            delta_lat = radians(lat2 - lat1)
            delta_lon = radians(lng2 - lng1)
            a = sin(delta_lat/2)**2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon/2)**2
            c = 2 * atan2(sqrt(a), sqrt(1-a))
            return R * c
        
        hazards = self.fetch_hazards()
        nearby = []
        for hazard in hazards:
            distance = haversine_distance(lat, lng, hazard['lat'], hazard['lng'])
            if distance <= radius_meters:
                hazard['distance_meters'] = round(distance, 1)
                nearby.append(hazard)
        return nearby


# Singleton instance
_news_fetcher = None

def get_news_fetcher() -> NewsHazardFetcher:
    global _news_fetcher
    if _news_fetcher is None:
        _news_fetcher = NewsHazardFetcher()
    return _news_fetcher