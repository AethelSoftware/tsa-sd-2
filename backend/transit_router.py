"""
Transit Router using GTFS data with shape-based geometry
KEY FIX: Dijkstra penalizes transfers so 1-transfer routes beat 4-transfer
downtown detours even if the detour is slightly faster on paper.
"""
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

# Each transfer adds this many seconds of "virtual penalty" to Dijkstra's
# priority.  Real arrival time is NOT affected — this only changes which
# routes the search explores first.  900s = 15 min penalty per transfer
# means Dijkstra strongly prefers staying on the same bus.
TRANSFER_PENALTY_SECONDS = 900


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
    # INIT
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

    def _load_walk_cache(self):
        try:
            if os.path.exists(self._walk_cache_file):
                with open(self._walk_cache_file, 'rb') as f:
                    c = pickle.load(f)
                    logger.info(f"Loaded {len(c)} walking routes from disk cache")
                    return c
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
        logger.info("Building shape index...")
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
                    df = pd.read_csv(f)
                    sp: Dict[str, list] = {}
                    for _, r in df.iterrows():
                        sid = str(r['shape_id'])
                        sp.setdefault(sid, []).append(
                            (int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
                    for sid, pts in sp.items():
                        pts.sort(key=lambda x: x[0])
                        self.shapes[sid] = [(la, lo) for _, la, lo in pts]
                logger.info(f"Loaded {len(self.shapes)} shapes")
                with z.open('trips.txt') as f:
                    df = pd.read_csv(f, dtype=str)
                    for _, r in df.iterrows():
                        tid = str(r['trip_id'])
                        sid = str(r.get('shape_id', ''))
                        if sid and sid != 'nan' and sid in self.shapes:
                            self.trip_to_shape[tid] = sid
                logger.info(f"Mapped {len(self.trip_to_shape)} trips to shapes")
        except Exception as e:
            logger.warning(f"Error loading shapes: {e}")

    def _load_routes(self):
        try:
            with zipfile.ZipFile(self.gtfs.gtfs_zip_path, 'r') as z:
                with z.open('routes.txt') as f:
                    df = pd.read_csv(f, dtype=str)
                    for _, r in df.iterrows():
                        rid = str(r['route_id'])
                        self._route_info[rid] = {
                            'route_short_name': str(r.get('route_short_name', '')),
                            'route_long_name': str(r.get('route_long_name', '')),
                        }
            logger.info(f"Loaded {len(self._route_info)} routes")
        except Exception as e:
            logger.warning(f"Error loading routes: {e}")
        for tid, trip in self.gtfs.trips.items():
            if trip.route_id:
                self._trip_to_route[tid] = trip.route_id

    def _build_trip_cache(self):
        for tid, st in self.gtfs.stop_times.items():
            self._trip_stop_cache[tid] = [(s.stop_id, s.stop_sequence) for s in st]
        logger.info(f"Cached {len(self._trip_stop_cache)} trips")

    # ================================================================
    # GEOMETRY
    # ================================================================

    def _haversine(self, lat1, lon1, lat2, lon2):
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

    def _get_next_stop(self, trip_id, cur_stop):
        stops = self._trip_stop_cache.get(trip_id, [])
        for i, (sid, _) in enumerate(stops):
            if sid == cur_stop and i+1 < len(stops):
                return stops[i+1][0]
        return None

    # ================================================================
    # SHAPE PATH
    # ================================================================

    @lru_cache(maxsize=10000)
    def _get_shape_path_cached(self, trip_id, from_sid, to_sid):
        shape_id = self.trip_to_shape.get(trip_id)
        if not shape_id or shape_id not in self.shapes:
            return ()
        shape = self.shapes[shape_id]
        fs, ts = self.gtfs.stops.get(from_sid), self.gtfs.stops.get(to_sid)
        if not fs or not ts:
            return ()
        fi = ti = -1
        mf = mt = float('inf')
        step = max(1, len(shape)//100)
        for i in range(0, len(shape), step):
            la, lo = shape[i]
            df = self._haversine(fs.lat, fs.lon, la, lo)
            dt = self._haversine(ts.lat, ts.lon, la, lo)
            if df < mf: mf, fi = df, i
            if dt < mt: mt, ti = dt, i
        for rs, re, so, is_f in [
            (max(0,fi-20), min(len(shape),fi+20), fs, True),
            (max(0,ti-20), min(len(shape),ti+20), ts, False)]:
            for i in range(rs, re):
                la, lo = shape[i]
                d = self._haversine(so.lat, so.lon, la, lo)
                if is_f and d < mf: mf, fi = d, i
                if not is_f and d < mt: mt, ti = d, i
        if fi >= 0 and ti >= 0:
            return tuple(shape[fi:ti+1]) if fi <= ti else tuple(shape[ti:fi+1][::-1])
        return ()

    def _get_shape_path(self, trip_id, from_sid, to_sid):
        r = self._get_shape_path_cached(trip_id, from_sid, to_sid)
        return list(r) if r else []

    # ================================================================
    # WALKING LEG
    # ================================================================

    def _decode_tomtom_polyline(self, enc):
        pts = []; idx = lat = lng = 0
        while idx < len(enc):
            for c in range(2):
                result = shift = 0
                while True:
                    b = ord(enc[idx]) - 63; idx += 1
                    result |= (b & 0x1f) << shift; shift += 5
                    if b < 0x20: break
                delta = ~(result >> 1) if result & 1 else result >> 1
                if c == 0: lat += delta
                else: lng += delta
            pts.append((lat*1e-5, lng*1e-5))
        return pts

    @lru_cache(maxsize=2000)
    def _walk_cached(self, flat, flon, tlat, tlon):
        ck = f"{flat:.5f},{flon:.5f}|{tlat:.5f},{tlon:.5f}"
        if ck in self._walk_route_cache:
            return tuple(self._walk_route_cache[ck])
        straight = self._haversine(flat, flon, tlat, tlon)
        if straight < 50:
            pts = [(flat, flon), (tlat, tlon)]
            self._walk_route_cache[ck] = pts; self._save_walk_cache()
            return tuple(pts)
        tk = os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')
        if tk:
            try:
                url = f"https://api.tomtom.com/routing/1/calculateRoute/{flat},{flon}:{tlat},{tlon}/json"
                resp = requests.get(url, params={'key':tk,'travelMode':'pedestrian','routeRepresentation':'polyline'}, timeout=5)
                if resp.status_code == 200:
                    routes = resp.json().get('routes', [])
                    if routes:
                        raw = routes[0].get('legs',[{}])[0].get('points',[])
                        if isinstance(raw, dict) and 'encodedPolyline' in raw:
                            pts = self._decode_tomtom_polyline(raw['encodedPolyline'])
                        elif isinstance(raw, list) and raw:
                            pts = [(p['latitude'], p['longitude']) for p in raw]
                        else: pts = []
                        if len(pts) >= 2:
                            self._walk_route_cache[ck] = pts; self._save_walk_cache()
                            return tuple(pts)
            except Exception: pass
        pts = [(flat, flon), (tlat, tlon)]
        self._walk_route_cache[ck] = pts
        if len(self._walk_route_cache) % 50 == 0: self._save_walk_cache()
        return tuple(pts)

    def _walk(self, flat, flon, tlat, tlon):
        return list(self._walk_cached(flat, flon, tlat, tlon))

    # ================================================================
    # STOP FINDING
    # ================================================================

    def _find_stops(self, lat, lon, pref=800, mx=15000, mn=1):
        for r in [pref, 1500, 3000, 5000, 8000, 10000, mx]:
            stops = self.gtfs.find_nearby_stops(lat, lon, r)
            if len(stops) >= mn:
                logger.info(f"Found {len(stops)} stops within {r}m of ({lat:.4f},{lon:.4f})")
                return stops
        logger.warning(f"No stops within {mx}m of ({lat:.4f},{lon:.4f})")
        return []

    # ================================================================
    # TIME ADJUSTMENT
    # ================================================================

    def _find_usable_time(self, start_stops, end_stops, orig, window):
        for stop, _ in start_stops[:5]:
            if self.gtfs.get_next_departure(stop.stop_id, orig, window):
                return orig

        logger.info("No departures now — scanning for next service...")
        end_ids = {s.stop_id for s, _ in end_stops}
        best_conn = best_any = None

        for stop, _ in start_stops[:10]:
            for st in self.gtfs.stop_times_by_stop.get(stop.stop_id, []):
                trip = self.gtfs.trips.get(st.trip_id)
                if not trip or not self.gtfs._is_service_active_any_day(trip.service_id, orig):
                    continue
                ds = st.departure_time % 86400
                if best_any is None or ds < best_any:
                    best_any = ds
                if self._route_stops.get(trip.route_id, set()) & end_ids:
                    if best_conn is None or ds < best_conn:
                        best_conn = ds

        chosen = best_conn if best_conn is not None else best_any
        if chosen is not None:
            adj = max(0, chosen - 300)
            h, rem = divmod(adj, 3600); m, s = divmod(rem, 60)
            try:
                t = orig.replace(hour=h, minute=m, second=s, microsecond=0)
                if t < orig: t += timedelta(days=1)
                logger.info(f"Adjusted time to {t.strftime('%H:%M')} ({'connecting' if best_conn is not None else 'any'})")
                return t
            except Exception: pass

        logger.warning("No departures found — defaulting to 8 AM")
        try: return orig.replace(hour=8, minute=0, second=0, microsecond=0)
        except Exception: return orig

    # ================================================================
    # MAIN ROUTING — transfer-penalized Dijkstra
    # ================================================================

    def find_route(self, start_lat, start_lon, end_lat, end_lon, start_time,
                   max_walk_distance=800, max_transfers=3,
                   time_window_minutes=120, num_alternatives=3):

        logger.info(f"Transit routing ({start_lat:.4f},{start_lon:.4f}) -> ({end_lat:.4f},{end_lon:.4f})")

        start_stops = self._find_stops(start_lat, start_lon, pref=max_walk_distance, mx=3000)
        end_stops = self._find_stops(end_lat, end_lon, pref=max_walk_distance, mx=15000)
        if not start_stops or not end_stops:
            return None

        eff_time = self._find_usable_time(start_stops, end_stops, start_time, time_window_minutes)
        eff_window = max(time_window_minutes, 360)

        # Priority queue: (priority_key, node_id, counter, trip_id, transfers, state)
        # priority_key = real_arrival + transfers * TRANSFER_PENALTY
        # This makes Dijkstra explore low-transfer routes first.
        pq = []
        best: Dict[tuple, float] = {}  # key -> best priority seen
        counter = 0

        for stop, dist in start_stops[:15]:
            ws = dist / self.walking_speed
            arr = eff_time + timedelta(seconds=ws)
            arr_ts = arr.timestamp()
            priority = arr_ts  # 0 transfers, no penalty
            state = State(time=arr, node_id=stop.stop_id, transfers=0,
                          edge_type='walk', predecessor=None)
            key = (stop.stop_id, None, 0)
            best[key] = priority
            heapq.heappush(pq, (priority, stop.stop_id, counter, None, 0, state))
            counter += 1

        goals = []
        iters = 0
        MAX_ITER = 80000
        end_map = {s.stop_id: (s, d) for s, d in end_stops[:20]}

        while pq and iters < MAX_ITER:
            if goals and iters > 15000:
                break
            iters += 1
            pri, cur_node, _, cur_trip, xfers, cur_state = heapq.heappop(pq)

            # Goal check
            if cur_node in end_map:
                es, ed = end_map[cur_node]
                ws = ed / self.walking_speed
                total = cur_state.time + timedelta(seconds=ws)
                goals.append((total, cur_state, es, ws))
                continue

            if xfers > max_transfers:
                continue

            # On a bus — ride or alight
            if cur_trip is not None:
                nxt = self._get_next_stop(cur_trip, cur_node)
                if nxt:
                    tt = self.gtfs.get_travel_time(cur_trip, cur_node, nxt)
                    if tt and tt > 0:
                        arr = cur_state.time + timedelta(seconds=tt)
                        arr_ts = arr.timestamp()
                        npri = arr_ts + xfers * TRANSFER_PENALTY_SECONDS
                        ns = State(time=arr, node_id=nxt, trip_id=cur_trip,
                                   route_id=cur_state.route_id,
                                   route_short_name=cur_state.route_short_name,
                                   predecessor=cur_state, edge_type='transit',
                                   from_stop_id=cur_node, to_stop_id=nxt,
                                   transfers=xfers)
                        k = (nxt, cur_trip, xfers)
                        if k not in best or best[k] > npri:
                            best[k] = npri
                            heapq.heappush(pq, (npri, nxt, counter, cur_trip, xfers, ns))
                            counter += 1

                # Alight
                if xfers < max_transfers:
                    at = cur_state.time + timedelta(seconds=self.walking_transfer_time)
                    at_ts = at.timestamp()
                    npri = at_ts + xfers * TRANSFER_PENALTY_SECONDS
                    a_s = State(time=at, node_id=cur_node, transfers=xfers,
                                predecessor=cur_state, edge_type='alight',
                                from_stop_id=cur_node)
                    k = (cur_node, None, xfers)
                    if k not in best or best[k] > npri:
                        best[k] = npri
                        heapq.heappush(pq, (npri, cur_node, counter, None, xfers, a_s))
                        counter += 1

            # Waiting — board a bus
            if cur_trip is None:
                deps = self.gtfs.get_next_departure(cur_node, cur_state.time, eff_window)
                for dep_time, trip_id, nxt_stop in deps[:15]:
                    tt = self.gtfs.get_travel_time(trip_id, cur_node, nxt_stop)
                    if not tt or tt <= 0:
                        continue
                    trip = self.gtfs.trips.get(trip_id)
                    rid = trip.route_id if trip else None
                    ri = self._route_info.get(rid, {})
                    arr = dep_time + timedelta(seconds=tt)
                    nx = xfers + 1
                    if nx > max_transfers:
                        continue
                    arr_ts = arr.timestamp()
                    npri = arr_ts + nx * TRANSFER_PENALTY_SECONDS
                    ns = State(time=arr, node_id=nxt_stop, trip_id=trip_id,
                               route_id=rid,
                               route_short_name=ri.get('route_short_name', ''),
                               predecessor=cur_state, edge_type='transit',
                               from_stop_id=cur_node, to_stop_id=nxt_stop,
                               transfers=nx)
                    k = (nxt_stop, trip_id, nx)
                    if k not in best or best[k] > npri:
                        best[k] = npri
                        heapq.heappush(pq, (npri, nxt_stop, counter, trip_id, nx, ns))
                        counter += 1

        if not goals:
            self._log_diag(start_stops, end_stops, eff_time, eff_window, iters, best)
            return None

        # Sort: fewer transfers first, then time
        goals.sort(key=lambda g: (self._count_xfers(g[1]), g[0]))
        unique = self._dedup(goals, num_alternatives)

        routes = []
        for idx, (total_time, final_state, end_stop, _) in enumerate(unique):
            steps = self._build_steps(final_state, end_stop, start_lat, start_lon, end_lat, end_lon)
            if not steps: continue
            ts = int((total_time - eff_time).total_seconds())
            td = sum(s.get('distance_meters', 0) for s in steps)
            wd = sum(s.get('distance_meters', 0) for s in steps if s['type']=='walk')
            rd = {
                'route_index': idx,
                'total_time_seconds': ts,
                'total_time_minutes': ts / 60,
                'total_distance_meters': round(td),
                'walk_distance_meters': round(wd),
                'transit_distance_meters': round(td - wd),
                'num_transfers': max(0, len([s for s in steps if s['type']=='transit']) - 1),
                'arrival_time': total_time.isoformat(),
                'start_time': start_time.isoformat(),
                'route_summary': self._summary(steps),
                'steps': steps,
                'start_location': {'lat': start_lat, 'lon': start_lon},
                'end_location': {'lat': end_lat, 'lon': end_lon},
                'route_ids_used': [s.get('route_short_name') for s in steps
                                   if s['type']=='transit' and s.get('route_short_name')],
            }
            if eff_time != start_time:
                rd['adjusted_departure_time'] = eff_time.isoformat()
                rd['note'] = (f"No service at {start_time.strftime('%I:%M %p')}. "
                              f"Showing route for {eff_time.strftime('%I:%M %p')}.")
            routes.append(rd)
        return routes if routes else None

    # ================================================================
    # HELPERS
    # ================================================================

    @staticmethod
    def _count_xfers(state):
        trips = set()
        s = state
        while s:
            if s.edge_type == 'transit' and s.trip_id:
                trips.add(s.trip_id)
            s = s.predecessor
        return max(0, len(trips) - 1)

    def _log_diag(self, ss, es, et, ew, it, best):
        logger.warning(f"No routes found — time={et.strftime('%H:%M')}, iters={it}, states={len(best)}")
        for stop, dist in ss[:5]:
            deps = self.gtfs.get_next_departure(stop.stop_id, et, ew)
            rts = []
            for _, tid, _ in deps[:3]:
                t = self.gtfs.trips.get(tid)
                if t: rts.append(self._route_info.get(t.route_id, {}).get('route_short_name', '?'))
            logger.info(f"  Start {stop.stop_id} ({stop.name}): {len(deps)} deps, routes={rts}")
        for stop, dist in es[:5]:
            logger.info(f"  End {stop.stop_id} ({stop.name}): {dist:.0f}m")

    def _dedup(self, goals, mx):
        unique = []; seen = set()
        for t, fs, es, ws in goals:
            seq = []
            s = fs
            while s:
                if s.edge_type == 'transit' and s.route_short_name:
                    seq.append(s.route_short_name)
                s = s.predecessor
            key = tuple(reversed(seq))
            if key not in seen:
                seen.add(key)
                unique.append((t, fs, es, ws))
                if len(unique) >= mx: break
        return unique

    def _summary(self, steps):
        parts = []
        for s in steps:
            if s['type'] == 'walk': parts.append('Walk')
            elif s['type'] == 'transit':
                rn = s.get('route_short_name', '')
                parts.append(f"Bus {rn}" if rn else 'Bus')
        if not parts: return ''
        c = [parts[0]]
        for p in parts[1:]:
            if p != c[-1]: c.append(p)
        return ' -> '.join(c)

    # ================================================================
    # BUILD STEPS
    # ================================================================

    def _build_steps(self, final_state, end_stop, slat, slon, elat, elon):
        states = []
        s = final_state
        while s:
            states.insert(0, s)
            s = s.predecessor

        steps = []

        # Initial walk
        ft = next((st for st in states if st.edge_type == 'transit'), None)
        if ft and ft.from_stop_id:
            fs = self.gtfs.stops.get(ft.from_stop_id)
            if fs:
                pts = self._walk(slat, slon, fs.lat, fs.lon)
                d = self._path_distance(pts)
                steps.append({
                    'type': 'walk',
                    'from_location': {'lat': slat, 'lon': slon},
                    'to_stop': self.gtfs.get_stop_name(fs.stop_id),
                    'to_stop_id': fs.stop_id,
                    'to_location': {'lat': fs.lat, 'lon': fs.lon},
                    'distance_meters': round(d),
                    'duration_seconds': round(d / self.walking_speed),
                    'path_geometry': [[la, lo] for la, lo in pts],
                })

        # Transit + transfers
        i = 0
        while i < len(states):
            st = states[i]
            if st.edge_type == 'transit':
                tid = st.trip_id
                run = []
                while i < len(states) and states[i].edge_type == 'transit' and states[i].trip_id == tid:
                    run.append(states[i]); i += 1
                fsid, tsid = run[0].from_stop_id, run[-1].to_stop_id
                fs, ts = self.gtfs.stops.get(fsid), self.gtfs.stops.get(tsid)
                if fs and ts:
                    shape = self._get_shape_path(tid, fsid, tsid)
                    rid = self._trip_to_route.get(tid, '')
                    ri = self._route_info.get(rid, {})
                    sl = self._trip_stop_cache.get(tid, [])
                    ss = next((sq for sid, sq in sl if sid == fsid), 0)
                    es = next((sq for sid, sq in sl if sid == tsid), 0)
                    steps.append({
                        'type': 'transit',
                        'route_short_name': ri.get('route_short_name', ''),
                        'route_long_name': ri.get('route_long_name', '').title(),
                        'trip_id': tid,
                        'start_stop': self.gtfs.get_stop_name(fsid),
                        'start_stop_id': fsid,
                        'start_location': {'lat': fs.lat, 'lon': fs.lon},
                        'end_stop': self.gtfs.get_stop_name(tsid),
                        'end_stop_id': tsid,
                        'end_location': {'lat': ts.lat, 'lon': ts.lon},
                        'num_stops': abs(es - ss),
                        'path_geometry': [[la, lo] for la, lo in shape] if shape else [[fs.lat, fs.lon], [ts.lat, ts.lon]],
                    })
            elif st.edge_type == 'alight':
                nxt = next((states[j] for j in range(i+1, len(states)) if states[j].edge_type == 'transit'), None)
                if nxt and nxt.from_stop_id:
                    fs = self.gtfs.stops.get(st.node_id)
                    ts = self.gtfs.stops.get(nxt.from_stop_id)
                    if fs and ts and fs.stop_id != ts.stop_id:
                        pts = self._walk(fs.lat, fs.lon, ts.lat, ts.lon)
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
        lt = next((st for st in reversed(states) if st.edge_type == 'transit'), None)
        if lt and lt.to_stop_id:
            ls = self.gtfs.stops.get(lt.to_stop_id)
            if ls:
                pts = self._walk(ls.lat, ls.lon, elat, elon)
                d = self._path_distance(pts)
                steps.append({
                    'type': 'walk',
                    'from_stop': self.gtfs.get_stop_name(ls.stop_id),
                    'from_location': {'lat': ls.lat, 'lon': ls.lon},
                    'to_stop': 'Your Destination',
                    'to_location': {'lat': elat, 'lon': elon},
                    'distance_meters': round(d),
                    'duration_seconds': round(d / self.walking_speed),
                    'path_geometry': [[la, lo] for la, lo in pts],
                })

        return steps