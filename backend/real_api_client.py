"""
Real API client for fetching actual data from all available sources.
"""

import os
import requests
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import time

logger = logging.getLogger(__name__)

class RealAPIClient:
    """Client for fetching real data from various APIs"""
    
    def __init__(self):
        self.session = requests.Session()
        self.session.timeout = 10
        
        # Load API keys from environment
        self.openweather_key = os.getenv('OPENWEATHER_API_KEY')
        self.weatherapi_key = os.getenv('WEATHERAPI_KEY')
        self.visualcrossing_key = os.getenv('VISUALCROSSING_API_KEY')
        self.tomtom_key = os.getenv('TOMTOM_API_KEY')
        self.census_key = os.getenv('CENSUS_API_KEY')
        self.bea_key = os.getenv('BEA_API_KEY')
        
    def get_weather_data(self, lat: float, lng: float) -> Dict:
        """Get real weather data from OpenWeatherMap"""
        try:
            url = "https://api.openweathermap.org/data/2.5/weather"
            params = {
                'lat': lat,
                'lon': lng,
                'appid': self.openweather_key,
                'units': 'metric'
            }
            
            response = self.session.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            weather_score = 0.8  # Default good weather
            
            # Calculate weather safety score
            weather_main = data.get('weather', [{}])[0].get('main', '').lower()
            temp = data.get('main', {}).get('temp', 20)
            visibility = data.get('visibility', 10000) / 10000  # Normalize
            wind_speed = data.get('wind', {}).get('speed', 0)
            
            # Adjust score based on conditions
            if any(cond in weather_main for cond in ['thunderstorm', 'tornado', 'hurricane']):
                weather_score = 0.2
            elif any(cond in weather_main for cond in ['snow', 'sleet', 'hail']):
                weather_score = 0.4
            elif any(cond in weather_main for cond in ['rain', 'drizzle']):
                weather_score = 0.6
            elif any(cond in weather_main for cond in ['fog', 'mist', 'haze']):
                weather_score = 0.7
            elif 'clear' in weather_main or 'clouds' in weather_main:
                weather_score = 0.9
            
            # Adjust for extreme temperatures
            if temp < 0 or temp > 35:
                weather_score *= 0.8
            
            # Adjust for poor visibility
            weather_score *= min(1.0, visibility * 1.2)
            
            # Adjust for high winds
            if wind_speed > 10:
                weather_score *= 0.9
            
            return {
                'temperature': temp,
                'condition': weather_main,
                'visibility': visibility,
                'wind_speed': wind_speed,
                'humidity': data.get('main', {}).get('humidity', 50),
                'safety_score': max(0.1, min(1.0, weather_score)),
                'source': 'openweathermap',
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Weather API error: {e}")
            return self._get_fallback_weather()
    
    def get_crime_data(self, lat: float, lng: float, radius_km: float = 5) -> Dict:
        """Get crime data from WPRDC (Western Pennsylvania Regional Data Center)"""
        try:
            # This is for Pittsburgh area - WPRDC has open crime data
            url = "https://data.wprdc.org/api/3/action/datastore_search"
            
            # Resource ID for Pittsburgh Police Incident data
            resource_id = "1797ead8-8262-41cc-9099-cbc8a161924b"
            
            # Calculate date range (last 30 days)
            end_date = datetime.now()
            start_date = end_date - timedelta(days=30)
            
            params = {
                'resource_id': resource_id,
                'limit': 100,
                'filters': json.dumps({
                    'INCIDENTTIME': {
                        '$gte': start_date.strftime('%Y-%m-%d'),
                        '$lte': end_date.strftime('%Y-%m-%d')
                    }
                })
            }
            
            response = self.session.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            if data.get('success'):
                records = data['result'].get('records', [])
                
                # Filter records near our location
                nearby_crimes = []
                for record in records:
                    crime_lat = record.get('LAT')
                    crime_lng = record.get('LON')
                    
                    if crime_lat and crime_lng:
                        distance = self._calculate_distance(lat, lng, float(crime_lat), float(crime_lng))
                        if distance <= radius_km * 1000:  # Convert km to meters
                            nearby_crimes.append({
                                'type': record.get('OFFENSES', 'Unknown'),
                                'severity': self._classify_crime_severity(record.get('OFFENSES', '')),
                                'distance': distance,
                                'timestamp': record.get('INCIDENTTIME'),
                                'location': f"{crime_lat}, {crime_lng}"
                            })
                
                # Calculate crime index (0-1, where 1 is safest)
                if nearby_crimes:
                    total_severity = sum(crime['severity'] for crime in nearby_crimes)
                    crime_density = len(nearby_crimes) / (3.14 * (radius_km ** 2))  # crimes per km²
                    crime_index = max(0.1, min(1.0, 1.0 - (total_severity * 0.1) - (crime_density * 0.05)))
                else:
                    crime_index = 0.9  # Low crime area
                
                return {
                    'crime_index': crime_index,
                    'nearby_incidents': nearby_crimes,
                    'total_incidents': len(nearby_crimes),
                    'radius_km': radius_km,
                    'source': 'wprdc',
                    'timestamp': datetime.now().isoformat()
                }
            
            return self._get_fallback_crime_data()
            
        except Exception as e:
            logger.error(f"Crime data error: {e}")
            return self._get_fallback_crime_data()
    
    def get_fema_alerts(self, lat: float, lng: float) -> Dict:
        """Get FEMA disaster declarations"""
        try:
            url = "https://www.fema.gov/api/open/v1/DisasterDeclarationsSummaries"
            params = {
                '$filter': f"state eq 'PA' and declaredCountyArea eq 'ALLEGHENY'",
                '$top': 10,
                '$orderby': 'declarationDate desc'
            }
            
            response = self.session.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            active_disasters = []
            current_date = datetime.now()
            
            for disaster in data.get('DisasterDeclarationsSummaries', []):
                declaration_date = datetime.strptime(
                    disaster.get('declarationDate', '2000-01-01T00:00:00.000Z'),
                    '%Y-%m-%dT%H:%M:%S.%fZ'
                )
                
                # Check if disaster is recent (within last 90 days)
                if (current_date - declaration_date).days <= 90:
                    active_disasters.append({
                        'type': disaster.get('incidentType', 'Disaster'),
                        'title': disaster.get('declarationTitle', ''),
                        'date': declaration_date.isoformat(),
                        'severity': self._classify_disaster_severity(disaster.get('incidentType', ''))
                    })
            
            disaster_score = 1.0
            if active_disasters:
                # Reduce safety score based on active disasters
                max_severity = max(d['severity'] for d in active_disasters)
                disaster_score = max(0.3, 1.0 - (max_severity * 0.3))
            
            return {
                'disaster_score': disaster_score,
                'active_disasters': active_disasters,
                'source': 'fema',
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"FEMA API error: {e}")
            return {'disaster_score': 0.9, 'active_disasters': [], 'source': 'fallback'}
    
    def get_census_data(self, lat: float, lng: float) -> Dict:
        """Get socioeconomic data from Census API"""
        try:
            # For Pittsburgh area - using Allegheny County data
            url = "https://api.census.gov/data/2021/acs/acs5"
            params = {
                'get': 'B19013_001E,B25077_001E,B01003_001E,B19301_001E',  # Income, home value, population, per capita income
                'for': 'county:003',  # Allegheny County
                'in': 'state:42',  # Pennsylvania
                'key': self.census_key
            }
            
            response = self.session.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            if len(data) > 1:
                # Parse census data
                median_income = float(data[1][0]) if data[1][0] != 'null' else 50000
                median_home_value = float(data[1][1]) if data[1][1] != 'null' else 150000
                population = float(data[1][2]) if data[1][2] != 'null' else 1000000
                per_capita_income = float(data[1][3]) if data[1][3] != 'null' else 30000
                
                # Calculate socioeconomic score (0-1)
                income_score = min(1.0, median_income / 100000)  # Normalize to $100k
                home_value_score = min(1.0, median_home_value / 300000)  # Normalize to $300k
                population_density_score = 0.7  # Default for urban areas
                
                socioeconomic_score = (income_score * 0.4 + 
                                     home_value_score * 0.3 + 
                                     population_density_score * 0.3)
                
                return {
                    'median_income': median_income,
                    'median_home_value': median_home_value,
                    'population': population,
                    'per_capita_income': per_capita_income,
                    'socioeconomic_score': socioeconomic_score,
                    'source': 'census',
                    'timestamp': datetime.now().isoformat()
                }
            
            return self._get_fallback_census_data()
            
        except Exception as e:
            logger.error(f"Census API error: {e}")
            return self._get_fallback_census_data()
    
    def get_traffic_data(self, lat: float, lng: float) -> Dict:
        """Get real-time traffic data from TomTom"""
        try:
            url = f"https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json"
            params = {
                'point': f"{lat},{lng}",
                'key': self.tomtom_key,
                'unit': 'KMPH'
            }
            
            response = self.session.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            flow_data = data.get('flowSegmentData', {})
            current_speed = flow_data.get('currentSpeed', 30)
            free_flow_speed = flow_data.get('freeFlowSpeed', 50)
            
            # Calculate congestion level (0-1, where 1 is most congested)
            if free_flow_speed > 0:
                congestion = max(0, 1 - (current_speed / free_flow_speed))
            else:
                congestion = 0.3  # Default moderate congestion
            
            # Convert to pedestrian safety score (less congestion = safer for pedestrians)
            traffic_safety_score = max(0.5, 1.0 - congestion)
            
            return {
                'current_speed': current_speed,
                'free_flow_speed': free_flow_speed,
                'congestion_level': congestion,
                'traffic_safety_score': traffic_safety_score,
                'source': 'tomtom',
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Traffic API error: {e}")
            return {'traffic_safety_score': 0.7, 'congestion_level': 0.3, 'source': 'fallback'}
    
    def get_time_based_factors(self) -> Dict:
        """Calculate time-based safety factors"""
        now = datetime.now()
        hour = now.hour
        day_of_week = now.weekday()  # 0 = Monday, 6 = Sunday
        month = now.month
        
        # Time of day factor (0-1, where 1 is safest)
        if 6 <= hour <= 18:  # Daylight hours
            time_factor = 0.9
        elif 19 <= hour <= 21:  # Evening
            time_factor = 0.7
        elif 22 <= hour <= 23 or 0 <= hour <= 5:  # Night
            time_factor = 0.4
        else:
            time_factor = 0.6
        
        # Day of week factor (weekends are slightly less safe)
        if day_of_week < 5:  # Weekday
            day_factor = 0.8
        else:  # Weekend
            day_factor = 0.7
        
        # Seasonal factor (winter months are less safe)
        if month in [12, 1, 2]:  # Winter
            season_factor = 0.6
        elif month in [6, 7, 8]:  # Summer
            season_factor = 0.9
        else:  # Spring/Fall
            season_factor = 0.8
        
        # Calculate overall time score
        time_score = (time_factor * 0.5 + day_factor * 0.3 + season_factor * 0.2)
        
        return {
            'hour': hour,
            'day_of_week': day_of_week,
            'month': month,
            'time_score': time_score,
            'is_daylight': 6 <= hour <= 18,
            'is_weekend': day_of_week >= 5,
            'timestamp': now.isoformat()
        }
    
    def _calculate_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate distance between two points in meters"""
        from math import radians, sin, cos, sqrt, atan2
        
        R = 6371000  # Earth radius in meters
        
        lat1_rad = radians(lat1)
        lat2_rad = radians(lat2)
        delta_lat = radians(lat2 - lat1)
        delta_lon = radians(lon2 - lon1)
        
        a = sin(delta_lat/2)**2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon/2)**2
        c = 2 * atan2(sqrt(a), sqrt(1-a))
        
        return R * c
    
    def _classify_crime_severity(self, crime_type: str) -> float:
        """Classify crime severity (0-1, where 1 is most severe)"""
        crime_type = crime_type.lower()
        
        if any(word in crime_type for word in ['assault', 'robbery', 'burglary', 'weapon']):
            return 0.9
        elif any(word in crime_type for word in ['theft', 'larceny', 'vandalism']):
            return 0.6
        elif any(word in crime_type for word in ['disorderly', 'trespass', 'public']):
            return 0.3
        else:
            return 0.1
    
    def _classify_disaster_severity(self, disaster_type: str) -> float:
        """Classify disaster severity (0-1)"""
        disaster_type = disaster_type.lower()
        
        if any(word in disaster_type for word in ['fire', 'flood', 'tornado', 'earthquake']):
            return 0.9
        elif any(word in disaster_type for word in ['storm', 'snow', 'ice', 'wind']):
            return 0.6
        else:
            return 0.3
    
    def _get_fallback_weather(self) -> Dict:
        """Get fallback weather data"""
        return {
            'temperature': 20,
            'condition': 'clear',
            'visibility': 0.9,
            'wind_speed': 5,
            'humidity': 50,
            'safety_score': 0.8,
            'source': 'fallback',
            'timestamp': datetime.now().isoformat()
        }
    
    def _get_fallback_crime_data(self) -> Dict:
        """Get fallback crime data"""
        return {
            'crime_index': 0.7,
            'nearby_incidents': [],
            'total_incidents': 0,
            'radius_km': 5,
            'source': 'fallback',
            'timestamp': datetime.now().isoformat()
        }
    
    def _get_fallback_census_data(self) -> Dict:
        """Get fallback census data"""
        return {
            'median_income': 50000,
            'median_home_value': 150000,
            'population': 1000000,
            'per_capita_income': 30000,
            'socioeconomic_score': 0.7,
            'source': 'fallback',
            'timestamp': datetime.now().isoformat()
        }