"""
Transit Router using GTFS data with shape-based geometry
REWRITTEN — fixes:
  1. Prefers direct routes (Bus 75) over random transfers (91->87->71C)
  2. Expands stop search up to 15km so distant destinations work
  3. Time-agnostic: always finds a route if one exists in the schedule
  4. Walking legs use TomTom for real pedestrian paths
"""
# transit_router.py
from typing import List, Dict, Tuple, Optional, Set
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
        self.gtfs = GTFSLoader(gtfs_zip_path, use_cache=True)
        self.walking_speed = walking_speed_mps
        self.walking_transfer_time = 120

        self.shapes: Dict[str, List[Tuple[float, float]]] = {}
        self.trip_to_shape: Dict[str, str] = {}
        self._load_shapes()

        self._shape_point_index: Dict[str, Dict[str, int]] = {}

        self._route_info: Dict[str, Dict] = {}
        self._trip_to_route: Dict[str, str] = {}
        self._load_routes()

        self._trip_stop_cache: Dict[str, List[Tuple[str, int]]] = {}
        self._build_trip_cache()

        self.cache_dir = os.path.join(os.path.dirname(__file__), 'cache')
        os.makedirs(self.cache_dir, exist_ok=True)
        self._walk_cache_file = os.path.join(self.cache_dir, 'walk_routes_cache.pkl')
        self._walk_route_cache: Dict[str, List[Tuple[float, float]]] = self._load_walk_cache()

        self._route_stops: Dict[str, Set[str]] = {}
        self._build_route_stops_index()

        self._build_shape_index()

    # ================================================================
    # INIT HELPERS
    # ================================================================

    def _build_route_stops_index(self):
        for trip_id, stop_list in self._trip_stop_cache.items():
            trip = self.gtfs.trips.get(trip_id)
            if not trip:
                continue
            rid = trip.route_id
            if rid not in self._route_stops:
                self._route_stops[rid] = set()
            for stop_id, _ in stop_list:
                self._route_stops[rid].add(stop_id)
        logger.info(f"Built route-stops index for {len(self._route_stops)} routes")

    def _load_walk_cache(self) -> Dict:
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
        try:
            with open(self._walk_cache_file, 'wb') as f:
                pickle.dump(self._walk_route_cache, f, protocol=pickle.HIGHEST_PROTOCOL)
        except Exception as e:
            logger.warning(f"Failed to save walk cache: {e}")

    def _build_shape_index(self):
        logger.info("Building shape index for fast stop mapping...")
        for shape_id, points in self.shapes.items():
            self._shape_point_index[shape_id] = {}
            for idx, (lat, lon) in enumerate(points[::10]):
                self._shape_point_index[shape_id][f"{lat:.4f},{lon:.4f}"] = idx * 10
        logger.info(f"Shape index built for {len(self._shape_point_index)} shapes")

    def _load_shapes(self):
        try:
            with zipfile.ZipFile(self.gtfs.gtfs_zip_path, 'r') as z:
                if 'shapes.txt' not in z.namelist():
                    return
                with z.open('shapes.txt') as f:
                    shapes_df = pd.read_csv(f)
                    shape_points: Dict[str, list] = {}
                    for _, row in shapes_df.iterrows():
                        sid = str(row['shape_id'])
                        shape_points.setdefault(sid, []).append(
                            (int(row['shape_pt_sequence']),
                             float(row['shape_pt_lat']),
                             float(row['shape_pt_lon'])))
                    for sid, pts in shape_points.items():
                        pts.sort(key=lambda x: x[0])
                        self.shapes[sid] = [(la, lo) for _, la, lo in pts]
                logger.info(f"Loaded {len(self.shapes)} shapes")
                with z.open('trips.txt') as f:
                    trips_df = pd.read_csv(f, dtype=str)
                    for _, row in trips_df.iterrows():
                        tid = str(row['trip_id'])
                        sid = str(row.get('shape_id', ''))
                        if sid and sid != 'nan' and sid in self.shapes:
                            self.trip_to_shape[tid] = sid
                logger.info(f"Mapped {len(self.trip_to_shape)} trips to shapes")
        except Exception as e:
            logger.warning(f"Error loading shapes: {e}")

    def _load_routes(self):
        try:
            with zipfile.ZipFile(self.gtfs.gtfs_zip_path, 'r') as z:
                with z.open('routes.txt') as f:
                    routes_df = pd.read_csv(f, dtype=str)
                    for _, row in routes_df.iterrows():
                        rid = str(row['route_id'])
                        self._route_info[rid] = {
                            'route_short_name': str(row.get('route_short_name', '')),
                            'route_long_name': str(row.get('route_long_name', '')),
                        }
            logger.info(f"Loaded {len(self._route_info)} routes")
        except Exception as e:
            logger.warning(f"Error loading routes: {e}")
        for tid, trip in self.gtfs.trips.items():
            if trip.route_id:
                self._trip_to_route[tid] = trip.route_id

    def _build_trip_cache(self):
        for tid, stop_times in self.gtfs.stop_times.items():
            self._trip_stop_cache[tid] = [(st.stop_id, st.stop_sequence) for st in stop_times]
        logger.info(f"Cached {len(self._trip_stop_cache)} trips")

    # ================================================================
    # GEOMETRY HELPERS
    # ================================================================

    def _haversine(self, lat1, lon1, lat2, lon2) -> float:
        R = 6371000
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
        a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    def _path_distance(self, pts):
        d = 0.0
        for i in range(len(pts)-1):
            d += self._haversine(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1])
        return d

    def _get_next_stop(self, trip_id, current_stop_id):
        stops = self._trip_stop_cache.get(trip_id, [])
        for i, (sid, _) in enumerate(stops):
            if sid == current_stop_id and i+1 < len(stops):
                return stops[i+1][0]
        return None

    # ================================================================
    # SHAPE PATH
    # ================================================================

    @lru_cache(maxsize=10000)
    def _get_shape_path_cached(self, trip_id, from_stop_id, to_stop_id):
        shape_id = self.trip_to_shape.get(trip_id)
        if not shape_id or shape_id not in self.shapes:
            return ()
        shape = self.shapes[shape_id]
        fs = self.gtfs.stops.get(from_stop_id)
        ts = self.gtfs.stops.get(to_stop_id)
        if not fs or not ts:
            return ()
        from_idx = to_idx = -1
        min_from = min_to = float('inf')
        step = max(1, len(shape)//100)
        for i in range(0, len(shape), step):
            la, lo = shape[i]
            df = self._haversine(fs.lat, fs.lon, la, lo)
            dt = self._haversine(ts.lat, ts.lon, la, lo)
            if df < min_from: min_from, from_idx = df, i
            if dt < min_to: min_to, to_idx = dt, i
        for rng_s, rng_e, sobj, is_f in [
            (max(0,from_idx-20), min(len(shape),from_idx+20), fs, True),
            (max(0,to_idx-20), min(len(shape),to_idx+20), ts, False)]:
            for i in range(rng_s, rng_e):
                la, lo = shape[i]
                d = self._haversine(sobj.lat, sobj.lon, la, lo)
                if is_f and d < min_from: min_from, from_idx = d, i
                if not is_f and d < min_to: min_to, to_idx = d, i
        if from_idx >= 0 and to_idx >= 0:
            if from_idx <= to_idx:
                return tuple(shape[from_idx:to_idx+1])
            else:
                return tuple(shape[to_idx:from_idx+1][::-1])
        return ()

    def _get_shape_path(self, trip_id, from_stop_id, to_stop_id):
        r = self._get_shape_path_cached(trip_id, from_stop_id, to_stop_id)
        return list(r) if r else []

    # ================================================================
    # WALKING LEG
    # ================================================================

    def _decode_tomtom_polyline(self, encoded):
        points = []; idx = lat = lng = 0
        while idx < len(encoded):
            for _ in range(2):
                result = shift = 0
                while True:
                    b = ord(encoded[idx]) - 63; idx += 1
                    result |= (b & 0x1f) << shift; shift += 5
                    if b < 0x20: break
                delta = ~(result >> 1) if result & 1 else result >> 1
                if _ == 0: lat += delta
                else: lng += delta
            points.append((lat*1e-5, lng*1e-5))
        return points

    @lru_cache(maxsize=2000)
    def _route_walking_leg_cached(self, from_lat, from_lon, to_lat, to_lon):
        ck = f"{from_lat:.5f},{from_lon:.5f}|{to_lat:.5f},{to_lon:.5f}"
        if ck in self._walk_route_cache:
            return tuple(self._walk_route_cache[ck])
        straight = self._haversine(from_lat, from_lon, to_lat, to_lon)
        if straight < 50:
            pts = [(from_lat, from_lon), (to_lat, to_lon)]
            self._walk_route_cache[ck] = pts
            self._save_walk_cache()
            return tuple(pts)
        tk = os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')
        if tk:
            try:
                url = f"https://api.tomtom.com/routing/1/calculateRoute/{from_lat},{from_lon}:{to_lat},{to_lon}/json"
                resp = requests.get(url, params={'key':tk,'travelMode':'pedestrian','routeRepresentation':'polyline'}, timeout=5)
                if resp.status_code == 200:
                    routes = resp.json().get('routes', [])
                    if routes:
                        raw = routes[0].get('legs',[{}])[0].get('points',[])
                        if isinstance(raw, dict) and 'encodedPolyline' in raw:
                            pts = self._decode_tomtom_polyline(raw['encodedPolyline'])
                        elif isinstance(raw, list) and raw:
                            pts = [(p['latitude'], p['longitude']) for p in raw]
                        else:
                            pts = []
                        if len(pts) >= 2:
                            self._walk_route_cache[ck] = pts
                            self._save_walk_cache()
                            return tuple(pts)
            except Exception as e:
                logger.debug(f"TomTom walk failed: {e}")
        pts = [(from_lat, from_lon), (to_lat, to_lon)]
        self._walk_route_cache[ck] = pts
        if len(self._walk_route_cache) % 50 == 0:
            self._save_walk_cache()
        return tuple(pts)

    def _route_walking_leg(self, from_lat, from_lon, to_lat, to_lon):
        return list(self._route_walking_leg_cached(from_lat, from_lon, to_lat, to_lon))

    # ================================================================
    # STOP FINDING (aggressive expansion)
    # ================================================================

    def _find_stops_expanded(self, lat, lon, preferred_radius=800, max_radius=15000, min_stops=1):
        for radius in [preferred_radius, 1500, 3000, 5000, 8000, 10000, max_radius]:
            stops = self.gtfs.find_nearby_stops(lat, lon, radius)
            if len(stops) >= min_stops:
                logger.info(f"Found {len(stops)} stops within {radius}m of ({lat:.4f},{lon:.4f})")
                return stops
        logger.warning(f"No stops found within {max_radius}m of ({lat:.4f},{lon:.4f})")
        return []

    # ================================================================
    # TIME ADJUSTMENT
    # ================================================================

    def _find_usable_search_time(self, start_stops, end_stops, original_time, time_window):
        # 1) Check if departures exist now
        for stop, _ in start_stops[:5]:
            deps = self.gtfs.get_next_departure(stop.stop_id, original_time, time_window)
            if deps:
                return original_time

        logger.info("No departures at requested time — scanning for next service...")
        end_stop_ids = {s.stop_id for s, _ in end_stops}
        best_connecting = best_any = None

        for stop, _ in start_stops[:10]:
            for st in self.gtfs.stop_times_by_stop.get(stop.stop_id, []):
                trip = self.gtfs.trips.get(st.trip_id)
                if not trip or not self.gtfs._is_service_active_any_day(trip.service_id, original_time):
                    continue
                dep_sec = st.departure_time % 86400
                if best_any is None or dep_sec < best_any:
                    best_any = dep_sec
                route_stops = self._route_stops.get(trip.route_id, set())
                if route_stops & end_stop_ids:
                    if best_connecting is None or dep_sec < best_connecting:
                        best_connecting = dep_sec

        chosen = best_connecting if best_connecting is not None else best_any
        if chosen is not None:
            adj = max(0, chosen - 300)
            h, rem = divmod(adj, 3600)
            m, s = divmod(rem, 60)
            try:
                t = original_time.replace(hour=h, minute=m, second=s, microsecond=0)
                if t < original_time:
                    t += timedelta(days=1)
                kind = "connecting" if best_connecting is not None else "any"
                logger.info(f"Adjusted search time to {t.strftime('%H:%M')} ({kind} route)")
                return t
            except Exception:
                pass

        logger.warning("No departures found — defaulting to 8 AM")
        try:
            return original_time.replace(hour=8, minute=0, second=0, microsecond=0)
        except Exception:
            return original_time

    # ================================================================
    # MAIN ROUTING
    # ================================================================

    def find_route(self, start_lat, start_lon, end_lat, end_lon, start_time,
                   max_walk_distance=800, max_transfers=4,
                   time_window_minutes=120, num_alternatives=3):

        logger.info(f"Transit routing ({start_lat:.4f},{start_lon:.4f}) -> ({end_lat:.4f},{end_lon:.4f})")
        logger.info(f"Requested time: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")

        start_stops = self._find_stops_expanded(start_lat, start_lon,
                                                 preferred_radius=max_walk_distance, max_radius=3000)
        end_stops = self._find_stops_expanded(end_lat, end_lon,
                                               preferred_radius=max_walk_distance, max_radius=15000)
        if not start_stops or not end_stops:
            logger.warning("Could not find stops near start or end")
            return None

        effective_time = self._find_usable_search_time(
            start_stops, end_stops, start_time, time_window_minutes)
        effective_window = max(time_window_minutes, 360)

        pq = []
        best_times = {}
        counter = 0

        for stop, dist in start_stops[:15]:
            walk_sec = dist / self.walking_speed
            arrival = effective_time + timedelta(seconds=walk_sec)
            state = State(time=arrival, node_id=stop.stop_id, transfers=0,
                          edge_type='walk', predecessor=None)
            key = (stop.stop_id, None, 0)
            best_times[key] = arrival
            heapq.heappush(pq, (arrival, stop.stop_id, counter, None, 0, state))
            counter += 1

        goal_states = []
        iterations = 0
        MAX_ITER = 80000
        end_stop_map = {s.stop_id: (s, d) for s, d in end_stops[:20]}

        while pq and iterations < MAX_ITER:
            if goal_states and iterations > 15000:
                break
            iterations += 1
            cur_time, cur_node, _, cur_trip, transfers, cur_state = heapq.heappop(pq)

            if cur_node in end_stop_map:
                end_stop, end_dist = end_stop_map[cur_node]
                walk_sec = end_dist / self.walking_speed
                total = cur_time + timedelta(seconds=walk_sec)
                goal_states.append((total, cur_state, end_stop, walk_sec))
                continue

            if transfers > max_transfers:
                continue

            if cur_trip is not None:
                nxt = self._get_next_stop(cur_trip, cur_node)
                if nxt:
                    tt = self.gtfs.get_travel_time(cur_trip, cur_node, nxt)
                    if tt and tt > 0:
                        arr = cur_time + timedelta(seconds=tt)
                        ns = State(time=arr, node_id=nxt, trip_id=cur_trip,
                                   route_id=cur_state.route_id,
                                   route_short_name=cur_state.route_short_name,
                                   predecessor=cur_state, edge_type='transit',
                                   from_stop_id=cur_node, to_stop_id=nxt,
                                   transfers=transfers)
                        k = (nxt, cur_trip, transfers)
                        if k not in best_times or best_times[k] > arr:
                            best_times[k] = arr
                            heapq.heappush(pq, (arr, nxt, counter, cur_trip, transfers, ns))
                            counter += 1
                if transfers < max_transfers:
                    at = cur_time + timedelta(seconds=self.walking_transfer_time)
                    a_s = State(time=at, node_id=cur_node, transfers=transfers,
                                predecessor=cur_state, edge_type='alight',
                                from_stop_id=cur_node)
                    k = (cur_node, None, transfers)
                    if k not in best_times or best_times[k] > at:
                        best_times[k] = at
                        heapq.heappush(pq, (at, cur_node, counter, None, transfers, a_s))
                        counter += 1

            if cur_trip is None:
                deps = self.gtfs.get_next_departure(cur_node, cur_time, effective_window)
                for dep_time, trip_id, nxt_stop in deps[:15]:
                    tt = self.gtfs.get_travel_time(trip_id, cur_node, nxt_stop)
                    if not tt or tt <= 0:
                        continue
                    trip = self.gtfs.trips.get(trip_id)
                    rid = trip.route_id if trip else None
                    ri = self._route_info.get(rid, {})
                    arr = dep_time + timedelta(seconds=tt)
                    nx = transfers + 1
                    if nx > max_transfers:
                        continue
                    ns = State(time=arr, node_id=nxt_stop, trip_id=trip_id,
                               route_id=rid,
                               route_short_name=ri.get('route_short_name', ''),
                               predecessor=cur_state, edge_type='transit',
                               from_stop_id=cur_node, to_stop_id=nxt_stop,
                               transfers=nx)
                    k = (nxt_stop, trip_id, nx)
                    if k not in best_times or best_times[k] > arr:
                        best_times[k] = arr
                        heapq.heappush(pq, (arr, nxt_stop, counter, trip_id, nx, ns))
                        counter += 1

        if not goal_states:
            self._log_diagnostics(start_stops, end_stops, effective_time, effective_window, iterations, best_times)
            return None

        # Sort: fewer transfers first, then by time
        goal_states.sort(key=lambda g: (self._count_transfers(g[1]), g[0]))
        unique = self._deduplicate_routes(goal_states, num_alternatives)

        routes = []
        for idx, (total_time, final_state, end_stop, _) in enumerate(unique):
            steps = self._build_steps(final_state, end_stop, start_lat, start_lon, end_lat, end_lon)
            if not steps:
                continue
            total_sec = int((total_time - effective_time).total_seconds())
            total_dist = sum(s.get('distance_meters', 0) for s in steps)
            walk_dist = sum(s.get('distance_meters', 0) for s in steps if s['type'] == 'walk')
            rd = {
                'route_index': idx,
                'total_time_seconds': total_sec,
                'total_time_minutes': total_sec / 60,
                'total_distance_meters': round(total_dist),
                'walk_distance_meters': round(walk_dist),
                'transit_distance_meters': round(total_dist - walk_dist),
                'num_transfers': max(0, len([s for s in steps if s['type']=='transit']) - 1),
                'arrival_time': total_time.isoformat(),
                'start_time': start_time.isoformat(),
                'route_summary': self._get_route_summary(steps),
                'steps': steps,
                'start_location': {'lat': start_lat, 'lon': start_lon},
                'end_location': {'lat': end_lat, 'lon': end_lon},
                'route_ids_used': [s.get('route_short_name') for s in steps
                                   if s['type']=='transit' and s.get('route_short_name')],
            }
            if effective_time != start_time:
                rd['adjusted_departure_time'] = effective_time.isoformat()
                rd['note'] = (f"No service at {start_time.strftime('%I:%M %p')}. "
                              f"Showing route for {effective_time.strftime('%I:%M %p')}.")
            routes.append(rd)
        return routes if routes else None

    # ================================================================
    # HELPERS
    # ================================================================

    @staticmethod
    def _count_transfers(state):
        trips = set()
        s = state
        while s:
            if s.edge_type == 'transit' and s.trip_id:
                trips.add(s.trip_id)
            s = s.predecessor
        return max(0, len(trips) - 1)

    def _log_diagnostics(self, start_stops, end_stops, eff_time, eff_window, iters, best_times):
        logger.warning("No transit routes found — diagnostics:")
        logger.warning(f"  Effective time: {eff_time.strftime('%H:%M:%S')}, iters: {iters}, states: {len(best_times)}")
        for stop, dist in start_stops[:5]:
            deps = self.gtfs.get_next_departure(stop.stop_id, eff_time, eff_window)
            rts = []
            for _, tid, _ in deps[:3]:
                t = self.gtfs.trips.get(tid)
                if t:
                    ri = self._route_info.get(t.route_id, {})
                    rts.append(ri.get('route_short_name', '?'))
            logger.info(f"  Start {stop.stop_id} ({stop.name}): {len(deps)} deps, routes={rts}, {dist:.0f}m")
        for stop, dist in end_stops[:5]:
            logger.info(f"  End {stop.stop_id} ({stop.name}): {dist:.0f}m")

    def _deduplicate_routes(self, goal_states, max_routes):
        unique = []; seen = set()
        for total_time, final_state, end_stop, walk_sec in goal_states:
            seq = []
            s = final_state
            while s:
                if s.edge_type == 'transit' and s.route_short_name:
                    seq.append(s.route_short_name)
                s = s.predecessor
            key = tuple(reversed(seq))
            if key not in seen:
                seen.add(key)
                unique.append((total_time, final_state, end_stop, walk_sec))
                if len(unique) >= max_routes:
                    break
        return unique

    def _get_route_summary(self, steps):
        parts = []
        for s in steps:
            if s['type'] == 'walk': parts.append('Walk')
            elif s['type'] == 'transit':
                rn = s.get('route_short_name', '')
                parts.append(f"Bus {rn}" if rn else 'Bus')
        if not parts: return ''
        collapsed = [parts[0]]
        for p in parts[1:]:
            if p != collapsed[-1]: collapsed.append(p)
        return ' -> '.join(collapsed)

    # ================================================================
    # BUILD STEPS
    # ================================================================

    def _build_steps(self, final_state, end_stop, start_lat, start_lon, end_lat, end_lon):
        states = []
        s = final_state
        while s:
            states.insert(0, s)
            s = s.predecessor

        steps = []

        # Initial walk
        first_transit = next((st for st in states if st.edge_type == 'transit'), None)
        if first_transit and first_transit.from_stop_id:
            fs = self.gtfs.stops.get(first_transit.from_stop_id)
            if fs:
                pts = self._route_walking_leg(start_lat, start_lon, fs.lat, fs.lon)
                d = self._path_distance(pts)
                steps.append({
                    'type': 'walk',
                    'from_location': {'lat': start_lat, 'lon': start_lon},
                    'to_stop': self.gtfs.get_stop_name(fs.stop_id),
                    'to_stop_id': fs.stop_id,
                    'to_location': {'lat': fs.lat, 'lon': fs.lon},
                    'distance_meters': round(d),
                    'duration_seconds': round(d / self.walking_speed),
                    'path_geometry': [[la, lo] for la, lo in pts],
                })

        # Transit legs + transfer walks
        i = 0
        while i < len(states):
            st = states[i]
            if st.edge_type == 'transit':
                trip_id = st.trip_id
                run = []
                while i < len(states) and states[i].edge_type == 'transit' and states[i].trip_id == trip_id:
                    run.append(states[i]); i += 1
                from_sid, to_sid = run[0].from_stop_id, run[-1].to_stop_id
                fs, ts = self.gtfs.stops.get(from_sid), self.gtfs.stops.get(to_sid)
                if fs and ts:
                    shape = self._get_shape_path(trip_id, from_sid, to_sid)
                    rid = self._trip_to_route.get(trip_id, '')
                    ri = self._route_info.get(rid, {})
                    sl = self._trip_stop_cache.get(trip_id, [])
                    s_seq = next((sq for sid, sq in sl if sid == from_sid), 0)
                    e_seq = next((sq for sid, sq in sl if sid == to_sid), 0)
                    steps.append({
                        'type': 'transit',
                        'route_short_name': ri.get('route_short_name', ''),
                        'route_long_name': ri.get('route_long_name', '').title(),
                        'trip_id': trip_id,
                        'start_stop': self.gtfs.get_stop_name(from_sid),
                        'start_stop_id': from_sid,
                        'start_location': {'lat': fs.lat, 'lon': fs.lon},
                        'end_stop': self.gtfs.get_stop_name(to_sid),
                        'end_stop_id': to_sid,
                        'end_location': {'lat': ts.lat, 'lon': ts.lon},
                        'num_stops': abs(e_seq - s_seq),
                        'path_geometry': [[la, lo] for la, lo in shape] if shape else [[fs.lat, fs.lon], [ts.lat, ts.lon]],
                    })
            elif st.edge_type == 'alight':
                nxt = next((states[j] for j in range(i+1, len(states)) if states[j].edge_type == 'transit'), None)
                if nxt and nxt.from_stop_id:
                    fs = self.gtfs.stops.get(st.node_id)
                    ts = self.gtfs.stops.get(nxt.from_stop_id)
                    if fs and ts and fs.stop_id != ts.stop_id:
                        pts = self._route_walking_leg(fs.lat, fs.lon, ts.lat, ts.lon)
                        d = self._path_distance(pts)
                        steps.append({
                            'type': 'walk',
                            'from_stop': self.gtfs.get_stop_name(fs.stop_id),
                            'to_stop': self.gtfs.get_stop_name(ts.stop_id),
                            'from_location': {'lat': fs.lat, 'lon': fs.lon},
                            'to_location': {'lat': ts.lat, 'lon': ts.lon},
                            'distance_meters': round(d),
                            'duration_seconds': round(d / self.walking_speed),
                            'path_geometry': [[la, lo] for la, lo in pts],
                        })
                i += 1
            else:
                i += 1

        # Final walk
        last_transit = next((st for st in reversed(states) if st.edge_type == 'transit'), None)
        if last_transit and last_transit.to_stop_id:
            ls = self.gtfs.stops.get(last_transit.to_stop_id)
            if ls:
                pts = self._route_walking_leg(ls.lat, ls.lon, end_lat, end_lon)
                d = self._path_distance(pts)
                steps.append({
                    'type': 'walk',
                    'from_stop': self.gtfs.get_stop_name(ls.stop_id),
                    'from_location': {'lat': ls.lat, 'lon': ls.lon},
                    'to_stop': 'Your Destination',
                    'to_location': {'lat': end_lat, 'lon': end_lon},
                    'distance_meters': round(d),
                    'duration_seconds': round(d / self.walking_speed),
                    'path_geometry': [[la, lo] for la, lo in pts],
                })

        return steps