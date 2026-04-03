"""
Real route calculation using TomTom API with proper turn-by-turn navigation and hazard avoidance.
"""

import os
import requests
import logging
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta
import math

logger = logging.getLogger(__name__)

class TomTomRouter:
    """Handle routing with TomTom API for realistic pedestrian routes with hazard avoidance"""
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')
        self.base_url = "https://api.tomtom.com/routing/1"
        self.search_url = "https://api.tomtom.com/search/2"
        
    def calculate_route(self, start_lat: float, start_lng: float, 
                       dest_lat: float, dest_lng: float,
                       travel_mode: str = "pedestrian",
                       avoid_hazards: bool = True,
                       accessibility_needs: List[str] = None,
                       obstruction_zones: List[Dict] = None) -> Optional[Dict]:
        """Calculate route, picking the best alternative that avoids obstructions"""
        try:
            if not (-90 <= start_lat <= 90) or not (-180 <= start_lng <= 180):
                return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
            if not (-90 <= dest_lat <= 90) or not (-180 <= dest_lng <= 180):
                return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
            
            origin = f"{start_lat},{start_lng}"
            destination = f"{dest_lat},{dest_lng}"
            
            # If we have hazards, try to get multiple route alternatives
            if obstruction_zones and len(obstruction_zones) > 0:
                # Check if destination is in a hazard zone
                dest_in_hazard = self._is_point_in_hazard_zone(dest_lat, dest_lng, obstruction_zones)
                start_in_hazard = self._is_point_in_hazard_zone(start_lat, start_lng, obstruction_zones)
                
                if dest_in_hazard:
                    logger.warning("Destination is in a hazard zone - cannot avoid completely, will approach safely")
                if start_in_hazard:
                    logger.warning("Start location is in a hazard zone")
                
                logger.info(f"Attempting to route around {len(obstruction_zones)} hazard zones")
                return self._get_safest_route_with_alternatives(
                    start_lat, start_lng, dest_lat, dest_lng,
                    travel_mode, accessibility_needs, obstruction_zones,
                    dest_in_hazard, start_in_hazard
                )
            
            # No hazards - get standard route
            return self._get_standard_route(
                start_lat, start_lng, dest_lat, dest_lng,
                travel_mode, accessibility_needs
            )
            
        except Exception as e:
            logger.error(f"Error calculating route: {e}")
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
    
    def _is_point_in_hazard_zone(self, lat: float, lng: float, hazard_zones: List[Dict]) -> bool:
        """Check if a point is within any hazard zone"""
        for zone in hazard_zones:
            z_lat = zone.get('lat')
            z_lng = zone.get('lng')
            z_radius = zone.get('radius', 100)
            if z_lat and z_lng:
                dist = self._haversine_distance(lat, lng, z_lat, z_lng)
                if dist < z_radius:
                    return True
        return False
    
    def _get_safest_route_with_alternatives(self, start_lat, start_lng, dest_lat, dest_lng,
                                            travel_mode, accessibility_needs, hazard_zones,
                                            dest_in_hazard=False, start_in_hazard=False):
        """Get multiple route alternatives and pick the safest one"""
        try:
            origin = f"{start_lat},{start_lng}"
            destination = f"{dest_lat},{dest_lng}"
            url = f"{self.base_url}/calculateRoute/{origin}:{destination}/json"
            
            params = {
                'key': self.api_key,
                'travelMode': travel_mode,
                'routeType': 'fastest',
                'traffic': 'false',
                'instructionsType': 'text',
                'language': 'en-US',
                'routeRepresentation': 'polyline',
                'maxAlternatives': 3,
                'alternativeType': 'anyRoute',
            }
            
            if accessibility_needs:
                if 'wheelchair' in accessibility_needs:
                    params['hilliness'] = 'normal'
            
            response = requests.get(url, params=params, timeout=15)
            
            if response.status_code == 200:
                data = response.json()
                if 'routes' in data and data['routes']:
                    all_routes = []
                    for route in data['routes']:
                        processed = self._process_route(route, start_lat, start_lng, dest_lat, dest_lng)
                        if processed:
                            # Calculate hazard score for this route
                            hazard_score = self._calculate_hazard_score(
                                processed['points'], hazard_zones, 
                                dest_in_hazard=dest_in_hazard, 
                                dest_coords=(dest_lat, dest_lng)
                            )
                            processed['hazard_score'] = hazard_score
                            all_routes.append(processed)
                    
                    if all_routes:
                        # Sort by hazard score (lower is better), then by distance
                        all_routes.sort(key=lambda r: (r.get('hazard_score', 999), r.get('distance_meters', 999)))
                        best_route = all_routes[0]
                        
                        if best_route.get('hazard_score', 0) > 0:
                            logger.warning(f"Best route still has hazard score {best_route.get('hazard_score', 0):.2f}")
                            if dest_in_hazard:
                                logger.info("Destination is in hazard zone - this is the best approach possible")
                        else:
                            logger.info("Selected route avoids all hazards!")
                        
                        if accessibility_needs:
                            best_route = self._add_accessibility_features(best_route, accessibility_needs)
                        return best_route
            
            # Fallback to standard route
            return self._get_standard_route(start_lat, start_lng, dest_lat, dest_lng, travel_mode, accessibility_needs)
            
        except Exception as e:
            logger.error(f"Error getting safest route: {e}")
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
    
    def _get_standard_route(self, start_lat, start_lng, dest_lat, dest_lng,
                           travel_mode, accessibility_needs):
        """Get a standard route from TomTom"""
        try:
            origin = f"{start_lat},{start_lng}"
            destination = f"{dest_lat},{dest_lng}"
            url = f"{self.base_url}/calculateRoute/{origin}:{destination}/json"
            
            params = {
                'key': self.api_key,
                'travelMode': travel_mode,
                'routeType': 'fastest',
                'traffic': 'false',
                'instructionsType': 'text',
                'language': 'en-US',
                'routeRepresentation': 'polyline',
            }
            
            if accessibility_needs:
                if 'wheelchair' in accessibility_needs:
                    params['hilliness'] = 'normal'
            
            response = requests.get(url, params=params, timeout=15)
            
            if response.status_code == 200:
                data = response.json()
                if 'routes' in data and data['routes']:
                    route = self._process_route(data['routes'][0], start_lat, start_lng, dest_lat, dest_lng)
                    if accessibility_needs:
                        route = self._add_accessibility_features(route, accessibility_needs)
                    return route
            
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
            
        except Exception as e:
            logger.error(f"Error getting standard route: {e}")
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
    
    def _calculate_hazard_score(self, route_points: List[Tuple], hazard_zones: List[Dict], 
                                dest_in_hazard=False, dest_coords=None) -> float:
        """
        Calculate a hazard score for a route.
        Lower score = safer route.
        If destination is in hazard, we don't penalize the final approach as heavily.
        """
        if not hazard_zones:
            return 0.0
        
        total_score = 0.0
        
        for zone in hazard_zones:
            z_lat = zone.get('lat')
            z_lng = zone.get('lng')
            z_radius = zone.get('radius', 50)
            z_severity = zone.get('severity', 0.5)
            
            if z_lat is None or z_lng is None:
                continue
            
            min_distance = float('inf')
            min_point_index = -1
            
            for i, point in enumerate(route_points):
                dist = self._haversine_distance(point[0], point[1], z_lat, z_lng)
                if dist < min_distance:
                    min_distance = dist
                    min_point_index = i
            
            # If destination is in hazard zone, don't penalize the last 100m of the route
            if dest_in_hazard and dest_coords:
                # Check if the close approach is near the destination
                dist_to_dest = self._haversine_distance(route_points[min_point_index][0], 
                                                        route_points[min_point_index][1],
                                                        dest_coords[0], dest_coords[1])
                if dist_to_dest < 200:
                    # This hazard is near the destination - reduce penalty
                    distance_factor = max(0, (200 - min_distance) / 200) * 0.3  # 70% reduction
                else:
                    distance_factor = max(0, (200 - min_distance) / 200)
            else:
                distance_factor = max(0, (200 - min_distance) / 200)
            
            if min_distance < 200:
                hazard_contribution = distance_factor * z_severity * 10
                total_score += hazard_contribution
        
        return total_score
    
    def _process_route(self, route: Dict, start_lat: float, start_lng: float,
                      dest_lat: float, dest_lng: float) -> Dict:
        """Process TomTom route response into our format"""
        
        summary = route.get('summary', {})
        legs = route.get('legs', [])
        
        if not legs:
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
        
        leg = legs[0]
        
        # Decode polyline points
        route_points = []
        points = leg.get('points', {})
        
        if 'encodedPolyline' in points:
            encoded = points['encodedPolyline']
            try:
                route_points = self._decode_tomtom_polyline(encoded)
            except Exception as e:
                logger.warning(f"Failed to decode polyline: {e}")
                route_points = [(start_lat, start_lng), (dest_lat, dest_lng)]
        else:
            for point in leg.get('points', []):
                if 'latitude' in point and 'longitude' in point:
                    route_points.append((point['latitude'], point['longitude']))
        
        if not route_points or len(route_points) < 2:
            route_points = self._generate_intermediate_points(start_lat, start_lng, dest_lat, dest_lng)
        
        # Extract instructions
        instructions = []
        guidance = leg.get('guidance', {}).get('instructions', [])
        
        for instr in guidance:
            if 'message' in instr:
                instruction = {
                    'instruction': instr['message'],
                    'distance': instr.get('routeOffsetInMeters', 0),
                    'duration': instr.get('travelTimeInSeconds', 0),
                    'type': instr.get('maneuver', 'continue'),
                    'point_index': instr.get('pointIndex', 0)
                }
                instructions.append(instruction)
        
        # Calculate segments
        segments = []
        if route_points and len(route_points) > 1:
            for i in range(len(route_points) - 1):
                start_point = route_points[i]
                end_point = route_points[i + 1]
                distance = self._haversine_distance(start_point[0], start_point[1], 
                                                   end_point[0], end_point[1])
                segments.append({
                    'start': {'lat': start_point[0], 'lng': start_point[1]},
                    'end': {'lat': end_point[0], 'lng': end_point[1]},
                    'distance': distance,
                    'duration': distance / 1.4,
                    'index': i
                })
        
        # Calculate bounds
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
        
        distance_meters = summary.get('lengthInMeters', 0)
        if distance_meters == 0 and route_points:
            distance_meters = 0
            for i in range(len(route_points) - 1):
                distance_meters += self._haversine_distance(
                    route_points[i][0], route_points[i][1],
                    route_points[i+1][0], route_points[i+1][1]
                )
        
        duration_seconds = summary.get('travelTimeInSeconds', distance_meters / 1.4)
        
        return {
            'points': route_points,
            'segments': segments,
            'distance_meters': distance_meters,
            'duration_seconds': duration_seconds,
            'instructions': instructions,
            'summary': summary,
            'bounds': bounds,
            'travel_mode': route.get('travelMode', 'pedestrian'),
            'arrival_time': (datetime.now() + timedelta(seconds=duration_seconds)).isoformat(),
            'start_point': {'lat': start_lat, 'lng': start_lng},
            'end_point': {'lat': dest_lat, 'lng': dest_lng}
        }
    
    def _add_accessibility_features(self, route: Dict, needs: List[str]) -> Dict:
        """Add accessibility features to route"""
        features = []
        if 'wheelchair' in needs:
            features.extend(['elevator_access', 'ramp_access', 'wide_pathways', 'smooth_surfaces'])
        if 'blind' in needs:
            features.extend(['tactile_paving', 'audible_signals', 'clear_wayfinding'])
        if 'deaf' in needs:
            features.extend(['visual_signals', 'clear_sightlines', 'vibration_alerts'])
        
        route['accessibility_features'] = features
        return route
    
    def _decode_tomtom_polyline(self, encoded: str) -> List[Tuple[float, float]]:
        """Decode TomTom polyline"""
        points = []
        index = 0
        lat = 0
        lng = 0
        
        while index < len(encoded):
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
            
            if result & 1:
                dlat = ~(result >> 1)
            else:
                dlat = result >> 1
            
            lat += dlat
            
            shift = 0
            result = 0
            
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            
            if result & 1:
                dlng = ~(result >> 1)
            else:
                dlng = result >> 1
            
            lng += dlng
            points.append((lat * 1e-5, lng * 1e-5))
        
        return points
    
    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate distance using Haversine formula"""
        R = 6371000
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        
        a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        return R * c
    
    def _generate_intermediate_points(self, start_lat: float, start_lng: float,
                                     dest_lat: float, dest_lng: float, 
                                     num_points: int = 10) -> List[Tuple[float, float]]:
        """Generate intermediate points for fallback route"""
        points = []
        for i in range(num_points + 1):
            t = i / num_points
            lat = start_lat + (dest_lat - start_lat) * t + math.sin(t * math.pi) * 0.0005
            lng = start_lng + (dest_lng - start_lng) * t + math.cos(t * math.pi) * 0.0005
            points.append((lat, lng))
        return points
    
    def _generate_fallback_route(self, start_lat: float, start_lng: float,
                                dest_lat: float, dest_lng: float) -> Dict:
        """Generate fallback route"""
        distance = self._haversine_distance(start_lat, start_lng, dest_lat, dest_lng)
        points = self._generate_intermediate_points(start_lat, start_lng, dest_lat, dest_lng, num_points=20)
        
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
            'instructions': [],
            'summary': {'lengthInMeters': distance, 'travelTimeInSeconds': distance / 1.4},
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
            params = {'key': self.api_key, 'language': 'en-US'}
            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
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
            params = {'key': self.api_key, 'limit': 10, 'language': 'en-US', 'typeahead': True}
            
            if lat and lng:
                params['lat'] = lat
                params['lon'] = lng
                params['radius'] = radius
            
            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
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