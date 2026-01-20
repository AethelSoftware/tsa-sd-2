"""
Monitor external hazard sources and integrate with tracking system.
"""

import requests
import json
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass
from enum import Enum
import os
from concurrent.futures import ThreadPoolExecutor

from real_time_tracker import Hazard, HazardType, Position

logger = logging.getLogger(__name__)

class HazardSource(Enum):
    """Sources of hazard information"""
    CRIME_DATA = "crime_data"
    FIRE_DEPT = "fire_department"
    WEATHER = "weather"
    TRAFFIC = "traffic"
    CONSTRUCTION = "construction"
    CUSTOM = "custom"

@dataclass
class HazardReport:
    """External hazard report"""
    source: HazardSource
    external_id: str
    hazard_type: str
    latitude: float
    longitude: float
    radius_meters: float
    severity: float
    description: str
    start_time: datetime
    end_time: Optional[datetime]
    confidence: float = 0.8
    
    def to_hazard(self) -> Hazard:
        """Convert to internal Hazard object"""
        # Map external hazard types to internal types
        type_mapping = {
            'crime': HazardType.CRIME,
            'fire': HazardType.FIRE,
            'weather': HazardType.DISASTER,
            'traffic': HazardType.CONGESTION,
            'construction': HazardType.CONSTRUCTION,
            'accessibility': HazardType.ACCESSIBILITY
        }
        
        hazard_type = type_mapping.get(
            self.hazard_type.lower(),
            HazardType.CRIME
        )
        
        return Hazard(
            type=hazard_type,
            position=Position(
                lat=self.latitude,
                lng=self.longitude
            ),
            radius=self.radius_meters,
            severity=self.severity,
            description=f"[{self.source.value}] {self.description}",
            timestamp=time.time()
        )

