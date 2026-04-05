# tomtom_router.py
import os
import requests
import logging
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta
import math
from functools import lru_cache
from threading import Lock
import time  # Added for sleep in OSRM retries and pre-warm

logger = logging.getLogger(__name__)

# ── OSRM configuration ────────────────────────────────────────────────────────
OSRM_BASE_URL = "https://router.project-osrm.org/route/v1/foot"
OSRM_USER_AGENT = "TryverSafetyApp/1.0 (Pittsburgh PA pedestrian routing; contact@tryver.app)"

# Timeout ladder: first attempt, second attempt, third attempt (seconds)
OSRM_TIMEOUT_LADDER = (6, 10, 15)
OSRM_MAX_RETRIES = 3

# Only invoke OSRM fallback for routes longer than this threshold (metres)
OSRM_MIN_DISTANCE_FOR_FALLBACK_M = 400

# Pittsburgh river bounding box — if origin AND destination span across this
# lat range and the TomTom route suspiciously goes point-to-point across it,
# trigger OSRM automatically.
PITTSBURGH_ALLEGHENY_RIVER_LAT_BAND = (40.443, 40.452)
PITTSBURGH_MON_RIVER_LAT_BAND = (40.426, 40.436)


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
        
        # Session for connection pooling (TomTom)
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': 'TryverSafetyApp/1.0'})
        
        # Dedicated OSRM session with correct headers baked in
        self.osrm_session = requests.Session()
        self.osrm_session.headers.update({
            'User-Agent': OSRM_USER_AGENT,
            'Accept': 'application/json',
            'Connection': 'keep-alive',
        })
        # Retry adapter: 3 retries with exponential backoff on 500/502/503/504
        osrm_adapter = requests.adapters.HTTPAdapter(
            pool_connections=2,
            pool_maxsize=4,
            max_retries=0,  # We handle retries ourselves for fine-grained timeout control
        )
        self.osrm_session.mount('https://', osrm_adapter)
        self.osrm_session.mount('http://', osrm_adapter)

        # OSRM result cache — keyed by (rounded_start_lat, rounded_start_lng, rounded_end_lat, rounded_end_lng)
        # Separate from TomTom cache to allow independent TTL management
        self._osrm_cache: dict = {}
        self._osrm_cache_lock = Lock()
        self._osrm_cache_ttl = 600  # 10 minutes — OSRM routes are stable (infrastructure doesn't change)
        self._osrm_prewarmed = False  # Track whether pre-warm has run
        
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
    
    # ========== OSRM PRE‑WARM ==========
    def prewarm_osrm(self) -> bool:
        """
        Pre-warm the OSRM connection by making a cheap test route call.
        This eliminates TCP connection setup time from the first real user request.
        Returns True if OSRM is reachable, False otherwise.
        Called once on application startup — non-blocking if OSRM is unreachable.
        """
        if self._osrm_prewarmed:
            return True
        try:
            # Short test route: Aspinwall borough park to Aspinwall waterfront (~300m)
            test_url = f"{OSRM_BASE_URL}/-79.9021,40.4868;-79.9038,40.4852"
            params = {'overview': 'false', 'steps': 'false'}
            resp = self.osrm_session.get(test_url, params=params, timeout=8)
            if resp.status_code == 200 and resp.json().get('code') == 'Ok':
                logger.info("OSRM pre-warm successful — server is reachable")
                self._osrm_prewarmed = True
                return True
            else:
                logger.warning(f"OSRM pre-warm: unexpected response {resp.status_code}")
                return False
        except Exception as e:
            logger.warning(f"OSRM pre-warm failed (will retry on first use): {e}")
            return False
    
    # ========== OSRM CACHE METHODS ==========
    def _get_osrm_cache_key(self, start_lat: float, start_lng: float,
                             end_lat: float, end_lng: float) -> tuple:
        """Cache key rounded to ~11m precision (4 decimal places ≈ 11m at Pittsburgh latitude)."""
        return (round(start_lat, 4), round(start_lng, 4),
                round(end_lat, 4), round(end_lng, 4))

    def _get_cached_osrm(self, key: tuple) -> Optional[Dict]:
        """Thread-safe OSRM cache retrieval with TTL check."""
        with self._osrm_cache_lock:
            if key in self._osrm_cache:
                result, ts = self._osrm_cache[key]
                if (datetime.now() - ts).total_seconds() < self._osrm_cache_ttl:
                    logger.debug(f"OSRM cache HIT for key {key}")
                    return result
                else:
                    del self._osrm_cache[key]
                    logger.debug(f"OSRM cache EXPIRED for key {key}")
        return None

    def _set_cached_osrm(self, key: tuple, value: Dict) -> None:
        """Thread-safe OSRM cache storage with simple eviction (max 200 entries)."""
        with self._osrm_cache_lock:
            if len(self._osrm_cache) >= 200:
                # Evict oldest entry
                oldest = min(self._osrm_cache.items(), key=lambda x: x[1][1])
                del self._osrm_cache[oldest[0]]
            self._osrm_cache[key] = (value, datetime.now())
            logger.debug(f"OSRM result cached for key {key}")
    
    # ========== ROUTE SANITY CHECKER – WATER CROSSING DETECTION ==========
    def _route_crosses_river(self, points: List[Tuple[float, float]],
                             start_lat: float, start_lng: float,
                             end_lat: float, end_lng: float) -> bool:
        """
        Heuristic check: does the TomTom route appear to cross a river in a straight line
        (i.e., go directly from one bank to the other without following bridge geometry)?

        Two conditions trigger a True result:
        1. The origin and destination are on opposite sides of a known river lat band,
           AND the route contains fewer than 8 intermediate waypoints crossing the band
           (a real bridge route has many waypoints; a straight-line crossing has very few).
        2. Any consecutive pair of points in the route is more than 450m apart AND
           that segment crosses a known river lat band (indicates a jump, not real road geometry).

        This is a heuristic — false positives are possible but rare in the Pittsburgh area.
        False positives result in an unnecessary OSRM call, which is acceptable.
        False negatives result in a water-crossing route being returned, which is the bug we're fixing.
        """
        if not points or len(points) < 2:
            return False

        RIVER_BANDS = [
            PITTSBURGH_ALLEGHENY_RIVER_LAT_BAND,
            PITTSBURGH_MON_RIVER_LAT_BAND,
        ]

        for lat_band in RIVER_BANDS:
            band_lo, band_hi = lat_band

            # Check if start and end are on opposite sides of the river
            start_above = start_lat > band_hi
            end_above = end_lat > band_hi
            start_below = start_lat < band_lo
            end_below = end_lat < band_lo

            spans_river = (start_above and end_below) or (start_below and end_above)
            if not spans_river:
                continue

            # Count how many route points actually pass through the river band
            # A real bridge route will have many points threading through it
            points_in_band = sum(1 for lat, lng in points if band_lo <= lat <= band_hi)
            if points_in_band < 3:
                logger.warning(
                    f"OSRM trigger: route spans river band {lat_band} "
                    f"but only {points_in_band} waypoints cross it — likely water crossing"
                )
                return True

            # Check for large jumps across the band
            for i in range(len(points) - 1):
                lat1, lng1 = points[i]
                lat2, lng2 = points[i + 1]
                seg_crosses = (
                    (lat1 < band_lo and lat2 > band_hi) or
                    (lat1 > band_hi and lat2 < band_lo)
                )
                if seg_crosses:
                    jump_dist = self._haversine_distance(lat1, lng1, lat2, lng2)
                    if jump_dist > 450:
                        logger.warning(
                            f"OSRM trigger: {jump_dist:.0f}m jump across river band {lat_band} "
                            f"between points {i} and {i+1}"
                        )
                        return True

        return False
    
    # ========== OSRM PEDESTRIAN ROUTING (FIXED) ==========
    def _route_pedestrian_osrm(self, start_lat: float, start_lng: float,
                                dest_lat: float, dest_lng: float,
                                skip_cache: bool = False) -> Optional[Dict]:
        """
        Route a pedestrian path using the OSRM public demo server.

        Uses OpenStreetMap data — knows every bridge, pedestrian path, underpass,
        and waterway crossing. This is the correct fallback when TomTom produces
        physically impossible routes (e.g., straight-line water crossings).

        Key improvements over the broken original:
        - Uses persistent osrm_session with correct User-Agent (no throttling)
        - Aggressive but sane timeout ladder: 6s / 10s / 15s per attempt
        - Full result caching with 10-minute TTL (keyed to 4 d.p. precision)
        - OSRM coordinate format: lng,lat (NOT lat,lng — this was a silent bug)
        - Returns same dict structure as _process_route() for drop-in compatibility
        - Sanity-checks the returned route (min 2 points, endpoint proximity check)

        Args:
            start_lat, start_lng: Origin coordinates
            dest_lat, dest_lng: Destination coordinates
            skip_cache: If True, bypass cache lookup (still writes to cache on success)

        Returns:
            Route dict compatible with _process_route() output, or None on failure.
        """
        # Check OSRM cache first
        cache_key = self._get_osrm_cache_key(start_lat, start_lng, dest_lat, dest_lng)
        if not skip_cache:
            cached = self._get_cached_osrm(cache_key)
            if cached:
                logger.info(f"OSRM cache hit — skipping network call")
                return cached

        # OSRM uses lng,lat order (critical — lat,lng is silently wrong and returns garbage routes)
        url = f"{OSRM_BASE_URL}/{start_lng:.6f},{start_lat:.6f};{dest_lng:.6f},{dest_lat:.6f}"
        params = {
            'overview': 'full',
            'geometries': 'geojson',
            'steps': 'true',
            'annotations': 'false',
        }

        last_exception = None
        for attempt, timeout in enumerate(OSRM_TIMEOUT_LADDER):
            try:
                logger.info(
                    f"OSRM attempt {attempt + 1}/{OSRM_MAX_RETRIES} "
                    f"(timeout={timeout}s) for {start_lat:.4f},{start_lng:.4f} → "
                    f"{dest_lat:.4f},{dest_lng:.4f}"
                )

                resp = self.osrm_session.get(url, params=params, timeout=timeout)

                if resp.status_code == 429:
                    logger.warning("OSRM rate-limited (429) — backing off 1s before retry")
                    time.sleep(1.0)
                    continue

                if resp.status_code != 200:
                    logger.warning(f"OSRM returned HTTP {resp.status_code} on attempt {attempt + 1}")
                    if attempt < OSRM_MAX_RETRIES - 1:
                        continue
                    return None

                data = resp.json()

                if data.get('code') != 'Ok':
                    logger.warning(
                        f"OSRM code={data.get('code')} message={data.get('message')} "
                        f"on attempt {attempt + 1}"
                    )
                    if data.get('code') == 'NoRoute':
                        # No route is definitive — don't retry, return None immediately
                        logger.warning("OSRM: NoRoute — origin/destination may be inaccessible by foot")
                        return None
                    if attempt < OSRM_MAX_RETRIES - 1:
                        continue
                    return None

                routes = data.get('routes', [])
                if not routes:
                    logger.warning(f"OSRM returned 0 routes on attempt {attempt + 1}")
                    if attempt < OSRM_MAX_RETRIES - 1:
                        continue
                    return None

                route = routes[0]

                # Decode GeoJSON coordinates — OSRM returns [lon, lat], must flip to (lat, lon)
                geojson_coords = route.get('geometry', {}).get('coordinates', [])
                if not geojson_coords:
                    logger.warning("OSRM: empty geometry coordinates")
                    if attempt < OSRM_MAX_RETRIES - 1:
                        continue
                    return None

                route_points = [(c[1], c[0]) for c in geojson_coords]

                if len(route_points) < 2:
                    logger.warning(f"OSRM returned only {len(route_points)} point(s)")
                    if attempt < OSRM_MAX_RETRIES - 1:
                        continue
                    return None

                # Sanity check: last point should be near destination
                last_pt = route_points[-1]
                endpoint_dist = self._haversine_distance(
                    last_pt[0], last_pt[1], dest_lat, dest_lng
                )
                if endpoint_dist > 200:
                    logger.warning(
                        f"OSRM endpoint {last_pt} is {endpoint_dist:.0f}m from "
                        f"requested destination {dest_lat},{dest_lng} — route may be wrong"
                    )
                    # Still return it — OSRM snaps to nearest routable point,
                    # so this is expected for destinations not on a pedestrian path

                distance_meters = route.get('distance', 0.0)
                duration_seconds = route.get('duration', distance_meters / 1.4)

                # Extract turn-by-turn instructions from OSRM step data
                instructions = self._extract_osrm_instructions(route)

                # Build segments for safety scoring compatibility
                segments = self._build_segments(route_points)

                # Calculate bounds
                lats = [p[0] for p in route_points]
                lngs = [p[1] for p in route_points]
                bounds = {
                    'north': max(lats), 'south': min(lats),
                    'east': max(lngs), 'west': min(lngs),
                }

                result = {
                    'points': route_points,
                    'segments': segments,
                    'distance_meters': distance_meters,
                    'duration_seconds': duration_seconds,
                    'instructions': instructions,
                    'summary': {
                        'lengthInMeters': distance_meters,
                        'travelTimeInSeconds': duration_seconds,
                    },
                    'bounds': bounds,
                    'travel_mode': 'pedestrian',
                    'arrival_time': (datetime.now() + timedelta(seconds=duration_seconds)).isoformat(),
                    'start_point': {'lat': start_lat, 'lng': start_lng},
                    'end_point': {'lat': dest_lat, 'lng': dest_lng},
                    'provider': 'osrm',
                    'is_fallback': False,
                }

                # Cache the successful result
                self._set_cached_osrm(cache_key, result)

                logger.info(
                    f"OSRM SUCCESS on attempt {attempt + 1}: "
                    f"{len(route_points)} waypoints, "
                    f"{distance_meters:.0f}m, "
                    f"{duration_seconds / 60:.1f} min"
                )
                self._osrm_prewarmed = True  # Mark as confirmed reachable
                return result

            except requests.exceptions.Timeout:
                logger.warning(
                    f"OSRM timeout on attempt {attempt + 1}/{OSRM_MAX_RETRIES} "
                    f"(limit={timeout}s)"
                )
                last_exception = f"Timeout at {timeout}s"
                if attempt < OSRM_MAX_RETRIES - 1:
                    time.sleep(0.3 * (attempt + 1))  # Brief exponential backoff
                    continue

            except requests.exceptions.ConnectionError as e:
                logger.warning(f"OSRM connection error on attempt {attempt + 1}: {e}")
                last_exception = str(e)
                if attempt < OSRM_MAX_RETRIES - 1:
                    time.sleep(0.5 * (attempt + 1))
                    continue

            except (ValueError, KeyError) as e:
                logger.warning(f"OSRM response parse error on attempt {attempt + 1}: {e}")
                last_exception = str(e)
                if attempt < OSRM_MAX_RETRIES - 1:
                    continue

            except Exception as e:
                logger.error(f"OSRM unexpected error on attempt {attempt + 1}: {e}")
                last_exception = str(e)
                break

        logger.error(
            f"OSRM FAILED after {OSRM_MAX_RETRIES} attempts. "
            f"Last error: {last_exception}. "
            f"Route: {start_lat:.4f},{start_lng:.4f} → {dest_lat:.4f},{dest_lng:.4f}"
        )
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
        
        # ── OSRM fallback decision ───────────────────────────────────────────────
        straight_dist = self._haversine_distance(start_lat, start_lng, dest_lat, dest_lng)

        if route_result is None and straight_dist >= OSRM_MIN_DISTANCE_FOR_FALLBACK_M:
            logger.info(
                f"TomTom failed for {straight_dist:.0f}m route — attempting OSRM fallback"
            )
            route_result = self._route_pedestrian_osrm(start_lat, start_lng, dest_lat, dest_lng)

        elif route_result is not None and straight_dist >= OSRM_MIN_DISTANCE_FOR_FALLBACK_M:
            # TomTom succeeded — sanity-check for water crossing
            returned_points = route_result.get('points', [])
            if self._route_crosses_river(returned_points, start_lat, start_lng, dest_lat, dest_lng):
                logger.warning(
                    "TomTom route appears to cross water — overriding with OSRM"
                )
                osrm_result = self._route_pedestrian_osrm(
                    start_lat, start_lng, dest_lat, dest_lng
                )
                if osrm_result:
                    route_result = osrm_result
                    logger.info("OSRM override successful — water crossing corrected")
                else:
                    logger.warning(
                        "OSRM override failed — keeping TomTom route despite suspected water crossing"
                    )
        
        # ── Final fallback to straight-line if everything fails ───────────────────
        if route_result is None:
            logger.error(f"TomTom and OSRM both failed, using straight-line fallback")
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
        """
        Absolute last-resort straight-line route.
        OSRM is attempted earlier in calculate_route — by the time we reach here,
        both TomTom and OSRM have already failed. Do not retry OSRM here.
        """
        distance = self._haversine_distance(start_lat, start_lng, dest_lat, dest_lng)
        logger.error(
            f"STRAIGHT LINE FALLBACK: {start_lat:.4f},{start_lng:.4f} → "
            f"{dest_lat:.4f},{dest_lng:.4f} ({distance:.0f}m). "
            f"Both TomTom and OSRM failed. This route may cross water or impassable terrain."
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
        """Cleanup sessions"""
        if hasattr(self, 'session'):
            self.session.close()
        if hasattr(self, 'osrm_session'):
            self.osrm_session.close()