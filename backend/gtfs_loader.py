"""
GTFS Data Loader for Pittsburgh Regional Transit
Handles loading and querying transit schedule data
Optimized with disk caching and lazy loading
"""
#gtfs_loader.py
import pandas as pd
import zipfile
from typing import Dict, List, Tuple, Optional
from datetime import datetime, timedelta
import os
import math
import logging
import bisect
import pickle
import hashlib
from dataclasses import dataclass
import json

logger = logging.getLogger(__name__)

@dataclass
class Stop:
    stop_id: str
    lat: float
    lon: float
    name: str
    parent_station: Optional[str] = None

@dataclass
class Trip:
    trip_id: str
    route_id: str
    service_id: str
    direction_id: Optional[str] = None

@dataclass
class StopTime:
    trip_id: str
    stop_id: str
    arrival_time: int
    departure_time: int
    stop_sequence: int

@dataclass
class Calendar:
    service_id: str
    monday: bool
    tuesday: bool
    wednesday: bool
    thursday: bool
    friday: bool
    saturday: bool
    sunday: bool
    start_date: int
    end_date: int

class GTFSLoader:
    def __init__(self, gtfs_zip_path: str, use_cache: bool = True):
        self.gtfs_zip_path = gtfs_zip_path
        self.use_cache = use_cache
        
        # Cache directory
        self.cache_dir = os.path.join(os.path.dirname(__file__), 'cache')
        os.makedirs(self.cache_dir, exist_ok=True)
        
        # Cache file path (based on file hash)
        self.cache_file = self._get_cache_path(gtfs_zip_path)
        
        # Data structures
        self.stops: Dict[str, Stop] = {}
        self.trips: Dict[str, Trip] = {}
        self.stop_times: Dict[str, List[StopTime]] = {}
        self.stop_times_by_stop: Dict[str, List[StopTime]] = {}
        self.calendar: Dict[str, Calendar] = {}
        self.calendar_dates: Dict[str, List[Tuple[int, int]]] = {}
        self._dep_times_by_stop: Dict[str, List[int]] = {}
        
        # Track if loaded
        self._loaded = False
        
        # Try to load from cache first
        if use_cache and self._load_from_cache():
            logger.info(f"GTFS loaded from cache: {len(self.stops)} stops, {len(self.trips)} trips")
            self._loaded = True
            self._prepare_bisect_index()
        else:
            # Load fresh from GTFS.zip
            self.load_gtfs(gtfs_zip_path)
            self._loaded = True
            self._prepare_bisect_index()
            # Save to cache for next time
            if use_cache:
                self._save_to_cache()
        
    def _get_cache_path(self, zip_path: str) -> str:
        """Generate cache file path based on GTFS file modification time and size"""
        cache_key = None
        if os.path.exists(zip_path):
            # Use file modification time + size as cache key
            stat = os.stat(zip_path)
            cache_key = f"{zip_path}_{stat.st_mtime}_{stat.st_size}"
            cache_key = hashlib.md5(cache_key.encode()).hexdigest()
        else:
            cache_key = "default_gtfs_cache"
        
        return os.path.join(self.cache_dir, f"gtfs_cache_{cache_key}.pkl")
    
    def _load_from_cache(self) -> bool:
        """Load GTFS data from disk cache"""
        try:
            if not os.path.exists(self.cache_file):
                return False
            
            # Check if GTFS.zip is newer than cache
            cache_mtime = os.path.getmtime(self.cache_file)
            zip_mtime = os.path.getmtime(self.gtfs_zip_path) if os.path.exists(self.gtfs_zip_path) else 0
            
            if zip_mtime > cache_mtime:
                logger.info("GTFS.zip is newer than cache, reloading...")
                return False
            
            with open(self.cache_file, 'rb') as f:
                cached_data = pickle.load(f)
            
            self.stops = cached_data.get('stops', {})
            self.trips = cached_data.get('trips', {})
            self.stop_times = cached_data.get('stop_times', {})
            self.stop_times_by_stop = cached_data.get('stop_times_by_stop', {})
            self.calendar = cached_data.get('calendar', {})
            self.calendar_dates = cached_data.get('calendar_dates', {})
            
            logger.info(f"Loaded GTFS from cache (age: {self._get_cache_age()})")
            return True
            
        except Exception as e:
            logger.warning(f"Failed to load GTFS from cache: {e}")
            return False
    
    def _get_cache_age(self) -> str:
        """Get human-readable cache age"""
        try:
            if os.path.exists(self.cache_file):
                age_seconds = time.time() - os.path.getmtime(self.cache_file)
                if age_seconds < 3600:
                    return f"{age_seconds / 60:.0f} minutes"
                elif age_seconds < 86400:
                    return f"{age_seconds / 3600:.1f} hours"
                else:
                    return f"{age_seconds / 86400:.1f} days"
        except:
            pass
        return "unknown"
    
    def _save_to_cache(self):
        """Save GTFS data to disk cache"""
        try:
            cached_data = {
                'stops': self.stops,
                'trips': self.trips,
                'stop_times': self.stop_times,
                'stop_times_by_stop': self.stop_times_by_stop,
                'calendar': self.calendar,
                'calendar_dates': self.calendar_dates,
                'timestamp': datetime.now().isoformat()
            }
            
            with open(self.cache_file, 'wb') as f:
                pickle.dump(cached_data, f, protocol=pickle.HIGHEST_PROTOCOL)
            
            logger.info(f"Saved GTFS to cache: {os.path.basename(self.cache_file)}")
        except Exception as e:
            logger.warning(f"Failed to save GTFS cache: {e}")
    
    def _safe_str(self, val) -> str:
        if pd.isna(val):
            return ''
        return str(val)
    
    def _safe_int(self, val) -> int:
        if pd.isna(val):
            return 0
        return int(val)
    
    def _safe_float(self, val) -> float:
        if pd.isna(val):
            return 0.0
        return float(val)
    
    def load_gtfs(self, zip_path: str):
        """Load GTFS from zip file - optimized with chunking and minimal memory"""
        try:
            logger.info(f"Loading GTFS from {zip_path}...")
            start_time = datetime.now()
            
            with zipfile.ZipFile(zip_path, 'r') as z:
                # ---- stops (small, load all) ----
                with z.open('stops.txt') as f:
                    stops_df = pd.read_csv(f, dtype=str)
                    for _, row in stops_df.iterrows():
                        stop = Stop(
                            stop_id=self._safe_str(row.get('stop_id', '')),
                            lat=self._safe_float(row.get('stop_lat', 0)),
                            lon=self._safe_float(row.get('stop_lon', 0)),
                            name=self._safe_str(row.get('stop_name', 'Unknown')),
                            parent_station=self._safe_str(row.get('parent_station')) if pd.notna(row.get('parent_station')) else None
                        )
                        if stop.stop_id:
                            self.stops[stop.stop_id] = stop
                
                # ---- trips (small, load all) ----
                with z.open('trips.txt') as f:
                    trips_df = pd.read_csv(f, dtype=str)
                    for _, row in trips_df.iterrows():
                        trip = Trip(
                            trip_id=self._safe_str(row.get('trip_id', '')),
                            route_id=self._safe_str(row.get('route_id', '')),
                            service_id=self._safe_str(row.get('service_id', '')),
                            direction_id=self._safe_str(row.get('direction_id')) if pd.notna(row.get('direction_id')) else None
                        )
                        if trip.trip_id:
                            self.trips[trip.trip_id] = trip
                
                # ---- stop times (large - use chunking) ----
                with z.open('stop_times.txt') as f:
                    chunk_size = 100000  # Larger chunks for better performance
                    for chunk in pd.read_csv(f, chunksize=chunk_size, dtype=str, low_memory=False):
                        for _, row in chunk.iterrows():
                            try:
                                trip_id = self._safe_str(row.get('trip_id', ''))
                                stop_id = self._safe_str(row.get('stop_id', ''))
                                if not trip_id or not stop_id:
                                    continue
                                arrival_str = self._safe_str(row.get('arrival_time', ''))
                                departure_str = self._safe_str(row.get('departure_time', ''))
                                if not arrival_str or not departure_str:
                                    continue
                                st = StopTime(
                                    trip_id=trip_id,
                                    stop_id=stop_id,
                                    arrival_time=self._time_to_seconds(arrival_str),
                                    departure_time=self._time_to_seconds(departure_str),
                                    stop_sequence=self._safe_int(row.get('stop_sequence', 0))
                                )
                                self.stop_times.setdefault(trip_id, []).append(st)
                                self.stop_times_by_stop.setdefault(stop_id, []).append(st)
                            except Exception:
                                continue
                
                # ---- sort stop times per trip ----
                for trip_id in self.stop_times:
                    self.stop_times[trip_id].sort(key=lambda x: x.stop_sequence)
                
                # ---- calendar ----
                with z.open('calendar.txt') as f:
                    cal_df = pd.read_csv(f, dtype=str)
                    for _, row in cal_df.iterrows():
                        cal = Calendar(
                            service_id=self._safe_str(row.get('service_id', '')),
                            monday=self._safe_str(row.get('monday', '0')) == '1',
                            tuesday=self._safe_str(row.get('tuesday', '0')) == '1',
                            wednesday=self._safe_str(row.get('wednesday', '0')) == '1',
                            thursday=self._safe_str(row.get('thursday', '0')) == '1',
                            friday=self._safe_str(row.get('friday', '0')) == '1',
                            saturday=self._safe_str(row.get('saturday', '0')) == '1',
                            sunday=self._safe_str(row.get('sunday', '0')) == '1',
                            start_date=self._safe_int(row.get('start_date', 0)),
                            end_date=self._safe_int(row.get('end_date', 0))
                        )
                        if cal.service_id:
                            self.calendar[cal.service_id] = cal
                
                # ---- calendar_dates (if exists) ----
                if 'calendar_dates.txt' in z.namelist():
                    with z.open('calendar_dates.txt') as f:
                        dates_df = pd.read_csv(f, dtype=str)
                        for _, row in dates_df.iterrows():
                            service_id = self._safe_str(row.get('service_id', ''))
                            date_int = self._safe_int(row.get('date', 0))
                            exception_type = self._safe_int(row.get('exception_type', 0))
                            if service_id:
                                self.calendar_dates.setdefault(service_id, []).append((date_int, exception_type))
            
            load_time = (datetime.now() - start_time).total_seconds()
            logger.info(f"Loaded GTFS fresh: {len(self.stops)} stops, {len(self.trips)} trips, "
                        f"{len(self.stop_times)} trip patterns - took {load_time:.1f}s")
        except Exception as e:
            logger.error(f"Error loading GTFS: {e}")
            raise
    
    def _prepare_bisect_index(self):
        """Build sorted departure time arrays for binary search in get_next_departure"""
        for stop_id, times in self.stop_times_by_stop.items():
            times.sort(key=lambda st: st.departure_time)
            self._dep_times_by_stop[stop_id] = [st.departure_time for st in times]
    
    def _time_to_seconds(self, time_str: str) -> int:
        if not time_str or pd.isna(time_str):
            return 0
        parts = str(time_str).split(':')
        if len(parts) != 3:
            return 0
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = int(parts[2])
        return hours * 3600 + minutes * 60 + seconds
    
    def _is_service_active(self, service_id: str, date: datetime) -> bool:
        date_int = int(date.strftime('%Y%m%d'))
        # Check calendar_dates exceptions first
        if service_id in self.calendar_dates:
            for exc_date, exc_type in self.calendar_dates[service_id]:
                if exc_date == date_int:
                    return exc_type == 1      # 1 = added, 2 = removed
        if service_id not in self.calendar:
            return False
        cal = self.calendar[service_id]
        if date_int < cal.start_date or date_int > cal.end_date:
            return False
        weekday = date.weekday()
        day_flags = [cal.monday, cal.tuesday, cal.wednesday,
                     cal.thursday, cal.friday, cal.saturday, cal.sunday]
        return day_flags[weekday]
    
    def get_next_departure(self, stop_id: str, after_time: datetime, time_window_minutes: int = 120) -> List[Tuple[datetime, str, str]]:
        """
        Returns list of (departure_datetime, trip_id, next_stop_id) for departures
        within the time window (including next‑day overruns).
        """
        if not self._loaded or stop_id not in self.stop_times_by_stop:
            return []
        
        current_seconds = after_time.hour * 3600 + after_time.minute * 60 + after_time.second
        max_seconds = current_seconds + (time_window_minutes * 60)
        max_seconds_extended = max_seconds + 86400   # allow for trips that start after midnight
        
        # Binary search to first departure >= current_seconds
        dep_times = self._dep_times_by_stop.get(stop_id, [])
        if not dep_times:
            return []
        
        start_idx = bisect.bisect_left(dep_times, current_seconds)
        
        departures = []
        # Limit to first 50 results for performance
        stop_times_list = self.stop_times_by_stop[stop_id][start_idx:start_idx + 200]
        
        for stop_time in stop_times_list:
            dep_sec = stop_time.departure_time
            # Accept if within today's window OR next‑day window (>=86400)
            in_window = (current_seconds <= dep_sec <= max_seconds) or (dep_sec >= 86400 and dep_sec <= max_seconds_extended)
            if not in_window:
                continue
            
            trip = self.trips.get(stop_time.trip_id)
            if not trip:
                continue
            if not self._is_service_active(trip.service_id, after_time):
                continue
            
            # Find next stop (cached lookup)
            trip_stops = self.stop_times.get(stop_time.trip_id, [])
            next_stop_id = None
            for i, ts in enumerate(trip_stops):
                if ts.stop_id == stop_id and i + 1 < len(trip_stops):
                    next_stop_id = trip_stops[i + 1].stop_id
                    break
            if not next_stop_id:
                continue
            
            # Build datetime efficiently
            days_to_add = dep_sec // 86400
            sec_in_day = dep_sec % 86400
            hours = sec_in_day // 3600
            minutes = (sec_in_day % 3600) // 60
            seconds = sec_in_day % 60
            
            try:
                dep_dt = after_time.replace(hour=hours, minute=minutes, second=seconds, microsecond=0)
                if days_to_add > 0:
                    dep_dt += timedelta(days=days_to_add)
                if dep_dt < after_time:
                    dep_dt += timedelta(days=1)
            except Exception:
                # fallback
                delta_sec = dep_sec - current_seconds
                if delta_sec < 0:
                    delta_sec += 86400
                dep_dt = after_time + timedelta(seconds=delta_sec)
            
            departures.append((dep_dt, stop_time.trip_id, next_stop_id))
            
            if len(departures) >= 20:
                break
        
        departures.sort(key=lambda x: x[0])
        return departures
    
    def get_travel_time(self, trip_id: str, from_stop_id: str, to_stop_id: str) -> Optional[int]:
        if not self._loaded:
            return None
        trip_stops = self.stop_times.get(trip_id, [])
        from_time = None
        to_time = None
        for st in trip_stops:
            if st.stop_id == from_stop_id:
                from_time = st.departure_time
            if st.stop_id == to_stop_id:
                to_time = st.arrival_time
            if from_time is not None and to_time is not None:
                return to_time - from_time
        return None
    
    def find_nearby_stops(self, lat: float, lon: float, radius_meters: float = 500) -> List[Tuple[Stop, float]]:
        if not self._loaded:
            return []
        nearby = []
        for stop in self.stops.values():
            try:
                dist = self._haversine_distance(lat, lon, stop.lat, stop.lon)
                if dist <= radius_meters:
                    nearby.append((stop, dist))
            except Exception:
                continue
        nearby.sort(key=lambda x: x[1])
        return nearby[:20]  # Limit to 20 nearest stops
    
    def _haversine_distance(self, lat1, lon1, lat2, lon2) -> float:
        R = 6371000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlam = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    def get_stop_name(self, stop_id: str) -> str:
        """Return human‑readable, title‑cased stop name."""
        if not self._loaded:
            return f"Stop {stop_id}"
        stop = self.stops.get(str(stop_id))
        if stop and stop.name:
            # Convert ALL CAPS PRT names to Title Case
            return stop.name.title()
        return f"Stop {stop_id}"
    
    def force_reload(self):
        """Force reload GTFS data from source"""
        logger.info("Forcing GTFS reload...")
        self._loaded = False
        self.load_gtfs(self.gtfs_zip_path)
        self._prepare_bisect_index()
        if self.use_cache:
            self._save_to_cache()
        self._loaded = True
        logger.info("GTFS reload complete")
    
    def is_loaded(self) -> bool:
        return self._loaded
    
    def get_stats(self) -> Dict:
        """Get statistics about loaded data"""
        return {
            'stops': len(self.stops),
            'trips': len(self.trips),
            'stop_times': len(self.stop_times),
            'stop_times_by_stop': len(self.stop_times_by_stop),
            'calendar': len(self.calendar),
            'calendar_dates': len(self.calendar_dates),
            'loaded': self._loaded,
            'cache_file': self.cache_file if self.use_cache else None
        }