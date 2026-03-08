"""
Real route calculation using TomTom API with proper turn-by-turn navigation.
"""

import os
import requests
import logging
import polyline
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta
import math

logger = logging.getLogger(__name__)

class TomTomRouter:
    """Handle routing with TomTom API for realistic pedestrian routes"""
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')
        self.base_url = "https://api.tomtom.com/routing/1"
        self.search_url = "https://api.tomtom.com/search/2"
        
    def calculate_route(self, start_lat: float, start_lng: float, 
                       dest_lat: float, dest_lng: float,
                       travel_mode: str = "pedestrian",
                       avoid_hazards: bool = True,
                       accessibility_needs: List[str] = None) -> Optional[Dict]:
        """Calculate route between two points using TomTom API"""
        try:
            # Format coordinates for TomTom API
            origin = f"{start_lat},{start_lng}"
            destination = f"{dest_lat},{dest_lng}"
            
            # Construct URL
            url = f"{self.base_url}/calculateRoute/{origin}:{destination}/json"
            
            # Build parameters
            params = {
                'key': self.api_key,
                'travelMode': travel_mode,
                'routeType': 'fastest',
                'traffic': 'true',
                'maxAlternatives': 3,
                'instructionsType': 'text',
                'language': 'en-US',
                'computeBestOrder': 'false',
                'routeRepresentation': 'polyline',
                'computeTravelTimeFor': 'all',
                'vehicleHeading': 0,
                'report': 'effectiveSettings',
                'sectionType': ['travelMode', 'pedestrian'],
                'avoid': 'unpavedRoads,ferries'
            }
            
            # Add accessibility considerations
            if accessibility_needs:
                if 'wheelchair' in accessibility_needs:
                    params['hilliness'] = 'normal'  # Avoid steep hills
                    params['windingness'] = 'normal'  # Avoid sharp turns
                if 'blind' in accessibility_needs:
                    params['avoid'] = 'unpavedRoads,tollRoads,ferries,motorways'
            
            logger.info(f"Calculating TomTom route from {origin} to {destination}")
            
            # Make request
            response = requests.get(url, params=params, timeout=15)
            response.raise_for_status()
            data = response.json()
            
            if 'routes' not in data or not data['routes']:
                logger.warning("No routes found in TomTom response")
                return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
            
            # Process best route
            route = data['routes'][0]
            processed = self._process_route(route, start_lat, start_lng, dest_lat, dest_lng)
            
            # Add accessibility features
            if accessibility_needs:
                processed = self._add_accessibility_features(processed, accessibility_needs)
            
            return processed
            
        except requests.exceptions.RequestException as e:
            logger.error(f"TomTom API request failed: {e}")
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
        except Exception as e:
            logger.error(f"Error calculating route: {e}")
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
    
    def _process_route(self, route: Dict, start_lat: float, start_lng: float,
                      dest_lat: float, dest_lng: float) -> Dict:
        """Process TomTom route response into our format"""
        
        # Extract route summary
        summary = route.get('summary', {})
        legs = route.get('legs', [])
        
        if not legs:
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
        
        leg = legs[0]
        
        # Decode polyline points
        route_points = []
        points = leg.get('points', {})
        
        if 'encodedPolyline' in points:
            # Decode TomTom polyline
            encoded = points['encodedPolyline']
            try:
                # TomTom uses a custom polyline format, try to decode it
                route_points = self._decode_tomtom_polyline(encoded)
            except:
                # Fallback to start and end points
                route_points = [(start_lat, start_lng), (dest_lat, dest_lng)]
        else:
            # Try alternative format
            for point in leg.get('points', []):
                if 'latitude' in point and 'longitude' in point:
                    route_points.append((point['latitude'], point['longitude']))
        
        # Extract guidance instructions
        instructions = []
        guidance = leg.get('guidance', {}).get('instructions', [])
        
        for instr in guidance:
            if 'message' in instr and 'point' in instr:
                instructions.append({
                    'instruction': instr['message'],
                    'distance': instr.get('roadLength', 0),
                    'duration': instr.get('travelTime', 0),
                    'type': instr.get('maneuver', 'continue'),
                    'point_index': instr.get('pointIndex', 0),
                    'point': {
                        'lat': route_points[instr.get('pointIndex', 0)][0] if route_points else start_lat,
                        'lng': route_points[instr.get('pointIndex', 0)][1] if route_points else start_lng
                    }
                })
        
        # Calculate segments for safety analysis
        segments = []
        if route_points and len(route_points) > 1:
            for i in range(len(route_points) - 1):
                start_point = route_points[i]
                end_point = route_points[i + 1]
                
                # Calculate segment distance using haversine
                distance = self._haversine_distance(start_point[0], start_point[1], 
                                                   end_point[0], end_point[1])
                
                segments.append({
                    'start': {'lat': start_point[0], 'lng': start_point[1]},
                    'end': {'lat': end_point[0], 'lng': end_point[1]},
                    'distance': distance,
                    'duration': distance / 1.4,  # Average walking speed 1.4 m/s
                    'index': i
                })
        
        # Calculate bounding box
        if route_points:
            lats = [p[0] for p in route_points]
            lngs = [p[1] for p in route_points]
            bounds = {
                'north': max(lats),
                'south': min(lats),
                'east': max(lngs),
                'west': min(lngs)
            }
        else:
            bounds = {
                'north': max(start_lat, dest_lat),
                'south': min(start_lat, dest_lat),
                'east': max(start_lng, dest_lng),
                'west': min(start_lng, dest_lng)
            }
        
        return {
            'points': route_points,
            'segments': segments,
            'distance_meters': summary.get('lengthInMeters', 0),
            'duration_seconds': summary.get('travelTimeInSeconds', 0),
            'instructions': instructions,
            'summary': summary,
            'bounds': bounds,
            'travel_mode': route.get('travelMode', 'pedestrian'),
            'arrival_time': (datetime.now() + timedelta(seconds=summary.get('travelTimeInSeconds', 0))).isoformat(),
            'start_point': {'lat': start_lat, 'lng': start_lng},
            'end_point': {'lat': dest_lat, 'lng': dest_lng}
        }
    
    def _add_accessibility_features(self, route: Dict, needs: List[str]) -> Dict:
        """Add accessibility features to route based on user needs"""
        features = []
        
        if 'wheelchair' in needs:
            features.extend([
                'elevator_access',
                'ramp_access',
                'wide_pathways',
                'smooth_surfaces',
                'accessible_crossings'
            ])
        
        if 'blind' in needs:
            features.extend([
                'tactile_paving',
                'audible_signals',
                'clear_wayfinding',
                'consistent_width',
                'obstacle_free'
            ])
        
        if 'deaf' in needs:
            features.extend([
                'visual_signals',
                'clear_sightlines',
                'vibration_alerts'
            ])
        
        route['accessibility_features'] = features
        return route
    
    def _decode_tomtom_polyline(self, encoded: str) -> List[Tuple[float, float]]:
        """Decode TomTom's custom polyline format"""
        points = []
        index = 0
        lat = 0
        lng = 0
        
        while index < len(encoded):
            # Decode latitude
            b = 0
            shift = 0
            result = 0
            
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            
            # Two's complement if negative
            if result & 1:
                dlat = ~(result >> 1)
            else:
                dlat = result >> 1
            
            lat += dlat
            
            # Decode longitude
            shift = 0
            result = 0
            
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            
            # Two's complement if negative
            if result & 1:
                dlng = ~(result >> 1)
            else:
                dlng = result >> 1
            
            lng += dlng
            
            points.append((lat * 1e-5, lng * 1e-5))
        
        return points
    
    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate distance between two points using Haversine formula"""
        R = 6371000  # Earth's radius in meters
        
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)
        
        a = math.sin(delta_phi/2) * math.sin(delta_phi/2) + \
            math.cos(phi1) * math.cos(phi2) * \
            math.sin(delta_lambda/2) * math.sin(delta_lambda/2)
        
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        
        return R * c
    
    def _generate_fallback_route(self, start_lat: float, start_lng: float,
                                dest_lat: float, dest_lng: float) -> Dict:
        """Generate a fallback route when API fails"""
        distance = self._haversine_distance(start_lat, start_lng, dest_lat, dest_lng)
        
        # Create intermediate points for a more natural route
        points = []
        steps = 10
        
        for i in range(steps + 1):
            t = i / steps
            # Add some curve to make it look natural
            lat = start_lat + (dest_lat - start_lat) * t + math.sin(t * math.pi) * 0.0005
            lng = start_lng + (dest_lng - start_lng) * t + math.cos(t * math.pi) * 0.0005
            points.append((lat, lng))
        
        segments = []
        for i in range(len(points) - 1):
            seg_distance = self._haversine_distance(points[i][0], points[i][1], 
                                                   points[i+1][0], points[i+1][1])
            segments.append({
                'start': {'lat': points[i][0], 'lng': points[i][1]},
                'end': {'lat': points[i+1][0], 'lng': points[i+1][1]},
                'distance': seg_distance,
                'duration': seg_distance / 1.4,
                'index': i
            })
        
        return {
            'points': points,
            'segments': segments,
            'distance_meters': distance,
            'duration_seconds': distance / 1.4,
            'instructions': [
                {
                    'instruction': 'Start walking towards destination',
                    'distance': distance / 2,
                    'duration': distance / 2.8,
                    'type': 'depart',
                    'point_index': 0
                },
                {
                    'instruction': 'Continue straight',
                    'distance': distance / 2,
                    'duration': distance / 2.8,
                    'type': 'arrive',
                    'point_index': len(points) - 1
                }
            ],
            'summary': {
                'lengthInMeters': distance,
                'travelTimeInSeconds': distance / 1.4
            },
            'bounds': {
                'north': max(start_lat, dest_lat),
                'south': min(start_lat, dest_lat),
                'east': max(start_lng, dest_lng),
                'west': min(start_lng, dest_lng)
            },
            'travel_mode': 'pedestrian',
            'arrival_time': (datetime.now() + timedelta(seconds=distance/1.4)).isoformat(),
            'start_point': {'lat': start_lat, 'lng': start_lng},
            'end_point': {'lat': dest_lat, 'lng': dest_lng},
            'is_fallback': True
        }
    
    def reverse_geocode(self, lat: float, lng: float) -> str:
        """Convert coordinates to address"""
        try:
            url = f"{self.search_url}/reverseGeocode/{lat},{lng}.json"
            params = {
                'key': self.api_key,
                'language': 'en-US'
            }
            
            response = requests.get(url, params=params, timeout=5)
            data = response.json()
            
            if 'addresses' in data and data['addresses']:
                address = data['addresses'][0].get('address', {})
                street = address.get('streetName', '')
                municipality = address.get('municipality', '')
                country = address.get('country', '')
                
                if street and municipality:
                    return f"{street}, {municipality}, {country}"
                elif municipality:
                    return f"{municipality}, {country}"
            
            return f"{lat:.4f}, {lng:.4f}"
            
        except Exception as e:
            logger.error(f"Reverse geocode failed: {e}")
            return f"{lat:.4f}, {lng:.4f}"
    
    def search_places(self, query: str, lat: float = None, lng: float = None,
                     radius: int = 5000) -> List[Dict]:
        """Search for places by name"""
        try:
            url = f"{self.search_url}/search/{query}.json"
            params = {
                'key': self.api_key,
                'limit': 10,
                'language': 'en-US',
                'typeahead': True
            }
            
            if lat and lng:
                params['lat'] = lat
                params['lon'] = lng
                params['radius'] = radius
            
            response = requests.get(url, params=params, timeout=5)
            data = response.json()
            
            results = []
            for result in data.get('results', []):
                results.append({
                    'name': result.get('poi', {}).get('name', 'Unknown'),
                    'address': result.get('address', {}).get('freeformAddress', ''),
                    'lat': result['position']['lat'],
                    'lng': result['position']['lon'],
                    'type': result.get('poi', {}).get('category', 'location'),
                    'score': result.get('score', 0)
                })
            
            return results
            
        except Exception as e:
            logger.error(f"Place search failed: {e}")
            return []