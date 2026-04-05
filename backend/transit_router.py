"""
Transit Router using GTFS data with shape-based geometry
OPTIMIZED VERSION - with aggressive caching and reduced API calls
"""
# transit_router.py
from typing import List, Dict, Tuple, Optional
from datetime import datetime, timedelta
import heapq
import logging
from dataclasses import dataclass, field
from gtfs_loader import GTFSLoader, Stop
import math
import zipfile
import pandas as pd
import os
import requests
import pickle
import hashlib
from functools import lru_cache

logger = logging.getLogger(__name__)

@dataclass(order=True)
class State:
    time: datetime
    node_id: str
    trip_id: Optional[str] = field(compare=False, default=None)
    route_id: Optional[str] = field(compare=False, default=None)
    route_short_name: Optional[str] = field(compare=False, default=None)
    predecessor: Optional['State'] = field(compare=False, default=None)
    edge_type: str = field(compare=False, default='walk')
    from_stop_id: Optional[str] = field(compare=False, default=None)
    to_stop_id: Optional[str] = field(compare=False, default=None)
    transfers: int = field(compare=False, default=0)

class TransitRouter:
    def __init__(self, gtfs_zip_path: str, walking_speed_mps: float = 1.4):
        self.gtfs = GTFSLoader(gtfs_zip_path, use_cache=True)  # Use cached GTFS
        self.walking_speed = walking_speed_mps
        self.walking_transfer_time = 120
        
        # Load shapes
        self.shapes: Dict[str, List[Tuple[float, float]]] = {}
        self.trip_to_shape: Dict[str, str] = {}
        self._load_shapes()
        
        # Pre-build shape index for fast point lookup
        self._shape_point_index: Dict[str, Dict[str, List[int]]] = {}  # shape_id -> {stop_id: [indices]}
        
        # Load route info
        self._route_info: Dict[str, Dict] = {}
        self._trip_to_route: Dict[str, str] = {}
        self._load_routes()
        
        # Trip stop cache
        self._trip_stop_cache: Dict[str, List[Tuple[str, int]]] = {}
        self._build_trip_cache()
        
        # DISK CACHE for walking routes (persists between server restarts)
        self.cache_dir = os.path.join(os.path.dirname(__file__), 'cache')
        os.makedirs(self.cache_dir, exist_ok=True)
        self._walk_cache_file = os.path.join(self.cache_dir, 'walk_routes_cache.pkl')
        self._walk_route_cache: Dict[str, List[Tuple[float, float]]] = self._load_walk_cache()
        
        # Pre-compute shape indices for fast stop-to-shape mapping
        self._build_shape_index()
    
    def _load_walk_cache(self) -> Dict:
        """Load walking route cache from disk"""
        try:
            if os.path.exists(self._walk_cache_file):
                with open(self._walk_cache_file, 'rb') as f:
                    cache = pickle.load(f)
                    logger.info(f"Loaded {len(cache)} walking routes from disk cache")
                    return cache
        except Exception as e:
            logger.warning(f"Failed to load walk cache: {e}")
        return {}
    
    def _save_walk_cache(self):
        """Save walking route cache to disk"""
        try:
            with open(self._walk_cache_file, 'wb') as f:
                pickle.dump(self._walk_route_cache, f, protocol=pickle.HIGHEST_PROTOCOL)
            logger.info(f"Saved {len(self._walk_route_cache)} walking routes to disk")
        except Exception as e:
            logger.warning(f"Failed to save walk cache: {e}")
    
    def _build_shape_index(self):
        """Pre-compute which shape points are near each stop for O(1) lookup"""
        logger.info("Building shape index for fast stop mapping...")
        for shape_id, points in self.shapes.items():
            self._shape_point_index[shape_id] = {}
            # Sample every 10th point for index (performance vs accuracy tradeoff)
            for idx, (lat, lon) in enumerate(points[::10]):
                # Store approximate index range
                self._shape_point_index[shape_id][f"{lat:.4f},{lon:.4f}"] = idx * 10
        logger.info(f"Shape index built for {len(self._shape_point_index)} shapes")
    
    def _load_shapes(self):
        """Load shapes.txt for bus route geometry - optimized"""
        try:
            with zipfile.ZipFile(self.gtfs.gtfs_zip_path, 'r') as z:
                if 'shapes.txt' in z.namelist():
                    with z.open('shapes.txt') as f:
                        shapes_df = pd.read_csv(f)
                        shape_points = {}
                        for _, row in shapes_df.iterrows():
                            shape_id = str(row['shape_id'])
                            lat = float(row['shape_pt_lat'])
                            lon = float(row['shape_pt_lon'])
                            seq = int(row['shape_pt_sequence'])
                            if shape_id not in shape_points:
                                shape_points[shape_id] = []
                            shape_points[shape_id].append((seq, lat, lon))
                        
                        for shape_id, points in shape_points.items():
                            points.sort(key=lambda x: x[0])
                            self.shapes[shape_id] = [(lat, lon) for _, lat, lon in points]
                    
                    logger.info(f"Loaded {len(self.shapes)} shapes")
                    
                    with z.open('trips.txt') as f:
                        trips_df = pd.read_csv(f, dtype=str)
                        for _, row in trips_df.iterrows():
                            trip_id = str(row['trip_id'])
                            shape_id = str(row['shape_id']) if 'shape_id' in row and pd.notna(row['shape_id']) else None
                            if shape_id and shape_id in self.shapes:
                                self.trip_to_shape[trip_id] = shape_id
                    
                    logger.info(f"Mapped {len(self.trip_to_shape)} trips to shapes")
        except Exception as e:
            logger.warning(f"Error loading shapes: {e}")
    
    @lru_cache(maxsize=10000)
    def _get_shape_path_cached(self, trip_id: str, from_stop_id: str, to_stop_id: str) -> Tuple[Tuple[float, float], ...]:
        """Cached version of shape path retrieval"""
        shape_id = self.trip_to_shape.get(trip_id)
        if not shape_id or shape_id not in self.shapes:
            return ()
        
        shape = self.shapes[shape_id]
        from_stop = self.gtfs.stops.get(from_stop_id)
        to_stop = self.gtfs.stops.get(to_stop_id)
        
        if not from_stop or not to_stop:
            return ()
        
        # Use shape index for faster lookup
        from_idx, to_idx = -1, -1
        min_from, min_to = float('inf'), float('inf')
        
        # Sample every 20th point for initial rough search
        sample_step = max(1, len(shape) // 100)
        for i in range(0, len(shape), sample_step):
            lat, lon = shape[i]
            d_from = self._haversine(from_stop.lat, from_stop.lon, lat, lon)
            d_to = self._haversine(to_stop.lat, to_stop.lon, lat, lon)
            if d_from < min_from:
                min_from, from_idx = d_from, i
            if d_to < min_to:
                min_to, to_idx = d_to, i
        
        # Refine search around found indices
        refine_range = 20
        from_start = max(0, from_idx - refine_range)
        from_end = min(len(shape), from_idx + refine_range)
        to_start = max(0, to_idx - refine_range)
        to_end = min(len(shape), to_idx + refine_range)
        
        for i in range(from_start, from_end):
            lat, lon = shape[i]
            d = self._haversine(from_stop.lat, from_stop.lon, lat, lon)
            if d < min_from:
                min_from, from_idx = d, i
        
        for i in range(to_start, to_end):
            lat, lon = shape[i]
            d = self._haversine(to_stop.lat, to_stop.lon, lat, lon)
            if d < min_to:
                min_to, to_idx = d, i
        
        if from_idx >= 0 and to_idx >= 0:
            if from_idx <= to_idx:
                return tuple(shape[from_idx:to_idx + 1])
            else:
                return tuple(shape[to_idx:from_idx + 1][::-1])
        return ()
    
    def _get_shape_path(self, trip_id: str, from_stop_id: str, to_stop_id: str) -> List[Tuple[float, float]]:
        """Get shape points between two stops - uses cached version"""
        result = self._get_shape_path_cached(trip_id, from_stop_id, to_stop_id)
        return list(result) if result else []
    
    def _load_routes(self):
        """Load routes.txt for route names"""
        try:
            with zipfile.ZipFile(self.gtfs.gtfs_zip_path, 'r') as z:
                with z.open('routes.txt') as f:
                    routes_df = pd.read_csv(f, dtype=str)
                    for _, row in routes_df.iterrows():
                        route_id = str(row['route_id'])
                        self._route_info[route_id] = {
                            'route_short_name': str(row.get('route_short_name', '')),
                            'route_long_name': str(row.get('route_long_name', '')),
                        }
            logger.info(f"Loaded {len(self._route_info)} routes")
        except Exception as e:
            logger.warning(f"Error loading routes: {e}")
        
        for trip_id, trip in self.gtfs.trips.items():
            if trip.route_id:
                self._trip_to_route[trip_id] = trip.route_id
    
    def _build_trip_cache(self):
        """Cache trip stop sequences for quick lookup"""
        for trip_id, stop_times in self.gtfs.stop_times.items():
            self._trip_stop_cache[trip_id] = [(st.stop_id, st.stop_sequence) for st in stop_times]
        logger.info(f"Cached {len(self._trip_stop_cache)} trips")
    
    def _get_next_stop(self, trip_id: str, current_stop_id: str) -> Optional[str]:
        """Get the next stop on a trip after the current stop"""
        stops = self._trip_stop_cache.get(trip_id, [])
        for i, (stop_id, _) in enumerate(stops):
            if stop_id == current_stop_id and i + 1 < len(stops):
                return stops[i + 1][0]
        return None
    
    def _haversine(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate distance between two points in meters"""
        R = 6371000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlam = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    def _path_distance(self, pts: List[Tuple[float, float]]) -> float:
        """Sum of haversine distances along a path"""
        total = 0.0
        for i in range(len(pts) - 1):
            total += self._haversine(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1])
        return total
    
    def _decode_tomtom_polyline(self, encoded: str) -> List[Tuple[float, float]]:
        """Decode Google/TomTom encoded polyline to (lat, lon) tuples"""
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
    
    @lru_cache(maxsize=2000)
    def _route_walking_leg_cached(self, from_lat: float, from_lon: float,
                                   to_lat: float, to_lon: float) -> Tuple[Tuple[float, float], ...]:
        """Cached version of walking route - uses disk cache + LRU"""
        cache_key = f"{from_lat:.5f},{from_lon:.5f}|{to_lat:.5f},{to_lon:.5f}"
        
        # Check memory cache (via lru_cache params above)
        # Check disk cache
        if cache_key in self._walk_route_cache:
            return tuple(self._walk_route_cache[cache_key])
        
        straight_dist = self._haversine(from_lat, from_lon, to_lat, to_lon)
        
        # Very short legs (< 50m) are fine as straight line
        if straight_dist < 50:
            pts = [(from_lat, from_lon), (to_lat, to_lon)]
            self._walk_route_cache[cache_key] = pts
            self._save_walk_cache()
            return tuple(pts)
        
        # Try TomTom (only if not in cache)
        tomtom_key = os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')
        if tomtom_key:
            try:
                url = (f"https://api.tomtom.com/routing/1/calculateRoute/"
                       f"{from_lat},{from_lon}:{to_lat},{to_lon}/json")
                params = {
                    'key': tomtom_key,
                    'travelMode': 'pedestrian',
                    'routeRepresentation': 'polyline',
                }
                resp = requests.get(url, params=params, timeout=5)  # Reduced timeout
                if resp.status_code == 200:
                    data = resp.json()
                    routes = data.get('routes', [])
                    if routes:
                        legs = routes[0].get('legs', [])
                        if legs:
                            raw_points = legs[0].get('points', [])
                            if isinstance(raw_points, dict) and 'encodedPolyline' in raw_points:
                                pts = self._decode_tomtom_polyline(raw_points['encodedPolyline'])
                            elif isinstance(raw_points, list) and raw_points:
                                pts = [(p['latitude'], p['longitude']) for p in raw_points]
                            else:
                                pts = []
                            if len(pts) >= 2:
                                self._walk_route_cache[cache_key] = pts
                                self._save_walk_cache()
                                return tuple(pts)
            except Exception as e:
                logger.debug(f"TomTom walk failed: {e}")
        
        # Fallback to straight line
        pts = [(from_lat, from_lon), (to_lat, to_lon)]
        self._walk_route_cache[cache_key] = pts
        if len(self._walk_route_cache) % 100 == 0:
            self._save_walk_cache()
        return tuple(pts)
    
    def _route_walking_leg(self, from_lat: float, from_lon: float,
                           to_lat: float, to_lon: float) -> List[Tuple[float, float]]:
        """Get real pedestrian route - uses caching"""
        result = self._route_walking_leg_cached(from_lat, from_lon, to_lat, to_lon)
        return list(result)
    
    def _find_stops_with_expansion(self, lat: float, lon: float, initial_radius: float = 800) -> List[Tuple[Stop, float]]:
        """Find stops - optimized with single radius attempt"""
        # Try one reasonable radius first
        stops = self.gtfs.find_nearby_stops(lat, lon, initial_radius)
        if stops:
            logger.info(f"Found {len(stops)} stops within {initial_radius}m")
            return stops
        
        # Only expand if necessary (suburban areas)
        for radius in [2000, 5000]:
            stops = self.gtfs.find_nearby_stops(lat, lon, radius)
            if stops:
                logger.info(f"Found {len(stops)} stops within {radius}m")
                return stops
        
        logger.warning(f"No stops found within 5km")
        return []
    
    def find_route(self,
                   start_lat: float, start_lon: float,
                   end_lat: float, end_lon: float,
                   start_time: datetime,
                   max_walk_distance: float = 800,
                   max_transfers: int = 4,
                   time_window_minutes: int = 120,
                   num_alternatives: int = 3) -> Optional[List[Dict]]:
        """Find transit routes - optimized version"""
        
        logger.info(f"Transit routing from ({start_lat:.4f},{start_lon:.4f}) to ({end_lat:.4f},{end_lon:.4f})")
        
        # Find stops
        start_stops = self._find_stops_with_expansion(start_lat, start_lon, max_walk_distance)
        end_stops = self._find_stops_with_expansion(end_lat, end_lon, max_walk_distance)
        
        if not start_stops or not end_stops:
            return None
        
        # Priority queue for Dijkstra
        pq = []
        best_times = {}
        counter = 0
        
        # Push initial walking states
        for stop, distance in start_stops[:10]:  # Limit to nearest 10 stops
            walk_time = distance / self.walking_speed
            arrival = start_time + timedelta(seconds=walk_time)
            state = State(
                time=arrival, node_id=stop.stop_id, trip_id=None,
                transfers=0, edge_type='walk', predecessor=None
            )
            key = (stop.stop_id, None, 0)
            best_times[key] = arrival
            heapq.heappush(pq, (arrival, stop.stop_id, counter, None, 0, state))
            counter += 1
        
        # Dijkstra with early termination
        goal_states = []
        iterations = 0
        MAX_ITERATIONS = 50000  # Limit search space
        
        while pq and iterations < MAX_ITERATIONS and (not goal_states or iterations < 10000):
            iterations += 1
            current_time, current_node, _, current_trip, transfers, current_state = heapq.heappop(pq)
            
            # Check if reached destination
            for end_stop, end_dist in end_stops[:5]:  # Limit to nearest 5 destination stops
                if current_node == end_stop.stop_id:
                    walk_time = end_dist / self.walking_speed
                    total_time = current_time + timedelta(seconds=walk_time)
                    goal_states.append((total_time, current_state, end_stop, walk_time))
                    # Don't break - continue for alternatives
            
            if transfers > max_transfers:
                continue
            
            # ALIGHT: from transit to waiting at stop
            if current_trip is not None:
                # Stay on same bus
                next_stop = self._get_next_stop(current_trip, current_node)
                if next_stop:
                    travel_sec = self.gtfs.get_travel_time(current_trip, current_node, next_stop)
                    if travel_sec and travel_sec > 0:
                        arrival = current_time + timedelta(seconds=travel_sec)
                        new_state = State(
                            time=arrival, node_id=next_stop, trip_id=current_trip,
                            route_id=current_state.route_id,
                            route_short_name=current_state.route_short_name,
                            predecessor=current_state, edge_type='transit',
                            from_stop_id=current_node, to_stop_id=next_stop,
                            transfers=transfers
                        )
                        key = (next_stop, current_trip, transfers)
                        if key not in best_times or best_times[key] > arrival:
                            best_times[key] = arrival
                            heapq.heappush(pq, (arrival, next_stop, counter, current_trip, transfers, new_state))
                            counter += 1
                
                # Alight here (transfer)
                if transfers < max_transfers:
                    alight_time = current_time + timedelta(seconds=self.walking_transfer_time)
                    alight_state = State(
                        time=alight_time, node_id=current_node, trip_id=None,
                        transfers=transfers,
                        predecessor=current_state, edge_type='alight',
                        from_stop_id=current_node, to_stop_id=None
                    )
                    key = (current_node, None, transfers)
                    if key not in best_times or best_times[key] > alight_time:
                        best_times[key] = alight_time
                        heapq.heappush(pq, (alight_time, current_node, counter, None, transfers, alight_state))
                        counter += 1
            
            # BOARD: from waiting at stop, board a new bus
            if current_trip is None:
                departures = self.gtfs.get_next_departure(current_node, current_time, time_window_minutes)
                for dep_time, trip_id, next_stop in departures[:10]:  # Limit to 10 departures
                    travel_sec = self.gtfs.get_travel_time(trip_id, current_node, next_stop)
                    if not travel_sec or travel_sec <= 0:
                        continue
                    
                    trip = self.gtfs.trips.get(trip_id)
                    route_id = trip.route_id if trip else None
                    route_info = self._route_info.get(route_id, {})
                    
                    arrival = dep_time + timedelta(seconds=travel_sec)
                    new_transfers = transfers + 1
                    if new_transfers > max_transfers:
                        continue
                    
                    new_state = State(
                        time=arrival, node_id=next_stop, trip_id=trip_id,
                        route_id=route_id,
                        route_short_name=route_info.get('route_short_name', ''),
                        predecessor=current_state, edge_type='transit',
                        from_stop_id=current_node, to_stop_id=next_stop,
                        transfers=new_transfers
                    )
                    
                    key = (next_stop, trip_id, new_transfers)
                    if key not in best_times or best_times[key] > arrival:
                        best_times[key] = arrival
                        heapq.heappush(pq, (arrival, next_stop, counter, trip_id, new_transfers, new_state))
                        counter += 1
        
        if not goal_states:
            logger.warning("No transit routes found")
            return None
        
        # Sort and deduplicate
        goal_states.sort(key=lambda x: x[0])
        unique_routes = self._deduplicate_routes(goal_states, num_alternatives)
        
        # Build routes
        routes = []
        for idx, (total_time, final_state, end_stop, final_walk_sec) in enumerate(unique_routes):
            steps = self._build_steps_with_shapes(final_state, end_stop, start_lat, start_lon, end_lat, end_lon)
            if not steps:
                continue
            
            total_seconds = int((total_time - start_time).total_seconds())
            total_distance = sum(s.get('distance_meters', 0) for s in steps)
            walk_dist = sum(s.get('distance_meters', 0) for s in steps if s['type'] == 'walk')
            transit_dist = total_distance - walk_dist
            
            route_summary = self._get_route_summary(steps)
            route_ids_used = [s.get('route_short_name') for s in steps if s['type'] == 'transit' and s.get('route_short_name')]
            
            routes.append({
                'route_index': idx,
                'total_time_seconds': total_seconds,
                'total_time_minutes': total_seconds / 60,
                'total_distance_meters': round(total_distance),
                'walk_distance_meters': round(walk_dist),
                'transit_distance_meters': round(transit_dist),
                'num_transfers': len([s for s in steps if s['type'] == 'transit']) - 1,
                'arrival_time': total_time.isoformat(),
                'start_time': start_time.isoformat(),
                'route_summary': route_summary,
                'steps': steps,
                'start_location': {'lat': start_lat, 'lon': start_lon},
                'end_location': {'lat': end_lat, 'lon': end_lon},
                'route_ids_used': route_ids_used,
            })
        
        return routes if routes else None
    
    def _deduplicate_routes(self, goal_states: List, max_routes: int) -> List:
        """Keep only routes with unique sequence of route_ids"""
        unique = []
        seen_sequences = set()
        for total_time, final_state, end_stop, walk_sec in goal_states:
            seq = []
            s = final_state
            while s:
                if s.edge_type == 'transit' and s.route_short_name:
                    seq.append(s.route_short_name)
                s = s.predecessor
            seq_tuple = tuple(reversed(seq))
            if seq_tuple not in seen_sequences:
                seen_sequences.add(seq_tuple)
                unique.append((total_time, final_state, end_stop, walk_sec))
                if len(unique) >= max_routes:
                    break
        return unique
    
    def _get_route_summary(self, steps: List[Dict]) -> str:
        """Generate human-readable route summary"""
        parts = []
        for step in steps:
            if step['type'] == 'walk':
                parts.append('Walk')
            elif step['type'] == 'transit':
                rn = step.get('route_short_name', '')
                parts.append(f"Bus {rn}" if rn else 'Bus')
        if not parts:
            return ''
        collapsed = [parts[0]]
        for p in parts[1:]:
            if p != collapsed[-1]:
                collapsed.append(p)
        return ' → '.join(collapsed)
    
    def _build_steps_with_shapes(self, final_state: State, end_stop: Stop,
                                 start_lat: float, start_lon: float,
                                 end_lat: float, end_lon: float) -> List[Dict]:
        """Build step-by-step directions with shape geometry"""
        # Collect states in forward order
        states = []
        s = final_state
        while s:
            states.insert(0, s)
            s = s.predecessor
        
        steps = []
        
        # Initial walk
        first_transit = next((st for st in states if st.edge_type == 'transit'), None)
        if first_transit and first_transit.from_stop_id:
            first_stop = self.gtfs.stops.get(first_transit.from_stop_id)
            if first_stop:
                routed_pts = self._route_walking_leg(start_lat, start_lon, first_stop.lat, first_stop.lon)
                distance_m = self._path_distance(routed_pts)
                steps.append({
                    'type': 'walk',
                    'from_location': {'lat': start_lat, 'lon': start_lon},
                    'to_stop': self.gtfs.get_stop_name(first_stop.stop_id),
                    'to_stop_id': first_stop.stop_id,
                    'to_location': {'lat': first_stop.lat, 'lon': first_stop.lon},
                    'distance_meters': round(distance_m),
                    'duration_seconds': round(distance_m / self.walking_speed),
                    'path_geometry': [[lat, lon] for lat, lon in routed_pts]
                })
        
        # Process transit legs and transfer walks
        i = 0
        while i < len(states):
            state = states[i]
            if state.edge_type == 'transit':
                trip_id = state.trip_id
                run = []
                while i < len(states) and states[i].edge_type == 'transit' and states[i].trip_id == trip_id:
                    run.append(states[i])
                    i += 1
                
                from_stop_id = run[0].from_stop_id
                to_stop_id = run[-1].to_stop_id
                from_stop = self.gtfs.stops.get(from_stop_id)
                to_stop = self.gtfs.stops.get(to_stop_id)
                
                if from_stop and to_stop:
                    shape_path = self._get_shape_path(trip_id, from_stop_id, to_stop_id)
                    route_id = self._trip_to_route.get(trip_id, '')
                    route_info = self._route_info.get(route_id, {})
                    
                    trip_stop_list = self._trip_stop_cache.get(trip_id, [])
                    start_seq = next((seq for sid, seq in trip_stop_list if sid == from_stop_id), 0)
                    end_seq = next((seq for sid, seq in trip_stop_list if sid == to_stop_id), 0)
                    num_stops = abs(end_seq - start_seq)
                    
                    step = {
                        'type': 'transit',
                        'route_short_name': route_info.get('route_short_name', ''),
                        'route_long_name': route_info.get('route_long_name', '').title(),
                        'trip_id': trip_id,
                        'start_stop': self.gtfs.get_stop_name(from_stop_id),
                        'start_stop_id': from_stop_id,
                        'start_location': {'lat': from_stop.lat, 'lon': from_stop.lon},
                        'end_stop': self.gtfs.get_stop_name(to_stop_id),
                        'end_stop_id': to_stop_id,
                        'end_location': {'lat': to_stop.lat, 'lon': to_stop.lon},
                        'num_stops': num_stops,
                    }
                    
                    if shape_path:
                        step['path_geometry'] = [[lat, lon] for lat, lon in shape_path]
                    else:
                        step['path_geometry'] = [[from_stop.lat, from_stop.lon], [to_stop.lat, to_stop.lon]]
                    
                    steps.append(step)
            
            elif state.edge_type == 'alight':
                next_transit = next((states[j] for j in range(i+1, len(states)) if states[j].edge_type == 'transit'), None)
                if next_transit and next_transit.from_stop_id:
                    from_stop = self.gtfs.stops.get(state.node_id)
                    to_stop = self.gtfs.stops.get(next_transit.from_stop_id)
                    if from_stop and to_stop and from_stop.stop_id != to_stop.stop_id:
                        routed_pts = self._route_walking_leg(from_stop.lat, from_stop.lon, to_stop.lat, to_stop.lon)
                        distance_m = self._path_distance(routed_pts)
                        steps.append({
                            'type': 'walk',
                            'from_stop': self.gtfs.get_stop_name(from_stop.stop_id),
                            'to_stop': self.gtfs.get_stop_name(to_stop.stop_id),
                            'from_location': {'lat': from_stop.lat, 'lon': from_stop.lon},
                            'to_location': {'lat': to_stop.lat, 'lon': to_stop.lon},
                            'distance_meters': round(distance_m),
                            'duration_seconds': round(distance_m / self.walking_speed),
                            'path_geometry': [[lat, lon] for lat, lon in routed_pts]
                        })
                i += 1
            else:
                i += 1
        
        # Final walk
        last_transit = next((st for st in reversed(states) if st.edge_type == 'transit'), None)
        if last_transit and last_transit.to_stop_id:
            last_stop = self.gtfs.stops.get(last_transit.to_stop_id)
            if last_stop:
                routed_pts = self._route_walking_leg(last_stop.lat, last_stop.lon, end_lat, end_lon)
                distance_m = self._path_distance(routed_pts)
                steps.append({
                    'type': 'walk',
                    'from_stop': self.gtfs.get_stop_name(last_stop.stop_id),
                    'from_location': {'lat': last_stop.lat, 'lon': last_stop.lon},
                    'to_stop': 'Your Destination',
                    'to_location': {'lat': end_lat, 'lon': end_lon},
                    'distance_meters': round(distance_m),
                    'duration_seconds': round(distance_m / self.walking_speed),
                    'path_geometry': [[lat, lon] for lat, lon in routed_pts]
                })
        
        return steps