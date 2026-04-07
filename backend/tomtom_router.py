# tomtom_router.py
import os
import requests
import logging
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta
import math
from threading import Lock

logger = logging.getLogger(__name__)

# ── Helper formatting functions ────────────────────────────────────────────────
def fmt_dist(meters: float) -> str:
    """Format meters to readable string"""
    if not meters or meters <= 0:
        return ""
    if meters >= 1000:
        return f"{meters/1000:.1f} km"
    return f"{meters:.0f} m"

def fmt_duration(seconds: float) -> str:
    """Format seconds to readable string"""
    if not seconds or seconds <= 0:
        return ""
    if seconds < 60:
        return f"{seconds:.0f} sec"
    elif seconds < 3600:
        return f"{seconds/60:.0f} min"
    else:
        hours = int(seconds / 3600)
        minutes = int((seconds % 3600) / 60)
        return f"{hours}h {minutes}m"


class TomTomRouter:
    """Handle routing with TomTom API and OSRM fallback for pedestrian routes"""
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')
        self.base_url = "https://api.tomtom.com/routing/1"
        self.search_url = "https://api.tomtom.com/search/2"
        
        self.route_cache = {}
        self.cache_lock = Lock()
        self.cache_max_size = 100
        self.cache_ttl = 300
        
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': 'TryverSafetyApp/1.0'})
        
    def _get_cache_key(self, start_lat, start_lng, dest_lat, dest_lng, 
                       travel_mode, avoid_hazards, accessibility_needs):
        key = (
            round(start_lat, 6), round(start_lng, 6),
            round(dest_lat, 6), round(dest_lng, 6),
            travel_mode,
            avoid_hazards,
            frozenset(accessibility_needs) if accessibility_needs else frozenset()
        )
        return key
    
    def _get_cached_route(self, key, dest_lat=None, dest_lng=None):
        with self.cache_lock:
            if key in self.route_cache:
                route_data, timestamp = self.route_cache[key]
                if (datetime.now() - timestamp).seconds < self.cache_ttl:
                    if dest_lat is not None and dest_lng is not None:
                        cached_end = route_data.get('end_point', {})
                        cached_lat = cached_end.get('lat', 0)
                        cached_lng = cached_end.get('lng', 0)
                        dist_diff = self._haversine_distance(cached_lat, cached_lng, dest_lat, dest_lng)
                        if dist_diff < 50:
                            return route_data
                        else:
                            del self.route_cache[key]
                            return None
                    return route_data
                else:
                    del self.route_cache[key]
            return None
    
    def _set_cached_route(self, key, value):
        with self.cache_lock:
            if len(self.route_cache) >= self.cache_max_size:
                oldest_key = next(iter(self.route_cache))
                del self.route_cache[oldest_key]
            self.route_cache[key] = (value, datetime.now())
    
    # ========== GET STREET NAME FROM COORDINATES ==========
    def _get_street_name(self, lat: float, lng: float) -> str:
        """Reverse geocode to get street name at a point"""
        try:
            url = f"{self.search_url}/reverseGeocode/{lat},{lng}.json"
            params = {'key': self.api_key, 'language': 'en-US', 'returnSpeedLimit': 'false'}
            response = self.session.get(url, params=params, timeout=3)
            if response.status_code == 200:
                data = response.json()
                if 'addresses' in data and data['addresses']:
                    address = data['addresses'][0].get('address', {})
                    street = address.get('streetName', '')
                    if street:
                        return street
            return ""
        except Exception:
            return ""
    
    # ========== TURN-BY-TURN INSTRUCTION GENERATOR WITH STREET NAMES ==========
    def _generate_turn_by_turn_from_geometry(self, route_points: List[Tuple[float, float]]) -> List[Dict]:
        """
        Generate detailed turn-by-turn instructions with street names.
        Creates directions like "Turn left onto Freeport Road"
        """
        if len(route_points) < 3:
            return []
        
        def get_bearing(lat1, lng1, lat2, lng2):
            lat1_rad = math.radians(lat1)
            lat2_rad = math.radians(lat2)
            dlon = math.radians(lng2 - lng1)
            x = math.sin(dlon) * math.cos(lat2_rad)
            y = math.cos(lat1_rad) * math.sin(lat2_rad) - math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(dlon)
            bearing = math.degrees(math.atan2(x, y))
            return (bearing + 360) % 360
        
        def get_turn_direction(prev_bearing, curr_bearing):
            diff = (curr_bearing - prev_bearing + 360) % 360
            if diff < 20 or diff > 340:
                return "straight"
            elif diff < 180:
                return "right"
            else:
                return "left"
        
        # Simplify route points
        simplified = [route_points[0]]
        tolerance = 0.00003
        
        for pt in route_points[1:-1]:
            if self._haversine_distance(simplified[-1][0], simplified[-1][1], pt[0], pt[1]) > tolerance:
                simplified.append(pt)
        simplified.append(route_points[-1])
        
        if len(simplified) < 2:
            return []
        
        # Calculate bearings
        bearings = []
        for i in range(len(simplified) - 1):
            bearings.append(get_bearing(simplified[i][0], simplified[i][1], simplified[i+1][0], simplified[i+1][1]))
        
        # Build instructions
        instructions = []
        
        # First instruction - depart
        first_street = self._get_street_name(simplified[0][0], simplified[0][1])
        if first_street:
            instructions.append({
                'instruction': f"Depart from your location onto {first_street}",
                'distance': "0 m",
                'distance_meters': 0,
                'duration': "0 sec",
                'duration_seconds': 0,
                'travel_mode': 'DEPART',
            })
        else:
            instructions.append({
                'instruction': "Depart from your location",
                'distance': "0 m",
                'distance_meters': 0,
                'duration': "0 sec",
                'duration_seconds': 0,
                'travel_mode': 'DEPART',
            })
        
        # Process each segment to detect turns and get street names
        i = 0
        segment_distances = []
        segment_streets = []
        
        # Group into segments between turns
        current_seg_start = 0
        for j in range(len(bearings) - 1):
            turn = get_turn_direction(bearings[j], bearings[j+1])
            if turn != "straight":
                # Calculate distance for this segment
                seg_dist = 0
                for k in range(current_seg_start, j + 1):
                    seg_dist += self._haversine_distance(
                        simplified[k][0], simplified[k][1],
                        simplified[k+1][0], simplified[k+1][1]
                    )
                if seg_dist > 10:
                    # Get street name at the middle of this segment
                    mid_idx = (current_seg_start + j) // 2
                    street_name = self._get_street_name(simplified[mid_idx][0], simplified[mid_idx][1])
                    segment_distances.append(seg_dist)
                    segment_streets.append(street_name)
                current_seg_start = j + 1
        
        # Add final segment
        if current_seg_start < len(simplified) - 1:
            seg_dist = 0
            for k in range(current_seg_start, len(simplified) - 1):
                seg_dist += self._haversine_distance(
                    simplified[k][0], simplified[k][1],
                    simplified[k+1][0], simplified[k+1][1]
                )
            if seg_dist > 10:
                mid_idx = (current_seg_start + len(simplified) - 1) // 2
                street_name = self._get_street_name(simplified[mid_idx][0], simplified[mid_idx][1])
                segment_distances.append(seg_dist)
                segment_streets.append(street_name)
        
        # Now build turn instructions using the segments
        i = 0
        while i < len(bearings) - 1:
            turn = get_turn_direction(bearings[i], bearings[i+1])
            if turn != "straight":
                # Get the street name for the segment after the turn
                street_name = ""
                if i + 1 < len(simplified):
                    # Look ahead to find the street for this turn
                    lookahead = min(i + 5, len(simplified) - 1)
                    street_name = self._get_street_name(simplified[lookahead][0], simplified[lookahead][1])
                
                # Get distance for this segment
                seg_dist = 0
                start_idx = i
                while start_idx < len(bearings):
                    if start_idx < len(bearings) - 1:
                        next_turn = get_turn_direction(bearings[start_idx], bearings[start_idx + 1])
                        if next_turn != "straight" and start_idx != i:
                            break
                    seg_dist += self._haversine_distance(
                        simplified[start_idx][0], simplified[start_idx][1],
                        simplified[start_idx + 1][0], simplified[start_idx + 1][1]
                    )
                    start_idx += 1
                
                if turn == "left":
                    if street_name:
                        instr = f"Turn left onto {street_name}"
                    else:
                        instr = "Turn left"
                else:
                    if street_name:
                        instr = f"Turn right onto {street_name}"
                    else:
                        instr = "Turn right"
                
                instructions.append({
                    'instruction': instr,
                    'distance': fmt_dist(seg_dist),
                    'distance_meters': round(seg_dist),
                    'duration': fmt_duration(seg_dist / 1.4),
                    'duration_seconds': seg_dist / 1.4,
                    'travel_mode': 'WALKING',
                })
                i = start_idx
            else:
                i += 1
        
        # Add arrival instruction
        dest_street = self._get_street_name(route_points[-1][0], route_points[-1][1])
        if dest_street:
            instructions.append({
                'instruction': f"Arrive at your destination on {dest_street}",
                'distance': "0 m",
                'distance_meters': 0,
                'duration': "0 sec",
                'duration_seconds': 0,
                'travel_mode': 'ARRIVE',
            })
        else:
            instructions.append({
                'instruction': "Arrive at your destination",
                'distance': "0 m",
                'distance_meters': 0,
                'duration': "0 sec",
                'duration_seconds': 0,
                'travel_mode': 'ARRIVE',
            })
        
        return instructions
    
    # ========== OSRM PEDESTRIAN ROUTING ==========
    def _route_pedestrian_osrm(self, start_lat: float, start_lng: float,
                                dest_lat: float, dest_lng: float) -> Optional[Dict]:
        for attempt in range(2):
            try:
                url = (f"https://router.project-osrm.org/route/v1/foot/"
                       f"{start_lng:.6f},{start_lat:.6f};{dest_lng:.6f},{dest_lat:.6f}")
                params = {'overview': 'full', 'geometries': 'geojson', 'steps': 'true'}
                timeout = 15 if attempt == 0 else 20
                resp = self.session.get(url, params=params, timeout=timeout)
                
                if resp.status_code != 200:
                    continue
                
                data = resp.json()
                if data.get('code') != 'Ok':
                    continue
                
                routes = data.get('routes', [])
                if not routes:
                    continue
                
                route = routes[0]
                geojson_coords = route['geometry']['coordinates']
                route_points = [(c[1], c[0]) for c in geojson_coords]
                
                if len(route_points) < 2:
                    continue
                
                distance_meters = route.get('distance', 0)
                duration_seconds = route.get('duration', distance_meters / 1.4)
                
                # Extract OSRM instructions with street names
                instructions = []
                legs = route.get('legs', [])
                if legs:
                    for step in legs[0].get('steps', []):
                        maneuver = step.get('maneuver', {})
                        m_type = maneuver.get('type', '')
                        modifier = maneuver.get('modifier', '')
                        street = step.get('name', '')
                        step_dist = step.get('distance', 0)
                        
                        if m_type == 'depart':
                            if street:
                                instr = f"Depart from your location onto {street}"
                            else:
                                instr = "Depart from your location"
                        elif m_type == 'arrive':
                            if street:
                                instr = f"Arrive at your destination on {street}"
                            else:
                                instr = "Arrive at your destination"
                        elif m_type == 'turn':
                            if street:
                                instr = f"Turn {modifier} onto {street}"
                            else:
                                instr = f"Turn {modifier}"
                        else:
                            if street:
                                instr = f"Continue on {street}"
                            else:
                                instr = "Continue"
                        
                        instructions.append({
                            'instruction': instr,
                            'distance': fmt_dist(step_dist),
                            'distance_meters': step_dist,
                            'duration': fmt_duration(step_dist / 1.4),
                            'duration_seconds': step_dist / 1.4,
                            'travel_mode': 'WALKING',
                        })
                
                if len(instructions) < 2:
                    instructions = self._generate_turn_by_turn_from_geometry(route_points)
                
                lats = [p[0] for p in route_points]
                lngs = [p[1] for p in route_points]
                
                return {
                    'points': route_points,
                    'segments': [],
                    'distance_meters': distance_meters,
                    'duration_seconds': duration_seconds,
                    'instructions': instructions,
                    'summary': {'lengthInMeters': distance_meters, 'travelTimeInSeconds': duration_seconds},
                    'bounds': {'north': max(lats), 'south': min(lats), 'east': max(lngs), 'west': min(lngs)},
                    'travel_mode': 'pedestrian',
                    'arrival_time': (datetime.now() + timedelta(seconds=duration_seconds)).isoformat(),
                    'start_point': {'lat': start_lat, 'lng': start_lng},
                    'end_point': {'lat': dest_lat, 'lng': dest_lng},
                    'provider': 'osrm'
                }
            except Exception as e:
                logger.warning(f"OSRM attempt {attempt + 1} failed: {e}")
                continue
        
        return None
    
    def _build_segments(self, points: List[Tuple]) -> List[Dict]:
        if len(points) < 2:
            return []
        segments = []
        for i in range(len(points) - 1):
            seg_dist = self._haversine_distance(points[i][0], points[i][1], points[i+1][0], points[i+1][1])
            segments.append({
                'start': {'lat': points[i][0], 'lng': points[i][1]},
                'end': {'lat': points[i+1][0], 'lng': points[i+1][1]},
                'distance': seg_dist,
                'duration': seg_dist / 1.4,
                'index': i
            })
        return segments
    
    # ========== PROCESS TOMTOM ROUTE ==========
    def _process_tomtom_route(self, route: Dict, start_lat: float, start_lng: float,
                               dest_lat: float, dest_lng: float) -> Dict:
        
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
            route_points = [(start_lat, start_lng), (dest_lat, dest_lng)]
        
        # Generate turn-by-turn instructions with street names
        instructions = self._generate_turn_by_turn_from_geometry(route_points)
        
        distance_meters = summary.get('lengthInMeters', 0)
        if distance_meters == 0 and route_points:
            distance_meters = 0
            for i in range(len(route_points) - 1):
                distance_meters += self._haversine_distance(route_points[i][0], route_points[i][1], route_points[i+1][0], route_points[i+1][1])
        
        duration_seconds = summary.get('travelTimeInSeconds', distance_meters / 1.4)
        segments = self._build_segments(route_points)
        
        if route_points:
            lats = [p[0] for p in route_points]
            lngs = [p[1] for p in route_points]
            bounds = {'north': max(lats), 'south': min(lats), 'east': max(lngs), 'west': min(lngs)}
        else:
            bounds = {'north': max(start_lat, dest_lat), 'south': min(start_lat, dest_lat),
                      'east': max(start_lng, dest_lng), 'west': min(start_lng, dest_lng)}
        
        logger.info(f"Generated {len(instructions)} turn-by-turn instructions")
        
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
    
    # ========== MAIN ROUTING METHOD WITH HAZARD AVOIDANCE ==========
    def calculate_route(self, start_lat: float, start_lng: float, 
                        dest_lat: float, dest_lng: float,
                        travel_mode: str = "pedestrian",
                        avoid_hazards: bool = True,
                        accessibility_needs: List[str] = None,
                        obstruction_zones: List[Dict] = None,
                        force_refresh: bool = False) -> Optional[Dict]:
        
        logger.info(f"=== calculate_route called ===")
        logger.info(f"Start: {start_lat}, {start_lng}")
        logger.info(f"Dest: {dest_lat}, {dest_lng}")
        logger.info(f"Hazards to avoid: {len(obstruction_zones) if obstruction_zones else 0}")
        
        if not (-90 <= start_lat <= 90) or not (-180 <= start_lng <= 180):
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
        if not (-90 <= dest_lat <= 90) or not (-180 <= dest_lng <= 180):
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
        
        cache_key = self._get_cache_key(start_lat, start_lng, dest_lat, dest_lng,
                                        travel_mode, avoid_hazards, accessibility_needs)
        
        if not force_refresh:
            cached_route = self._get_cached_route(cache_key, dest_lat, dest_lng)
            if cached_route:
                logger.info(f"Using cached route")
                return cached_route
        
        route_result = None
        
        # Try TomTom API with hazard avoidance
        if self.api_key:
            try:
                start_lat_rounded = round(start_lat, 6)
                start_lng_rounded = round(start_lng, 6)
                dest_lat_rounded = round(dest_lat, 6)
                dest_lng_rounded = round(dest_lng, 6)
                
                origin = f"{start_lat_rounded},{start_lng_rounded}"
                destination = f"{dest_lat_rounded},{dest_lng_rounded}"
                url = f"{self.base_url}/calculateRoute/{origin}:{destination}/json"
                
                params = {
                    'key': self.api_key,
                    'travelMode': 'pedestrian',
                    'routeType': 'fastest',
                    'traffic': 'false',
                    'instructionsType': 'text',
                    'language': 'en-US',
                    'routeRepresentation': 'polyline',
                }
                
                # Add hazard avoidance if zones provided
                if obstruction_zones and len(obstruction_zones) > 0:
                    params['maxAlternatives'] = 3
                    params['alternativeType'] = 'anyRoute'
                    logger.info(f"Requesting {len(obstruction_zones)} hazard avoidance")
                
                if accessibility_needs and 'wheelchair' in accessibility_needs:
                    params['hilliness'] = 'normal'
                    params['avoid'] = 'unpavedRoads,stairs'
                
                logger.info(f"Calling TomTom API...")
                response = self.session.get(url, params=params, timeout=15)
                
                if response.status_code == 200:
                    data = response.json()
                    if 'routes' in data and data['routes']:
                        best_route = None
                        best_score = float('inf')
                        
                        for route in data['routes']:
                            processed = self._process_tomtom_route(
                                route, start_lat, start_lng, dest_lat, dest_lng
                            )
                            if processed and obstruction_zones:
                                hazard_score = self._calculate_hazard_score(
                                    processed['points'], obstruction_zones
                                )
                                if hazard_score < best_score:
                                    best_score = hazard_score
                                    best_route = processed
                                    logger.info(f"Route hazard score: {hazard_score:.2f}")
                            elif processed and not best_route:
                                best_route = processed
                        
                        if best_route:
                            route_result = best_route
                            if best_score == 0:
                                logger.info("TomTom found route that avoids all hazards!")
                            elif best_score > 0:
                                logger.info(f"TomTom found safest route with hazard score {best_score:.2f}")
                            else:
                                logger.info("TomTom routing SUCCESS")
                    else:
                        logger.warning("TomTom returned no routes")
                else:
                    logger.warning(f"TomTom returned status {response.status_code}")
                        
            except requests.exceptions.Timeout:
                logger.warning("TomTom API timeout")
            except Exception as e:
                logger.warning(f"TomTom API error: {e}")
        
        # Fallback to OSRM if TomTom failed
        if route_result is None:
            logger.info("TomTom failed, trying OSRM fallback")
            route_result = self._route_pedestrian_osrm(start_lat, start_lng, dest_lat, dest_lng)
        
        # Final fallback to straight line
        if route_result is None:
            logger.error("All routing failed, using straight-line fallback")
            route_result = self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
        
        if accessibility_needs and route_result:
            route_result = self._add_accessibility_features(route_result, accessibility_needs)
        
        if route_result and not force_refresh:
            self._set_cached_route(cache_key, route_result)
        
        return route_result
    
    # ========== HAZARD AVOIDANCE ==========
    def _get_safest_route_with_alternatives(self, start_lat, start_lng, dest_lat, dest_lng,
                                            travel_mode, accessibility_needs, hazard_zones,
                                            dest_in_hazard=False, start_in_hazard=False):
        """Get multiple route alternatives and pick the safest one"""
        return self.calculate_route(start_lat, start_lng, dest_lat, dest_lng,
                                    travel_mode, avoid_hazards=True,
                                    accessibility_needs=accessibility_needs,
                                    obstruction_zones=hazard_zones,
                                    force_refresh=True)
    
    def _get_standard_route(self, start_lat, start_lng, dest_lat, dest_lng,
                           travel_mode, accessibility_needs):
        return self.calculate_route(start_lat, start_lng, dest_lat, dest_lng,
                                    travel_mode, accessibility_needs=accessibility_needs)
    
    # ========== HELPER METHODS ==========
    def _calculate_hazard_score(self, route_points: List[Tuple], hazard_zones: List[Dict], 
                                dest_in_hazard=False, dest_coords=None) -> float:
        if not hazard_zones:
            return 0.0
        
        total_score = 0.0
        for zone in hazard_zones:
            z_lat = zone.get('lat')
            z_lng = zone.get('lng')
            z_severity = zone.get('severity', 0.7)
            
            if z_lat is None or z_lng is None:
                continue
            
            min_distance = float('inf')
            for point in route_points:
                dist = self._haversine_distance(point[0], point[1], z_lat, z_lng)
                if dist < min_distance:
                    min_distance = dist
            
            if min_distance < 200:
                distance_factor = max(0, (200 - min_distance) / 200)
                total_score += distance_factor * z_severity * 10
        
        return total_score
    
    def _add_accessibility_features(self, route: Dict, needs: List[str]) -> Dict:
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
        points = []
        index = 0
        lat = 0
        lng = 0
        
        while index < len(encoded):
            result = 0
            shift = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            dlat = ~(result >> 1) if result & 1 else result >> 1
            lat += dlat
            
            result = 0
            shift = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            dlng = ~(result >> 1) if result & 1 else result >> 1
            lng += dlng
            points.append((lat * 1e-5, lng * 1e-5))
        
        return points
    
    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
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
        points = []
        for i in range(num_points + 1):
            t = i / num_points
            lat = start_lat + (dest_lat - start_lat) * t
            lng = start_lng + (dest_lng - start_lng) * t
            points.append((lat, lng))
        return points
    
    def _generate_fallback_route(self, start_lat: float, start_lng: float,
                                 dest_lat: float, dest_lng: float) -> Dict:
        distance = self._haversine_distance(start_lat, start_lng, dest_lat, dest_lng)
        logger.error(f"STRAIGHT LINE FALLBACK: {distance:.0f}m")
        
        points = self._generate_intermediate_points(start_lat, start_lng, dest_lat, dest_lng, num_points=20)
        segments = self._build_segments(points)
        
        instructions = [
            {'instruction': "Depart from your location", 'distance': fmt_dist(distance), 'distance_meters': distance, 
             'duration': fmt_duration(distance / 1.4), 'duration_seconds': distance / 1.4, 'travel_mode': 'DEPART'},
            {'instruction': "Arrive at your destination", 'distance': '0 m', 'distance_meters': 0, 
             'duration': '0 sec', 'duration_seconds': 0, 'travel_mode': 'ARRIVE'},
        ]
        
        return {
            'points': points,
            'segments': segments,
            'distance_meters': distance,
            'duration_seconds': distance / 1.4,
            'instructions': instructions,
            'summary': {'lengthInMeters': distance, 'travelTimeInSeconds': distance / 1.4},
            'bounds': {'north': max(start_lat, dest_lat), 'south': min(start_lat, dest_lat),
                       'east': max(start_lng, dest_lng), 'west': min(start_lng, dest_lng)},
            'travel_mode': 'pedestrian',
            'arrival_time': (datetime.now() + timedelta(seconds=distance/1.4)).isoformat(),
            'start_point': {'lat': start_lat, 'lng': start_lng},
            'end_point': {'lat': dest_lat, 'lng': dest_lng},
            'is_fallback': True,
            'provider': 'straight_line_fallback'
        }
    
    def reverse_geocode(self, lat: float, lng: float) -> str:
        try:
            url = f"{self.search_url}/reverseGeocode/{lat},{lng}.json"
            params = {'key': self.api_key, 'language': 'en-US'}
            response = self.session.get(url, params=params, timeout=5)
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
            return f"{lat:.4f}, {lng:.4f}"
    
    def search_places(self, query: str, lat: float = None, lng: float = None,
                      radius: int = 5000) -> List[Dict]:
        try:
            url = f"{self.search_url}/search/{query}.json"
            params = {'key': self.api_key, 'limit': 10, 'language': 'en-US', 'typeahead': True}
            if lat and lng:
                params['lat'] = lat
                params['lon'] = lng
                params['radius'] = radius
            response = self.session.get(url, params=params, timeout=5)
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
                })
            return results
        except Exception as e:
            return []
    
    def clear_cache(self):
        with self.cache_lock:
            self.route_cache.clear()
            logger.info("Route cache cleared")
    
    def __del__(self):
        if hasattr(self, 'session'):
            self.session.close()