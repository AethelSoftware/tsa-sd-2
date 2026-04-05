# tomtom_router.py
import os
import requests
import logging
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta
import math
from functools import lru_cache
from threading import Lock

logger = logging.getLogger(__name__)

class TomTomRouter:
    """Handle routing with TomTom API and OSRM fallback for pedestrian routes"""
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')
        self.base_url = "https://api.tomtom.com/routing/1"
        self.search_url = "https://api.tomtom.com/search/2"
        
        # Cache for route calculations - DISABLED for now to fix stale routes
        self.route_cache = {}
        self.cache_lock = Lock()
        self.cache_max_size = 100
        self.cache_ttl = 300  # 5 minutes cache TTL
        
        # Session for connection pooling
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': 'TryverSafetyApp/1.0'})
        
    def _get_cache_key(self, start_lat, start_lng, dest_lat, dest_lng, 
                       travel_mode, avoid_hazards, accessibility_needs):
        """Create efficient cache key"""
        key = (
            round(start_lat, 6), round(start_lng, 6),
            round(dest_lat, 6), round(dest_lng, 6),
            travel_mode,
            avoid_hazards,
            frozenset(accessibility_needs) if accessibility_needs else frozenset()
        )
        return key
    
    def _get_cached_route(self, key, dest_lat=None, dest_lng=None):
        """Thread-safe cache retrieval with destination validation"""
        with self.cache_lock:
            if key in self.route_cache:
                route_data, timestamp = self.route_cache[key]
                # Check if cache is still fresh (5 minutes)
                if (datetime.now() - timestamp).seconds < self.cache_ttl:
                    # CRITICAL: Verify destination matches EXACTLY
                    if dest_lat is not None and dest_lng is not None:
                        cached_end = route_data.get('end_point', {})
                        cached_lat = cached_end.get('lat', 0)
                        cached_lng = cached_end.get('lng', 0)
                        
                        # Calculate distance between cached destination and requested
                        dist_diff = self._haversine_distance(
                            cached_lat, cached_lng, dest_lat, dest_lng
                        )
                        
                        # Only use cache if destinations are within 50 meters
                        if dist_diff < 50:
                            logger.info(f"Cache HIT - destinations match within {dist_diff:.0f}m")
                            return route_data
                        else:
                            logger.warning(f"Cache MISS - destination mismatch: cached ({cached_lat},{cached_lng}) vs requested ({dest_lat},{dest_lng}), distance {dist_diff:.0f}m")
                            # Delete the stale cache entry
                            del self.route_cache[key]
                            return None
                    return route_data
                else:
                    # Remove expired cache
                    logger.info(f"Cache expired for key {key}")
                    del self.route_cache[key]
            return None
    
    def _set_cached_route(self, key, value):
        """Thread-safe cache storage with LRU eviction"""
        with self.cache_lock:
            if len(self.route_cache) >= self.cache_max_size:
                oldest_key = next(iter(self.route_cache))
                del self.route_cache[oldest_key]
            self.route_cache[key] = (value, datetime.now())
            logger.debug(f"Cached route for key {key}")
    
    # ========== OSRM PEDESTRIAN ROUTING (PRIMARY) ==========
    def _route_pedestrian_osrm(self, start_lat: float, start_lng: float,
                                dest_lat: float, dest_lng: float) -> Optional[Dict]:
        """
        Route pedestrian path using OSRM public demo server.
        Uses OpenStreetMap data — knows all bridges, paths, pedestrian ways.
        Returns same format as _process_route() or None on failure.
        """
        # Retry logic for OSRM (sometimes times out)
        for attempt in range(3):  # Increased to 3 attempts
            try:
                # OSRM expects lng,lat NOT lat,lng
                url = (
                    f"https://router.project-osrm.org/route/v1/foot/"
                    f"{start_lng:.6f},{start_lat:.6f};{dest_lng:.6f},{dest_lat:.6f}"
                )
                params = {
                    'overview': 'full',
                    'geometries': 'geojson',
                    'steps': 'true',
                    'annotations': 'false'
                }
                headers = {'User-Agent': 'TryverSafetyApp/1.0 (Pittsburgh PA pedestrian routing)'}
                
                # Progressive timeout: 15s, 20s, 25s
                timeout = 15 + (attempt * 5)
                logger.info(f"OSRM attempt {attempt + 1}/3 with timeout {timeout}s")
                
                resp = self.session.get(url, params=params, headers=headers, timeout=timeout)
                
                if resp.status_code != 200:
                    if attempt < 2:
                        logger.warning(f"OSRM returned {resp.status_code}, retrying...")
                        continue
                    logger.warning(f"OSRM returned {resp.status_code}")
                    return None
                
                data = resp.json()
                
                if data.get('code') != 'Ok':
                    if attempt < 2 and data.get('code') == 'NoRoute':
                        logger.warning("OSRM: No route found, retrying...")
                        continue
                    logger.warning(f"OSRM code: {data.get('code')}, message: {data.get('message')}")
                    return None
                
                routes = data.get('routes', [])
                if not routes:
                    return None
                
                route = routes[0]
                
                # GeoJSON coords are [lon, lat] — flip to (lat, lon) tuples for Leaflet
                geojson_coords = route['geometry']['coordinates']
                route_points = [(c[1], c[0]) for c in geojson_coords]
                
                if len(route_points) < 2:
                    return None
                
                distance_meters = route.get('distance', 0)
                duration_seconds = route.get('duration', distance_meters / 1.4)
                
                # Extract turn-by-turn instructions from OSRM steps
                instructions = self._extract_osrm_instructions(route)
                
                # Calculate bounds
                lats = [p[0] for p in route_points]
                lngs = [p[1] for p in route_points]
                bounds = {
                    'north': max(lats), 'south': min(lats),
                    'east': max(lngs), 'west': min(lngs)
                }
                
                # Build segments for safety scoring
                segments = self._build_segments(route_points)
                
                logger.info(
                    f"OSRM pedestrian route: {len(route_points)} waypoints, "
                    f"{distance_meters:.0f}m, {duration_seconds/60:.1f} min"
                )
                
                return {
                    'points': route_points,
                    'segments': segments,
                    'distance_meters': distance_meters,
                    'duration_seconds': duration_seconds,
                    'instructions': instructions,
                    'summary': {'lengthInMeters': distance_meters, 'travelTimeInSeconds': duration_seconds},
                    'bounds': bounds,
                    'travel_mode': 'pedestrian',
                    'arrival_time': (datetime.now() + timedelta(seconds=duration_seconds)).isoformat(),
                    'start_point': {'lat': start_lat, 'lng': start_lng},
                    'end_point': {'lat': dest_lat, 'lng': dest_lng},
                    'provider': 'osrm'
                }
                
            except requests.exceptions.Timeout:
                if attempt < 2:
                    logger.warning(f"OSRM request timed out (attempt {attempt + 1}), retrying with longer timeout...")
                    continue
                logger.warning("OSRM request timed out after all retries")
                return None
            except Exception as e:
                if attempt < 2:
                    logger.warning(f"OSRM routing failed: {e}, retrying...")
                    continue
                logger.warning(f"OSRM routing failed: {e}")
                return None
        
        return None
    
    def _extract_osrm_instructions(self, route: Dict) -> List[Dict]:
        """Extract instructions from OSRM route"""
        instructions = []
        legs = route.get('legs', [])
        
        if not legs:
            return instructions
        
        for step in legs[0].get('steps', []):
            maneuver = step.get('maneuver', {})
            maneuver_type = maneuver.get('type', 'continue')
            modifier = maneuver.get('modifier', '')
            street_name = step.get('name', '') or step.get('ref', '')
            step_distance = step.get('distance', 0)
            step_duration = step.get('duration', 0)
            
            # Build instruction text
            if maneuver_type == 'depart':
                instr = f"Head {modifier} on {street_name}" if street_name else "Depart"
            elif maneuver_type == 'arrive':
                instr = "Arrive at your destination"
            elif maneuver_type == 'turn':
                direction = modifier.replace('-', ' ')
                instr = f"Turn {direction}" + (f" onto {street_name}" if street_name else "")
            elif maneuver_type == 'new name':
                instr = f"Continue onto {street_name}" if street_name else "Continue"
            elif maneuver_type == 'continue':
                instr = f"Continue on {street_name}" if street_name else "Continue straight"
            elif maneuver_type == 'roundabout':
                exit_num = maneuver.get('exit', 1)
                instr = f"At the roundabout, take exit {exit_num}"
            elif maneuver_type in ['merge', 'ramp', 'fork']:
                instr = f"Keep {modifier}" + (f" on {street_name}" if street_name else "")
            else:
                instr = f"Continue" + (f" on {street_name}" if street_name else "")
            
            # Format distance
            if step_distance >= 1000:
                dist_str = f"{step_distance/1000:.1f} km"
            else:
                dist_str = f"{step_distance:.0f} m"
            
            instructions.append({
                'instruction': instr,
                'distance': dist_str,
                'distance_meters': step_distance,
                'duration': f"{int(step_duration//60)} min" if step_duration >= 60 else f"{int(step_duration)} sec",
                'duration_seconds': step_duration,
                'travel_mode': 'WALKING',
                'maneuver_type': maneuver_type,
                'modifier': modifier,
            })
        
        return instructions
    
    def _build_segments(self, points: List[Tuple]) -> List[Dict]:
        """Build segments from route points"""
        if len(points) < 2:
            return []
        
        segments = []
        for i in range(len(points) - 1):
            seg_dist = self._haversine_distance(
                points[i][0], points[i][1],
                points[i+1][0], points[i+1][1]
            )
            segments.append({
                'start': {'lat': points[i][0], 'lng': points[i][1]},
                'end': {'lat': points[i+1][0], 'lng': points[i+1][1]},
                'distance': seg_dist,
                'duration': seg_dist / 1.4,
                'index': i
            })
        
        return segments
    
    # ========== MAIN ROUTING METHOD ==========
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
        logger.info(f"force_refresh: {force_refresh}")
        
        # Validate coordinates
        if not (-90 <= start_lat <= 90) or not (-180 <= start_lng <= 180):
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
        if not (-90 <= dest_lat <= 90) or not (-180 <= dest_lng <= 180):
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
        
        # Create cache key
        cache_key = self._get_cache_key(start_lat, start_lng, dest_lat, dest_lng,
                                        travel_mode, avoid_hazards, accessibility_needs)
        
        # Check cache (skip if force_refresh)
        if not force_refresh:
            cached_route = self._get_cached_route(cache_key, dest_lat, dest_lng)
            if cached_route:
                logger.info(f"Using cached route to {dest_lat},{dest_lng}")
                return cached_route
        else:
            logger.info("force_refresh=True - bypassing cache")
        
        route_result = None
        
        # SKIP OSRM - it always times out. Go directly to TomTom
        logger.info("Skipping OSRM (always times out), going directly to TomTom")
        
        # ── ATTEMPT: TomTom directly ──────────────────────────────────────────────
        if self.api_key:
            logger.info("Attempting TomTom routing...")
            if obstruction_zones and len(obstruction_zones) > 0:
                tomtom_result = self._get_safest_route_with_alternatives(
                    start_lat, start_lng, dest_lat, dest_lng,
                    travel_mode, accessibility_needs, obstruction_zones
                )
            else:
                tomtom_result = self._get_standard_route(
                    start_lat, start_lng, dest_lat, dest_lng,
                    travel_mode, accessibility_needs
                )
            
            if tomtom_result and not tomtom_result.get('is_fallback', False):
                logger.info("TomTom routing SUCCESS")
                route_result = tomtom_result
        
        # ── Fallback to straight-line if TomTom fails ──────────────────────────────
        if route_result is None:
            logger.error(f"TomTom failed, using straight-line fallback")
            route_result = self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
        
        # Add accessibility features if needed
        if accessibility_needs and route_result:
            route_result = self._add_accessibility_features(route_result, accessibility_needs)
        
        # Cache the result (only if not force_refresh)
        if route_result and not force_refresh:
            self._set_cached_route(cache_key, route_result)
        
        return route_result
    
    # ========== HAZARD AVOIDANCE ROUTING (TomTom alternatives) ==========
    def _get_safest_route_with_alternatives(self, start_lat, start_lng, dest_lat, dest_lng,
                                            travel_mode, accessibility_needs, hazard_zones,
                                            dest_in_hazard=False, start_in_hazard=False):
        """Get multiple route alternatives and pick the safest one"""
        try:
            origin = f"{start_lat:.6f},{start_lng:.6f}"
            destination = f"{dest_lat:.6f},{dest_lng:.6f}"
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
            
            logger.info(f"Calling TomTom API: {url[:100]}...")
            response = self.session.get(url, params=params, timeout=15)
            
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
                        
                        # Verify the route ends at the correct destination
                        route_end = best_route.get('end_point', {})
                        route_end_lat = route_end.get('lat', 0)
                        route_end_lng = route_end.get('lng', 0)
                        dist_to_dest = self._haversine_distance(route_end_lat, route_end_lng, dest_lat, dest_lng)
                        
                        if dist_to_dest > 100:
                            logger.error(f"TomTom route ends {dist_to_dest:.0f}m from requested destination! Rejecting.")
                            return None
                        
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
            origin = f"{start_lat:.6f},{start_lng:.6f}"
            destination = f"{dest_lat:.6f},{dest_lng:.6f}"
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
            
            logger.info(f"Calling TomTom standard API...")
            response = self.session.get(url, params=params, timeout=15)
            
            if response.status_code == 200:
                data = response.json()
                if 'routes' in data and data['routes']:
                    route = self._process_route(data['routes'][0], start_lat, start_lng, dest_lat, dest_lng)
                    
                    # Verify destination
                    route_end = route.get('end_point', {})
                    route_end_lat = route_end.get('lat', 0)
                    route_end_lng = route_end.get('lng', 0)
                    dist_to_dest = self._haversine_distance(route_end_lat, route_end_lng, dest_lat, dest_lng)
                    
                    if dist_to_dest > 100:
                        logger.error(f"TomTom standard route ends {dist_to_dest:.0f}m from destination! Rejecting.")
                        return None
                    
                    if accessibility_needs:
                        route = self._add_accessibility_features(route, accessibility_needs)
                    return route
            
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
            
        except Exception as e:
            logger.error(f"Error getting standard route: {e}")
            return self._generate_fallback_route(start_lat, start_lng, dest_lat, dest_lng)
    
    # ========== HELPER METHODS ==========
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
    
    def _calculate_hazard_score(self, route_points: List[Tuple], hazard_zones: List[Dict], 
                                dest_in_hazard=False, dest_coords=None) -> float:
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
            
            if dest_in_hazard and dest_coords:
                dist_to_dest = self._haversine_distance(route_points[min_point_index][0], 
                                                        route_points[min_point_index][1],
                                                        dest_coords[0], dest_coords[1])
                if dist_to_dest < 200:
                    distance_factor = max(0, (200 - min_distance) / 200) * 0.3
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
        """Process TomTom route response into our format with OSRM fallback on decode failure"""
        
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
                logger.warning(f"Failed to decode polyline: {e} — trying OSRM")
                osrm = self._route_pedestrian_osrm(start_lat, start_lng, dest_lat, dest_lng)
                if osrm:
                    return osrm  # Return OSRM result directly
                route_points = [(start_lat, start_lng), (dest_lat, dest_lng)]
        else:
            for point in leg.get('points', []):
                if 'latitude' in point and 'longitude' in point:
                    route_points.append((point['latitude'], point['longitude']))
        
        if not route_points or len(route_points) < 2:
            logger.warning(f"TomTom returned {len(route_points) if route_points else 0} points — trying OSRM")
            osrm = self._route_pedestrian_osrm(start_lat, start_lng, dest_lat, dest_lng)
            if osrm:
                return osrm
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
        segments = self._build_segments(route_points)
        
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
            lat = start_lat + (dest_lat - start_lat) * t + math.sin(t * math.pi) * 0.0005
            lng = start_lng + (dest_lng - start_lng) * t + math.cos(t * math.pi) * 0.0005
            points.append((lat, lng))
        return points
    
    def _generate_fallback_route(self, start_lat: float, start_lng: float,
                                dest_lat: float, dest_lng: float) -> Dict:
        """Generate fallback route — tries OSRM first, then straight line as last resort."""
        
        # Try OSRM before giving up
        osrm_result = self._route_pedestrian_osrm(start_lat, start_lng, dest_lat, dest_lng)
        if osrm_result:
            logger.info("_generate_fallback_route: OSRM succeeded as fallback")
            return osrm_result
        
        # Absolute last resort: straight line with warning
        distance = self._haversine_distance(start_lat, start_lng, dest_lat, dest_lng)
        logger.error(
            f"STRAIGHT LINE FALLBACK: {start_lat},{start_lng} → {dest_lat},{dest_lng} "
            f"({distance:.0f}m). This route may cross water. Both OSRM and TomTom failed."
        )
        
        points = self._generate_intermediate_points(
            start_lat, start_lng, dest_lat, dest_lng, num_points=20
        )
        
        segments = self._build_segments(points)
        
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
            logger.error(f"Reverse geocode failed: {e}")
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
                    'score': result.get('score', 0)
                })
            
            return results
        except Exception as e:
            logger.error(f"Place search failed: {e}")
            return []
    
    def clear_cache(self):
        """Clear the route cache - useful for debugging"""
        with self.cache_lock:
            self.route_cache.clear()
            logger.info("Route cache cleared")
    
    def __del__(self):
        """Cleanup session"""
        if hasattr(self, 'session'):
            self.session.close()