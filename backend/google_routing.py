# google_routing.py
import os
import requests
import logging
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import math

logger = logging.getLogger(__name__)

class GoogleMapsRouter:
    """Handles routing using Google Maps Directions API with transit support"""
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv('GOOGLE_MAPS_API_KEY')
        self.base_url = "https://maps.googleapis.com/maps/api/directions/json"
        
        # Cache for construction zones (simulated)
        self.construction_zones = self._init_construction_zones()
    
    def _init_construction_zones(self):
        """Initialize known construction zones in Pittsburgh area"""
        return [
            {
                'lat': 40.4475,
                'lng': -79.9545,
                'radius': 200,
                'description': 'Road construction on Forbes Ave',
                'start_date': '2026-03-01',
                'end_date': '2026-05-30'
            },
            {
                'lat': 40.4385,
                'lng': -79.9975,
                'radius': 150,
                'description': 'Bridge maintenance - Liberty Bridge',
                'start_date': '2026-03-15',
                'end_date': '2026-06-15'
            },
            {
                'lat': 40.4585,
                'lng': -79.9285,
                'radius': 100,
                'description': 'Sidewalk repair on S Aiken Ave',
                'start_date': '2026-03-20',
                'end_date': '2026-04-20'
            }
        ]
    
    def get_transit_route(self, origin_lat: float, origin_lng: float,
                         dest_lat: float, dest_lng: float,
                         departure_time: datetime = None,
                         alternatives: bool = True,
                         transit_mode: str = None) -> Optional[List[Dict]]:
        """
        Get transit route between two points using Google Maps
        transit_mode: 'bus', 'subway', 'train', 'tram', 'rail' (None = all)
        """
        if not self.api_key:
            logger.warning("Google Maps API key not set")
            return None
        
        params = {
            'origin': f"{origin_lat},{origin_lng}",
            'destination': f"{dest_lat},{dest_lng}",
            'mode': 'transit',
            'key': self.api_key,
            'alternatives': 'true' if alternatives else 'false',
            'language': 'en'
        }
        
        # Add transit mode preference
        if transit_mode:
            params['transit_mode'] = transit_mode
        
        if departure_time:
            params['departure_time'] = departure_time.strftime('%s')
        
        try:
            response = requests.get(self.base_url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            if data['status'] != 'OK':
                logger.warning(f"Google Maps API error: {data['status']}")
                return None
            
            # Process all routes
            routes = []
            for route in data.get('routes', []):
                processed = self._process_route(route)
                if processed:
                    # Check if route passes through construction zones
                    processed['construction_warnings'] = self._check_construction_zones(processed)
                    routes.append(processed)
            
            # Sort routes by duration (fastest first)
            routes.sort(key=lambda x: x.get('total_duration_seconds', float('inf')))
            
            logger.info(f"Found {len(routes)} transit routes, fastest: {routes[0].get('total_duration_seconds', 0) / 60:.0f} minutes")
            return routes if routes else None
            
        except Exception as e:
            logger.error(f"Google Maps request failed: {e}")
            return None
    
    def _check_construction_zones(self, route: Dict) -> List[Dict]:
        """Check if route passes through known construction zones"""
        warnings = []
        waypoints = route.get('waypoints', [])
        
        for zone in self.construction_zones:
            # Check if any waypoint is within construction zone radius
            for wp in waypoints:
                distance = self._haversine_distance(
                    wp[0], wp[1], zone['lat'], zone['lng']
                )
                if distance < zone['radius']:
                    warnings.append({
                        'type': 'construction',
                        'description': zone['description'],
                        'location': {'lat': zone['lat'], 'lng': zone['lng']},
                        'radius': zone['radius'],
                        'severity': 0.6
                    })
                    break
        
        return warnings
    
    def _haversine_distance(self, lat1, lng1, lat2, lng2):
        """Calculate distance between two points in meters"""
        R = 6371000
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lng2 - lng1)
        
        a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        
        return R * c
    
    def _process_route(self, route: Dict) -> Optional[Dict]:
        """Process a single route into our format"""
        legs = route.get('legs', [])
        if not legs:
            return None
        
        leg = legs[0]
        
        # Extract overview polyline
        overview_polyline = route.get('overview_polyline', {}).get('points', '')
        
        # Extract steps (including transit steps)
        steps = []
        transit_steps = []
        walking_steps = []
        total_walking_time = 0
        total_walking_distance = 0
        
        for step in leg.get('steps', []):
            travel_mode = step.get('travel_mode', 'WALKING')
            duration_seconds = step.get('duration', {}).get('value', 0)
            distance_meters = step.get('distance', {}).get('value', 0)
            
            step_data = {
                'instruction': self._clean_instruction(step.get('html_instructions', '')),
                'distance': step.get('distance', {}).get('text', ''),
                'distance_meters': distance_meters,
                'duration': step.get('duration', {}).get('text', ''),
                'duration_seconds': duration_seconds,
                'travel_mode': travel_mode,
                'start_location': step.get('start_location', {}),
                'end_location': step.get('end_location', {}),
                'polyline': step.get('polyline', {}).get('points', '')
            }
            
            if travel_mode == 'TRANSIT':
                transit_details = step.get('transit_details', {})
                line = transit_details.get('line', {})
                
                # Get vehicle type
                vehicle = line.get('vehicle', {})
                vehicle_type = vehicle.get('type', 'BUS')
                vehicle_name = vehicle.get('name', 'Bus')
                
                step_data.update({
                    'transit_line': line.get('short_name', line.get('name', '')),
                    'transit_line_full': line.get('name', ''),
                    'transit_vehicle': vehicle_name,
                    'transit_vehicle_type': vehicle_type,
                    'transit_headsign': transit_details.get('headsign', ''),
                    'departure_stop': transit_details.get('departure_stop', {}).get('name', ''),
                    'departure_stop_location': transit_details.get('departure_stop', {}).get('location', {}),
                    'arrival_stop': transit_details.get('arrival_stop', {}).get('name', ''),
                    'arrival_stop_location': transit_details.get('arrival_stop', {}).get('location', {}),
                    'num_stops': transit_details.get('num_stops', 0),
                    'line_color': line.get('color', '#000000'),
                    'line_text_color': line.get('text_color', '#FFFFFF')
                })
                transit_steps.append(step_data)
            else:
                walking_steps.append(step_data)
                total_walking_time += duration_seconds
                total_walking_distance += distance_meters
            
            steps.append(step_data)
        
        # Compute total distance and duration
        total_distance = leg.get('distance', {}).get('value', 0)
        total_duration = leg.get('duration', {}).get('value', 0)
        total_transit_time = total_duration - total_walking_time
        
        # Extract waypoints (for full route path)
        waypoints = self._decode_polyline(overview_polyline)
        
        # If no waypoints, create from step endpoints
        if not waypoints and steps:
            waypoints = []
            for step in steps:
                start = step.get('start_location', {})
                if start:
                    waypoints.append((start.get('lat', 0), start.get('lng', 0)))
            end = leg.get('end_location', {})
            if end:
                waypoints.append((end.get('lat', 0), end.get('lng', 0)))
        
        # Calculate summary of transit lines used
        transit_lines_used = {}
        for ts in transit_steps:
            line = ts.get('transit_line', 'Unknown')
            if line not in transit_lines_used:
                transit_lines_used[line] = {
                    'line': line,
                    'vehicle': ts.get('transit_vehicle', 'Bus'),
                    'stops': ts.get('num_stops', 0),
                    'direction': ts.get('transit_headsign', '')
                }
        
        return {
            'steps': steps,
            'transit_steps': transit_steps,
            'walking_steps': walking_steps,
            'total_distance_meters': total_distance,
            'total_duration_seconds': total_duration,
            'total_walking_time': total_walking_time,
            'total_walking_distance': total_walking_distance,
            'total_transit_time': total_transit_time,
            'transit_lines': list(transit_lines_used.values()),
            'start_address': leg.get('start_address', ''),
            'end_address': leg.get('end_address', ''),
            'start_location': leg.get('start_location', {}),
            'end_location': leg.get('end_location', {}),
            'waypoints': waypoints,
            'bounds': leg.get('bounds', {})
        }
    
    def _clean_instruction(self, html: str) -> str:
        """Clean HTML from instruction text"""
        if not html:
            return ""
        # Remove HTML tags
        import re
        clean = re.sub(r'<[^>]+>', ' ', html)
        # Remove extra spaces
        clean = re.sub(r'\s+', ' ', clean).strip()
        return clean
    
    def _decode_polyline(self, polyline: str) -> List[Tuple[float, float]]:
        """Decode Google Maps encoded polyline to list of (lat, lng)"""
        if not polyline:
            return []
        
        points = []
        index = 0
        lat = 0
        lng = 0
        
        while index < len(polyline):
            b = 0
            shift = 0
            result = 0
            while True:
                b = ord(polyline[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            dlat = ~(result >> 1) if result & 1 else (result >> 1)
            lat += dlat
            
            shift = 0
            result = 0
            while True:
                b = ord(polyline[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            dlng = ~(result >> 1) if result & 1 else (result >> 1)
            lng += dlng
            
            points.append((lat / 1e5, lng / 1e5))
        
        return points
    
    def get_construction_zones(self, lat: float, lng: float, radius: int = 500) -> List[Dict]:
        """Get construction zones near a location"""
        nearby = []
        for zone in self.construction_zones:
            distance = self._haversine_distance(lat, lng, zone['lat'], zone['lng'])
            if distance <= radius:
                nearby.append({
                    **zone,
                    'distance_meters': distance
                })
        return nearby