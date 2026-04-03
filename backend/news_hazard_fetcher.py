"""
Crime Hazard Fetcher for Pittsburgh - Using Monthly Criminal Activity Data
Source: WPRDC - Updated Daily with NIBRS crime incidents
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

# Direct download URL for the Monthly Criminal Activity Dataset (Updated April 1, 2026)
CRIME_DATA_URL = "https://data.wprdc.org/dataset/65e69ee3-93b2-4f7a-b9cb-8ce977f15d9a/resource/bd41992a-987a-4cca-8798-fbe1cd946b07/download/monthly_crime_data_2024_2026.xlsx"

# Severity mapping by NIBRS offense type
SEVERITY_MAP = {
    'HOMICIDE': 0.95,
    'SHOOTING': 0.9,
    'ROBBERY': 0.85,
    'AGGRAVATED ASSAULT': 0.85,
    'BURGLARY': 0.75,
    'THEFT': 0.6,
    'DRUG': 0.5,
    'DEFAULT': 0.5
}

# Hazard type mapping
TYPE_MAP = {
    'HOMICIDE': 'violent',
    'SHOOTING': 'violent',
    'ROBBERY': 'violent',
    'AGGRAVATED ASSAULT': 'violent',
    'BURGLARY': 'property',
    'THEFT': 'property',
    'DRUG': 'drug',
    'DEFAULT': 'crime'
}

# Pittsburgh bounding box for filtering
PITTSBURGH_BOUNDS = {
    'min_lat': 40.2,
    'max_lat': 40.8,
    'min_lng': -80.8,
    'max_lng': -79.5
}

# --- Caching ---
CACHE_DURATION = 300  # Cache results for 5 minutes

# ============================================================================
# CRIME HAZARD FETCHER CLASS
# ============================================================================

class NewsHazardFetcher:
    def __init__(self):
        self.cache = []
        self.last_cache_time = None
        logger.info("Crime Hazard Fetcher initialized with WPRDC Monthly Crime Data")
        logger.info(f"Data source updates daily. Cache duration: {CACHE_DURATION}s")

    def fetch_hazards(self) -> List[Dict[str, Any]]:
        """Fetch recent crime incidents and convert to hazard format."""
        # Return cached data if it's still fresh
        if self.last_cache_time and (datetime.now() - self.last_cache_time).seconds < CACHE_DURATION:
            logger.info(f"Returning {len(self.cache)} cached hazards")
            return self.cache
        
        logger.info("Cache expired. Fetching fresh crime data from WPRDC...")
        all_hazards = self._fetch_crime_data()
        
        # Update cache and return
        self.cache = self.deduplicate_hazards(all_hazards)
        self.last_cache_time = datetime.now()
        logger.info(f"Cache updated. Total unique hazards found: {len(self.cache)}")
        return self.cache

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
            logger.info(f"Columns in dataset: {df.columns.tolist()}")
            
            # Filter for incidents in the last 7 days
            cutoff_date = datetime.now() - timedelta(days=7)
            recent_incidents = 0
            
            for _, row in df.iterrows():
                try:
                    # Parse the reported date
                    reported_date_str = row.get('ReportedDate')
                    if pd.isna(reported_date_str):
                        continue
                    
                    # Handle different possible date formats
                    try:
                        if isinstance(reported_date_str, datetime):
                            reported_date = reported_date_str
                        else:
                            reported_date = pd.to_datetime(reported_date_str)
                    except Exception:
                        continue
                    
                    # Filter by date (last 7 days)
                    if reported_date < cutoff_date:
                        continue
                    
                    recent_incidents += 1
                    
                    # Extract coordinates (XCOORD = Longitude, YCOORD = Latitude)
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
                    
                    # Skip if no valid coordinates
                    if lat is None or lng is None:
                        continue
                    
                    # Validate Pittsburgh bounds
                    if not (PITTSBURGH_BOUNDS['min_lat'] <= lat <= PITTSBURGH_BOUNDS['max_lat'] and
                            PITTSBURGH_BOUNDS['min_lng'] <= lng <= PITTSBURGH_BOUNDS['max_lng']):
                        continue
                    
                    # Get offense information
                    offense = row.get('NIBRS_Coded_Offense', 'Unknown')
                    if pd.isna(offense):
                        offense = 'Unknown'
                    offense_upper = str(offense).upper()
                    
                    # Determine severity
                    severity = SEVERITY_MAP.get('DEFAULT')
                    hazard_type = TYPE_MAP.get('DEFAULT')
                    for key, value in SEVERITY_MAP.items():
                        if key in offense_upper:
                            severity = value
                            hazard_type = TYPE_MAP.get(key, TYPE_MAP['DEFAULT'])
                            break
                    
                    # Get neighborhood
                    neighborhood = row.get('Neighborhood', 'Pittsburgh')
                    if pd.isna(neighborhood):
                        neighborhood = 'Pittsburgh'
                    
                    # Get block address for description
                    block_address = row.get('Block_Address', '')
                    if pd.isna(block_address):
                        block_address = ''
                    
                    hazard = {
                        'type': hazard_type,
                        'description': f"{offense}",
                        'full_description': f"{offense} reported at {block_address} in {neighborhood}" if block_address else f"{offense} reported in {neighborhood}",
                        'lat': lat,
                        'lng': lng,
                        'location_name': neighborhood,
                        'severity': severity,
                        'source': 'wprdc_crime_data',
                        'title': offense,
                        'url': '',
                        'publisher': 'Pittsburgh Bureau of Police',
                        'published_date': reported_date.isoformat(),
                        'is_active': True
                    }
                    hazards.append(hazard)
                    
                except Exception as row_error:
                    logger.debug(f"Error processing crime row: {row_error}")
                    continue
            
            logger.info(f"Found {recent_incidents} crime incidents in the last 7 days")
            logger.info(f"Successfully created {len(hazards)} hazards from crime data")
            
        except Exception as e:
            logger.error(f"Failed to fetch or parse crime data: {e}")
        
        return hazards

    def deduplicate_hazards(self, hazards: List[Dict]) -> List[Dict]:
        """Remove duplicate hazards based on type, location, and source."""
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