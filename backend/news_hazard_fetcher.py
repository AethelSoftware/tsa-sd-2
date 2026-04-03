"""
News Hazard Fetcher for Pittsburgh - Multi-API with Rotation, Caching, and Arrest Data
Supports: GNews API, NewsData.io API, TheNewsAPI, and Pittsburgh Arrest Data (Direct Excel Download)
"""

import os
import re
import logging
import requests
import time
import pandas as pd
import random
from io import BytesIO
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

# --- API Keys for Rotation ---
API_CONFIGS = [
    {
        'name': 'GNews',
        'url': 'https://gnews.io/api/v4/search',
        'key_param': 'apikey',
        'keys': [
            "a75ef0e7d2d4ed9b928d8d721387ee42",
        ]
    },
    {
        'name': 'NewsData',
        'url': 'https://newsdata.io/api/1/news',
        'key_param': 'apikey',
        'keys': [
            "pub_650a9ab0f3164569b74c778f83589ba9",
        ]
    },
    {
        'name': 'TheNewsAPI',
        'url': 'https://api.thenewsapi.com/v1/news/all',
        'key_param': 'api_token',
        'keys': [
            "QHi6uqDFhbArmzMvfZ1ZNhiCzubnq7ZJ4Y7jSlMm",
        ]
    }
]

# --- Pittsburgh Arrest Data (Direct Excel Download) ---
ARREST_FILE_URL = "https://data.wprdc.org/dataset/pbp_arrest_data_2024_2025/resource/e419c20c-8df4-4729-830c-e49427a656e0/download/arrests_2024_2026.xlsx"

# Severity mapping by offense type
SEVERITY_MAP = {
    'HOMICIDE': 0.95,
    'ROBBERY': 0.85,
    'AGGRAVATED ASSAULT': 0.85,
    'BURGLARY': 0.75,
    'THEFT': 0.6,
    'DRUG': 0.5,
    'DUI': 0.4,
    'DISORDERLY': 0.3,
    'DEFAULT': 0.5
}

# --- Caching ---
CACHE_DURATION = 300  # Cache results for 5 minutes (in seconds)

# --- Search Queries (Optimized) ---
HAZARD_QUERIES = {
    'accident': ['"car accident" Pittsburgh OR "crash" Pittsburgh OR "vehicle collision" Pittsburgh'],
    'fire': ['"fire" Pittsburgh OR "house fire" Pittsburgh OR "building fire" Pittsburgh'],
    'crime': ['"shooting" Pittsburgh OR "robbery" Pittsburgh OR "assault" Pittsburgh'],
    'hazard': ['"road closed" Pittsburgh OR "gas leak" Pittsburgh OR "police activity" Pittsburgh'],
}

# Pittsburgh neighborhoods with coordinates
PITTSBURGH_NEIGHBORHOODS = {
    'downtown': (40.4406, -79.9959),
    'oakland': (40.4440, -79.9545),
    'shadyside': (40.4560, -79.9390),
    'east liberty': (40.4600, -79.9200),
    'south side': (40.4280, -79.9720),
    'north shore': (40.4460, -80.0080),
    'bloomfield': (40.4610, -79.9490),
    'lawrenceville': (40.4720, -79.9590),
    'squirrel hill': (40.4370, -79.9250),
    'point breeze': (40.4460, -79.9150),
    'highland park': (40.4790, -79.9110),
    'strip district': (40.4480, -79.9850),
    'north side': (40.4520, -80.0120),
    'west end': (40.4350, -80.0580),
    'mount washington': (40.4300, -80.0100),
    'brookline': (40.4000, -80.0180),
    'beechview': (40.4080, -80.0300),
    'carrick': (40.3980, -79.9870),
    'hazelwood': (40.4050, -79.9280),
    'greenfield': (40.4200, -79.9400),
}

# Common Pittsburgh street names for location extraction
STREET_KEYWORDS = [
    'penn ave', 'liberty ave', 'forbes ave', 'fifth ave', 'baum blvd',
    'centre ave', 'butler st', 'carson st', 'smithfield st', 'wood st',
    'market square', 'station square', 'waterfront', 'north shore'
]

# ============================================================================
# NEWS HAZARD FETCHER CLASS
# ============================================================================

