"""
GTFS Data Loader for Pittsburgh Regional Transit
Handles loading and querying transit schedule data
"""

import pandas as pd
import zipfile
from typing import Dict, List, Tuple, Optional
from datetime import datetime, timedelta
import os
import math
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class Stop:
    """GTFS stop"""
    stop_id: str
    lat: float
    lon: float
    name: str
    parent_station: Optional[str] = None

@dataclass
class Trip:
    """GTFS trip"""
    trip_id: str
    route_id: str
    service_id: str
    direction_id: Optional[str] = None

@dataclass
class StopTime:
    """GTFS stop time"""
    trip_id: str
    stop_id: str
    arrival_time: int  # seconds since midnight
    departure_time: int  # seconds since midnight
    stop_sequence: int

@dataclass
class Calendar:
    """GTFS calendar entry"""
    service_id: str
    monday: bool
    tuesday: bool
    wednesday: bool
    thursday: bool
    friday: bool
    saturday: bool
    sunday: bool
    start_date: int  # YYYYMMDD
    end_date: int  # YYYYMMDD

class GTFSLoader:
    """Load and manage GTFS data for transit routing"""
    
    def __init__(self, gtfs_zip_path: str):
        """
        Initialize GTFS loader
        
        Args:
            gtfs_zip_path: Path to GTFS static zip file
        """
        self.stops: Dict[str, Stop] = {}
        self.trips: Dict[str, Trip] = {}
        self.stop_times: Dict[str, List[StopTime]] = {}  # trip_id -> list of stop times
        self.stop_times_by_stop: Dict[str, List[StopTime]] = {}  # stop_id -> list of stop times
        self.calendar: Dict[str, Calendar] = {}
        
        self.load_gtfs(gtfs_zip_path)
        
    def _safe_str(self, val) -> str:
        """Safely convert to string"""
        if pd.isna(val):
            return ''
        return str(val)
    
    def _safe_int(self, val) -> int:
        """Safely convert to int"""
        if pd.isna(val):
            return 0
        return int(val)
    
    def _safe_float(self, val) -> float:
        """Safely convert to float"""
        if pd.isna(val):
            return 0.0
        return float(val)
    
    def load_gtfs(self, zip_path: str):
        """Load all GTFS files with error handling"""
        try:
            with zipfile.ZipFile(zip_path, 'r') as z:
                # Load stops
                logger.info("Loading stops...")
                with z.open('stops.txt') as f:
                    stops_df = pd.read_csv(f, dtype=str)
                    for _, row in stops_df.iterrows():
                        try:
                            stop = Stop(
                                stop_id=self._safe_str(row.get('stop_id', '')),
                                lat=self._safe_float(row.get('stop_lat', 0)),
                                lon=self._safe_float(row.get('stop_lon', 0)),
                                name=self._safe_str(row.get('stop_name', 'Unknown')),
                                parent_station=self._safe_str(row.get('parent_station')) if pd.notna(row.get('parent_station')) else None
                            )
                            if stop.stop_id:
                                self.stops[stop.stop_id] = stop
                        except Exception as e:
                            logger.warning(f"Error loading stop: {e}")
                            continue
                
                # Load trips
                logger.info("Loading trips...")
                with z.open('trips.txt') as f:
                    trips_df = pd.read_csv(f, dtype=str)
                    for _, row in trips_df.iterrows():
                        try:
                            trip = Trip(
                                trip_id=self._safe_str(row.get('trip_id', '')),
                                route_id=self._safe_str(row.get('route_id', '')),
                                service_id=self._safe_str(row.get('service_id', '')),
                                direction_id=self._safe_str(row.get('direction_id')) if pd.notna(row.get('direction_id')) else None
                            )
                            if trip.trip_id:
                                self.trips[trip.trip_id] = trip
                        except Exception as e:
                            logger.warning(f"Error loading trip: {e}")
                            continue
                
                # Load stop times - use chunks to handle large files
                logger.info("Loading stop times (this may take a moment)...")
                with z.open('stop_times.txt') as f:
                    # Read in chunks to handle large files
                    chunk_size = 50000
                    chunk_iter = pd.read_csv(f, chunksize=chunk_size, dtype=str, low_memory=False)
                    
                    for chunk_num, chunk in enumerate(chunk_iter):
                        logger.info(f"Processing stop times chunk {chunk_num + 1}...")
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
                                
                                stop_time = StopTime(
                                    trip_id=trip_id,
                                    stop_id=stop_id,
                                    arrival_time=self._time_to_seconds(arrival_str),
                                    departure_time=self._time_to_seconds(departure_str),
                                    stop_sequence=self._safe_int(row.get('stop_sequence', 0))
                                )
                                
                                # Add to trip's stop times
                                if trip_id not in self.stop_times:
                                    self.stop_times[trip_id] = []
                                self.stop_times[trip_id].append(stop_time)
                                
                                # Add to stop's stop times
                                if stop_id not in self.stop_times_by_stop:
                                    self.stop_times_by_stop[stop_id] = []
                                self.stop_times_by_stop[stop_id].append(stop_time)
                                
                            except Exception as e:
                                # Skip problematic rows
                                continue
                
                # Sort stop times by sequence for each trip
                logger.info("Sorting stop times...")
                for trip_id in self.stop_times:
                    self.stop_times[trip_id].sort(key=lambda x: x.stop_sequence)
                
                # Load calendar
                logger.info("Loading calendar...")
                with z.open('calendar.txt') as f:
                    calendar_df = pd.read_csv(f, dtype=str)
                    for _, row in calendar_df.iterrows():
                        try:
                            calendar = Calendar(
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
                            if calendar.service_id:
                                self.calendar[calendar.service_id] = calendar
                        except Exception as e:
                            logger.warning(f"Error loading calendar: {e}")
                            continue
            
            logger.info(f"Loaded GTFS data: {len(self.stops)} stops, {len(self.trips)} trips, {len(self.stop_times)} trips with stop times")
            
        except Exception as e:
            logger.error(f"Error loading GTFS data: {e}")
            raise
    
    def _time_to_seconds(self, time_str: str) -> int:
        """Convert GTFS time string (HH:MM:SS) to seconds since midnight"""
        try:
            # Handle empty or invalid strings
            if not time_str or pd.isna(time_str):
                return 0
            
            # Handle times > 24:00:00 (e.g., 25:30:00)
            parts = str(time_str).split(':')
            if len(parts) != 3:
                return 0
            
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = int(parts[2])
            
            # Keep the full hours - don't mod by 24
            # This allows us to handle times like 25:30:00 correctly
            return hours * 3600 + minutes * 60 + seconds
        except Exception as e:
            logger.warning(f"Error parsing time {time_str}: {e}")
            return 0
    
    def _is_service_active(self, service_id: str, date: datetime) -> bool:
        """Check if a service is active on a given date"""
        if service_id not in self.calendar:
            return False
        
        cal = self.calendar[service_id]
        date_int = int(date.strftime('%Y%m%d'))
        
        # Check if date is within service period
        if date_int < cal.start_date or date_int > cal.end_date:
            return False
        
        # Check day of week
        weekday = date.weekday()  # Monday=0, Sunday=6
        day_flags = [cal.monday, cal.tuesday, cal.wednesday, cal.thursday, 
                    cal.friday, cal.saturday, cal.sunday]
        
        return day_flags[weekday]
    
    def get_next_departure(self, stop_id: str, after_time: datetime, time_window_minutes: int = 60) -> List[Tuple[datetime, str, str]]:
        """
        Get next departures from a stop after a given time
        
        Returns:
            List of (departure_time, trip_id, next_stop_id) tuples
        """
        if stop_id not in self.stop_times_by_stop:
            return []
        
        current_seconds = after_time.hour * 3600 + after_time.minute * 60 + after_time.second
        
        departures = []
        for stop_time in self.stop_times_by_stop[stop_id]:
            # Skip if departure time is before current time
            if stop_time.departure_time < current_seconds:
                continue

                        # Skip if departure time is beyond our time window
            max_seconds = current_seconds + (time_window_minutes * 60)
            if stop_time.departure_time > max_seconds:
                continue
            
            trip = self.trips.get(stop_time.trip_id)
            if not trip:
                continue
            
            # Check if service is active today
            if not self._is_service_active(trip.service_id, after_time):
                continue
            
            # Find next stop after this one
            trip_stops = self.stop_times.get(stop_time.trip_id, [])
            next_stop_id = None
            for i, ts in enumerate(trip_stops):
                if ts.stop_id == stop_id and i + 1 < len(trip_stops):
                    next_stop_id = trip_stops[i + 1].stop_id
                    break
            
            if next_stop_id:
                # Handle times > 24:00:00 (next day)
                total_seconds = stop_time.departure_time
                days_to_add = total_seconds // 86400  # 86400 seconds in a day
                seconds_in_day = total_seconds % 86400
                
                hours = seconds_in_day // 3600
                minutes = (seconds_in_day % 3600) // 60
                seconds = seconds_in_day % 60
                
                try:
                    # Create base datetime
                    departure_datetime = after_time.replace(
                        hour=hours,
                        minute=minutes,
                        second=seconds,
                        microsecond=0
                    )
                    
                    # Add days if needed
                    if days_to_add > 0:
                        departure_datetime = departure_datetime + timedelta(days=days_to_add)
                    
                    # If the resulting time is still before after_time, add one more day
                    if departure_datetime < after_time:
                        departure_datetime = departure_datetime + timedelta(days=1)
                    
                    departures.append((departure_datetime, stop_time.trip_id, next_stop_id))
                except Exception as e:
                    # Fallback: create datetime by adding seconds
                    logger.debug(f"Time conversion fallback for {stop_time.departure_time}: {e}")
                    seconds_to_add = stop_time.departure_time - current_seconds
                    if seconds_to_add < 0:
                        seconds_to_add += 86400
                    departure_datetime = after_time + timedelta(seconds=seconds_to_add)
                    departures.append((departure_datetime, stop_time.trip_id, next_stop_id))
        
        # Sort by departure time
        departures.sort(key=lambda x: x[0])
        return departures[:10]  # Return next 10 departures
    
    def get_travel_time(self, trip_id: str, from_stop_id: str, to_stop_id: str) -> Optional[int]:
        """
        Get travel time between two stops on a trip (in seconds)
        """
        trip_stops = self.stop_times.get(trip_id, [])
        
        from_time = None
        to_time = None
        
        for stop_time in trip_stops:
            if stop_time.stop_id == from_stop_id:
                from_time = stop_time.departure_time
            if stop_time.stop_id == to_stop_id:
                to_time = stop_time.arrival_time
            
            if from_time is not None and to_time is not None:
                return to_time - from_time
        
        return None
    
    def find_nearby_stops(self, lat: float, lon: float, radius_meters: float = 500) -> List[Tuple[Stop, float]]:
        """
        Find stops within a radius of a location
        
        Returns:
            List of (stop, distance) tuples
        """
        nearby = []
        for stop in self.stops.values():
            try:
                distance = self._haversine_distance(lat, lon, stop.lat, stop.lon)
                if distance <= radius_meters:
                    nearby.append((stop, distance))
            except Exception as e:
                logger.debug(f"Error calculating distance for stop {stop.stop_id}: {e}")
                continue
        
        # Sort by distance
        nearby.sort(key=lambda x: x[1])
        return nearby
    
    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate distance between two points in meters"""
        R = 6371000  # Earth's radius in meters
        
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)
        
        a = math.sin(delta_phi/2) * math.sin(delta_phi/2) + \
            math.cos(phi1) * math.cos(phi2) * \
            math.sin(delta_lambda/2) * math.sin(delta_lambda/2)
        
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        
        return R * c