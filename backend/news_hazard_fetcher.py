"""
News Hazard Fetcher for Pittsburgh - Multi-API with Rotation and Caching
Supports: GNews API, NewsData.io API, TheNewsAPI
"""

import os
import re
import logging
import requests
import time
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

# --- API Keys for Rotation ---
# Add your actual API keys here (remove the placeholder comments)
API_CONFIGS = [
    {
        'name': 'GNews',
        'url': 'https://gnews.io/api/v4/search',
        'key_param': 'apikey',
        'keys': [
            "a75ef0e7d2d4ed9b928d8d721387ee42",  # Your GNews key
            # Add more GNews keys here if you have multiple accounts
        ]
    },
    {
        'name': 'NewsData',
        'url': 'https://newsdata.io/api/1/news',
        'key_param': 'apikey',
        'keys': [
            "pub_650a9ab0f3164569b74c778f83589ba9",  # Replace with your NewsData.io key
        ]
    },
    {
        'name': 'TheNewsAPI',
        'url': 'https://api.thenewsapi.com/v1/news/all',
        'key_param': 'api_token',
        'keys': [
            "QHi6uqDFhbArmzMvfZ1ZNhiCzubnq7ZJ4Y7jSlMm",  # Replace with your TheNewsAPI key
        ]
    }
]

# --- Caching ---
CACHE_DURATION = 300  # Cache results for 5 minutes (in seconds)

# --- Search Queries (Optimized) ---
# Combined queries to reduce the number of API calls
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
}

# ============================================================================
# NEWS HAZARD FETCHER CLASS
# ============================================================================