class HazardMonitor:
    """Monitor external hazard sources"""
    
    def __init__(self, tracker):
        self.tracker = tracker
        self.executor = ThreadPoolExecutor(max_workers=3)
        self.sources = self._initialize_sources()
        self.update_interval = 60  # Update every minute
        
        # Start monitoring
        self._start_monitoring()
    
    def _initialize_sources(self):
        """Initialize hazard data sources"""
        sources = []
        
        # Crime data source (using Pittsburgh open data as example)
        if os.environ.get('WPRDC_API_ENABLED', 'true').lower() == 'true':
            sources.append({
                'name': 'Pittsburgh Crime',
                'type': HazardSource.CRIME_DATA,
                'url': 'https://data.wprdc.org/api/3/action/datastore_search',
                'resource_id': '1797ead8-8262-41cc-9099-cbc8a161924b',  # Police incident data
                'update_interval': 300,  # 5 minutes
                'last_update': 0
            })
        
        # Weather alerts
        if os.environ.get('OPENWEATHER_API_KEY'):
            sources.append({
                'name': 'Weather Alerts',
                'type': HazardSource.WEATHER,
                'url': 'https://api.openweathermap.org/data/2.5/onecall',
                'api_key': os.environ.get('OPENWEATHER_API_KEY'),
                'update_interval': 600,  # 10 minutes
                'last_update': 0
            })
        
        # FEMA disaster alerts
        if os.environ.get('FEMA_API_ENABLED', 'true').lower() == 'true':
            sources.append({
                'name': 'FEMA Disasters',
                'type': HazardSource.FIRE_DEPT,
                'url': 'https://www.fema.gov/api/open/v1/DisasterDeclarationsSummaries',
                'update_interval': 3600,  # 1 hour
                'last_update': 0
            })
        
        return sources
    
    def _start_monitoring(self):
        """Start monitoring all sources"""
        import threading
        
        def monitor_loop():
            while True:
                try:
                    self._update_all_sources()
                    time.sleep(self.update_interval)
                except Exception as e:
                    logger.error(f"Monitoring loop error: {e}")
                    time.sleep(30)
        
        thread = threading.Thread(target=monitor_loop, daemon=True)
        thread.start()
        
        logger.info(f"Hazard monitoring started with {len(self.sources)} sources")
    
    def _update_all_sources(self):
        """Update all hazard sources"""
        current_time = time.time()
        
        for source in self.sources:
            try:
                if current_time - source['last_update'] >= source['update_interval']:
                    self.executor.submit(self._update_source, source)
                    source['last_update'] = current_time
            except Exception as e:
                logger.error(f"Error scheduling update for {source['name']}: {e}")
    
    def _update_source(self, source: Dict):
        """Update a single hazard source"""
        try:
            if source['type'] == HazardSource.CRIME_DATA:
                hazards = self._fetch_crime_data(source)
            elif source['type'] == HazardSource.WEATHER:
                hazards = self._fetch_weather_alerts(source)
            elif source['type'] == HazardSource.FIRE_DEPT:
                hazards = self._fetch_fema_alerts(source)
            else:
                hazards = []
            
            # Add hazards to tracker
            for hazard in hazards:
                self.tracker.add_hazard(hazard.to_hazard())
            
            logger.info(f"Updated {source['name']}: {len(hazards)} new hazards")
            
        except Exception as e:
            logger.error(f"Error updating {source['name']}: {e}")
    
    def _fetch_crime_data(self, source: Dict) -> List[HazardReport]:
        """Fetch crime data from WPRDC"""
        hazards = []
        
        try:
            # Get recent crimes (last 24 hours)
            end_date = datetime.now()
            start_date = end_date - timedelta(hours=24)
            
            params = {
                'resource_id': source['resource_id'],
                'limit': 50,
                'filters': json.dumps({
                    'INCIDENTTIME': {
                        '$gte': start_date.isoformat(),
                        '$lte': end_date.isoformat()
                    }
                })
            }
            
            response = requests.get(source['url'], params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            if data.get('success'):
                records = data['result'].get('records', [])
                
                for record in records:
                    try:
                        lat = float(record.get('LAT', 0))
                        lng = float(record.get('LON', 0))
                        
                        if lat == 0 or lng == 0:
                            continue
                        
                        # Categorize crime type
                        offense = record.get('OFFENSES', '').lower()
                        
                        if any(word in offense for word in ['assault', 'robbery', 'burglary']):
                            hazard_type = 'crime'
                            severity = 0.8
                            radius = 200
                        elif any(word in offense for word in ['theft', 'larceny']):
                            hazard_type = 'crime'
                            severity = 0.5
                            radius = 150
                        else:
                            continue
                        
                        hazard = HazardReport(
                            source=source['type'],
                            external_id=record.get('PK', ''),
                            hazard_type=hazard_type,
                            latitude=lat,
                            longitude=lng,
                            radius_meters=radius,
                            severity=severity,
                            description=f"Police incident: {record.get('OFFENSES', 'Unknown')}",
                            start_time=datetime.fromisoformat(record.get('INCIDENTTIME', end_date.isoformat())),
                            end_time=datetime.now() + timedelta(hours=6),
                            confidence=0.7
                        )
                        
                        hazards.append(hazard)
                        
                    except (ValueError, KeyError) as e:
                        continue
            
        except Exception as e:
            logger.error(f"Error fetching crime data: {e}")
        
        return hazards
    
    def _fetch_weather_alerts(self, source: Dict) -> List[HazardReport]:
        """Fetch weather alerts from OpenWeatherMap"""
        hazards = []
        
        try:
            # Pittsburgh coordinates as default
            lat = 40.4406
            lng = -79.9959
            
            params = {
                'lat': lat,
                'lon': lng,
                'exclude': 'minutely,hourly,daily',
                'appid': source['api_key']
            }
            
            response = requests.get(source['url'], params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            # Check for severe weather
            if 'alerts' in data:
                for alert in data['alerts']:
                    severity_map = {
                        'Extreme': 0.9,
                        'Severe': 0.7,
                        'Moderate': 0.5,
                        'Minor': 0.3
                    }
                    
                    severity = severity_map.get(alert.get('severity', 'Moderate'), 0.5)
                    
                    hazard = HazardReport(
                        source=source['type'],
                        external_id=alert.get('id', ''),
                        hazard_type='weather',
                        latitude=lat,
                        longitude=lng,
                        radius_meters=5000,  # 5km radius for weather
                        severity=severity,
                        description=f"Weather alert: {alert.get('event', 'Severe Weather')} - {alert.get('description', '')[:100]}",
                        start_time=datetime.fromtimestamp(alert.get('start', time.time())),
                        end_time=datetime.fromtimestamp(alert.get('end', time.time() + 3600)),
                        confidence=0.8
                    )
                    
                    hazards.append(hazard)
            
        except Exception as e:
            logger.error(f"Error fetching weather alerts: {e}")
        
        return hazards
    
    def _fetch_fema_alerts(self, source: Dict) -> List[HazardReport]:
        """Fetch FEMA disaster declarations"""
        hazards = []
        
        try:
            # Get recent disaster declarations
            response = requests.get(source['url'], timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            # Filter for recent and relevant disasters
            for record in data.get('DisasterDeclarationsSummaries', [])[:10]:
                try:
                    # Only include disasters from last 30 days
                    declaration_date = datetime.strptime(
                        record.get('declarationDate', ''),
                        '%Y-%m-%dT%H:%M:%S.%fZ'
                    )
                    
                    if (datetime.now() - declaration_date).days > 30:
                        continue
                    
                    # Pittsburgh area disasters
                    if record.get('state', '') == 'PA':
                        hazard = HazardReport(
                            source=source['type'],
                            external_id=record.get('id', ''),
                            hazard_type='weather',
                            latitude=40.4406,  # Pittsburgh
                            longitude=-79.9959,
                            radius_meters=10000,  # 10km radius
                            severity=0.6,
                            description=f"FEMA: {record.get('incidentType', 'Disaster')} - {record.get('declarationTitle', '')}",
                            start_time=declaration_date,
                            end_time=declaration_date + timedelta(days=30),
                            confidence=0.7
                        )
                        
                        hazards.append(hazard)
                        
                except (ValueError, KeyError):
                    continue
            
        except Exception as e:
            logger.error(f"Error fetching FEMA data: {e}")
        
        return hazards
    
    def add_custom_hazard(self, lat: float, lng: float, hazard_type: str,
                         description: str, severity: float = 0.5):
        """Add a custom hazard report"""
        hazard = HazardReport(
            source=HazardSource.CUSTOM,
            external_id=f"custom_{int(time.time())}",
            hazard_type=hazard_type,
            latitude=lat,
            longitude=lng,
            radius_meters=100,
            severity=severity,
            description=description,
            start_time=datetime.now(),
            end_time=datetime.now() + timedelta(hours=2),
            confidence=0.9
        )
        
        self.tracker.add_hazard(hazard.to_hazard())
        logger.info(f"Added custom hazard: {description}")