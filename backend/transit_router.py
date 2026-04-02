"""
Transit Router using GTFS data with shape-based geometry
Fast - uses shapes.txt for bus route paths
"""

from typing import List, Dict, Tuple, Optional
from datetime import datetime, timedelta
import heapq
import logging
from dataclasses import dataclass, field
from gtfs_loader import GTFSLoader, Stop
import math
import zipfile
import pandas as pd

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

class TransitRouter:
    def __init__(self, gtfs_zip_path: str, walking_speed_mps: float = 1.4):
        self.gtfs = GTFSLoader(gtfs_zip_path)
        self.gtfs_zip_path = gtfs_zip_path
        self.walking_speed = walking_speed_mps
        self.walking_transfer_time = 120
        
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
        self._stop_transfer_cache: Dict[str, List[Tuple[str, float]]] = {}
    
    def _load_shapes(self):
        """Load shapes.txt for bus route geometry"""
        try:
            with zipfile.ZipFile(self.gtfs_zip_path, 'r') as z:
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
            with zipfile.ZipFile(self.gtfs_zip_path, 'r') as z:
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
        for trip_id, stop_times in self.gtfs.stop_times.items():
            self._trip_stop_cache[trip_id] = [(st.stop_id, st.stop_sequence) for st in stop_times]
        logger.info(f"Cached {len(self._trip_stop_cache)} trips")
    
    def _get_next_stop(self, trip_id: str, current_stop_id: str) -> Optional[str]:
        stops = self._trip_stop_cache.get(trip_id, [])
        for i, (stop_id, _) in enumerate(stops):
            if stop_id == current_stop_id and i + 1 < len(stops):
                return stops[i + 1][0]
        return None
    
    def _get_stop_name(self, stop_id: str) -> str:
        stop = self.gtfs.stops.get(stop_id)
        if stop and stop.name:
            name = stop.name
            if ' + ' in name:
                name = name.split(' + ')[0]
            return name
        return f"Stop {stop_id[:8]}"
    
    def _haversine(self, lat1, lon1, lat2, lon2):
        R = 6371000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlam = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    def find_route(self, start_lat: float, start_lon: float,
                   end_lat: float, end_lon: float,
                   start_time: datetime,
                   max_walk_distance: float = 500,
                   max_transfers: int = 3,
                   time_window_minutes: int = 60) -> Optional[Dict]:
        
        logger.info(f"TRANSIT ROUTE: ({start_lat:.4f}, {start_lon:.4f}) to ({end_lat:.4f}, {end_lon:.4f})")
        
        # Find nearby stops
        start_stops = self.gtfs.find_nearby_stops(start_lat, start_lon, max_walk_distance)
        end_stops = self.gtfs.find_nearby_stops(end_lat, end_lon, max_walk_distance)
        
        if not start_stops:
            logger.warning("No stops near start")
            return None
        
        # Priority queue
        pq = []
        best_times = {}
        
        for stop, distance in start_stops:
            walk_time = distance / self.walking_speed
            arrival = start_time + timedelta(seconds=walk_time)
            state = State(
                time=arrival, node_id=stop.stop_id, trip_id=None,
                route_id=None, route_short_name=None, predecessor=None,
                edge_type='walk', from_stop_id=None, to_stop_id=None
            )
            key = (stop.stop_id, None)
            best_times[key] = arrival
            heapq.heappush(pq, (arrival, stop.stop_id, None, 0, state))
        
        # Dijkstra
        goal_states = []
        iterations = 0
        
        while pq and iterations < 20000:
            iterations += 1
            current_time, current_node, current_trip, transfers, current_state = heapq.heappop(pq)
            
            # Check if reached destination
            for end_stop, end_dist in end_stops:
                if current_node == end_stop.stop_id:
                    walk_time = end_dist / self.walking_speed
                    total_time = current_time + timedelta(seconds=walk_time)
                    goal_states.append((total_time, current_state, end_stop))
                    break
            
            if transfers >= max_transfers:
                continue
            
            # If at a stop, try boarding a bus
            if current_trip is None:
                departures = self.gtfs.get_next_departure(current_node, current_time, time_window_minutes)
                
                for dep_time, trip_id, next_stop in departures[:15]:
                    travel_sec = self.gtfs.get_travel_time(trip_id, current_node, next_stop)
                    if not travel_sec or travel_sec <= 0:
                        continue
                    
                    trip = self.gtfs.trips.get(trip_id)
                    route_id = trip.route_id if trip else None
                    route_info = self._route_info.get(route_id, {})
                    
                    arrival = dep_time + timedelta(seconds=travel_sec)
                    
                    new_state = State(
                        time=arrival, node_id=next_stop, trip_id=trip_id,
                        route_id=route_id,
                        route_short_name=route_info.get('route_short_name', ''),
                        predecessor=current_state, edge_type='transit',
                        from_stop_id=current_node, to_stop_id=next_stop
                    )
                    
                    key = (next_stop, trip_id)
                    if key not in best_times or best_times[key] > arrival:
                        best_times[key] = arrival
                        heapq.heappush(pq, (arrival, next_stop, trip_id, transfers + 1, new_state))
            
            # Continue on same bus
            if current_trip is not None:
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
                            from_stop_id=current_node, to_stop_id=next_stop
                        )
                        
                        key = (next_stop, current_trip)
                        if key not in best_times or best_times[key] > arrival:
                            best_times[key] = arrival
                            heapq.heappush(pq, (arrival, next_stop, current_trip, transfers, new_state))
        
        if not goal_states:
            logger.warning("No transit route found")
            return None
        
        # Build the route with shape geometry
        best_goal = min(goal_states, key=lambda x: x[0])
        steps = self._build_steps_with_shapes(best_goal[1], best_goal[2], end_lat, end_lon)
        
        total_seconds = (best_goal[0] - start_time).total_seconds()
        
        return {
            'total_time_seconds': total_seconds,
            'total_time_minutes': total_seconds / 60,
            'arrival_time': best_goal[0].isoformat(),
            'start_time': start_time.isoformat(),
            'steps': steps,
            'start_location': {'lat': start_lat, 'lon': start_lon},
            'end_location': {'lat': end_lat, 'lon': end_lon}
        }
    
    def _build_steps_with_shapes(self, final_state: State, end_stop: Stop, end_lat: float, end_lon: float) -> List[Dict]:
        """Build steps with shape geometry from shapes.txt"""
        # Collect states in order
        states = []
        state = final_state
        while state:
            states.insert(0, state)
            state = state.predecessor
        
        # Build path with geometry
        steps = []
        for i, state in enumerate(states):
            if state.edge_type == 'walk':
                if i == 0:
                    # First walk - from start to first bus stop
                    steps.append({
                        'type': 'walk',
                        'to_stop': self._get_stop_name(state.node_id),
                        'to_stop_id': state.node_id,
                        'to_location': {'lat': self.gtfs.stops[state.node_id].lat, 'lon': self.gtfs.stops[state.node_id].lon}
                    })
                elif i == len(states) - 1:
                    # Last walk - from last bus stop to destination - skip, handled separately
                    pass
                else:
                    # Transfer walk
                    steps.append({
                        'type': 'walk',
                        'to_stop': self._get_stop_name(state.node_id),
                        'to_stop_id': state.node_id,
                        'to_location': {'lat': self.gtfs.stops[state.node_id].lat, 'lon': self.gtfs.stops[state.node_id].lon}
                    })
            
            elif state.edge_type == 'transit':
                # Get shape geometry from shapes.txt
                shape_path = self._get_shape_path(state.trip_id, state.from_stop_id, state.to_stop_id)
                
                step = {
                    'type': 'transit',
                    'route_short_name': state.route_short_name,
                    'trip_id': state.trip_id,
                    'start_stop': self._get_stop_name(state.from_stop_id),
                    'start_stop_id': state.from_stop_id,
                    'start_location': {'lat': self.gtfs.stops[state.from_stop_id].lat, 'lon': self.gtfs.stops[state.from_stop_id].lon},
                    'end_stop': self._get_stop_name(state.to_stop_id),
                    'end_stop_id': state.to_stop_id,
                    'end_location': {'lat': self.gtfs.stops[state.to_stop_id].lat, 'lon': self.gtfs.stops[state.to_stop_id].lon},
                }
                
                # Add the shape geometry for drawing!
                if shape_path:
                    step['path_geometry'] = [[lat, lon] for lat, lon in shape_path]
                    logger.info(f"Added shape geometry for {state.route_short_name}: {len(shape_path)} points")
                
                steps.append(step)
        
        # Add final walk to destination
        steps.append({
            'type': 'walk',
            'to_stop': 'Destination',
            'to_location': {'lat': end_lat, 'lon': end_lon}
        })
        
        return steps