class NewsHazardFetcher:
    def __init__(self):
        # Flatten all API keys into a list of (service_name, url, key_param, api_key)
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
            logger.error("No valid API keys found! Please add at least one API key to API_CONFIGS.")
        else:
            logger.info(f"News Hazard Fetcher initialized with {len(self.api_endpoints)} API key(s) across {len(API_CONFIGS)} service(s)")
        
        # Cache storage
        self.cache = []
        self.last_cache_time = None
        self.current_api_index = 0  # For round-robin rotation
        
        logger.info(f"Cache duration: {CACHE_DURATION}s")

    def _make_request_with_rotation(self, params: Dict, original_query: str) -> Optional[Dict]:
        """
        Try to make a request, rotating through ALL available API keys from ALL services.
        Uses round-robin to distribute load across multiple services.
        """
        # Try each API endpoint in rotation
        for attempt in range(len(self.api_endpoints)):
            endpoint = self.api_endpoints[self.current_api_index]
            self.current_api_index = (self.current_api_index + 1) % len(self.api_endpoints)
            
            try:
                # Build URL with service-specific parameters
                url = endpoint['url']
                request_params = params.copy()
                request_params[endpoint['key_param']] = endpoint['key']
                
                # Service-specific parameter adjustments
                if endpoint['name'] == 'NewsData':
                    # NewsData.io uses 'q' for search, but we need to add 'country' and 'language'
                    request_params['country'] = 'us'
                    request_params['language'] = 'en'
                elif endpoint['name'] == 'TheNewsAPI':
                    # TheNewsAPI uses 'search' instead of 'q'
                    request_params['search'] = request_params.pop('q')
                    request_params['language'] = 'en'
                    request_params['limit'] = 5
                
                logger.debug(f"Attempting request with {endpoint['name']} (key {attempt+1}/{len(self.api_endpoints)}) for: {original_query}")
                response = requests.get(url, params=request_params, timeout=10)
                
                if response.status_code == 200:
                    return self._parse_response(response.json(), endpoint['name'])
                elif response.status_code == 429:
                    logger.warning(f"{endpoint['name']} API key hit rate limit. Trying next key/service...")
                    continue
                else:
                    logger.warning(f"{endpoint['name']} API returned {response.status_code}: {response.text[:100]}")
                    continue
                    
            except requests.exceptions.RequestException as e:
                logger.error(f"Request failed for {endpoint['name']}: {e}")
                continue
        
        logger.error(f"All API keys/services exhausted for query: {original_query}")
        return None
    
    def _parse_response(self, data: Dict, service_name: str) -> Optional[Dict]:
        """Parse response from different API services into a common format"""
        articles = []
        
        if service_name == 'GNews':
            # GNews format: {'articles': [...]}
            articles = data.get('articles', [])
            # Convert to standard format
            return {'articles': articles}
            
        elif service_name == 'NewsData':
            # NewsData.io format: {'results': [...]}
            results = data.get('results', [])
            # Convert to GNews-compatible format
            articles = []
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
            # TheNewsAPI format: {'data': [...]}
            results = data.get('data', [])
            articles = []
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

    def fetch_hazards(self) -> List[Dict[str, Any]]:
        """Fetch hazard-related news articles using cached data or fresh API call."""
        # 1. Return cached data if it's still fresh
        if self.last_cache_time and (datetime.now() - self.last_cache_time).seconds < CACHE_DURATION:
            logger.info(f"Returning {len(self.cache)} cached hazards (cache age: {(datetime.now() - self.last_cache_time).seconds}s)")
            return self.cache
        
        # 2. Cache is stale or empty, fetch new data
        logger.info("Cache expired or empty. Fetching fresh hazards from APIs...")
        all_hazards = []
        
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
                        logger.debug(f"No results for query: {query}")
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
                            logger.info(f"Added hazard: {hazard['type']} at {hazard['location_name']}")
                            
                except Exception as e:
                    logger.error(f"Error fetching {query}: {e}")
                    continue
        
        # 3. Update cache and return
        self.cache = self.deduplicate_hazards(all_hazards)
        self.last_cache_time = datetime.now()
        logger.info(f"Cache updated. Total unique hazards found: {len(self.cache)}")
        return self.cache
    
    # --- The following helper methods remain unchanged from your original code ---
    
    def extract_location_from_article(self, article: Dict) -> Optional[Dict]:
        """Extract location from article title and description"""
        title = article.get('title', '')
        description = article.get('description', '')
        text = f"{title} {description}".lower()
        
        for neighborhood, coords in PITTSBURGH_NEIGHBORHOODS.items():
            if neighborhood in text:
                return {'lat': coords[0], 'lng': coords[1], 'name': f"{neighborhood.title()} neighborhood"}
        
        landmarks = {
            'waterfront': (40.4100, -79.9200),
            'station square': (40.4320, -80.0050),
            'market square': (40.4400, -79.9990),
        }
        for landmark, coords in landmarks.items():
            if landmark in text:
                return {'lat': coords[0], 'lng': coords[1], 'name': landmark.title()}
        
        return {'lat': 40.4406, 'lng': -79.9959, 'name': 'Downtown Pittsburgh'}
    
    def calculate_severity(self, article: Dict, hazard_type: str) -> float:
        """Calculate severity score (0-1) based on article content"""
        title = article.get('title', '').lower()
        description = article.get('description', '').lower()
        full_text = f"{title} {description}"
        
        high_keywords = ['fatal', 'death', 'killed', 'critical', 'explosion', 'multi-car']
        medium_keywords = ['injury', 'injured', 'hospital', 'collision', 'structure fire']
        
        if any(word in full_text for word in high_keywords):
            return 0.9
        elif any(word in full_text for word in medium_keywords):
            return 0.7
        
        severity_map = {'accident': 0.6, 'fire': 0.8, 'crime': 0.7, 'hazard': 0.5}
        return severity_map.get(hazard_type, 0.5)
    
    def deduplicate_hazards(self, hazards: List[Dict]) -> List[Dict]:
        """Remove duplicate hazards"""
        unique = []
        seen = set()
        for hazard in hazards:
            key = f"{hazard['type']}_{hazard['lat']}_{hazard['lng']}"
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