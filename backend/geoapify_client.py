import os
import requests
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

class GeoapifyClient:
    """Client for Geoapify Places API"""

    def __init__(self):
        self.api_key = os.getenv('GEOAPIFY_PLACES_API_KEY')
        self.base_url = "https://api.geoapify.com/v1"

    def search_places(self, query: str, lat: float = None, lng: float = None, limit: int = 5) -> List[Dict]:
        """Search for places by name"""
        if not self.api_key:
            logger.warning("Geoapify API key not set")
            return []

        try:
            url = f"{self.base_url}/geocode/search"
            params = {
                'text': query,
                'apiKey': self.api_key,
                'limit': limit,
                'format': 'json'
            }
            if lat and lng:
                params['bias'] = f"proximity:{lng},{lat}"  # longitude,latitude order

            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()

            results = []
            for feature in data.get('features', []):
                props = feature.get('properties', {})
                geom = feature.get('geometry', {})
                coords = geom.get('coordinates', [0, 0])  # [lng, lat]
                results.append({
                    'name': props.get('name', props.get('formatted', 'Unknown')),
                    'address': props.get('formatted', ''),
                    'lat': coords[1],
                    'lng': coords[0],
                    'type': props.get('categories', ['place'])[0] if props.get('categories') else 'place',
                    'score': props.get('rank', {}).get('confidence', 0)
                })
            return results
        except Exception as e:
            logger.error(f"Geoapify search failed: {e}")
            return []

    def reverse_geocode(self, lat: float, lng: float) -> Optional[str]:
        """Convert coordinates to address"""
        if not self.api_key:
            logger.warning("Geoapify API key not set")
            return None

        try:
            url = f"{self.base_url}/geocode/reverse"
            params = {
                'lat': lat,
                'lon': lng,
                'apiKey': self.api_key,
                'format': 'json',
                'limit': 1
            }
            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()

            features = data.get('features', [])
            if features:
                props = features[0].get('properties', {})
                return props.get('formatted')
            return None
        except Exception as e:
            logger.error(f"Geoapify reverse geocode failed: {e}")
            return None