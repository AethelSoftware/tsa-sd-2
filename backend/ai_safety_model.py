import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
import requests
import json
from datetime import datetime, time
import math
import os

class SafetyRoutingAI:
    def __init__(self):
        self.model = None
        self.scaler = StandardScaler()
        self.feature_names = [
            'time_of_day', 'day_of_week', 'population_density', 
            'crime_index', 'lighting_score', 'business_density',
            'transit_access', 'sidewalk_score', 'historical_incidents',
            'weather_condition', 'emergency_distance'
        ]
        self.is_trained = False
        
    def fetch_real_time_data(self, lat, lng):
        # Fetch real-time data from various APIs
        try:
            # Crime data -> OpenStreetMap and public safety API's
            crime_data = self.get_crime_data(lat, lng)
            
            # Population density -> OpenStreetMap
            population_density = self.get_population_density(lat, lng)
            
            # Business and lighting data
            business_density = self.get_business_density(lat, lng)
            lighting_score = self.get_lighting_score(lat, lng)
            
            # Transit accessibility
            transit_access = self.get_transit_accessibility(lat, lng)
            
            # Sidewalk and accessibility data
            sidewalk_score = self.get_sidewalk_score(lat, lng)
            
            return {
                'crime_index': crime_data,
                'population_density': population_density,
                'business_density': business_density,
                'lighting_score': lighting_score,
                'transit_access': transit_access,
                'sidewalk_score': sidewalk_score,
                'historical_incidents': self.get_historical_incidents(lat, lng),
                'emergency_distance': self.get_emergency_services_distance(lat, lng)
            }
        except Exception as e:
            print(f"Error fetching real-time data: {e}")
            return self.get_fallback_data()
    
    def get_crime_data(self, lat, lng):
        # Get crime data -> OpenStreetMap and public sources
        try:
            # Overpass API query for police stations and crime-prone areas
            overpass_query = f"""
            [out:json];
            (
              node["amenity"="police"](around:5000,{lat},{lng});
              way["amenity"="police"](around:5000,{lat},{lng});
              relation["amenity"="police"](around:5000,{lat},{lng});
            );
            out count;
            """
            
            response = requests.post(
                'https://overpass-api.de/api/interpreter',
                data=overpass_query,
                timeout=10
            )
            
            police_count = len(response.json().get('elements', []))
            
            # Inverse relationship -> more police might indicate higher crime areas
            crime_index = max(0, 1 - (police_count * 0.1))
            
            return min(crime_index, 1.0)
            
        except:
            # Fallback -> use time-based heuristic
            current_hour = datetime.now().hour
            if 22 <= current_hour or current_hour <= 5:  # Night time
                return 0.8
            elif 18 <= current_hour <= 21:  # Evening
                return 0.6
            else:  # Daytime
                return 0.3
    
    def get_population_density(self, lat, lng):
        # Estimate population density -> OpenStreetMap data
        try:
            # Query for buildings and amenities as proxy for density
            overpass_query = f"""
            [out:json];
            (
              node(around:1000,{lat},{lng});
              way(around:1000,{lat},{lng});
            );
            out count;
            """
            
            response = requests.post(
                'https://overpass-api.de/api/interpreter',
                data=overpass_query,
                timeout=10
            )
            
            element_count = len(response.json().get('elements', []))
            density = min(element_count / 100, 1.0)  # Normalize to 0-1
            
            return density
            
        except:
            return 0.5
    
    def get_business_density(self, lat, lng):
        # Get density of businesses and amenities
        try:
            overpass_query = f"""
            [out:json];
            (
              node["shop"](around:500,{lat},{lng});
              node["amenity"](around:500,{lat},{lng});
              node["leisure"](around:500,{lat},{lng});
            );
            out count;
            """
            
            response = requests.post(
                'https://overpass-api.de/api/interpreter',
                data=overpass_query,
                timeout=10
            )
            
            business_count = len(response.json().get('elements', []))
            density = min(business_count / 50, 1.0)
            
            return density
            
        except:
            return 0.4
    
    def get_lighting_score(self, lat, lng):
        # Estimate street lighting quality
        try:
            # Look for street lamps and well-lit areas
            overpass_query = f"""
            [out:json];
            (
              node["highway"="street_lamp"](around:500,{lat},{lng});
              node["amenity"="lighting"](around:500,{lat},{lng});
            );
            out count;
            """
            
            response = requests.post(
                'https://overpass-api.de/api/interpreter',
                data=overpass_query,
                timeout=10
            )
            
            lamp_count = len(response.json().get('elements', []))
            lighting_score = min(lamp_count / 20, 1.0)
            
            # Adjust for time of day
            current_hour = datetime.now().hour
            if 6 <= current_hour <= 18:  # Daylight
                lighting_score = 1.0
            
            return lighting_score
            
        except:
            current_hour = datetime.now().hour
            return 0.3 if (22 <= current_hour or current_hour <= 5) else 0.8
    
    def get_transit_accessibility(self, lat, lng):
        # Calculate public transit accessibility
        try:
            overpass_query = f"""
            [out:json];
            (
              node["public_transport"](around:1000,{lat},{lng});
              node["railway"="station"](around:1000,{lat},{lng});
              node["highway"="bus_stop"](around:1000,{lat},{lng});
            );
            out count;
            """
            
            response = requests.post(
                'https://overpass-api.de/api/interpreter',
                data=overpass_query,
                timeout=10
            )
            
            transit_count = len(response.json().get('elements', []))
            accessibility = min(transit_count / 10, 1.0)
            
            return accessibility
            
        except:
            return 0.5
    
    def get_sidewalk_score(self, lat, lng):
        # Calculate sidewalk availability and quality
        try:
            overpass_query = f"""
            [out:json];
            (
              way["footway"="sidewalk"](around:500,{lat},{lng});
              way["footway"="crossing"](around:500,{lat},{lng});
            );
            out count;
            """
            
            response = requests.post(
                'https://overpass-api.de/api/interpreter',
                data=overpass_query,
                timeout=10
            )
            
            sidewalk_elements = len(response.json().get('elements', []))
            score = min(sidewalk_elements / 25, 1.0)
            
            return score
            
        except:
            return 0.6
    
    def get_historical_incidents(self, lat, lng):
        # Get historical incident data
        # later integrate with local police APIs
        # For now use a time-based heuristic
        current_hour = datetime.now().hour
        if 0 <= current_hour <= 4:  # Late night
            return 0.8
        elif 20 <= current_hour <= 23:  # Evening
            return 0.6
        else:
            return 0.3
    
    def get_emergency_services_distance(self, lat, lng):
        # Calculate distance to emergency services
        try:
            overpass_query = f"""
            [out:json];
            (
              node["amenity"="police"](around:5000,{lat},{lng});
              node["amenity"="hospital"](around:5000,{lat},{lng});
              node["amenity"="fire_station"](around:5000,{lat},{lng});
            );
            out count;
            """
            
            response = requests.post(
                'https://overpass-api.de/api/interpreter',
                data=overpass_query,
                timeout=10
            )
            
            service_count = len(response.json().get('elements', []))
            # More services = shorter distance = higher safety
            distance_score = min(service_count / 5, 1.0)
            
            return distance_score
            
        except:
            return 0.5
    
    def get_weather_condition(self):
        # Get current weather condition (simulated)
        # later integrate with weather API
        conditions = {
            'clear': 0.9,
            'rain': 0.6,
            'snow': 0.4,
            'storm': 0.2
        }
        return conditions['clear']  # Default to clear
    
    def get_fallback_data(self):
        # Provide fallback data when APIs fail
        current_time = datetime.now()
        return {
            'crime_index': 0.5,
            'population_density': 0.5,
            'business_density': 0.5,
            'lighting_score': 0.7,
            'transit_access': 0.5,
            'sidewalk_score': 0.6,
            'historical_incidents': 0.4,
            'emergency_distance': 0.5
        }
    
    def prepare_features(self, lat, lng):
        # Prepare feature vector for AI model
        real_time_data = self.fetch_real_time_data(lat, lng)
        current_time = datetime.now()
        
        features = [
            current_time.hour / 24.0,  # time_of_day (normalized)
            current_time.weekday() / 7.0,  # day_of_week (normalized)
            real_time_data['population_density'],
            real_time_data['crime_index'],
            real_time_data['lighting_score'],
            real_time_data['business_density'],
            real_time_data['transit_access'],
            real_time_data['sidewalk_score'],
            real_time_data['historical_incidents'],
            self.get_weather_condition(),
            real_time_data['emergency_distance']
        ]
        
        return np.array(features).reshape(1, -1)
    
    def train_model(self, training_data=None):
        # Train the AI model with sample data
        if training_data is None:
            # Generate synthetic training data
            np.random.seed(42)
            n_samples = 1000
            
            X = np.random.random((n_samples, len(self.feature_names)))
            # Create realistic safety scores based on feature relationships
            y = (
                0.3 * (1 - X[:, 3]) +  # Lower crime = higher safety
                0.2 * X[:, 4] +        # Better lighting = higher safety
                0.15 * X[:, 6] +       # Better transit = higher safety
                0.15 * X[:, 7] +       # Better sidewalks = higher safety
                0.1 * (1 - X[:, 0]) +  # Daytime = higher safety
                0.1 * X[:, 10]         # Closer emergency services = higher safety
            ) + np.random.normal(0, 0.1, n_samples)
            
            y = np.clip(y, 0, 1)
        else:
            X, y = training_data
        
        # Scale features
        X_scaled = self.scaler.fit_transform(X)
        
        # Train Random Forest model
        self.model = RandomForestRegressor(
            n_estimators=100,
            max_depth=10,
            random_state=42
        )
        self.model.fit(X_scaled, y)
        self.is_trained = True
        
        return self.model.score(X_scaled, y)
    
    def predict_safety_score(self, lat, lng):
        # Predict safety score for a location
        if not self.is_trained:
            self.train_model()
        
        features = self.prepare_features(lat, lng)
        features_scaled = self.scaler.transform(features)
        
        safety_score = self.model.predict(features_scaled)[0]
        safety_score = np.clip(safety_score, 0, 1)
        
        return float(safety_score)
    
    def calculate_route_safety(self, route_coordinates):
        # Calculate overall safety score for a route
        safety_scores = []
        
        for coord in route_coordinates:
            lat, lng = coord
            score = self.predict_safety_score(lat, lng)
            safety_scores.append(score)
        
        # Weighted average giving more importance to lower scores
        if safety_scores:
            min_score = min(safety_scores)
            avg_score = sum(safety_scores) / len(safety_scores)
            overall_score = 0.7 * min_score + 0.3 * avg_score
        else:
            overall_score = 0.5
        
        return {
            'overall_safety': overall_score,
            'safety_breakdown': safety_scores,
            'safety_level': self.get_safety_level(overall_score),
            'recommendations': self.get_safety_recommendations(safety_scores)
        }
    
    def get_safety_level(self, score):
        # Convert numerical score to safety level
        if score >= 0.8:
            return "Very Safe"
        elif score >= 0.6:
            return "Safe"
        elif score >= 0.4:
            return "Moderate"
        elif score >= 0.2:
            return "Risky"
        else:
            return "Dangerous"
    
    def get_safety_recommendations(self, safety_scores):
        # Generate safety recommendations based on route analysis
        recommendations = []
        min_score = min(safety_scores) if safety_scores else 0.5
        
        if min_score < 0.3:
            recommendations.append("Avoid this route - high risk areas detected")
        
        if any(score < 0.4 for score in safety_scores):
            recommendations.append("Consider alternative transportation")
            recommendations.append("Travel with companion if possible")
        
        if len([s for s in safety_scores if s < 0.6]) > len(safety_scores) / 2:
            recommendations.append("Multiple moderate-risk segments - exercise caution")
        
        if not recommendations:
            recommendations.append("Route appears safe - standard precautions advised")
        
        return recommendations

# Global instance
safety_ai = SafetyRoutingAI()