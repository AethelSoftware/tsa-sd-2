"""
Crime Hazard Fetcher for Pittsburgh - Using Monthly Criminal Activity Data
Source: WPRDC - Updated Daily with NIBRS crime incidents
FILTERED: Only shows genuine safety threats, not minor incidents
"""

import os
import logging
import requests
import pandas as pd
from io import BytesIO
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

# Direct download URL for the Monthly Criminal Activity Dataset
CRIME_DATA_URL = "https://data.wprdc.org/dataset/65e69ee3-93b2-4f7a-b9cb-8ce977f15d9a/resource/bd41992a-987a-4cca-8798-fbe1cd946b07/download/monthly_crime_data_2024_2026.xlsx"

# ============================================================================
# SEVERITY MAPPING - Only high-threat incidents get high severity
# ============================================================================

# HIGH SEVERITY (0.8-0.95) - Active threats to personal safety
HIGH_THREAT = {
    'HOMICIDE': 0.95,
    'SHOOTING': 0.95,
    'ASSAULT': 0.85,
    'AGGRAVATED ASSAULT': 0.9,
    'ROBBERY': 0.85,           # Armed robbery, mugging
    'CARJACKING': 0.85,
    'KIDNAPPING': 0.9,
    'SEXUAL ASSAULT': 0.9,
    'ARSON': 0.85,
    'BURGLARY': 0.75,          # Home invasion while occupied
}

# MEDIUM SEVERITY (0.5-0.7) - Situational awareness needed
MEDIUM_THREAT = {
    'BURGLARY': 0.65,          # Unoccupied
    'THEFT': 0.5,
    'STOLEN VEHICLE': 0.55,
    'VANDALISM': 0.4,
    'TRESPASSING': 0.45,
    'DISORDERLY CONDUCT': 0.6,  # Public disturbance
    'DRUG': 0.55,              # Drug activity
    'DRUG POSSESSION': 0.5,
    'DRUG TRAFFICKING': 0.7,
    'WEAPON': 0.7,             # Weapons violation
    'WEAPONS VIOLATION': 0.7,
}

# LOW SEVERITY (0.1-0.3) - Not safety hazards (filtered out)
LOW_THREAT = {
    'FRAUD': 0.2,
    'CREDIT CARD': 0.15,
    'FORGERY': 0.2,
    'COUNTERFEITING': 0.2,
    'EMBEZZLEMENT': 0.15,
    'BAD CHECK': 0.1,
    'VANDALISM': 0.3,
    'PUBLIC DRUNKENNESS': 0.25,
    'DISORDERLY': 0.3,
}

# Type mapping for frontend display
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

# Pittsburgh bounding box
PITTSBURGH_BOUNDS = {
    'min_lat': 40.2,
    'max_lat': 40.8,
    'min_lng': -80.8,
    'max_lng': -79.5
}

# --- Caching ---
CACHE_DURATION = 300  # 5 minutes

# Minimum severity threshold to show on map (0-1)
# Set to 0.5 to only show medium+ threats, filter out fraud, credit card, etc.
MIN_SEVERITY_THRESHOLD = 0.5

# ============================================================================
# CRIME HAZARD FETCHER CLASS
# ============================================================================

class NewsHazardFetcher:
    def __init__(self):
        self.cache = []
        self.last_cache_time = None
        logger.info("Crime Hazard Fetcher initialized with WPRDC Monthly Crime Data")
        logger.info(f"Minimum severity threshold: {MIN_SEVERITY_THRESHOLD} (filtering out low-threat incidents)")
        logger.info(f"Cache duration: {CACHE_DURATION}s")

    def fetch_hazards(self) -> List[Dict[str, Any]]:
        """Fetch recent crime incidents and convert to hazard format."""
        if self.last_cache_time and (datetime.now() - self.last_cache_time).seconds < CACHE_DURATION:
            logger.info(f"Returning {len(self.cache)} cached hazards")
            return self.cache
        
        logger.info("Cache expired. Fetching fresh crime data from WPRDC...")
        all_hazards = self._fetch_crime_data()
        
        # Filter by severity threshold before caching
        filtered_hazards = [h for h in all_hazards if h.get('severity', 0) >= MIN_SEVERITY_THRESHOLD]
        
        self.cache = self.deduplicate_hazards(filtered_hazards)
        self.last_cache_time = datetime.now()
        
        logger.info(f"Total hazards after filtering (severity >= {MIN_SEVERITY_THRESHOLD}): {len(self.cache)}")
        logger.info(f"Filtered out {len(all_hazards) - len(self.cache)} low-threat incidents")
        
        return self.cache

    def _get_severity_and_type(self, offense: str) -> tuple:
        """Determine severity and type based on offense description."""
        offense_upper = str(offense).upper()
        
        # Check high threat first
        for key, value in HIGH_THREAT.items():
            if key in offense_upper:
                return value, TYPE_MAP.get(key, TYPE_MAP['DEFAULT'])
        
        # Check medium threat
        for key, value in MEDIUM_THREAT.items():
            if key in offense_upper:
                return value, TYPE_MAP.get(key, TYPE_MAP['DEFAULT'])
        
        # Check low threat (will be filtered out)
        for key, value in LOW_THREAT.items():
            if key in offense_upper:
                return value, TYPE_MAP.get('DEFAULT', 'crime')
        
        # Default for unknown offenses
        return 0.4, 'crime'

    def _fetch_crime_data(self) -> List[Dict[str, Any]]:
        """Download the Excel file and parse crime incidents from the last 7 days."""
        hazards = []
        
        try:
            logger.info(f"Downloading crime data from: {CRIME_DATA_URL}")
            response = requests.get(CRIME_DATA_URL, timeout=30)
            response.raise_for_status()
            
            excel_data = BytesIO(response.content)
            df = pd.read_excel(excel_data)
            
            logger.info(f"Successfully loaded {len(df)} total crime records")
            logger.info(f"Columns: {df.columns.tolist()}")
            
            cutoff_date = datetime.now() - timedelta(days=7)
            recent_incidents = 0
            filtered_low_threat = 0
            
            for _, row in df.iterrows():
                try:
                    # Parse reported date
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
                    
                    # Extract coordinates
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
                    
                    # Get offense information
                    offense = row.get('NIBRS_Coded_Offense', 'Unknown')
                    if pd.isna(offense):
                        offense = 'Unknown'
                    
                    # Calculate severity and type
                    severity, hazard_type = self._get_severity_and_type(offense)
                    
                    # Skip low severity incidents (fraud, credit card, etc.)
                    if severity < MIN_SEVERITY_THRESHOLD:
                        filtered_low_threat += 1
                        continue
                    
                    # Get neighborhood
                    neighborhood = row.get('Neighborhood', 'Pittsburgh')
                    if pd.isna(neighborhood):
                        neighborhood = 'Pittsburgh'
                    
                    block_address = row.get('Block_Address', '')
                    if pd.isna(block_address):
                        block_address = ''
                    
                    # Build description with threat level indicator
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
            
            logger.info(f"Found {recent_incidents} crime incidents in last 7 days")
            logger.info(f"Filtered out {filtered_low_threat} low-threat incidents (fraud, credit card, etc.)")
            logger.info(f"Created {len(hazards)} hazards from serious incidents")
            
            # Log counts by severity
            high_count = len([h for h in hazards if h['severity'] >= 0.8])
            medium_count = len([h for h in hazards if 0.6 <= h['severity'] < 0.8])
            logger.info(f"High severity: {high_count}, Medium severity: {medium_count}")
            
        except Exception as e:
            logger.error(f"Failed to fetch or parse crime data: {e}")
        
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