class NewsHazardFetcher:
    def __init__(self):
        # Flatten all API keys into a list
        self.api_endpoints = []
        for config in API_CONFIGS:
            for api_key in config['keys']:
                if api_key and not api_key.startswith('YOUR_'):
                    self.api_endpoints.append({
                        'name': config['name'],
                        'url': config['url'],
                        'key_param': config['key_param'],
                        'key': api_key
                    })
        
        if not self.api_endpoints:
            logger.error("No valid API keys found!")
        else:
            logger.info(f"News Hazard Fetcher initialized with {len(self.api_endpoints)} API key(s)")
        
        # Cache storage
        self.cache = []
        self.last_cache_time = None
        self.current_api_index = 0
        self.arrest_cache = []
        self.arrest_cache_time = None
        
        # Track which neighborhoods have been used for random assignment
        self.neighborhood_usage = {name: 0 for name in PITTSBURGH_NEIGHBORHOODS.keys()}
        
        logger.info(f"Cache duration: {CACHE_DURATION}s")

    def _fetch_arrest_data(self) -> List[Dict]:
        """Fetch recent arrest data by downloading the Excel file directly from WPRDC."""
        hazards = []
        
        try:
            if self.arrest_cache_time and (datetime.now() - self.arrest_cache_time).seconds < 3600:
                logger.info(f"Returning {len(self.arrest_cache)} cached arrest records")
                return self.arrest_cache
            
            logger.info(f"Downloading arrest data from: {ARREST_FILE_URL}")
            response = requests.get(ARREST_FILE_URL, timeout=30)
            response.raise_for_status()
            
            excel_data = BytesIO(response.content)
            df = pd.read_excel(excel_data)
            
            logger.info(f"Successfully loaded {len(df)} arrest records from Excel file")
            
            # Show columns for debugging
            logger.info(f"Arrest data columns: {df.columns.tolist()}")
            
            cutoff_date = datetime.now() - timedelta(days=30)  # Last 30 days
            
            for _, row in df.iterrows():
                try:
                    # Parse arrest date
                    arrest_date_str = None
                    for col in ['ARREST_DATE', 'Date', 'ARRESTDATE', 'date']:
                        if col in row and pd.notna(row[col]):
                            arrest_date_str = str(row[col])
                            break
                    
                    if arrest_date_str:
                        try:
                            if 'T' in arrest_date_str:
                                arrest_date = datetime.strptime(arrest_date_str, '%Y-%m-%dT%H:%M:%S')
                            elif ' ' in arrest_date_str:
                                arrest_date = datetime.strptime(arrest_date_str, '%Y-%m-%d %H:%M:%S')
                            else:
                                arrest_date = datetime.strptime(arrest_date_str, '%Y-%m-%d')
                            
                            if arrest_date < cutoff_date:
                                continue
                        except:
                            pass
                    
                    # Extract coordinates
                    lat = None
                    lng = None
                    
                    for col in ['Y', 'LATITUDE', 'Latitude', 'lat', 'INCIDENT_LATITUDE']:
                        if col in row and pd.notna(row[col]):
                            try:
                                lat = float(row[col])
                                break
                            except:
                                pass
                    
                    for col in ['X', 'LONGITUDE', 'Longitude', 'lng', 'INCIDENT_LONGITUDE']:
                        if col in row and pd.notna(row[col]):
                            try:
                                lng = float(row[col])
                                break
                            except:
                                pass
                    
                    if not lat or not lng:
                        continue
                    
                    if not (40.2 <= lat <= 40.8 and -80.5 <= lng <= -79.5):
                        continue
                    
                    offense = "Unknown"
                    for col in ['OFFENSE', 'OFFENSES', 'Charge', 'Description']:
                        if col in row and pd.notna(row[col]):
                            offense = str(row[col]).upper()
                            break
                    
                    severity = SEVERITY_MAP.get('DEFAULT')
                    for key, value in SEVERITY_MAP.items():
                        if key in offense:
                            severity = value
                            break
                    
                    neighborhood = "Pittsburgh"
                    for col in ['NEIGHBORHOOD', 'INCIDENTNEIGHBORHOOD', 'Neighborhood']:
                        if col in row and pd.notna(row[col]):
                            neighborhood = str(row[col])
                            break
                    
                    hazard = {
                        'type': 'crime',
                        'description': f"Arrest: {offense[:100]}",
                        'full_description': f"Arrest reported in {neighborhood}",
                        'lat': lat,
                        'lng': lng,
                        'location_name': neighborhood,
                        'severity': severity,
                        'source': 'arrest_data',
                        'title': f"Arrest: {offense[:100]}",
                        'url': '',
                        'publisher': 'Pittsburgh Police',
                        'published_date': arrest_date_str if arrest_date_str else datetime.now().isoformat(),
                        'is_active': True
                    }
                    hazards.append(hazard)
                    
                except Exception as row_error:
                    logger.debug(f"Error processing arrest row: {row_error}")
                    continue
            
            self.arrest_cache = hazards
            self.arrest_cache_time = datetime.now()
            
            logger.info(f"Added {len(hazards)} arrest-based hazards (last 30 days)")
            
        except Exception as e:
            logger.error(f"Failed to fetch arrest data: {e}")
            if self.arrest_cache:
                logger.info(f"Returning {len(self.arrest_cache)} cached arrest records due to error")
                return self.arrest_cache
        
        return hazards

    def _make_request_with_rotation(self, params: Dict, original_query: str) -> Optional[Dict]:
        """Try to make a request, rotating through available API keys on failure."""
        for attempt in range(len(self.api_endpoints)):
            endpoint = self.api_endpoints[self.current_api_index]
            self.current_api_index = (self.current_api_index + 1) % len(self.api_endpoints)
            
            try:
                url = endpoint['url']
                request_params = params.copy()
                request_params[endpoint['key_param']] = endpoint['key']
                
                if endpoint['name'] == 'NewsData':
                    request_params['country'] = 'us'
                    request_params['language'] = 'en'
                elif endpoint['name'] == 'TheNewsAPI':
                    request_params['search'] = request_params.pop('q')
                    request_params['language'] = 'en'
                    request_params['limit'] = 5
                
                logger.debug(f"Attempting request with {endpoint['name']}")
                response = requests.get(url, params=request_params, timeout=10)
                
                if response.status_code == 200:
                    return self._parse_response(response.json(), endpoint['name'])
                elif response.status_code == 429:
                    logger.warning(f"{endpoint['name']} API key hit rate limit. Trying next...")
                    continue
                else:
                    logger.warning(f"{endpoint['name']} API returned {response.status_code}")
                    continue
                    
            except requests.exceptions.RequestException as e:
                logger.error(f"Request failed for {endpoint['name']}: {e}")
                continue
        
        logger.error(f"All API keys exhausted for query: {original_query}")
        return None
    
    def _parse_response(self, data: Dict, service_name: str) -> Optional[Dict]:
        """Parse response from different API services into a common format"""
        articles = []
        
        if service_name == 'GNews':
            articles = data.get('articles', [])
            return {'articles': articles}
            
        elif service_name == 'NewsData':
            results = data.get('results', [])
            for item in results:
                articles.append({
                    'title': item.get('title', ''),
                    'description': item.get('description', ''),
                    'url': item.get('link', ''),
                    'source': {'name': item.get('source_id', 'Unknown')},
                    'publishedAt': item.get('pubDate', ''),
                })
            return {'articles': articles}
            
        elif service_name == 'TheNewsAPI':
            results = data.get('data', [])
            for item in results:
                articles.append({
                    'title': item.get('title', ''),
                    'description': item.get('description', ''),
                    'url': item.get('url', ''),
                    'source': {'name': item.get('source', 'Unknown')},
                    'publishedAt': item.get('published_at', ''),
                })
            return {'articles': articles}
        
        return data

    def extract_location_from_article(self, article: Dict) -> Optional[Dict]:
        """
        Extract location from article title and description.
        Uses multiple strategies to find location data.
        """
        title = article.get('title', '')
        description = article.get('description', '')
        text = f"{title} {description}".lower()
        
        # Strategy 1: Check for neighborhood names
        for neighborhood, coords in PITTSBURGH_NEIGHBORHOODS.items():
            if neighborhood in text:
                return {'lat': coords[0], 'lng': coords[1], 'name': f"{neighborhood.title()} neighborhood"}
        
        # Strategy 2: Check for street names
        street_keywords = {
            'penn ave': (40.4440, -79.9870),
            'liberty ave': (40.4440, -79.9800),
            'forbes ave': (40.4400, -79.9540),
            'fifth ave': (40.4420, -79.9460),
            'baum blvd': (40.4560, -79.9400),
            'butler st': (40.4580, -79.9550),
            'carson st': (40.4280, -79.9720),
        }
        for street, coords in street_keywords.items():
            if street in text:
                return {'lat': coords[0], 'lng': coords[1], 'name': f"Near {street.title()}"}
        
        # Strategy 3: Check for landmarks
        landmarks = {
            'waterfront': (40.4100, -79.9200),
            'station square': (40.4320, -80.0050),
            'market square': (40.4400, -79.9990),
        }
        for landmark, coords in landmarks.items():
            if landmark in text:
                return {'lat': coords[0], 'lng': coords[1], 'name': landmark.title()}
        
        # Strategy 4: Spread across different neighborhoods based on article hash
        # This ensures hazards aren't all stacked at one point
        import hashlib
        article_hash = int(hashlib.md5(article.get('title', '').encode()).hexdigest()[:8], 16)
        neighborhoods_list = list(PITTSBURGH_NEIGHBORHOODS.values())
        neighborhood_names = list(PITTSBURGH_NEIGHBORHOODS.keys())
        
        # Use hash to pick a consistent neighborhood for this article
        idx = article_hash % len(neighborhoods_list)
        coords = neighborhoods_list[idx]
        name = neighborhood_names[idx]
        
        return {'lat': coords[0], 'lng': coords[1], 'name': f"{name.title()} (estimated location)"}
    
    def calculate_severity(self, article: Dict, hazard_type: str) -> float:
        """Calculate severity score (0-1) based on article content"""
        title = article.get('title', '').lower()
        description = article.get('description', '').lower()
        full_text = f"{title} {description}"
        
        high_keywords = ['fatal', 'death', 'killed', 'critical', 'explosion', 'multi-car', 'homicide', 'murder']
        medium_keywords = ['injury', 'injured', 'hospital', 'collision', 'structure fire', 'shooting', 'stabbing']
        
        if any(word in full_text for word in high_keywords):
            return 0.9
        elif any(word in full_text for word in medium_keywords):
            return 0.7
        
        severity_map = {'accident': 0.6, 'fire': 0.8, 'crime': 0.7, 'hazard': 0.5}
        return severity_map.get(hazard_type, 0.5)
    
    def fetch_hazards(self) -> List[Dict[str, Any]]:
        """Fetch hazard-related news articles AND arrest data using cached data or fresh API call."""
        # Return cached data if it's still fresh
        if self.last_cache_time and (datetime.now() - self.last_cache_time).seconds < CACHE_DURATION:
            logger.info(f"Returning {len(self.cache)} cached hazards")
            return self.cache
        
        logger.info("Cache expired. Fetching fresh hazards...")
        all_hazards = []
        
        # Fetch from news APIs
        news_count = 0
        for hazard_type, queries in HAZARD_QUERIES.items():
            for query in queries:
                try:
                    logger.info(f"Searching for: {query}")
                    
                    params = {
                        'q': query,
                        'lang': 'en',
                        'max': 5,
                    }
                    
                    data = self._make_request_with_rotation(params, query)
                    
                    if not data or 'articles' not in data:
                        continue
                    
                    articles = data.get('articles', [])
                    logger.info(f"Found {len(articles)} articles for {query}")
                    
                    for article in articles:
                        location = self.extract_location_from_article(article)
                        if location:
                            severity = self.calculate_severity(article, hazard_type)
                            hazard = {
                                'type': hazard_type,
                                'description': article.get('title', '')[:200],
                                'full_description': article.get('description', ''),
                                'lat': location['lat'],
                                'lng': location['lng'],
                                'location_name': location.get('name', 'Unknown'),
                                'source': 'news_api',
                                'title': article.get('title', ''),
                                'url': article.get('url', ''),
                                'publisher': article.get('source', {}).get('name', 'Unknown'),
                                'published_date': article.get('publishedAt', ''),
                                'severity': severity,
                                'is_active': True
                            }
                            all_hazards.append(hazard)
                            news_count += 1
                            logger.info(f"Added hazard: {hazard['type']} at {hazard['location_name']}")
                            
                except Exception as e:
                    logger.error(f"Error fetching {query}: {e}")
                    continue
        
        logger.info(f"News hazards found: {news_count}")
        
        # Fetch arrest data
        arrest_hazards = self._fetch_arrest_data()
        all_hazards.extend(arrest_hazards)
        logger.info(f"Arrest hazards found: {len(arrest_hazards)}")
        
        # Update cache and return
        self.cache = self.deduplicate_hazards(all_hazards)
        self.last_cache_time = datetime.now()
        logger.info(f"Cache updated. Total unique hazards found: {len(self.cache)} (news: {news_count}, arrests: {len(arrest_hazards)})")
        return self.cache
    
    def deduplicate_hazards(self, hazards: List[Dict]) -> List[Dict]:
        """Remove duplicate hazards"""
        unique = []
        seen = set()
        for hazard in hazards:
            key = f"{hazard['type']}_{hazard['lat']}_{hazard['lng']}_{hazard['source']}"
            if key not in seen:
                seen.add(key)
                unique.append(hazard)
        return unique
    
    def get_hazards_in_area(self, lat: float, lng: float, radius_meters: float = 1000) -> List[Dict]:
        """Get hazards near a location"""
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