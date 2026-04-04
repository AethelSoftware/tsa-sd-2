"""
Transit Router using GTFS data with shape-based geometry
Supports multiple alternatives, walking legs, transfers, and progressive stop discovery.
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
        self.gtfs = GTFSLoader(gtfs_zip_path)
        self.walking_speed = walking_speed_mps
        self.walking_transfer_time = 120  # seconds to transfer between buses
        
        # Load shapes from GTFS
        self.shapes: Dict[str, List[Tuple[float, float]]] = {}
        self.trip_to_shape: Dict[str, str] = {}
        self._load_shapes()
        
        # Load route info
        self._route_info: Dict[str, Dict] = {}
        self._trip_to_route: Dict[str, str] = {}
        self._load_routes()
        
        # Trip stop cache
        self._trip_stop_cache: Dict[str, List[Tuple[str, int]]] = {}
        self._build_trip_cache()
        
        # Cache for walking route results
        self._walk_route_cache: Dict[str, List[Tuple[float, float]]] = {}
    
    def _load_shapes(self):
        """Load shapes.txt for bus route geometry"""
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
                else:
                    logger.warning("No shapes.txt found - routes will be straight lines")
        except Exception as e:
            logger.warning(f"Error loading shapes: {e}")
    
    def _get_shape_path(self, trip_id: str, from_stop_id: str, to_stop_id: str) -> List[Tuple[float, float]]:
        """Get shape points between two stops - FAST (no API calls)"""
        shape_id = self.trip_to_shape.get(trip_id)
        if not shape_id or shape_id not in self.shapes:
            return []
        
        shape = self.shapes[shape_id]
        from_stop = self.gtfs.stops.get(from_stop_id)
        to_stop = self.gtfs.stops.get(to_stop_id)
        
        if not from_stop or not to_stop:
            return []
        
        # Find closest points on shape
        from_idx, to_idx = -1, -1
        min_from, min_to = float('inf'), float('inf')
        
        for i, (lat, lon) in enumerate(shape):
            d_from = self._haversine(from_stop.lat, from_stop.lon, lat, lon)
            d_to = self._haversine(to_stop.lat, to_stop.lon, lat, lon)
            if d_from < min_from:
                min_from, from_idx = d_from, i
            if d_to < min_to:
                min_to, to_idx = d_to, i
        
        if from_idx >= 0 and to_idx >= 0:
            if from_idx <= to_idx:
                return shape[from_idx:to_idx + 1]
            else:
                return shape[to_idx:from_idx + 1][::-1]
        return []
    
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
        """Calculate distance between two points in meters using Haversine formula"""
        R = 6371000  # Earth radius in meters
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlam = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    def _path_distance(self, pts: List[Tuple[float, float]]) -> float:
        """Sum of haversine distances along a path."""
        total = 0.0
        for i in range(len(pts) - 1):
            total += self._haversine(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1])
        return total
    
    def _decode_tomtom_polyline(self, encoded: str) -> List[Tuple[float, float]]:
        """Decode Google/TomTom encoded polyline to (lat, lon) tuples."""
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
    
    def _route_walking_leg(self, from_lat: float, from_lon: float,
                           to_lat: float, to_lon: float) -> List[Tuple[float, float]]:
        """
        Get real pedestrian route between two points using road network.
        Tries TomTom first, then OSRM public demo, then straight line fallback.
        Returns list of (lat, lon) tuples.
        """
        # Cache check
        cache_key = f"{from_lat:.5f},{from_lon:.5f}|{to_lat:.5f},{to_lon:.5f}"
        if cache_key in self._walk_route_cache:
            return self._walk_route_cache[cache_key]
        
        straight_dist = self._haversine(from_lat, from_lon, to_lat, to_lon)
        
        # Very short legs (< 50m) are fine as straight line
        if straight_dist < 50:
            pts = [(from_lat, from_lon), (to_lat, to_lon)]
            self._walk_route_cache[cache_key] = pts
            return pts
        
        # ── ATTEMPT 1: TomTom pedestrian routing ──────────────────────────────────
        tomtom_key = os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')
        if tomtom_key:
            try:
                url = (
                    f"https://api.tomtom.com/routing/1/calculateRoute/"
                    f"{from_lat},{from_lon}:{to_lat},{to_lon}/json"
                )
                params = {
                    'key': tomtom_key,
                    'travelMode': 'pedestrian',
                    'routeRepresentation': 'polyline',
                    'computeTravelTimeFor': 'none',
                }
                resp = requests.get(url, params=params, timeout=8)
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
                                routed_dist = self._path_distance(pts)
                                logger.info(f"TomTom walk leg: {len(pts)} pts, straight {straight_dist:.0f}m → routed {routed_dist:.0f}m")
                                self._walk_route_cache[cache_key] = pts
                                return pts
            except Exception as e:
                logger.warning(f"TomTom walk routing failed: {e}")
        
        # ── ATTEMPT 2: OSRM public demo (free, OpenStreetMap-based) ──────────────
        try:
            # OSRM uses lng,lat order (NOT lat,lng!)
            osrm_url = (
                f"https://router.project-osrm.org/route/v1/foot/"
                f"{from_lon},{from_lat};{to_lon},{to_lat}"
            )
            params = {
                'overview': 'full',
                'geometries': 'geojson'
            }
            headers = {'User-Agent': 'TryverSafetyApp/1.0 (Pittsburgh Transit Routing)'}
            resp = requests.get(osrm_url, params=params, headers=headers, timeout=8)
            if resp.status_code == 200:
                data = resp.json()
                routes = data.get('routes', [])
                if routes:
                    # GeoJSON coordinates are [lon, lat] — must flip to (lat, lon)
                    coords = routes[0]['geometry']['coordinates']
                    pts = [(c[1], c[0]) for c in coords]  # flip lon,lat → lat,lon
                    if len(pts) >= 2:
                        routed_dist = self._path_distance(pts)
                        logger.info(f"OSRM walk leg: {len(pts)} pts, straight {straight_dist:.0f}m → routed {routed_dist:.0f}m")
                        self._walk_route_cache[cache_key] = pts
                        return pts
        except Exception as e:
            logger.warning(f"OSRM walk routing failed: {e}")
        
        # ── FALLBACK: Straight line ───────────────────────────────────────────────
        # Log a warning if the straight line is likely to cross water (heuristic)
        ALLEGHENY_RIVER_LAT = (40.443, 40.448)  # rough lat band for river crossing
        crosses_allegheny = (
            (min(from_lat, to_lat) < ALLEGHENY_RIVER_LAT[0] and
             max(from_lat, to_lat) > ALLEGHENY_RIVER_LAT[1])
        )
        if straight_dist > 300 and crosses_allegheny:
            logger.error(
                f"WALK LEG FALLBACK MAY CROSS RIVER: {from_lat},{from_lon} → {to_lat},{to_lon} "
                f"({straight_dist:.0f}m straight). Both routing APIs failed. "
                "Walking segment will show as straight line — consider adding a bridge waypoint."
            )
        elif straight_dist > 300:
            logger.warning(f"Walk leg fallback to straight line: {straight_dist:.0f}m. Both APIs failed.")
        
        pts = [(from_lat, from_lon), (to_lat, to_lon)]
        self._walk_route_cache[cache_key] = pts
        return pts
    
    def _find_stops_with_expansion(self, lat: float, lon: float, initial_radius: float = 800) -> List[Tuple[Stop, float]]:
        """Find stops with progressive radius expansion for suburban areas"""
        for radius in [initial_radius, 1500, 3000, 5000, 8000]:
            stops = self.gtfs.find_nearby_stops(lat, lon, radius)
            if stops:
                logger.info(f"Found {len(stops)} stops within {radius}m")
                return stops
        return []
    
    def find_route(self,
                   start_lat: float, start_lon: float,
                   end_lat: float, end_lon: float,
                   start_time: datetime,
                   max_walk_distance: float = 800,
                   max_transfers: int = 4,
                   time_window_minutes: int = 120,
                   num_alternatives: int = 3) -> Optional[List[Dict]]:
        """
        Find transit routes between two points
        
        Returns:
            List of route dicts (best first), or None if no route found
        """
        logger.info(f"Transit routing from ({start_lat:.4f},{start_lon:.4f}) to ({end_lat:.4f},{end_lon:.4f})")
        
        # Find start and end stops with progressive radius expansion
        start_stops = self._find_stops_with_expansion(start_lat, start_lon, max_walk_distance)
        end_stops = self._find_stops_with_expansion(end_lat, end_lon, max_walk_distance)
        
        if not start_stops:
            logger.warning("No stops found near origin within 8km")
            return None
        if not end_stops:
            logger.warning("No stops found near destination within 8km")
            return None
        
        # Priority queue for Dijkstra
        pq = []
        best_times = {}  # key: (stop_id, trip_id, transfers)
        counter = 0      # monotonic counter to avoid comparing None trip_id
        
        # Push initial walking states from origin to each start stop
        for stop, distance in start_stops:
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
        
        # Dijkstra with multi-goal collection
        goal_states = []  # (total_time, final_state, end_stop, final_walk_seconds)
        iterations = 0
        EXTRA_BUDGET = 15000  # Continue searching after first goal to find alternatives
        
        while pq and (not goal_states or iterations < EXTRA_BUDGET):
            iterations += 1
            current_time, current_node, _, current_trip, transfers, current_state = heapq.heappop(pq)
            
            # Check if reached destination
            for end_stop, end_dist in end_stops:
                if current_node == end_stop.stop_id:
                    walk_time = end_dist / self.walking_speed
                    total_time = current_time + timedelta(seconds=walk_time)
                    goal_states.append((total_time, current_state, end_stop, walk_time))
                    # Continue to find alternatives
            
            if transfers > max_transfers:
                continue
            
            # ALIGHT: from transit to waiting at stop (enables transfers)
            if current_trip is not None:
                # Option 1: Stay on same bus
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
                
                # Option 2: Alight here and wait (transfer point)
                if transfers < max_transfers:
                    alight_time = current_time + timedelta(seconds=self.walking_transfer_time)
                    alight_state = State(
                        time=alight_time, node_id=current_node, trip_id=None,
                        transfers=transfers,  # Transfer counted when boarding next bus
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
                for dep_time, trip_id, next_stop in departures[:20]:
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
        
        # Sort and deduplicate routes
        goal_states.sort(key=lambda x: x[0])  # earliest first
        unique_routes = self._deduplicate_routes(goal_states, num_alternatives)
        
        # Build detailed step lists for each alternative
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
        """Keep only routes with unique sequence of route_ids (bus lines)"""
        unique = []
        seen_sequences = set()
        for total_time, final_state, end_stop, walk_sec in goal_states:
            # Extract route sequence from state chain
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
        # Collapse consecutive identical parts
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
        """Build step-by-step directions with shape geometry for map display"""
        # Collect states in forward order
        states = []
        s = final_state
        while s:
            states.insert(0, s)
            s = s.predecessor
        
        steps = []
        
        # Initial walk: origin -> first boarded stop
        first_transit = next((st for st in states if st.edge_type == 'transit'), None)
        if first_transit and first_transit.from_stop_id:
            first_stop = self.gtfs.stops.get(first_transit.from_stop_id)
            if first_stop:
                # Get routed path instead of straight line
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
                # Collect consecutive transit states on same trip
                run = []
                while i < len(states) and states[i].edge_type == 'transit' and states[i].trip_id == trip_id:
                    run.append(states[i])
                    i += 1
                
                from_stop_id = run[0].from_stop_id
                to_stop_id = run[-1].to_stop_id
                from_stop = self.gtfs.stops.get(from_stop_id)
                to_stop = self.gtfs.stops.get(to_stop_id)
                
                if not from_stop or not to_stop:
                    continue
                
                # Get shape geometry for entire leg
                shape_path = self._get_shape_path(trip_id, from_stop_id, to_stop_id)
                
                # Route info
                route_id = self._trip_to_route.get(trip_id, '')
                route_info = self._route_info.get(route_id, {})
                
                # Count intermediate stops
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
                elif from_stop and to_stop:
                    step['path_geometry'] = [[from_stop.lat, from_stop.lon], [to_stop.lat, to_stop.lon]]
                
                steps.append(step)
            
            elif state.edge_type == 'alight':
                # Transfer walk: from alight stop to next boarding stop
                next_transit = next((states[j] for j in range(i+1, len(states)) if states[j].edge_type == 'transit'), None)
                if next_transit and next_transit.from_stop_id:
                    from_stop = self.gtfs.stops.get(state.node_id)
                    to_stop = self.gtfs.stops.get(next_transit.from_stop_id)
                    if from_stop and to_stop and from_stop.stop_id != to_stop.stop_id:
                        # Get routed path instead of straight line
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
        
        # Final walk: last alighted stop -> destination
        last_transit = next((st for st in reversed(states) if st.edge_type == 'transit'), None)
        if last_transit and last_transit.to_stop_id:
            last_stop = self.gtfs.stops.get(last_transit.to_stop_id)
            if last_stop:
                # Get routed path instead of straight line
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