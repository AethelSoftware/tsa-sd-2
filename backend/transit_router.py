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

# Virtual penalty per transfer in Dijkstra priority.
# 3600 = 1 hour per transfer means a direct bus that takes 50 min
# will ALWAYS beat a 2-transfer route that takes 20 min.
TRANSFER_PENALTY = 3600


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

    # init
    def _build_route_stops_index(self):
        for tid, sl in self._trip_stop_cache.items():
            t = self.gtfs.trips.get(tid)
            if not t: continue
            self._route_stops.setdefault(t.route_id, set()).update(s for s, _ in sl)
        logger.info(f"Route-stops index: {len(self._route_stops)} routes")

    def _load_walk_cache(self):
        try:
            if os.path.exists(self._walk_cache_file):
                with open(self._walk_cache_file, 'rb') as f:
                    c = pickle.load(f)
                    logger.info(f"Loaded {len(c)} walking routes from cache")
                    return c
        except Exception as e:
            logger.warning(f"Walk cache load failed: {e}")
        return {}

    def _save_walk_cache(self):
        try:
            with open(self._walk_cache_file, 'wb') as f:
                pickle.dump(self._walk_route_cache, f, protocol=pickle.HIGHEST_PROTOCOL)
        except Exception as e:
            logger.warning(f"Walk cache save failed: {e}")

    def _build_shape_index(self):
        for sid, pts in self.shapes.items():
            self._shape_point_index[sid] = {}
            for i, (la, lo) in enumerate(pts[::10]):
                self._shape_point_index[sid][f"{la:.4f},{lo:.4f}"] = i * 10
        logger.info(f"Shape index: {len(self._shape_point_index)} shapes")

    def _load_shapes(self):
        try:
            with zipfile.ZipFile(self.gtfs.gtfs_zip_path, 'r') as z:
                if 'shapes.txt' not in z.namelist(): return
                with z.open('shapes.txt') as f:
                    df = pd.read_csv(f)
                    sp: Dict[str, list] = {}
                    for _, r in df.iterrows():
                        sp.setdefault(str(r['shape_id']), []).append(
                            (int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
                    for sid, pts in sp.items():
                        pts.sort(key=lambda x: x[0])
                        self.shapes[sid] = [(la, lo) for _, la, lo in pts]
                logger.info(f"Loaded {len(self.shapes)} shapes")
                with z.open('trips.txt') as f:
                    df = pd.read_csv(f, dtype=str)
                    for _, r in df.iterrows():
                        tid, sid = str(r['trip_id']), str(r.get('shape_id', ''))
                        if sid and sid != 'nan' and sid in self.shapes:
                            self.trip_to_shape[tid] = sid
                logger.info(f"Mapped {len(self.trip_to_shape)} trips to shapes")
        except Exception as e:
            logger.warning(f"Shape load error: {e}")

    def _load_routes(self):
        try:
            with zipfile.ZipFile(self.gtfs.gtfs_zip_path, 'r') as z:
                with z.open('routes.txt') as f:
                    for _, r in pd.read_csv(f, dtype=str).iterrows():
                        rid = str(r['route_id'])
                        self._route_info[rid] = {
                            'route_short_name': str(r.get('route_short_name', '')),
                            'route_long_name': str(r.get('route_long_name', '')),
                        }
            logger.info(f"Loaded {len(self._route_info)} routes")
        except Exception as e:
            logger.warning(f"Route load error: {e}")
        for tid, t in self.gtfs.trips.items():
            if t.route_id: self._trip_to_route[tid] = t.route_id

    def _build_trip_cache(self):
        for tid, st in self.gtfs.stop_times.items():
            self._trip_stop_cache[tid] = [(s.stop_id, s.stop_sequence) for s in st]
        logger.info(f"Cached {len(self._trip_stop_cache)} trips")

    # geometry
    def _haversine(self, lat1, lon1, lat2, lon2):
        R = 6371000; p1, p2 = math.radians(lat1), math.radians(lat2)
        dp, dl = math.radians(lat2-lat1), math.radians(lon2-lon1)
        a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
        return R*2*math.atan2(math.sqrt(a), math.sqrt(1-a))

    def _path_distance(self, pts):
        return sum(self._haversine(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1]) for i in range(len(pts)-1))

    def _get_next_stop(self, tid, cur):
        for i, (s, _) in enumerate(self._trip_stop_cache.get(tid, [])):
            if s == cur and i+1 < len(self._trip_stop_cache[tid]):
                return self._trip_stop_cache[tid][i+1][0]
        return None

    # shape path
    @lru_cache(maxsize=10000)
    def _shape_path_cached(self, tid, fsid, tsid):
        sid = self.trip_to_shape.get(tid)
        if not sid or sid not in self.shapes: return ()
        shape = self.shapes[sid]
        fs, ts = self.gtfs.stops.get(fsid), self.gtfs.stops.get(tsid)
        if not fs or not ts: return ()
        fi = ti = -1; mf = mt = float('inf')
        step = max(1, len(shape)//100)
        for i in range(0, len(shape), step):
            la, lo = shape[i]
            df = self._haversine(fs.lat, fs.lon, la, lo)
            dt = self._haversine(ts.lat, ts.lon, la, lo)
            if df < mf: mf, fi = df, i
            if dt < mt: mt, ti = dt, i
        for rs, re, so, isf in [(max(0,fi-20),min(len(shape),fi+20),fs,True),
                                  (max(0,ti-20),min(len(shape),ti+20),ts,False)]:
            for i in range(rs, re):
                d = self._haversine(so.lat, so.lon, shape[i][0], shape[i][1])
                if isf and d < mf: mf, fi = d, i
                if not isf and d < mt: mt, ti = d, i
        if fi >= 0 and ti >= 0:
            return tuple(shape[fi:ti+1]) if fi <= ti else tuple(shape[ti:fi+1][::-1])
        return ()

    def _shape_path(self, tid, fsid, tsid):
        return list(self._shape_path_cached(tid, fsid, tsid))

    # walking
    def _decode_polyline(self, enc):
        pts=[]; idx=lat=lng=0
        while idx<len(enc):
            for c in range(2):
                r=s=0
                while True:
                    b=ord(enc[idx])-63; idx+=1; r|=(b&0x1f)<<s; s+=5
                    if b<0x20: break
                d=~(r>>1) if r&1 else r>>1
                if c==0: lat+=d
                else: lng+=d
            pts.append((lat*1e-5, lng*1e-5))
        return pts

    @lru_cache(maxsize=2000)
    def _walk_cached(self, flat, flon, tlat, tlon):
        ck = f"{flat:.5f},{flon:.5f}|{tlat:.5f},{tlon:.5f}"
        if ck in self._walk_route_cache: return tuple(self._walk_route_cache[ck])
        if self._haversine(flat,flon,tlat,tlon) < 50:
            pts=[(flat,flon),(tlat,tlon)]; self._walk_route_cache[ck]=pts; self._save_walk_cache()
            return tuple(pts)
        tk = os.getenv('TOMTOM_API_KEY','pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')
        if tk:
            try:
                resp=requests.get(f"https://api.tomtom.com/routing/1/calculateRoute/{flat},{flon}:{tlat},{tlon}/json",
                    params={'key':tk,'travelMode':'pedestrian','routeRepresentation':'polyline'}, timeout=5)
                if resp.status_code==200:
                    rts=resp.json().get('routes',[])
                    if rts:
                        raw=rts[0].get('legs',[{}])[0].get('points',[])
                        if isinstance(raw,dict) and 'encodedPolyline' in raw: pts=self._decode_polyline(raw['encodedPolyline'])
                        elif isinstance(raw,list) and raw: pts=[(p['latitude'],p['longitude']) for p in raw]
                        else: pts=[]
                        if len(pts)>=2:
                            self._walk_route_cache[ck]=pts; self._save_walk_cache(); return tuple(pts)
            except: pass
        pts=[(flat,flon),(tlat,tlon)]; self._walk_route_cache[ck]=pts
        if len(self._walk_route_cache)%50==0: self._save_walk_cache()
        return tuple(pts)

    def _walk(self, flat, flon, tlat, tlon):
        return list(self._walk_cached(flat, flon, tlat, tlon))

    # stop finding
    def _find_stops(self, lat, lon, pref=800, mx=15000, mn=1):
        for r in [pref, 1500, 3000, 5000, 8000, 10000, mx]:
            s = self.gtfs.find_nearby_stops(lat, lon, r)
            if len(s) >= mn:
                logger.info(f"Found {len(s)} stops within {r}m of ({lat:.4f},{lon:.4f})")
                return s
        logger.warning(f"No stops within {mx}m")
        return []

    # time adjustment
    def _find_usable_time(self, start_stops, end_stops, orig, window):
        for stop, _ in start_stops[:5]:
            if self.gtfs.get_next_departure(stop.stop_id, orig, window):
                return orig
        logger.info("No departures now — finding next service...")
        end_ids = {s.stop_id for s, _ in end_stops}
        best_conn = best_any = None
        for stop, _ in start_stops[:10]:
            for st in self.gtfs.stop_times_by_stop.get(stop.stop_id, []):
                t = self.gtfs.trips.get(st.trip_id)
                if not t or not self.gtfs._is_service_active_any_day(t.service_id, orig): continue
                ds = st.departure_time % 86400
                if best_any is None or ds < best_any: best_any = ds
                if self._route_stops.get(t.route_id, set()) & end_ids:
                    if best_conn is None or ds < best_conn: best_conn = ds
        chosen = best_conn if best_conn is not None else best_any
        if chosen is not None:
            adj = max(0, chosen - 300)
            h, rem = divmod(adj, 3600); m, s = divmod(rem, 60)
            try:
                t = orig.replace(hour=h, minute=m, second=s, microsecond=0)
                if t < orig: t += timedelta(days=1)
                logger.info(f"Adjusted to {t.strftime('%H:%M')}")
                return t
            except: pass
        try: return orig.replace(hour=8, minute=0, second=0, microsecond=0)
        except: return orig

    # main routing
    def find_route(self, start_lat, start_lon, end_lat, end_lon, start_time,
                   max_walk_distance=800, max_transfers=2,
                   time_window_minutes=120, num_alternatives=3):

        logger.info(f"Transit routing ({start_lat:.4f},{start_lon:.4f}) -> ({end_lat:.4f},{end_lon:.4f})")

        start_stops = self._find_stops(start_lat, start_lon, pref=max_walk_distance, mx=3000)
        end_stops = self._find_stops(end_lat, end_lon, pref=max_walk_distance, mx=15000)
        if not start_stops or not end_stops: return None

        eff_time = self._find_usable_time(start_stops, end_stops, start_time, time_window_minutes)
        eff_window = max(time_window_minutes, 360)

        # ── Run Dijkstra with increasing transfer limits ──
        # Try 0 transfers first. If nothing found, try 1, then 2.
        # This guarantees the direct bus always wins if it exists.
        all_goals = []
        for try_max_xfers in range(0, max_transfers + 1):
            goals = self._dijkstra(start_stops, end_stops, eff_time, eff_window, try_max_xfers)
            if goals:
                all_goals.extend(goals)
                logger.info(f"Found {len(goals)} routes with max {try_max_xfers} transfer(s)")
                # If we found direct routes (0 transfers), still try 1 transfer
                # for alternatives, but stop after that
                if try_max_xfers >= 1 and all_goals:
                    break

        if not all_goals:
            self._log_diag(start_stops, end_stops, eff_time, eff_window)
            return None

        # Sort: fewest transfers → least walking → shortest time
        all_goals.sort(key=lambda g: (
            self._count_xfers(g[1]),
            g[3],   # final walk distance (seconds of walking ~ proportional)
            g[0],   # arrival time
        ))
        unique = self._dedup(all_goals, num_alternatives)

        routes = []
        for idx, (total_time, final_state, end_stop, _) in enumerate(unique):
            steps = self._build_steps(final_state, end_stop, start_lat, start_lon, end_lat, end_lon)
            if not steps: continue
            ts = int((total_time - eff_time).total_seconds())
            td = sum(s.get('distance_meters', 0) for s in steps)
            wd = sum(s.get('distance_meters', 0) for s in steps if s['type'] == 'walk')
            rd = {
                'route_index': idx,
                'total_time_seconds': ts,
                'total_time_minutes': ts / 60,
                'total_distance_meters': round(td),
                'walk_distance_meters': round(wd),
                'transit_distance_meters': round(td - wd),
                'num_transfers': max(0, len([s for s in steps if s['type'] == 'transit']) - 1),
                'arrival_time': total_time.isoformat(),
                'start_time': start_time.isoformat(),
                'route_summary': self._summary(steps),
                'steps': steps,
                'start_location': {'lat': start_lat, 'lon': start_lon},
                'end_location': {'lat': end_lat, 'lon': end_lon},
                'route_ids_used': [s.get('route_short_name') for s in steps
                                   if s['type'] == 'transit' and s.get('route_short_name')],
            }
            if eff_time != start_time:
                rd['adjusted_departure_time'] = eff_time.isoformat()
                rd['note'] = (f"No service at {start_time.strftime('%I:%M %p')}. "
                              f"Showing route for {eff_time.strftime('%I:%M %p')}.")
            routes.append(rd)
        return routes if routes else None

    # dijkstra core
    def _dijkstra(self, start_stops, end_stops, eff_time, eff_window, max_xfers):
        """Run Dijkstra with a hard transfer cap.
        
        Transfer counting: boarding the FIRST bus = transfer 0.
        Each subsequent different bus = +1 transfer.
        So max_xfers=0 means direct bus only (no transfers).
        """
        pq = []
        best: Dict[tuple, float] = {}
        counter = 0
        end_map = {s.stop_id: (s, d) for s, d in end_stops[:20]}

        for stop, dist in start_stops[:15]:
            ws = dist / self.walking_speed
            arr = eff_time + timedelta(seconds=ws)
            pri = arr.timestamp()
            state = State(time=arr, node_id=stop.stop_id, transfers=0,
                          edge_type='walk', predecessor=None)
            k = (stop.stop_id, None, 0)
            best[k] = pri
            heapq.heappush(pq, (pri, stop.stop_id, counter, None, 0, state))
            counter += 1

        goals = []
        iters = 0
        MAX_ITER = 80000

        while pq and iters < MAX_ITER:
            if goals and iters > 12000: break
            iters += 1
            pri, cur_node, _, cur_trip, xfers, cur_state = heapq.heappop(pq)

            # Goal
            if cur_node in end_map:
                es, ed = end_map[cur_node]
                ws = ed / self.walking_speed
                total = cur_state.time + timedelta(seconds=ws)
                goals.append((total, cur_state, es, ws))
                continue

            # On bus: ride forward
            if cur_trip is not None:
                nxt = self._get_next_stop(cur_trip, cur_node)
                if nxt:
                    tt = self.gtfs.get_travel_time(cur_trip, cur_node, nxt)
                    if tt and tt > 0:
                        arr = cur_state.time + timedelta(seconds=tt)
                        npri = arr.timestamp() + xfers * TRANSFER_PENALTY
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

                # Alight (only if we haven't hit the transfer cap yet)
                if xfers < max_xfers:
                    at = cur_state.time + timedelta(seconds=self.walking_transfer_time)
                    npri = at.timestamp() + xfers * TRANSFER_PENALTY
                    a_s = State(time=at, node_id=cur_node, transfers=xfers,
                                predecessor=cur_state, edge_type='alight',
                                from_stop_id=cur_node)
                    k = (cur_node, None, xfers)
                    if k not in best or best[k] > npri:
                        best[k] = npri
                        heapq.heappush(pq, (npri, cur_node, counter, None, xfers, a_s))
                        counter += 1

            # Waiting: board a bus
            if cur_trip is None:
                deps = self.gtfs.get_next_departure(cur_node, cur_state.time, eff_window)
                for dep_time, trip_id, nxt_stop in deps[:15]:
                    tt = self.gtfs.get_travel_time(trip_id, cur_node, nxt_stop)
                    if not tt or tt <= 0: continue
                    trip = self.gtfs.trips.get(trip_id)
                    rid = trip.route_id if trip else None
                    ri = self._route_info.get(rid, {})

                    # Transfer counting: first bus = xfers stays same
                    # subsequent bus after alight = xfers already incremented
                    # But boarding itself costs a transfer only if we already
                    # rode a bus before (i.e., predecessor has transit)
                    has_prior_transit = False
                    s = cur_state
                    while s:
                        if s.edge_type == 'transit':
                            has_prior_transit = True
                            break
                        s = s.predecessor

                    new_xfers = xfers + 1 if has_prior_transit else xfers
                    if new_xfers > max_xfers: continue

                    arr = dep_time + timedelta(seconds=tt)
                    npri = arr.timestamp() + new_xfers * TRANSFER_PENALTY
                    ns = State(time=arr, node_id=nxt_stop, trip_id=trip_id,
                               route_id=rid,
                               route_short_name=ri.get('route_short_name', ''),
                               predecessor=cur_state, edge_type='transit',
                               from_stop_id=cur_node, to_stop_id=nxt_stop,
                               transfers=new_xfers)
                    k = (nxt_stop, trip_id, new_xfers)
                    if k not in best or best[k] > npri:
                        best[k] = npri
                        heapq.heappush(pq, (npri, nxt_stop, counter, trip_id, new_xfers, ns))
                        counter += 1

        return goals

    
    @staticmethod
    def _count_xfers(state):
        trips = set()
        s = state
        while s:
            if s.edge_type == 'transit' and s.trip_id: trips.add(s.trip_id)
            s = s.predecessor
        return max(0, len(trips) - 1)

    def _log_diag(self, ss, es, et, ew):
        logger.warning(f"No routes found — time={et.strftime('%H:%M')}")
        for stop, dist in ss[:5]:
            deps = self.gtfs.get_next_departure(stop.stop_id, et, ew)
            rts = [self._route_info.get(self.gtfs.trips.get(tid, None).route_id if self.gtfs.trips.get(tid) else '', {}).get('route_short_name', '?') for _, tid, _ in deps[:3]]
            logger.info(f"  Start {stop.stop_id} ({stop.name}): {len(deps)} deps, routes={rts}")
        for stop, dist in es[:5]:
            logger.info(f"  End {stop.stop_id} ({stop.name}): {dist:.0f}m")

    def _dedup(self, goals, mx):
        unique = []; seen = set()
        for t, fs, es, ws in goals:
            seq = []
            s = fs
            while s:
                if s.edge_type == 'transit' and s.route_short_name: seq.append(s.route_short_name)
                s = s.predecessor
            key = tuple(reversed(seq))
            if key not in seen:
                seen.add(key); unique.append((t, fs, es, ws))
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

   
    # build steps
    def _build_steps(self, final_state, end_stop, slat, slon, elat, elon):
        states = []
        s = final_state
        while s: states.insert(0, s); s = s.predecessor
        steps = []

        # Initial walk
        ft = next((st for st in states if st.edge_type == 'transit'), None)
        if ft and ft.from_stop_id:
            fs = self.gtfs.stops.get(ft.from_stop_id)
            if fs:
                pts = self._walk(slat, slon, fs.lat, fs.lon)
                d = self._path_distance(pts)
                steps.append({'type':'walk','from_location':{'lat':slat,'lon':slon},
                    'to_stop':self.gtfs.get_stop_name(fs.stop_id),'to_stop_id':fs.stop_id,
                    'to_location':{'lat':fs.lat,'lon':fs.lon},
                    'distance_meters':round(d),'duration_seconds':round(d/self.walking_speed),
                    'path_geometry':[[la,lo] for la,lo in pts]})

        i = 0
        while i < len(states):
            st = states[i]
            if st.edge_type == 'transit':
                tid = st.trip_id; run = []
                while i < len(states) and states[i].edge_type == 'transit' and states[i].trip_id == tid:
                    run.append(states[i]); i += 1
                fsid, tsid = run[0].from_stop_id, run[-1].to_stop_id
                fs, ts = self.gtfs.stops.get(fsid), self.gtfs.stops.get(tsid)
                if fs and ts:
                    shape = self._shape_path(tid, fsid, tsid)
                    rid = self._trip_to_route.get(tid, '')
                    ri = self._route_info.get(rid, {})
                    sl = self._trip_stop_cache.get(tid, [])
                    ss = next((sq for sid, sq in sl if sid == fsid), 0)
                    es = next((sq for sid, sq in sl if sid == tsid), 0)
                    steps.append({'type':'transit',
                        'route_short_name':ri.get('route_short_name',''),
                        'route_long_name':ri.get('route_long_name','').title(),
                        'trip_id':tid,
                        'start_stop':self.gtfs.get_stop_name(fsid),'start_stop_id':fsid,
                        'start_location':{'lat':fs.lat,'lon':fs.lon},
                        'end_stop':self.gtfs.get_stop_name(tsid),'end_stop_id':tsid,
                        'end_location':{'lat':ts.lat,'lon':ts.lon},
                        'num_stops':abs(es-ss),
                        'path_geometry':[[la,lo] for la,lo in shape] if shape else [[fs.lat,fs.lon],[ts.lat,ts.lon]]})
            elif st.edge_type == 'alight':
                nxt = next((states[j] for j in range(i+1,len(states)) if states[j].edge_type=='transit'), None)
                if nxt and nxt.from_stop_id:
                    fs, ts = self.gtfs.stops.get(st.node_id), self.gtfs.stops.get(nxt.from_stop_id)
                    if fs and ts and fs.stop_id != ts.stop_id:
                        pts = self._walk(fs.lat, fs.lon, ts.lat, ts.lon)
                        d = self._path_distance(pts)
                        steps.append({'type':'walk',
                            'from_stop':self.gtfs.get_stop_name(fs.stop_id),
                            'to_stop':self.gtfs.get_stop_name(ts.stop_id),
                            'from_location':{'lat':fs.lat,'lon':fs.lon},
                            'to_location':{'lat':ts.lat,'lon':ts.lon},
                            'distance_meters':round(d),'duration_seconds':round(d/self.walking_speed),
                            'path_geometry':[[la,lo] for la,lo in pts]})
                i += 1
            else: i += 1

        # Final walk
        lt = next((st for st in reversed(states) if st.edge_type == 'transit'), None)
        if lt and lt.to_stop_id:
            ls = self.gtfs.stops.get(lt.to_stop_id)
            if ls:
                pts = self._walk(ls.lat, ls.lon, elat, elon)
                d = self._path_distance(pts)
                steps.append({'type':'walk',
                    'from_stop':self.gtfs.get_stop_name(ls.stop_id),
                    'from_location':{'lat':ls.lat,'lon':ls.lon},
                    'to_stop':'Your Destination','to_location':{'lat':elat,'lon':elon},
                    'distance_meters':round(d),'duration_seconds':round(d/self.walking_speed),
                    'path_geometry':[[la,lo] for la,lo in pts]})
        return steps