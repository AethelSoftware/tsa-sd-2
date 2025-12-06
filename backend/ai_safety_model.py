import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler, PolynomialFeatures
from sklearn.feature_selection import SelectFromModel
from sklearn.model_selection import cross_val_score
import requests
import json
from datetime import datetime, timedelta
import math
import os
from scipy import stats
import warnings
warnings.filterwarnings('ignore')

class AdvancedSafetyRoutingAI:
    def _init_(self):
        self.model = None
        self.scaler = StandardScaler()
        self.poly = PolynomialFeatures(degree=2, include_bias=False)
        self.feature_selector = None
        self.feature_names = [
            'time_of_day', 'day_of_week', 'population_density',
            'crime_index', 'lighting_score', 'business_density',
            'transit_access', 'sidewalk_score', 'historical_incidents',
            'weather_condition', 'emergency_distance', 'temperature',
            'visibility', 'precipitation', 'wind_speed', 'humidity',
            'urbanization_index', 'economic_index', 'education_index',
            'time_since_sunset', 'holiday_indicator', 'special_event'
        ]
        self.is_trained = False
        self.ensemble_models = []
       
    def fetch_real_time_data(self, lat, lng):
        """Fetch comprehensive real-time data from multiple APIs"""
        try:
            # Crime data from multiple police APIs
            crime_data = self.get_crime_data_combined(lat, lng)
           
            # Population density and urban metrics
            population_density = self.get_population_density(lat, lng)
            urbanization_index = self.get_urbanization_index(lat, lng)
           
            # Business and infrastructure data
            business_density = self.get_business_density(lat, lng)
            lighting_score = self.get_lighting_score(lat, lng)
           
            # Transit and accessibility
            transit_access = self.get_transit_accessibility(lat, lng)
            sidewalk_score = self.get_sidewalk_score(lat, lng)
           
            # Emergency services
            emergency_distance = self.get_emergency_services_distance(lat, lng)
           
            # Real weather data
            weather_data = self.get_real_weather_data(lat, lng)
           
            # Socio-economic indicators (estimated)
            economic_index = self.get_economic_index(lat, lng)
            education_index = self.get_education_index(lat, lng)
           
            # Time-based features
            current_time = datetime.now()
            time_since_sunset = self.get_time_since_sunset(lat, lng, current_time)
            holiday_indicator = self.get_holiday_indicator(current_time)
            special_event = self.get_special_event_indicator(lat, lng, current_time)
           
            return {
                'crime_index': crime_data,
                'population_density': population_density,
                'business_density': business_density,
                'lighting_score': lighting_score,
                'transit_access': transit_access,
                'sidewalk_score': sidewalk_score,
                'historical_incidents': self.get_historical_incidents(lat, lng),
                'emergency_distance': emergency_distance,
                'weather_condition': weather_data['condition_score'],
                'temperature': weather_data['temperature_norm'],
                'visibility': weather_data['visibility_norm'],
                'precipitation': weather_data['precipitation'],
                'wind_speed': weather_data['wind_speed_norm'],
                'humidity': weather_data['humidity_norm'],
                'urbanization_index': urbanization_index,
                'economic_index': economic_index,
                'education_index': education_index,
                'time_since_sunset': time_since_sunset,
                'holiday_indicator': holiday_indicator,
                'special_event': special_event
            }
        except Exception as e:
            print(f"Error fetching real-time data: {e}")
            return self.get_fallback_data()
   
    def get_real_weather_data(self, lat, lng):
        """Get real weather data from OpenWeatherMap API"""
        try:
            api_key = os.environ.get('OPENWEATHER_API_KEY', 'your_api_key_here')
            url = f"http://api.openweathermap.org/data/2.5/weather"
           
            params = {
                'lat': lat,
                'lon': lng,
                'appid': api_key,
                'units': 'imperial'
            }
           
            response = requests.get(url, params=params, timeout=10)
           
            if response.status_code == 200:
                data = response.json()
                weather = data['weather'][0]
                main = data['main']
                visibility = data.get('visibility', 10000)
                wind = data.get('wind', {})
               
                # Weather condition scoring
                condition_scores = {
                    'clear': 0.9, 'few clouds': 0.8, 'scattered clouds': 0.7,
                    'broken clouds': 0.6, 'overcast clouds': 0.5, 'mist': 0.4,
                    'light rain': 0.3, 'moderate rain': 0.2, 'heavy rain': 0.1,
                    'thunderstorm': 0.1, 'snow': 0.2, 'fog': 0.3
                }
               
                condition = weather['main'].lower()
                condition_score = condition_scores.get(condition, 0.5)
               
                # Normalize other weather factors
                temp_norm = max(0, min(1, (main['temp'] - 0) / 100))  # 0-100°F scale
                humidity_norm = main['humidity'] / 100.0
                visibility_norm = min(1.0, visibility / 10000.0)
                wind_speed_norm = min(1.0, wind.get('speed', 0) / 50.0)  # 0-50 mph scale
                precipitation = 1.0 if 'rain' in condition else 0.0
               
                return {
                    'condition_score': condition_score,
                    'temperature_norm': temp_norm,
                    'humidity_norm': humidity_norm,
                    'visibility_norm': visibility_norm,
                    'wind_speed_norm': wind_speed_norm,
                    'precipitation': precipitation
                }
               
        except Exception as e:
            print(f"Weather API error: {e}")
       
        # Fallback weather data
        return {
            'condition_score': 0.7,
            'temperature_norm': 0.5,
            'humidity_norm': 0.5,
            'visibility_norm': 0.8,
            'wind_speed_norm': 0.3,
            'precipitation': 0.0
        }
   
    def get_crime_data_combined(self, lat, lng):
        """Get comprehensive crime data from multiple sources"""
        crime_scores = []
       
        try:
            # Source 1: Crimeometer API
            crimeometer_score = self.get_crimeometer_data(lat, lng)
            if crimeometer_score is not None:
                crime_scores.append(crimeometer_score)
           
            # Source 2: Area demographic-based crime estimation
            demographic_score = self.get_demographic_crime_estimate(lat, lng)
            crime_scores.append(demographic_score)
           
            # Source 3: Infrastructure-based crime indicators
            infrastructure_score = self.get_crime_infrastructure_data(lat, lng)
            if infrastructure_score is not None:
                crime_scores.append(infrastructure_score)
           
            # Source 4: Time-based crime patterns
            time_based_score = self.get_time_based_crime_estimate()
            crime_scores.append(time_based_score)
           
            # Use weighted average with confidence scores
            if crime_scores:
                weights = [0.4, 0.3, 0.2, 0.1]  # Weights for each source
                weighted_score = sum(s * w for s, w in zip(crime_scores, weights))
                return min(weighted_score, 1.0)
               
        except Exception as e:
            print(f"Crime data combination error: {e}")
       
        return 0.5  # Default average crime score
   
    def get_crimeometer_data(self, lat, lng):
        """Get crime data from Crimeometer API"""
        try:
            api_key = os.environ.get('CRIMEOMETER_API_KEY')
            if not api_key:
                return None
               
            url = "https://api.crimeometer.com/v1/incidents/raw-data"
           
            params = {
                'lat': lat,
                'lon': lng,
                'distance': '1mi',
                'datetime_ini': (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
                'datetime_end': datetime.now().strftime('%Y-%m-%dT%H:%M:%S.000Z'),
            }
           
            headers = {'X-Api-Key': api_key}
            response = requests.get(url, params=params, headers=headers, timeout=10)
           
            if response.status_code == 200:
                data = response.json()
                incidents = data.get('incidents', [])
               
                # Calculate crime density with severity weighting
                if incidents:
                    total_severity = 0
                    for incident in incidents:
                        # Simple severity estimation based on crime type
                        crime_type = incident.get('type', '').lower()
                        if any(word in crime_type for word in ['assault', 'robbery', 'burglary']):
                            total_severity += 2
                        elif any(word in crime_type for word in ['theft', 'vandalism']):
                            total_severity += 1
                        else:
                            total_severity += 0.5
                   
                    crime_score = min(total_severity / 20.0, 1.0)
                    return crime_score
                   
        except Exception as e:
            print(f"Crimeometer API error: {e}")
       
        return None
   
    def get_demographic_crime_estimate(self, lat, lng):
        """Estimate crime based on demographic patterns"""
        try:
            # Use OpenStreetMap data to estimate demographics
            building_density = self.get_population_density(lat, lng)
            business_density = self.get_business_density(lat, lng)
           
            # Complex demographic crime model
            base_risk = 0.3
            density_factor = building_density * 0.4
            business_factor = business_density * 0.3
            time_factor = self.get_time_based_crime_estimate()
           
            crime_score = base_risk + density_factor + business_factor + time_factor
            return min(crime_score, 1.0)
           
        except:
            return 0.5
   
    def get_crime_infrastructure_data(self, lat, lng):
        """Use infrastructure as crime indicator"""
        try:
            overpass_query = f"""
            [out:json];
            (
              node["amenity"="bar"](around:1000,{lat},{lng});
              node["amenity"="pub"](around:1000,{lat},{lng});
              node["amenity"="nightclub"](around:1000,{lat},{lng});
              node["shop"="alcohol"](around:1000,{lat},{lng});
              node["amenity"="police"](around:1000,{lat},{lng});
              node["amenity"="community_centre"](around:1000,{lat},{lng});
            );
            out count;
            """
           
            response = requests.post(
                'https://overpass-api.de/api/interpreter',
                data=overpass_query,
                timeout=10
            )
           
            elements = response.json().get('elements', [])
           
            risk_indicators = 0
            safety_indicators = 0
           
            for element in elements:
                tags = element.get('tags', {})
                amenity = tags.get('amenity', '')
               
                if amenity in ['bar', 'pub', 'nightclub']:
                    risk_indicators += 1
                elif amenity == 'alcohol':
                    risk_indicators += 0.5
                elif amenity in ['police', 'community_centre']:
                    safety_indicators += 1
           
            net_risk = max(0, (risk_indicators * 0.1) - (safety_indicators * 0.15))
            return min(0.5 + net_risk, 1.0)
           
        except:
            return None
   
    def get_time_based_crime_estimate(self):
        """Time-based crime probability"""
        current_time = datetime.now()
        hour = current_time.hour
       
        # Crime follows specific temporal patterns
        if 0 <= hour <= 4:   # Late night - highest crime
            return 0.3
        elif 20 <= hour <= 23:  # Evening - high crime
            return 0.2
        elif 18 <= hour <= 19:  # Early evening - moderate
            return 0.1
        else:  # Daytime - lower crime
            return 0.0
   
    def get_urbanization_index(self, lat, lng):
        """Calculate urbanization level"""
        try:
            overpass_query = f"""
            [out:json];
            (
              way["building"](around:2000,{lat},{lng});
              way["landuse"="commercial"](around:2000,{lat},{lng});
              way["landuse"="industrial"](around:2000,{lat},{lng});
              way["landuse"="residential"](around:2000,{lat},{lng});
            );
            out count;
            """
           
            response = requests.post(
                'https://overpass-api.de/api/interpreter',
                data=overpass_query,
                timeout=10
            )
           
            elements = len(response.json().get('elements', []))
            return min(elements / 100.0, 1.0)
           
        except:
            return 0.5
   
    def get_economic_index(self, lat, lng):
        """Estimate economic conditions (simplified)"""
        # In production, use Census data or similar
        business_density = self.get_business_density(lat, lng)
        urbanization = self.get_urbanization_index(lat, lng)
       
        # Higher business density + urbanization = better economic conditions
        return (business_density * 0.6 + urbanization * 0.4) * 0.8 + 0.2
   
    def get_education_index(self, lat, lng):
        """Estimate education levels (simplified)"""
        try:
            overpass_query = f"""
            [out:json];
            (
              node["amenity"="school"](around:2000,{lat},{lng});
              node["amenity"="university"](around:2000,{lat},{lng});
              node["amenity"="college"](around:2000,{lat},{lng});
              node["amenity"="library"](around:2000,{lat},{lng});
            );
            out count;
            """
           
            response = requests.post(
                'https://overpass-api.de/api/interpreter',
                data=overpass_query,
                timeout=10
            )
           
            education_facilities = len(response.json().get('elements', []))
            return min(education_facilities / 10.0, 1.0)
           
        except:
            return 0.5
   
    def get_time_since_sunset(self, lat, lng, current_time):
        """Calculate time since sunset (simplified)"""
        # Simplified sunset calculation (6 PM)
        sunset_hour = 18
        current_hour = current_time.hour + current_time.minute / 60.0
       
        if current_hour >= sunset_hour:
            hours_since_sunset = current_hour - sunset_hour
        else:
            hours_since_sunset = current_hour + (24 - sunset_hour)
       
        return min(hours_since_sunset / 12.0, 1.0)  # Normalize to 0-1
   
    def get_holiday_indicator(self, current_time):
        """Check if current date is a holiday"""
        # Simplified holiday detection
        holidays = [
            '01-01', '07-04', '12-25', '11-11', '05-31', '09-06'
        ]  # New Year, Independence Day, Christmas, etc.
       
        current_date = current_time.strftime('%m-%d')
        return 1.0 if current_date in holidays else 0.0
   
    def get_special_event_indicator(self, lat, lng, current_time):
        """Check for special events in area"""
        # Simplified event detection
        # In production, integrate with event APIs
        return 0.0  # Default no special events
   
    # Keep all your existing methods for population_density, business_density, etc.
    # but add error handling and improvements
   
    def get_population_density(self, lat, lng):
        try:
            overpass_query = f"""
            [out:json];
            (
              node(around:1000,{lat},{lng});
              way(around:1000,{lat},{lng});
              relation(around:1000,{lat},{lng});
            );
            out count;
            """
           
            response = requests.post(
                'https://overpass-api.de/api/interpreter',
                data=overpass_query,
                timeout=10
            )
           
            elements = len(response.json().get('elements', []))
            density = min(elements / 150.0, 1.0)
           
            # Apply non-linear transformation
            return density ** 0.7
           
        except:
            return 0.5
   
    # ... include all your other existing methods with similar enhancements ...
   
    def prepare_features(self, lat, lng):
        """Prepare advanced feature vector with interaction terms"""
        real_time_data = self.fetch_real_time_data(lat, lng)
        current_time = datetime.now()
       
        # Base features
        features = [
            current_time.hour / 24.0,
            current_time.weekday() / 7.0,
            real_time_data['population_density'],
            real_time_data['crime_index'],
            real_time_data['lighting_score'],
            real_time_data['business_density'],
            real_time_data['transit_access'],
            real_time_data['sidewalk_score'],
            real_time_data['historical_incidents'],
            real_time_data['weather_condition'],
            real_time_data['emergency_distance'],
            real_time_data['temperature'],
            real_time_data['visibility'],
            real_time_data['precipitation'],
            real_time_data['wind_speed'],
            real_time_data['humidity'],
            real_time_data['urbanization_index'],
            real_time_data['economic_index'],
            real_time_data['education_index'],
            real_time_data['time_since_sunset'],
            real_time_data['holiday_indicator'],
            real_time_data['special_event']
        ]
       
        return np.array(features).reshape(1, -1)
   
    def train_model(self, training_data=None):
        """Advanced ensemble training with feature engineering"""
        if training_data is None:
            # Generate sophisticated synthetic training data
            np.random.seed(42)
            n_samples = 5000
           
            X = np.random.random((n_samples, len(self.feature_names)))
           
            # Create complex safety scoring function with interactions
            y = self.complex_safety_function(X)
           
            # Add noise with different variance
            noise = np.random.normal(0, 0.08, n_samples)
            y += noise
            y = np.clip(y, 0, 1)
        else:
            X, y = training_data
       
        # Feature engineering
        X_poly = self.poly.fit_transform(X)
       
        # Scale features
        X_scaled = self.scaler.fit_transform(X_poly)
       
        # Feature selection
        self.feature_selector = SelectFromModel(
            RandomForestRegressor(n_estimators=100, random_state=42),
            threshold='median'
        )
        X_selected = self.feature_selector.fit_transform(X_scaled, y)
       
        # Create ensemble of models
        models = [
            RandomForestRegressor(
                n_estimators=200,
                max_depth=15,
                min_samples_split=5,
                min_samples_leaf=2,
                random_state=42
            ),
            GradientBoostingRegressor(
                n_estimators=150,
                max_depth=8,
                learning_rate=0.1,
                random_state=42
            )
        ]
       
        # Train ensemble
        self.ensemble_models = []
        for model in models:
            model.fit(X_selected, y)
            self.ensemble_models.append(model)
       
        self.is_trained = True
       
        # Cross-validation scores
        cv_scores = []
        for model in self.ensemble_models:
            scores = cross_val_score(model, X_selected, y, cv=5, scoring='r2')
            cv_scores.append(scores.mean())
       
        return np.mean(cv_scores)
   
    def complex_safety_function(self, X):
        """Complex safety scoring with non-linear relationships and interactions"""
        # Unpack features
        time_of_day, day_of_week, pop_density, crime_index, lighting, business, \
        transit, sidewalk, incidents, weather, emergency, temp, visibility, \
        precip, wind, humidity, urban, economic, education, sunset, holiday, event = X.T
       
        # Base safety components
        time_safety = 0.4 * (1 - time_of_day)  # Safer during day
        crime_safety = 0.25 * (1 - crime_index ** 1.5)  # Non-linear crime impact
        lighting_safety = 0.15 * lighting ** 0.8
        infrastructure_safety = 0.1 * (transit * 0.4 + sidewalk * 0.6)
        weather_safety = 0.1 * weather
       
        # Interaction terms
        night_crime_interaction = 0.05 * (time_of_day * crime_index)  # Worse at night
        weather_crime_interaction = 0.03 * ((1 - weather) * crime_index)  # Worse in bad weather
        density_lighting_interaction = 0.02 * (pop_density * (1 - lighting))  # Dense + dark = dangerous
       
        # Socio-economic factors
        socio_economic_safety = 0.08 * (economic * 0.6 + education * 0.4)
       
        # Emergency access
        emergency_safety = 0.07 * emergency
       
        # Combine all components
        safety_score = (
            time_safety + crime_safety + lighting_safety +
            infrastructure_safety + weather_safety -
            night_crime_interaction - weather_crime_interaction -
            density_lighting_interaction + socio_economic_safety +
            emergency_safety
        )
       
        return np.clip(safety_score, 0, 1)
   
    def predict_safety_score(self, lat, lng):
        """Advanced ensemble prediction"""
        if not self.is_trained:
            self.train_model()
       
        features = self.prepare_features(lat, lng)
        features_poly = self.poly.transform(features)
        features_scaled = self.scaler.transform(features_poly)
        features_selected = self.feature_selector.transform(features_scaled)
       
        # Ensemble prediction
        predictions = []
        for model in self.ensemble_models:
            pred = model.predict(features_selected)[0]
            predictions.append(pred)
       
        # Weighted average (could use model performance weights)
        safety_score = np.mean(predictions)
        safety_score = np.clip(safety_score, 0, 1)
       
        # Add uncertainty estimation
        uncertainty = np.std(predictions)
       
        return {
            'safety_score': float(safety_score),
            'uncertainty': float(uncertainty),
            'confidence': max(0, 1 - uncertainty * 2)
        }
   
    def calculate_route_safety(self, route_coordinates):
        """Advanced route analysis with segment weighting"""
        safety_results = []
       
        for coord in route_coordinates:
            lat, lng = coord
            result = self.predict_safety_score(lat, lng)
            safety_results.append(result)
       
        safety_scores = [r['safety_score'] for r in safety_results]
        confidences = [r['confidence'] for r in safety_results]
       
        if safety_scores:
            # Weighted average considering confidence
            weights = np.array(confidences)
            weights = weights / np.sum(weights) if np.sum(weights) > 0 else np.ones_like(weights) / len(weights)
           
            weighted_avg = np.average(safety_scores, weights=weights)
            min_score = min(safety_scores)
           
            # Non-linear combination focusing on worst segments
            overall_score = 0.6 * min_score + 0.4 * weighted_avg
           
            # Risk clustering analysis
            risk_clusters = self.analyze_risk_clusters(safety_scores)
           
        else:
            overall_score = 0.5
            risk_clusters = []
       
        return {
            'overall_safety': overall_score,
            'safety_breakdown': safety_results,
            'safety_level': self.get_safety_level(overall_score),
            'risk_clusters': risk_clusters,
            'recommendations': self.get_advanced_recommendations(safety_scores, risk_clusters),
            'confidence_score': np.mean(confidences) if confidences else 0.5
        }
   
    def analyze_risk_clusters(self, safety_scores, threshold=0.4):
        """Identify clusters of high-risk segments"""
        risk_segments = [i for i, score in enumerate(safety_scores) if score < threshold]
       
        if not risk_segments:
            return []
       
        clusters = []
        current_cluster = [risk_segments[0]]
       
        for i in range(1, len(risk_segments)):
            if risk_segments[i] - risk_segments[i-1] <= 2:  # Consecutive or nearby
                current_cluster.append(risk_segments[i])
            else:
                if len(current_cluster) >= 2:  # Only significant clusters
                    clusters.append(current_cluster)
                current_cluster = [risk_segments[i]]
       
        if len(current_cluster) >= 2:
            clusters.append(current_cluster)
       
        return clusters
   
    def get_advanced_recommendations(self, safety_scores, risk_clusters):
        """Generate sophisticated safety recommendations"""
        recommendations = []
        min_score = min(safety_scores) if safety_scores else 0.5
       
        # Risk level based recommendations
        if min_score < 0.2:
            recommendations.extend([
                "CRITICAL: Avoid this route - extreme risk detected",
                "Use emergency transportation services",
                "Notify emergency contacts of your travel plans"
            ])
        elif min_score < 0.4:
            recommendations.extend([
                "HIGH RISK: Strongly consider alternative routes",
                "Travel with companion recommended",
                "Avoid walking alone in high-risk segments"
            ])
       
        # Cluster-based recommendations
        if risk_clusters:
            largest_cluster = max(risk_clusters, key=len)
            if len(largest_cluster) >= 3:
                recommendations.append(f"Extended high-risk area: {len(largest_cluster)} consecutive segments")
       
        # Time-based recommendations
        current_hour = datetime.now().hour
        if current_hour >= 22 or current_hour <= 5:
            recommendations.append("Enhanced caution advised during nighttime hours")
       
        if not recommendations:
            recommendations.append("Route appears generally safe - maintain situational awareness")
       
        return recommendations

# Global instance
safety_ai = AdvancedSafetyRoutingAI()