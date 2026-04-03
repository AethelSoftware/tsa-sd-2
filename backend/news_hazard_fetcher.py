"""
News Hazard Fetcher for Pittsburgh - Using GNews API with API Key
"""

import os
import re
import logging
import requests
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)

# GNews API configuration
GNEWS_API_KEY = "a75ef0e7d2d4ed9b928d8d721387ee42"
GNEWS_BASE_URL = "https://gnews.io/api/v4"

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

class NewsHazardFetcher:
    def __init__(self):
        self.api_key = GNEWS_API_KEY
        if not self.api_key:
            logger.warning("GNEWS_API_KEY not set in environment variables")
        logger.info("News Hazard Fetcher initialized with GNews API")
    
    def _make_request(self, endpoint: str, params: Dict) -> Optional[Dict]:
        """Make a request to the GNews API"""
        if not self.api_key:
            return None
        
        url = f"{GNEWS_BASE_URL}/{endpoint}"
        params['apikey'] = self.api_key
        
        try:
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"GNews API request failed: {e}")
            return None
    
    def fetch_hazards(self) -> List[Dict[str, Any]]:
        """Fetch hazard-related news articles using GNews API"""
        all_hazards = []
        
        # Define search queries for different hazard types
        hazard_queries = {
            'accident': [
                '"car accident" Pittsburgh',
                '"crash" Pittsburgh',
                '"vehicle collision" Pittsburgh',
            ],
            'fire': [
                '"fire" Pittsburgh',
                '"house fire" Pittsburgh',
                '"building fire" Pittsburgh',
            ],
            'crime': [
                '"shooting" Pittsburgh',
                '"robbery" Pittsburgh',
                '"assault" Pittsburgh',
            ],
            'hazard': [
                '"road closed" Pittsburgh',
                '"gas leak" Pittsburgh',
                '"police activity" Pittsburgh',
            ]
        }
        
        for hazard_type, queries in hazard_queries.items():
            for query in queries:
                try:
                    logger.info(f"Searching GNews for: {query}")
                    
                    # Make API request
                    params = {
                        'q': query,
                        'lang': 'en',
                        'country': 'us',
                        'max': 5,  # Max 5 articles per query
                        'sortby': 'publishedAt',  # Most recent first
                    }
                    
                    data = self._make_request('search', params)
                    
                    if not data or 'articles' not in data:
                        logger.debug(f"No results for query: {query}")
                        continue
                    
                    articles = data.get('articles', [])
                    logger.info(f"Found {len(articles)} articles for {query}")
                    
                    for article in articles:
                        # Extract location from article
                        location = self.extract_location_from_article(article)
                        
                        if location:
                            # Calculate severity based on article content
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
        
        # Remove duplicates
        unique_hazards = self.deduplicate_hazards(all_hazards)
        logger.info(f"Total unique hazards found: {len(unique_hazards)}")
        return unique_hazards
    
    def extract_location_from_article(self, article: Dict) -> Optional[Dict]:
        """Extract location from article title and description"""
        title = article.get('title', '')
        description = article.get('description', '')
        text = f"{title} {description}".lower()
        
        # Check neighborhoods
        for neighborhood, coords in PITTSBURGH_NEIGHBORHOODS.items():
            if neighborhood in text:
                return {
                    'lat': coords[0],
                    'lng': coords[1],
                    'name': f"{neighborhood.title()} neighborhood"
                }
        
        # Check for Pittsburgh landmarks
        landmarks = {
            'waterfront': (40.4100, -79.9200),
            'station square': (40.4320, -80.0050),
            'market square': (40.4400, -79.9990),
        }
        
        for landmark, coords in landmarks.items():
            if landmark in text:
                return {
                    'lat': coords[0],
                    'lng': coords[1],
                    'name': landmark.title()
                }
        
        # Default to downtown Pittsburgh
        return {'lat': 40.4406, 'lng': -79.9959, 'name': 'Downtown Pittsburgh'}
    
    def calculate_severity(self, article: Dict, hazard_type: str) -> float:
        """Calculate severity score (0-1) based on article content"""
        title = article.get('title', '').lower()
        description = article.get('description', '').lower()
        full_text = f"{title} {description}"
        
        # High severity keywords
        high_keywords = ['fatal', 'death', 'killed', 'critical', 'explosion', 'multi-car']
        # Medium severity keywords
        medium_keywords = ['injury', 'injured', 'hospital', 'collision', 'structure fire']
        
        if any(word in full_text for word in high_keywords):
            return 0.9
        elif any(word in full_text for word in medium_keywords):
            return 0.7
        
        # Default severity by type
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