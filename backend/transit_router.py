"""
Transit Router using GTFS data with time-dependent graph
Implements time-dependent Dijkstra for transit routing
"""

from typing import List, Dict, Tuple, Optional
from datetime import datetime, timedelta
import heapq
import logging
from dataclasses import dataclass, field
from gtfs_loader import GTFSLoader, Stop
import math

logger = logging.getLogger(__name__)

@dataclass(order=True)
class State:
    """State for time-dependent Dijkstra"""
    time: datetime
    node_id: str
    trip_id: Optional[str] = field(compare=False, default=None)
    route_id: Optional[str] = field(compare=False, default=None)
    route_short_name: Optional[str] = field(compare=False, default=None)  # User-friendly route name
    route_long_name: Optional[str] = field(compare=False, default=None)
    predecessor: Optional['State'] = field(compare=False, default=None)
    edge_type: str = field(compare=False, default='walk')
    stop_sequence: int = field(compare=False, default=-1)

class TransitRouter:
    def __init__(self, gtfs_zip_path: str, walking_speed_mps: float = 1.4):
        self.gtfs = GTFSLoader(gtfs_zip_path)
        self.walking_speed = walking_speed_mps
        self.walking_transfer_time = 120
        
        # Build route information cache
        self._route_info: Dict[str, Dict] = {}
        self._trip_to_route: Dict[str, str] = {}  # trip_id -> route_id
        self._build_route_cache()
        
        # Build caches
        self._trip_stop_cache: Dict[str, List[Tuple[str, int]]] = {}
        self._build_trip_cache()
        self._stop_transfer_cache: Dict[str, List[Tuple[str, float]]] = {}
        
    def _build_route_cache(self):
        """Build cache of route information from routes.txt"""
        import zipfile
        import pandas as pd
        
        try:
            with zipfile.ZipFile(self.gtfs.gtfs_zip_path, 'r') as z:
                with z.open('routes.txt') as f:
                    routes_df = pd.read_csv(f, dtype=str)
                    for _, row in routes_df.iterrows():
                        route_id = self.gtfs._safe_str(row.get('route_id', ''))
                        if route_id:
                            self._route_info[route_id] = {
                                'route_id': route_id,
                                'route_short_name': self.gtfs._safe_str(row.get('route_short_name', '')),
                                'route_long_name': self.gtfs._safe_str(row.get('route_long_name', '')),
                                'route_type': self.gtfs._safe_str(row.get('route_type', '3')),
                                'route_color': self.gtfs._safe_str(row.get('route_color', '')),
                                'route_text_color': self.gtfs._safe_str(row.get('route_text_color', ''))
                            }
            logger.info(f"Loaded {len(self._route_info)} routes")
        except Exception as e:
            logger.warning(f"Could not load routes.txt: {e}")
        
        # Build trip to route mapping
        for trip_id, trip in self.gtfs.trips.items():
            if trip.route_id:
                self._trip_to_route[trip_id] = trip.route_id
    
    def _get_route_name(self, route_id: str) -> str:
        """Get user-friendly route name"""
        if route_id in self._route_info:
            route = self._route_info[route_id]
            short_name = route.get('route_short_name', '')
            long_name = route.get('route_long_name', '')
            
            if short_name:
                return short_name
            elif long_name:
                return long_name[:30]
        return f"Route {route_id[:8]}"  # Fallback
    
    def _get_route_display(self, route_id: str) -> Dict:
        """Get complete route display info"""
        if route_id in self._route_info:
            return self._route_info[route_id]
        return {
            'route_short_name': f"Route {route_id[:8]}",
            'route_long_name': '',
            'route_color': '888888',
            'route_text_color': 'FFFFFF'
        }
    
    def _build_trip_cache(self):
        """Build cache of trip stop sequences"""
        logger.info("Building trip cache...")
        for trip_id, stop_times in self.gtfs.stop_times.items():
            self._trip_stop_cache[trip_id] = [
                (st.stop_id, st.stop_sequence) for st in stop_times
            ]
        logger.info(f"Cached {len(self._trip_stop_cache)} trips")
    
    def _get_next_stop_in_trip(self, trip_id: str, current_stop_id: str) -> Optional[str]:
        """Get the next stop in a trip"""
        if trip_id not in self._trip_stop_cache:
            return None
        stops = self._trip_stop_cache[trip_id]
        for i, (stop_id, _) in enumerate(stops):
            if stop_id == current_stop_id and i + 1 < len(stops):
                return stops[i + 1][0]
        return None
    
    def _get_stop_name(self, stop_id: str) -> str:
        """Get user-friendly stop name"""
        if stop_id in self.gtfs.stops:
            stop = self.gtfs.stops[stop_id]
            if stop.name and stop.name != 'Unknown':
                # Clean up stop names - remove common suffixes
                name = stop.name
                # Remove " + " patterns (like "FREEPORT RD + #2238")
                if ' + ' in name:
                    name = name.split(' + ')[0]
                # Remove " at " patterns
                if ' at ' in name:
                    name = name.split(' at ')[0]
                return name
        return f"Stop {stop_id[:8]}"
    
    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6371000
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)
        a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    def find_route(self, start_lat: float, start_lon: float,
                   end_lat: float, end_lon: float,
                   start_time: datetime,
                   max_walk_distance: float = 800,
                   max_transfers: int = 3,
                   time_window_minutes: int = 60) -> Optional[Dict]:
        """
        Find the fastest transit route
        
        Args:
            time_window_minutes: Look for buses up to this many minutes after arrival at stop
        """
        
        logger.info(f"\n{'='*60}")
        logger.info(f"TRANSIT ROUTE SEARCH")
        logger.info(f"From: ({start_lat:.4f}, {start_lon:.4f})")
        logger.info(f"To: ({end_lat:.4f}, {end_lon:.4f})")
        logger.info(f"Departure: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info(f"Time window: {time_window_minutes} minutes")
        logger.info(f"{'='*60}")
        
        # Find nearby stops
        start_stops = self.gtfs.find_nearby_stops(start_lat, start_lon, max_walk_distance)
        end_stops = self.gtfs.find_nearby_stops(end_lat, end_lon, max_walk_distance)
        
        if not start_stops or not end_stops:
            logger.warning(f"No nearby stops found. Start: {len(start_stops)}, End: {len(end_stops)}")
            return None
        
        logger.info(f"\n📍 START STOPS (within {max_walk_distance}m):")
        for stop, dist in start_stops[:10]:
            stop_name = self._get_stop_name(stop.stop_id)
            logger.info(f"  • {stop_name} - {dist:.0f}m away")
        
        logger.info(f"\n📍 DESTINATION STOPS:")
        for stop, dist in end_stops[:10]:
            stop_name = self._get_stop_name(stop.stop_id)
            logger.info(f"  • {stop_name} - {dist:.0f}m away")
        
        # Check if any start stop has departures within the time window
        logger.info(f"\n🚌 CHECKING DEPARTURES FROM START STOPS (next {time_window_minutes} min):")
        for stop, _ in start_stops[:5]:
            departures = self.gtfs.get_next_departure(stop.stop_id, start_time, time_window_minutes)
            stop_name = self._get_stop_name(stop.stop_id)
            logger.info(f"  {stop_name}: {len(departures)} departures found")
            for dep_time, trip_id, next_stop in departures[:5]:
                route_id = self._trip_to_route.get(trip_id, '')
                route_name = self._get_route_name(route_id)
                next_stop_name = self._get_stop_name(next_stop)
                wait_minutes = int((dep_time - start_time).total_seconds() / 60)
                logger.info(f"    → {dep_time.strftime('%H:%M')} (wait {wait_minutes} min) - Bus {route_name} to {next_stop_name}")
        
        # Priority queue: (arrival_time, node_id, trip_id, transfers, state)
        pq = []
        best_times: Dict[Tuple[str, Optional[str]], datetime] = {}
        
        # Add initial walking states
        for stop, distance in start_stops:
            walk_time = distance / self.walking_speed
            arrival_time = start_time + timedelta(seconds=walk_time)
            
            state = State(
                time=arrival_time,
                node_id=stop.stop_id,
                trip_id=None,
                route_id=None,
                route_short_name=None,
                route_long_name=None,
                predecessor=None,
                edge_type='walk'
            )
            
            key = (stop.stop_id, None)
            if key not in best_times or best_times[key] > arrival_time:
                best_times[key] = arrival_time
                heapq.heappush(pq, (arrival_time, stop.stop_id, None, 0, state))
        
        # Run Dijkstra
        goal_states = []
        iterations = 0
        max_iterations = 50000
        
        logger.info(f"\n🔍 SEARCHING FOR ROUTE...")
        
        while pq and iterations < max_iterations:
            iterations += 1
            current_time, current_node, current_trip, transfers, current_state = heapq.heappop(pq)
            
            key = (current_node, current_trip)
            if key in best_times and best_times[key] < current_time:
                continue
            
            # Check if reached destination
            if current_node in [stop.stop_id for stop, _ in end_stops]:
                end_stop = self.gtfs.stops.get(current_node)
                walk_distance = min([dist for stop, dist in end_stops if stop.stop_id == current_node], default=0)
                walk_time = walk_distance / self.walking_speed
                arrival_time = current_time + timedelta(seconds=walk_time)
                goal_states.append((arrival_time, current_state))
                logger.info(f"✓ Found route to destination via {self._get_stop_name(current_node)}")
                if len(goal_states) >= 3:
                    break
            
            if transfers >= max_transfers:
                continue
            
            # TRANSFER: Walk to other stops
            if current_trip is None:
                current_stop = self.gtfs.stops.get(current_node)
                if current_stop:
                    if current_node not in self._stop_transfer_cache:
                        nearby = self.gtfs.find_nearby_stops(
                            current_stop.lat, current_stop.lon, max_walk_distance
                        )
                        self._stop_transfer_cache[current_node] = [
                            (other.stop_id, dist) for other, dist in nearby if other.stop_id != current_node
                        ]
                    
                    for other_stop_id, distance in self._stop_transfer_cache[current_node][:15]:
                        walk_time = max(distance / self.walking_speed, self.walking_transfer_time)
                        arrival_time = current_time + timedelta(seconds=walk_time)
                        
                        new_state = State(
                            time=arrival_time,
                            node_id=other_stop_id,
                            trip_id=None,
                            route_id=None,
                            route_short_name=None,
                            route_long_name=None,
                            predecessor=current_state,
                            edge_type='walk'
                        )
                        
                        key = (other_stop_id, None)
                        if key not in best_times or best_times[key] > arrival_time:
                            best_times[key] = arrival_time
                            heapq.heappush(pq, (arrival_time, other_stop_id, None, transfers, new_state))
            
            # BOARDING: Take transit - WITH TIME WINDOW
            if current_node in self.gtfs.stops:
                departures = self.gtfs.get_next_departure(current_node, current_time, time_window_minutes)
                
                for departure_time, trip_id, next_stop_id in departures[:12]:
                    travel_time = self.gtfs.get_travel_time(trip_id, current_node, next_stop_id)
                    
                    if travel_time is None or travel_time <= 0:
                        continue
                    
                    trip = self.gtfs.trips.get(trip_id)
                    route_id = trip.route_id if trip else None
                    route_info = self._get_route_display(route_id) if route_id else {}
                    
                    arrival_time = departure_time + timedelta(seconds=travel_time)
                    
                    new_state = State(
                        time=arrival_time,
                        node_id=next_stop_id,
                        trip_id=trip_id,
                        route_id=route_id,
                        route_short_name=route_info.get('route_short_name', ''),
                        route_long_name=route_info.get('route_long_name', ''),
                        predecessor=current_state,
                        edge_type='transit'
                    )
                    
                    key = (next_stop_id, trip_id)
                    if key not in best_times or best_times[key] > arrival_time:
                        best_times[key] = arrival_time
                        heapq.heappush(pq, (arrival_time, next_stop_id, trip_id, transfers + 1, new_state))
            
            # CONTINUE ON SAME TRIP
            if current_trip is not None:
                next_stop_id = self._get_next_stop_in_trip(current_trip, current_node)
                if next_stop_id:
                    travel_time = self.gtfs.get_travel_time(current_trip, current_node, next_stop_id)
                    if travel_time and travel_time > 0:
                        arrival_time = current_time + timedelta(seconds=travel_time)
                        
                        new_state = State(
                            time=arrival_time,
                            node_id=next_stop_id,
                            trip_id=current_trip,
                            route_id=current_state.route_id,
                            route_short_name=current_state.route_short_name,
                            route_long_name=current_state.route_long_name,
                            predecessor=current_state,
                            edge_type='transit'
                        )
                        
                        key = (next_stop_id, current_trip)
                        if key not in best_times or best_times[key] > arrival_time:
                            best_times[key] = arrival_time
                            heapq.heappush(pq, (arrival_time, next_stop_id, current_trip, transfers, new_state))
        
        logger.info(f"Search completed: {iterations} iterations, {len(goal_states)} routes found")
        
        if not goal_states:
            logger.warning("❌ No transit route found! Try increasing time_window_minutes or max_walk_distance")
            return None
        
        # Get best route
        best_goal = min(goal_states, key=lambda x: x[0])
        total_seconds = (best_goal[0] - start_time).total_seconds()
        
        # Reconstruct path
        path = self._reconstruct_path(best_goal[1])
        
        # Log the route details
        logger.info(f"\n✅ ROUTE FOUND!")
        logger.info(f"Total time: {total_seconds/60:.1f} minutes")
        logger.info(f"Steps:")
        for i, step in enumerate(path):
            if step['type'] == 'walk':
                if 'to_stop' in step and step['to_stop']:
                    logger.info(f"  {i+1}. 🚶 Walk to {step['to_stop']} stop")
                else:
                    logger.info(f"  {i+1}. 🚶 Walk")
            elif step['type'] == 'transit':
                route_name = step.get('route_short_name', step.get('route_id', 'Bus'))
                logger.info(f"  {i+1}. 🚌 Take Bus {route_name} from {step.get('start_stop', 'stop')} to {step.get('end_stop', 'next stop')}")
        
        return {
            'total_time_seconds': total_seconds,
            'total_time_minutes': total_seconds / 60,
            'arrival_time': best_goal[0].isoformat(),
            'start_time': start_time.isoformat(),
            'steps': path,
            'start_location': {'lat': start_lat, 'lon': start_lon},
            'end_location': {'lat': end_lat, 'lon': end_lon}
        }
    
    def _reconstruct_path(self, final_state: State) -> List[Dict]:
        path = []
        state = final_state
        
        while state is not None:
            step = {
                'type': state.edge_type,
                'time': state.time.isoformat(),
                'node_id': state.node_id,
                'trip_id': state.trip_id,
                'route_id': state.route_id,
                'route_short_name': state.route_short_name,
                'route_long_name': state.route_long_name
            }
            
            if state.node_id in self.gtfs.stops:
                stop = self.gtfs.stops[state.node_id]
                step['stop_name'] = self._get_stop_name(state.node_id)
                step['stop_full_name'] = stop.name
                step['location'] = {'lat': stop.lat, 'lon': stop.lon}
            
            path.insert(0, step)
            state = state.predecessor
        
        # Simplify path - combine consecutive transit steps on same trip
        simplified = []
        for step in path:
            if simplified and simplified[-1]['type'] == step['type']:
                if step['type'] == 'transit' and simplified[-1].get('trip_id') == step.get('trip_id'):
                    simplified[-1]['end_stop'] = step['stop_name']
                    simplified[-1]['end_stop_full'] = step.get('stop_full_name', step['stop_name'])
                    simplified[-1]['end_location'] = step['location']
                    continue
                elif step['type'] == 'walk':
                    # Merge consecutive walks
                    continue
            else:
                if step['type'] == 'transit':
                    step['start_stop'] = step['stop_name']
                    step['start_stop_full'] = step.get('stop_full_name', step['stop_name'])
                    step['start_location'] = step['location']
                    step['end_stop'] = step['stop_name']
                    step['end_stop_full'] = step.get('stop_full_name', step['stop_name'])
                    step['end_location'] = step['location']
                simplified.append(step)
        
        # Add walking destinations
        for i, step in enumerate(simplified):
            if step['type'] == 'walk' and i + 1 < len(simplified):
                next_step = simplified[i + 1]
                if next_step['type'] == 'transit':
                    step['to_stop'] = next_step['start_stop']
                    step['to_stop_full'] = next_step.get('start_stop_full', next_step['start_stop'])
                    step['to_location'] = next_step['start_location']
        
        return simplified