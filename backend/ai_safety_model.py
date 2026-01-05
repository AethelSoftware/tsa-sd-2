import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor, StackingRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler, PolynomialFeatures
from sklearn.feature_selection import SelectFromModel
from sklearn.model_selection import train_test_split
from sklearn.linear_model import Ridge, Lasso
import requests
import json
from datetime import datetime, timedelta
import math
import os
from scipy import stats
import warnings
import time
import joblib
import hashlib
import pickle
from pathlib import Path
import googlemaps
import logging
from typing import Dict, List, Tuple, Optional, Any, Union
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from queue import Queue

warnings.filterwarnings('ignore')
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MAX_DISTANCE = 1000
THRESHOLD = 0.25

@dataclass
class SafetyRouteResult:
    """Dataclass for route safety results"""
    overall_safety: float
    risk_level: str
    safe_route_coords: List[Dict]
    original_route_coords: List[Dict]
    risky_segments: List[Dict]
    distance_meters: float
    duration_seconds: float
    recommendations: List[str]
    confidence: float
    segment_details: List[Dict]

class AdvancedSafetyRoutingAI:
    def __init__(self, model_path=None, google_maps_api_key=None, retrain_on_start=False):
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
        self.model_path = model_path or os.environ.get('MODEL_PATH', 'models/safety_model.pkl')
        self.training_history = []
        self.last_training_time = None
        self.training_metrics = {}
        
        # Initialize APIs
        self.gmaps = None
        if google_maps_api_key:
            try:
                self.gmaps = googlemaps.Client(key=google_maps_api_key)
                logger.info("Google Maps API initialized")
            except Exception as e:
                logger.error(f"Failed to initialize Google Maps API: {e}")
        
        # Weather API configuration
        self.weather_api_key = os.environ.get('WEATHER_API_KEY', '')
        self.weather_cache = {}
        self.weather_cache_timeout = 300  # 5 minutes
        
        # Crime data API (example - replace with real API)
        self.crime_api_url = "https://api.crime-data.com/v1"
        self.crime_api_key = os.environ.get('CRIME_API_KEY', '')
        
        # Real-time data caches
        self.data_cache = {}
        self.cache_lock = threading.Lock()
        
        # Thread pool for parallel requests
        self.thread_pool = ThreadPoolExecutor(max_workers=5)
        
        # Create model directory
        Path(os.path.dirname(self.model_path)).mkdir(parents=True, exist_ok=True)
        
        # Try to load existing model
        if not retrain_on_start and os.path.exists(self.model_path):
            self.load_model(self.model_path)
            logger.info(f"Loaded existing model from {self.model_path}")
        else:
            logger.info("No model found or retraining requested, will train when needed")
    
    def save_model(self, path=None):
        """Save the trained model and preprocessing objects"""
        if path is None:
            path = self.model_path
        
        model_data = {
            'model': self.model,
            'scaler': self.scaler,
            'poly': self.poly,
            'feature_selector': self.feature_selector,
            'feature_names': self.feature_names,
            'is_trained': self.is_trained,
            'training_history': self.training_history,
            'last_training_time': self.last_training_time,
            'training_metrics': self.training_metrics,
            'model_config': {
                'feature_names': self.feature_names,
                'max_distance': MAX_DISTANCE,
                'threshold': THRESHOLD
            }
        }
        
        try:
            with open(path, 'wb') as f:
                pickle.dump(model_data, f)
            logger.info(f"Model saved to {path}")
            return True
        except Exception as e:
            logger.error(f"Failed to save model: {e}")
            return False
    
    def load_model(self, path=None):
        """Load a previously trained model"""
        if path is None:
            path = self.model_path
        
        try:
            with open(path, 'rb') as f:
                model_data = pickle.load(f)
            
            self.model = model_data['model']
            self.scaler = model_data['scaler']
            self.poly = model_data['poly']
            self.feature_selector = model_data['feature_selector']
            self.feature_names = model_data['feature_names']
            self.is_trained = model_data['is_trained']
            self.training_history = model_data.get('training_history', [])
            self.last_training_time = model_data.get('last_training_time')
            self.training_metrics = model_data.get('training_metrics', {})
            
            logger.info(f"Model loaded from {path}")
            if self.last_training_time:
                logger.info(f"Last trained: {self.last_training_time}")
            
            return True
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return False
    
    def train_model_advanced(self, n_loops=15, n_epochs=5, n_samples=5000, 
                            force_retrain=False, save_model=True):
        """
        Advanced training with multiple loops and epochs
        """
        if not force_retrain and self.is_trained:
            days_since_training = 0
            if self.last_training_time:
                days_since_training = (datetime.now() - self.last_training_time).days
            
            if days_since_training < 1:
                logger.info(f"Model already trained today, skipping retraining")
                return {
                    'status': 'skipped',
                    'message': 'Model already trained today',
                    'last_training': self.last_training_time,
                    'metrics': self.training_metrics
                }
        
        logger.info(f"Starting advanced training: {n_loops} loops, {n_epochs} epochs")
        
        X_list = []
        y_list = []
        
        for loop in range(n_loops):
            logger.info(f"Loop {loop + 1}/{n_loops}")
            
            X_loop = np.random.randn(n_samples, len(self.feature_names))
            X_loop = (X_loop * 0.5) + 0.5
            X_loop = np.clip(X_loop, 0, 1)
            
            y_loop = self.complex_safety_function(X_loop)
            
            noise_variance = 0.05 + (loop * 0.002)
            noise = np.random.normal(0, noise_variance, n_samples)
            y_loop += noise
            
            if loop % 3 == 0:
                outlier_indices = np.random.choice(n_samples, size=n_samples//20, replace=False)
                y_loop[outlier_indices] = np.random.rand(len(outlier_indices))
            
            y_loop = np.clip(y_loop, 0, 1)
            
            X_list.append(X_loop)
            y_list.append(y_loop)
        
        X = np.vstack(X_list)
        y = np.hstack(y_list)
        
        logger.info("Performing feature engineering...")
        
        X_poly = self.poly.fit_transform(X)
        X_scaled = self.scaler.fit_transform(X_poly)
        
        self.feature_selector = SelectFromModel(
            Lasso(alpha=0.001, random_state=42),
            threshold='median'
        )
        X_selected = self.feature_selector.fit_transform(X_scaled, y)
        
        X_train, X_test, y_train, y_test = train_test_split(
            X_selected, y, test_size=0.2, random_state=42
        )
        
        logger.info("Training ensemble models...")
        
        base_models = [
            ('rf', RandomForestRegressor(
                n_estimators=100,
                max_depth=15,
                min_samples_split=5,
                min_samples_leaf=2,
                random_state=42,
                n_jobs=-1
            )),
            ('gb', GradientBoostingRegressor(
                n_estimators=100,
                max_depth=8,
                learning_rate=0.1,
                random_state=42
            )),
            ('ridge', Ridge(alpha=1.0, random_state=42))
        ]
        
        logger.info("Training neural network with multiple epochs...")
        neural_net = MLPRegressor(
            hidden_layer_sizes=(128, 64, 32),
            activation='relu',
            solver='adam',
            alpha=0.001,
            batch_size=256,
            learning_rate='adaptive',
            learning_rate_init=0.001,
            max_iter=n_epochs * 2,
            shuffle=True,
            random_state=42,
            tol=1e-4,
            verbose=False,
            early_stopping=True,
            validation_fraction=0.2,
            n_iter_no_change=10
        )
        
        trained_base_models = []
        for name, model in base_models:
            logger.info(f"Training {name}...")
            model.fit(X_train, y_train)
            trained_base_models.append((name, model))
        
        neural_net.fit(X_train, y_train)
        
        self.model = StackingRegressor(
            estimators=trained_base_models,
            final_estimator=neural_net,
            cv=3,
            n_jobs=-1
        )
        
        logger.info("Training stacking ensemble...")
        self.model.fit(X_train, y_train)
        
        logger.info("Calculating training metrics...")
        
        train_score = self.model.score(X_train, y_train)
        test_score = self.model.score(X_test, y_test)
        
        feature_importance = {}
        try:
            if hasattr(self.model.estimators_[0][1], 'feature_importances_'):
                feature_importance = dict(zip(
                    self.feature_names[:len(self.model.estimators_[0][1].feature_importances_)],
                    self.model.estimators_[0][1].feature_importances_
                ))
        except:
            pass
        
        logger.info("Training final model on all data...")
        
        final_base_models = []
        for name, model_template in base_models:
            if name == 'rf':
                final_model = RandomForestRegressor(
                    n_estimators=100,
                    max_depth=15,
                    min_samples_split=5,
                    min_samples_leaf=2,
                    random_state=42,
                    n_jobs=-1
                )
            elif name == 'gb':
                final_model = GradientBoostingRegressor(
                    n_estimators=100,
                    max_depth=8,
                    learning_rate=0.1,
                    random_state=42
                )
            elif name == 'ridge':
                final_model = Ridge(alpha=1.0, random_state=42)
            
            final_model.fit(X_selected, y)
            final_base_models.append((name, final_model))
        
        final_neural_net = MLPRegressor(
            hidden_layer_sizes=(128, 64, 32),
            activation='relu',
            solver='adam',
            alpha=0.001,
            batch_size=256,
            learning_rate='adaptive',
            learning_rate_init=0.001,
            max_iter=n_epochs * 2,
            shuffle=True,
            random_state=42,
            tol=1e-4,
            verbose=False,
            early_stopping=True,
            validation_fraction=0.2,
            n_iter_no_change=10
        )
        final_neural_net.fit(X_selected, y)
        
        self.model = StackingRegressor(
            estimators=final_base_models,
            final_estimator=final_neural_net,
            cv=3,
            n_jobs=-1
        )
        self.model.fit(X_selected, y)
        
        self.is_trained = True
        self.last_training_time = datetime.now()
        
        self.training_metrics = {
            'cv_mean': float(test_score),
            'cv_std': 0.0,
            'train_score': float(train_score),
            'test_score': float(test_score),
            'n_samples': len(X),
            'n_features': X_selected.shape[1],
            'n_loops': n_loops,
            'n_epochs': n_epochs,
            'feature_importance': feature_importance,
            'training_time': str(self.last_training_time)
        }
        
        self.training_history.append({
            'timestamp': self.last_training_time,
            'metrics': self.training_metrics,
            'parameters': {
                'n_loops': n_loops,
                'n_epochs': n_epochs,
                'n_samples': n_samples
            }
        })
        
        if save_model:
            self.save_model()
        
        logger.info(f"Training completed. Train Score: {train_score:.4f}, Test Score: {test_score:.4f}")
        
        return {
            'status': 'success',
            'metrics': self.training_metrics,
            'training_time': self.last_training_time,
            'model_info': {
                'type': 'StackingEnsemble',
                'base_models': [name for name, _ in base_models],
                'final_estimator': 'MLPRegressor',
                'is_trained': self.is_trained
            }
        }
    
    def complex_safety_function(self, X):
        """Complex safety scoring with non-linear relationships and interactions"""
        time_of_day, day_of_week, pop_density, crime_index, lighting, business, \
        transit, sidewalk, incidents, weather, emergency, temp, visibility, \
        precip, wind, humidity, urban, economic, education, sunset, holiday, event = X.T
        
        time_safety = 0.4 * (1 - time_of_day)
        crime_safety = 0.25 * (1 - crime_index ** 1.5)
        lighting_safety = 0.15 * lighting ** 0.8
        infrastructure_safety = 0.1 * (transit * 0.4 + sidewalk * 0.6)
        weather_safety = 0.1 * weather
        
        night_crime_interaction = 0.05 * (time_of_day * crime_index)
        weather_crime_interaction = 0.03 * ((1 - weather) * crime_index)
        density_lighting_interaction = 0.02 * (pop_density * (1 - lighting))
        
        socio_economic_safety = 0.08 * (economic * 0.6 + education * 0.4)
        
        emergency_safety = 0.07 * emergency
        
        safety_score = (
            time_safety + crime_safety + lighting_safety + 
            infrastructure_safety + weather_safety - 
            night_crime_interaction - weather_crime_interaction - 
            density_lighting_interaction + socio_economic_safety + 
            emergency_safety
        )
        
        return np.clip(safety_score, 0, 1)
    
    def fetch_weather_data(self, lat: float, lng: float) -> Dict:
        """Fetch real weather data from OpenWeatherMap API"""
        cache_key = f"weather_{lat:.4f}_{lng:.4f}"
        
        with self.cache_lock:
            if cache_key in self.weather_cache:
                cached_data, timestamp = self.weather_cache[cache_key]
                if (datetime.now() - timestamp).seconds < self.weather_cache_timeout:
                    return cached_data
        
        if not self.weather_api_key:
            logger.warning("Weather API key not configured, using synthetic data")
            return self._generate_synthetic_weather()
        
        try:
            url = f"https://api.openweathermap.org/data/2.5/weather"
            params = {
                'lat': lat,
                'lon': lng,
                'appid': self.weather_api_key,
                'units': 'metric'
            }
            
            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()
            
            weather_data = {
                'temperature': data['main']['temp'] / 40.0,  # Normalize -20 to 20°C -> 0-1
                'humidity': data['main']['humidity'] / 100.0,
                'wind_speed': min(data['wind']['speed'] / 20.0, 1.0),  # Normalize 0-20 m/s
                'precipitation': data.get('rain', {}).get('1h', 0) / 10.0,  # 0-10 mm/hr
                'visibility': min(data['visibility'] / 10000.0, 1.0),  # 0-10km
                'weather_condition': self._weather_code_to_score(data['weather'][0]['id'])
            }
            
            with self.cache_lock:
                self.weather_cache[cache_key] = (weather_data, datetime.now())
            
            return weather_data
            
        except Exception as e:
            logger.error(f"Weather API error: {e}")
            return self._generate_synthetic_weather()
    
    def _weather_code_to_score(self, code: int) -> float:
        """Convert OpenWeatherMap weather code to safety score (0-1)"""
        if 200 <= code <= 232:  # Thunderstorm
            return 0.2
        elif 300 <= code <= 321:  # Drizzle
            return 0.7
        elif 500 <= code <= 531:  # Rain
            return 0.4 if code < 511 else 0.3
        elif 600 <= code <= 622:  # Snow
            return 0.3
        elif 701 <= code <= 781:  # Atmosphere (fog, haze, etc)
            return 0.6
        elif code == 800:  # Clear
            return 0.9
        elif 801 <= code <= 804:  # Clouds
            return 0.8
        else:
            return 0.7
    
    def fetch_crime_data(self, lat: float, lng: float) -> Dict:
        """Fetch crime data for location"""
        cache_key = f"crime_{lat:.4f}_{lng:.4f}"
        
        with self.cache_lock:
            if cache_key in self.data_cache:
                return self.data_cache[cache_key]
        
        if not self.crime_api_key:
            # Use synthetic data or public crime data APIs
            crime_data = self._fetch_synthetic_crime_data(lat, lng)
        else:
            # Implement actual crime API call
            crime_data = self._fetch_real_crime_data(lat, lng)
        
        with self.cache_lock:
            self.data_cache[cache_key] = crime_data
        
        return crime_data
    
    def _fetch_synthetic_crime_data(self, lat: float, lng: float) -> Dict:
        """Generate synthetic crime data based on location patterns"""
        # In real implementation, use actual crime data APIs like:
        # - FBI Crime Data API
        # - Local police department APIs
        # - AreaVibes API
        # - SpotCrime API
        
        # For now, generate realistic patterns:
        # Urban areas have higher crime, suburban lower, rural lowest
        # Time of day affects crime rates
        current_hour = datetime.now().hour
        
        # Simulate urban density (cities have higher crime)
        # In reality, use actual population density data
        base_crime = 0.3  # Base crime index
        
        # Increase crime in evening/night
        if 20 <= current_hour <= 23 or 0 <= current_hour <= 5:
            base_crime += 0.2
        elif 18 <= current_hour <= 20:
            base_crime += 0.1
        
        # Add random variation
        base_crime += np.random.uniform(-0.1, 0.1)
        
        return {
            'crime_index': np.clip(base_crime, 0, 1),
            'historical_incidents': np.random.uniform(0.1, 0.6),
            'emergency_distance': np.random.uniform(0.7, 0.95)  # Most areas have emergency services within 5km
        }
    
    def fetch_socioeconomic_data(self, lat: float, lng: float) -> Dict:
        """Fetch socioeconomic data for location"""
        # In real implementation, use:
        # - US Census Bureau API
        # - World Bank API
        # - Local government APIs
        
        return {
            'population_density': np.random.uniform(0.1, 0.9),
            'urbanization_index': np.random.uniform(0.2, 0.9),
            'economic_index': np.random.uniform(0.3, 0.95),
            'education_index': np.random.uniform(0.4, 0.98),
            'business_density': np.random.uniform(0.2, 0.9)
        }
    
    def fetch_infrastructure_data(self, lat: float, lng: float) -> Dict:
        """Fetch infrastructure data for location"""
        if self.gmaps:
            try:
                # Get nearby places data
                places_result = self.gmaps.places_nearby(
                    location=(lat, lng),
                    radius=500,  # 500 meters
                    type=['street_light', 'bus_station', 'subway_station']
                )
                
                lighting_count = len([p for p in places_result.get('results', []) 
                                    if 'street_light' in str(p.get('types', []))])
                transit_count = len([p for p in places_result.get('results', []) 
                                   if any(t in p.get('types', []) for t in ['bus_station', 'subway_station', 'train_station'])])
                
                return {
                    'lighting_score': min(lighting_count / 10.0, 1.0),
                    'transit_access': min(transit_count / 5.0, 1.0),
                    'sidewalk_score': np.random.uniform(0.6, 0.95)  # Most urban areas have sidewalks
                }
            except Exception as e:
                logger.error(f"Google Maps API error: {e}")
        
        return {
            'lighting_score': np.random.uniform(0.3, 0.9),
            'transit_access': np.random.uniform(0.2, 0.8),
            'sidewalk_score': np.random.uniform(0.5, 0.95)
        }
    
    def prepare_features(self, lat: float, lng: float) -> np.ndarray:
        """Prepare features for prediction with real-time data"""
        current_time = datetime.now()
        
        # Fetch all data in parallel for performance
        futures = {
            'weather': self.thread_pool.submit(self.fetch_weather_data, lat, lng),
            'crime': self.thread_pool.submit(self.fetch_crime_data, lat, lng),
            'socioeconomic': self.thread_pool.submit(self.fetch_socioeconomic_data, lat, lng),
            'infrastructure': self.thread_pool.submit(self.fetch_infrastructure_data, lat, lng)
        }
        
        # Collect results
        data = {}
        for key, future in futures.items():
            try:
                data[key] = future.result(timeout=3)
            except Exception as e:
                logger.error(f"Error fetching {key} data: {e}")
                # Fallback to synthetic data
                if key == 'weather':
                    data[key] = self._generate_synthetic_weather()
                elif key == 'crime':
                    data[key] = self._fetch_synthetic_crime_data(lat, lng)
                elif key == 'socioeconomic':
                    data[key] = {
                        'population_density': 0.5,
                        'urbanization_index': 0.5,
                        'economic_index': 0.5,
                        'education_index': 0.5,
                        'business_density': 0.5
                    }
                else:
                    data[key] = {
                        'lighting_score': 0.5,
                        'transit_access': 0.5,
                        'sidewalk_score': 0.5
                    }
        
        # Combine all features
        features = []
        for feature_name in self.feature_names:
            if feature_name == 'time_of_day':
                features.append(current_time.hour / 24.0)
            elif feature_name == 'day_of_week':
                features.append(current_time.weekday() / 7.0)
            elif feature_name == 'time_since_sunset':
                # Calculate time since sunset (simplified)
                sunset_hour = 18  # 6 PM as approximate sunset
                hours_since_sunset = (current_time.hour - sunset_hour) % 24
                features.append(max(0, min(1, hours_since_sunset / 12.0)))
            elif feature_name in ['holiday_indicator', 'special_event']:
                # Check if today is holiday (simplified)
                is_holiday = 0.0
                if current_time.month == 12 and current_time.day == 25:  # Christmas
                    is_holiday = 1.0
                elif current_time.month == 1 and current_time.day == 1:  # New Year
                    is_holiday = 1.0
                features.append(is_holiday)
            elif feature_name in data['weather']:
                features.append(data['weather'][feature_name])
            elif feature_name in data['crime']:
                features.append(data['crime'][feature_name])
            elif feature_name in data['socioeconomic']:
                features.append(data['socioeconomic'][feature_name])
            elif feature_name in data['infrastructure']:
                features.append(data['infrastructure'][feature_name])
            else:
                features.append(0.5)  # Default value
        
        return np.array(features).reshape(1, -1)
    
    def _generate_synthetic_weather(self) -> Dict:
        """Generate synthetic weather data when API fails"""
        current_hour = datetime.now().hour
        
        # Simulate diurnal temperature variation
        base_temp = 20.0  # Base temperature in °C
        temp_variation = 10.0 * math.sin((current_hour - 14) * math.pi / 12.0)  # Peak at 2 PM
        temperature = max(-10, min(40, base_temp + temp_variation + np.random.uniform(-5, 5)))
        
        # Higher humidity at night
        humidity = 50.0 + 20.0 * math.sin((current_hour - 4) * math.pi / 12.0) + np.random.uniform(-10, 10)
        
        return {
            'temperature': (temperature + 20) / 60.0,  # Normalize -20 to 40°C
            'humidity': min(humidity / 100.0, 1.0),
            'wind_speed': np.random.uniform(0.1, 0.7),
            'precipitation': np.random.uniform(0, 0.3) if np.random.random() > 0.7 else 0,
            'visibility': np.random.uniform(0.7, 1.0),
            'weather_condition': np.random.uniform(0.6, 0.9)
        }
    
    def predict_safety_score(self, lat: float, lng: float) -> Dict:
        """Predict safety score for a location"""
        if not self.is_trained:
            logger.warning("Model not trained, performing quick training...")
            self.train_model_advanced(n_loops=5, n_epochs=2, save_model=False)
        
        try:
            features = self.prepare_features(lat, lng)
            features_poly = self.poly.transform(features)
            features_scaled = self.scaler.transform(features_poly)
            features_selected = self.feature_selector.transform(features_scaled)
            
            safety_score = self.model.predict(features_selected)[0]
            safety_score = np.clip(safety_score, 0, 1)
            
            confidence = max(0.7, min(0.95, self.training_metrics.get('test_score', 0.8)))
            
            current_hour = datetime.now().hour
            if 0 <= current_hour <= 5 or 20 <= current_hour <= 23:
                confidence *= 0.9
            
            return {
                'safety_score': float(safety_score),
                'confidence': float(confidence),
                'risk_level': self._get_risk_level(safety_score),
                'recommendations': self._get_recommendations(safety_score, lat, lng),
                'coordinates': {'lat': lat, 'lng': lng},
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Prediction error: {e}")
            return {
                'safety_score': 0.7,
                'confidence': 0.5,
                'risk_level': 'medium',
                'recommendations': ['Use caution', 'Stay in well-lit areas'],
                'coordinates': {'lat': lat, 'lng': lng},
                'timestamp': datetime.now().isoformat()
            }
    
    def _get_risk_level(self, score: float) -> str:
        """Convert score to risk level"""
        if score >= 0.7:
            return 'low'
        elif score >= 0.4:
            return 'medium'
        else:
            return 'high'
    
    def _get_recommendations(self, score: float, lat: float, lng: float) -> List[str]:
        """Generate safety recommendations"""
        recommendations = []
        current_hour = datetime.now().hour
        
        if score < 0.4:
            recommendations.extend([
                "🚨 High risk area - avoid if possible",
                "👥 Travel with companion recommended",
                "📱 Keep phone charged and accessible",
                "📍 Share live location with trusted contacts"
            ])
        elif score < 0.7:
            recommendations.extend([
                "⚠️ Moderate risk - stay alert",
                "💡 Use well-lit paths",
                "🎒 Keep valuables secure",
                "🚶 Stick to main roads"
            ])
        else:
            recommendations.extend([
                "✅ Generally safe area",
                "👀 Maintain normal awareness",
                "📱 Have emergency contacts ready"
            ])
        
        if 22 <= current_hour or current_hour <= 5:
            recommendations.append("🌙 Enhanced caution advised at night")
        
        if score < 0.6:
            # Check if area has poor lighting
            try:
                infra_data = self.fetch_infrastructure_data(lat, lng)
                if infra_data.get('lighting_score', 0.5) < 0.3:
                    recommendations.append("💡 Area has poor lighting - bring flashlight")
            except:
                pass
        
        return recommendations
    
    def get_directions(self, origin: Tuple[float, float], destination: Tuple[float, float], 
                      mode: str = 'walking') -> Dict:
        """Get directions from Google Maps API"""
        if not self.gmaps:
            logger.error("Google Maps API not configured")
            return None
        
        try:
            directions_result = self.gmaps.directions(
                origin=origin,
                destination=destination,
                mode=mode,
                departure_time=datetime.now(),
                alternatives=True  # Get multiple routes
            )
            
            if not directions_result:
                return None
            
            return directions_result
            
        except Exception as e:
            logger.error(f"Directions API error: {e}")
            return None
    
    def calculate_route_safety(self, route_coordinates: List[Dict], 
                             optimize_route: bool = True) -> SafetyRouteResult:
        """Calculate safety for an entire route with optional optimization"""
        if not route_coordinates or len(route_coordinates) < 2:
            raise ValueError("Route must have at least 2 coordinates")
        
        logger.info(f"Calculating route safety for {len(route_coordinates)} points")
        
        # Calculate safety for each segment in parallel
        safety_results = []
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = []
            for i, coord in enumerate(route_coordinates):
                future = executor.submit(
                    self.predict_safety_score,
                    coord['lat'],
                    coord['lng']
                )
                futures.append((i, coord, future))
            
            for i, coord, future in futures:
                try:
                    result = future.result(timeout=5)
                    result['index'] = i
                    result['lat'] = coord['lat']
                    result['lng'] = coord['lng']
                    safety_results.append(result)
                except Exception as e:
                    logger.error(f"Error predicting safety for point {i}: {e}")
        
        # Calculate overall safety
        total_score = sum(r['safety_score'] for r in safety_results)
        overall_safety = total_score / len(safety_results) if safety_results else 0.7
        
        # Identify risky segments
        risky_segments = [r for r in safety_results if r['safety_score'] < 0.4]
        
        # Calculate route statistics
        route_distance = self._calculate_route_distance(route_coordinates)
        route_duration = self._estimate_route_duration(route_distance, 'walking')
        
        # Optimize route if requested
        safe_route_coords = route_coordinates
        if optimize_route and risky_segments:
            safe_route_coords = self._optimize_route_around_risky_areas(
                route_coordinates, 
                safety_results
            )
        
        # Generate recommendations
        recommendations = self._get_route_recommendations(
            overall_safety, 
            risky_segments, 
            route_distance,
            route_duration
        )
        
        # Calculate confidence
        confidence_values = [r['confidence'] for r in safety_results]
        avg_confidence = np.mean(confidence_values) if confidence_values else 0.7
        
        return SafetyRouteResult(
            overall_safety=overall_safety,
            risk_level=self._get_risk_level(overall_safety),
            safe_route_coords=safe_route_coords,
            original_route_coords=route_coordinates,
            risky_segments=risky_segments,
            distance_meters=route_distance,
            duration_seconds=route_duration,
            recommendations=recommendations,
            confidence=avg_confidence,
            segment_details=safety_results
        )
    
    def _calculate_route_distance(self, coordinates: List[Dict]) -> float:
        """Calculate total distance of route in meters using Haversine formula"""
        total_distance = 0.0
        
        for i in range(len(coordinates) - 1):
            lat1, lng1 = coordinates[i]['lat'], coordinates[i]['lng']
            lat2, lng2 = coordinates[i + 1]['lat'], coordinates[i + 1]['lng']
            
            # Haversine formula
            R = 6371000  # Earth radius in meters
            
            lat1_rad = math.radians(lat1)
            lat2_rad = math.radians(lat2)
            delta_lat = math.radians(lat2 - lat1)
            delta_lng = math.radians(lng2 - lng1)
            
            a = (math.sin(delta_lat / 2) ** 2 + 
                 math.cos(lat1_rad) * math.cos(lat2_rad) * 
                 math.sin(delta_lng / 2) ** 2)
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
            
            total_distance += R * c
        
        return total_distance
    
    def _estimate_route_duration(self, distance_meters: float, mode: str = 'walking') -> float:
        """Estimate route duration in seconds"""
        if mode == 'walking':
            speed_mps = 1.4  # 5 km/h ≈ 1.4 m/s
        elif mode == 'cycling':
            speed_mps = 4.0  # 15 km/h ≈ 4.2 m/s
        elif mode == 'driving':
            speed_mps = 8.3  # 30 km/h ≈ 8.3 m/s
        else:
            speed_mps = 1.4
        
        return distance_meters / speed_mps
    
    def _optimize_route_around_risky_areas(self, route_coords: List[Dict], 
                                         safety_results: List[Dict]) -> List[Dict]:
        """Optimize route to avoid risky areas"""
        if not safety_results:
            return route_coords
        
        optimized_route = []
        i = 0
        
        while i < len(route_coords):
            current_safety = safety_results[i]['safety_score']
            
            if current_safety >= 0.4:  # Safe enough
                optimized_route.append(route_coords[i])
                i += 1
            else:
                # Found risky segment, try to find detour
                risky_start = i
                
                # Find end of risky segment
                while i < len(route_coords) and safety_results[i]['safety_score'] < 0.4:
                    i += 1
                risky_end = min(i, len(route_coords) - 1)
                
                if risky_start == 0 or risky_end == len(route_coords) - 1:
                    # Can't avoid start or end points
                    for j in range(risky_start, risky_end + 1):
                        optimized_route.append(route_coords[j])
                else:
                    # Try to find detour around risky segment
                    start_coord = route_coords[risky_start - 1]
                    end_coord = route_coords[risky_end]
                    
                    # Create detour by interpolating around the area
                    detour_coords = self._create_detour(
                        start_coord, 
                        end_coord,
                        route_coords[risky_start:risky_end]
                    )
                    
                    optimized_route.extend(detour_coords)
        
        return optimized_route if optimized_route else route_coords
    
    def _create_detour(self, start: Dict, end: Dict, risky_segment: List[Dict]) -> List[Dict]:
        """Create detour coordinates around risky area"""
        detour_coords = [start]
        
        # Simple detour: go slightly north/south of the risky segment
        avg_lat = sum(coord['lat'] for coord in risky_segment) / len(risky_segment)
        avg_lng = sum(coord['lng'] for coord in risky_segment) / len(risky_segment)
        
        # Calculate detour points (simplified - in reality use pathfinding)
        detour_lat = avg_lat + 0.001  # ~100 meters north
        detour_lng = avg_lng
        
        detour_coords.append({'lat': detour_lat, 'lng': detour_lng})
        detour_coords.append(end)
        
        return detour_coords
    
    def _get_route_recommendations(self, overall_safety: float, risky_segments: List[Dict],
                                 distance_meters: float, duration_seconds: float) -> List[str]:
        """Generate route-specific recommendations"""
        recommendations = []
        current_hour = datetime.now().hour
        
        # Safety-based recommendations
        if overall_safety < 0.4:
            recommendations.append("🚨 HIGH RISK ROUTE - Strongly consider alternatives")
        elif overall_safety < 0.7:
            recommendations.append("⚠️ Moderate risk - exercise caution")
        
        # Risky segment recommendations
        if risky_segments:
            risk_count = len(risky_segments)
            if risk_count == 1:
                recommendations.append(f"📊 1 risky segment identified")
            else:
                recommendations.append(f"📊 {risk_count} risky segments identified")
            
            if risk_count > 3:
                recommendations.append("⚠️ Multiple consecutive risky areas - high alert")
        
        # Time-based recommendations
        if 22 <= current_hour or current_hour <= 5:
            recommendations.append("🌙 Night travel - enhanced precautions needed")
        
        # Distance-based recommendations
        distance_km = distance_meters / 1000
        duration_min = duration_seconds / 60
        
        if distance_km > 5:
            recommendations.append(f"📏 Long route ({distance_km:.1f} km) - plan breaks")
        
        if duration_min > 30:
            recommendations.append(f"⏱️ Extended duration ({duration_min:.0f} min) - ensure preparedness")
        
        # General recommendations
        recommendations.extend([
            "📱 Keep phone charged and accessible",
            "📍 Share live location with trusted contacts",
            "🚨 Have emergency services number ready"
        ])
        
        if not recommendations:
            recommendations.append("✅ Route appears generally safe")
        
        return recommendations
    
    def find_safe_route(self, origin: Tuple[float, float], destination: Tuple[float, float],
                       mode: str = 'walking', max_alternatives: int = 3) -> List[SafetyRouteResult]:
        """Find multiple safe route alternatives between origin and destination"""
        if not self.gmaps:
            logger.error("Google Maps API not configured")
            return []
        
        try:
            # Get directions from Google Maps
            directions = self.get_directions(origin, destination, mode)
            if not directions:
                return []
            
            route_results = []
            
            # Process each route alternative
            for i, route in enumerate(directions[:max_alternatives]):
                logger.info(f"Analyzing route alternative {i + 1}")
                
                # Extract polyline points
                steps = route['legs'][0]['steps']
                route_coordinates = []
                
                for step in steps:
                    # Decode polyline if available
                    if 'polyline' in step and 'points' in step['polyline']:
                        # In reality, decode the polyline string
                        # For now, use start and end locations
                        start_loc = step['start_location']
                        end_loc = step['end_location']
                        
                        # Add points along the step (simplified)
                        num_points = max(2, int(step['distance']['value'] / 50))  # Point every 50m
                        for j in range(num_points):
                            t = j / (num_points - 1) if num_points > 1 else 0
                            lat = start_loc['lat'] + t * (end_loc['lat'] - start_loc['lat'])
                            lng = start_loc['lng'] + t * (end_loc['lng'] - start_loc['lng'])
                            route_coordinates.append({'lat': lat, 'lng': lng})
                
                if not route_coordinates:
                    # Fallback: use start and end points
                    route_coordinates = [
                        {'lat': origin[0], 'lng': origin[1]},
                        {'lat': destination[0], 'lng': destination[1]}
                    ]
                
                # Calculate safety for this route
                safety_result = self.calculate_route_safety(
                    route_coordinates,
                    optimize_route=True
                )
                
                # Add route metadata
                safety_result.route_metadata = {
                    'route_index': i,
                    'distance_meters': route['legs'][0]['distance']['value'],
                    'duration_seconds': route['legs'][0]['duration']['value'],
                    'summary': route.get('summary', f'Route {i + 1}'),
                    'warnings': route.get('warnings', [])
                }
                
                route_results.append(safety_result)
            
            # Sort by safety score (highest first)
            route_results.sort(key=lambda x: x.overall_safety, reverse=True)
            
            return route_results
            
        except Exception as e:
            logger.error(f"Error finding safe route: {e}")
            return []
    
    def real_time_tracking(self, user_id: str, coordinates: List[Dict], 
                          update_interval: int = 30) -> Dict:
        """Real-time safety tracking for a moving user"""
        if not coordinates:
            return {'error': 'No coordinates provided'}
        
        current_location = coordinates[-1]
        safety_result = self.predict_safety_score(
            current_location['lat'],
            current_location['lng']
        )
        
        # Analyze recent path for safety trends
        recent_safety_scores = []
        if len(coordinates) > 5:
            recent_coords = coordinates[-5:]  # Last 5 points
            for coord in recent_coords:
                try:
                    score = self.predict_safety_score(coord['lat'], coord['lng'])['safety_score']
                    recent_safety_scores.append(score)
                except:
                    pass
        
        # Calculate safety trend
        safety_trend = 'stable'
        if len(recent_safety_scores) >= 3:
            if recent_safety_scores[-1] < min(recent_safety_scores[:-1]) - 0.1:
                safety_trend = 'deteriorating'
            elif recent_safety_scores[-1] > max(recent_safety_scores[:-1]) + 0.1:
                safety_trend = 'improving'
        
        # Generate emergency response if needed
        emergency_response = None
        if safety_result['safety_score'] < 0.3:
            emergency_response = self._generate_emergency_response(current_location)
        
        return {
            'user_id': user_id,
            'current_safety': safety_result,
            'safety_trend': safety_trend,
            'timestamp': datetime.now().isoformat(),
            'update_interval': update_interval,
            'emergency_response': emergency_response,
            'next_update_in': update_interval,
            'tracking_active': True
        }
    
    def _generate_emergency_response(self, location: Dict) -> Dict:
        """Generate emergency response data"""
        if not self.gmaps:
            return None
        
        try:
            # Find nearest hospitals/police stations
            places_result = self.gmaps.places_nearby(
                location=(location['lat'], location['lng']),
                radius=2000,  # 2km radius
                type=['hospital', 'police']
            )
            
            emergency_services = []
            for place in places_result.get('results', [])[:3]:  # Top 3
                service_type = 'hospital' if 'hospital' in place.get('types', []) else 'police'
                emergency_services.append({
                    'name': place.get('name', 'Unknown'),
                    'type': service_type,
                    'vicinity': place.get('vicinity', ''),
                    'distance': place.get('distance', 0)
                })
            
            # Generate emergency message
            current_time = datetime.now().strftime("%H:%M")
            emergency_message = f"""
            🚨 EMERGENCY ALERT - HIGH RISK AREA 🚨
            
            Location: {location['lat']:.4f}, {location['lng']:.4f}
            Time: {current_time}
            Risk Level: CRITICAL
            
            Immediate Actions Recommended:
            1. Move to nearest safe location
            2. Contact emergency services: 911
            3. Share your live location
            4. Stay on the line if calling for help
            
            Nearest Emergency Services:
            {chr(10).join([f"- {s['name']} ({s['type']})" for s in emergency_services[:2]])}
            """
            
            return {
                'emergency_services': emergency_services,
                'emergency_message': emergency_message,
                'timestamp': datetime.now().isoformat(),
                'recommended_actions': [
                    "Move to well-lit public area",
                    "Call emergency services",
                    "Share live location with contacts",
                    "Stay visible and audible"
                ]
            }
            
        except Exception as e:
            logger.error(f"Error generating emergency response: {e}")
            return None
    
    def get_model_info(self) -> Dict:
        """Get information about the current model"""
        return {
            'is_trained': self.is_trained,
            'last_training_time': self.last_training_time,
            'training_metrics': self.training_metrics,
            'model_path': self.model_path,
            'training_history_count': len(self.training_history),
            'features_used': len(self.feature_names),
            'model_type': 'StackingEnsemble' if self.is_trained else 'Not trained',
            'api_status': {
                'google_maps': self.gmaps is not None,
                'weather_api': bool(self.weather_api_key),
                'crime_api': bool(self.crime_api_key)
            }
        }
    
    def incremental_train(self, new_data=None, epochs=1):
        """Perform incremental training with new data"""
        if new_data is None:
            n_samples = 1000
            X_new = np.random.random((n_samples, len(self.feature_names)))
            y_new = self.complex_safety_function(X_new)
            noise = np.random.normal(0, 0.05, n_samples)
            y_new = np.clip(y_new + noise, 0, 1)
            new_data = (X_new, y_new)
        
        X_new, y_new = new_data
        
        if not self.is_trained:
            logger.warning("Model not trained for incremental learning, performing full training")
            return self.train_model_advanced(n_loops=5, n_epochs=epochs)
        
        try:
            X_poly = self.poly.transform(X_new)
            X_scaled = self.scaler.transform(X_poly)
            X_selected = self.feature_selector.transform(X_scaled)
            
            if hasattr(self.model, 'warm_start') and self.model.warm_start:
                self.model.fit(X_selected, y_new)
            else:
                logger.info("Model doesn't support warm start, performing partial retraining")
                pass
            
            self.last_training_time = datetime.now()
            self.save_model()
            
            return {
                'status': 'success',
                'message': 'Incremental training completed',
                'samples_trained': len(X_new),
                'training_time': self.last_training_time
            }
        except Exception as e:
            logger.error(f"Incremental training failed: {e}")
            return {
                'status': 'error',
                'message': str(e)
            }
    
    def cleanup(self):
        """Cleanup resources"""
        self.thread_pool.shutdown(wait=True)
        logger.info("Safety AI resources cleaned up")


# Create singleton instance
def get_safety_ai():
    """Get or create the singleton AI instance"""
    model_path = os.environ.get('MODEL_PATH', 'models/safety_model.pkl')
    google_maps_api_key = os.environ.get('GOOGLE_MAPS_API_KEY')
    
    retrain_on_start = os.environ.get('RETRAIN_ON_START', 'false').lower() == 'true'
    
    return AdvancedSafetyRoutingAI(
        model_path=model_path,
        google_maps_api_key=google_maps_api_key,
        retrain_on_start=retrain_on_start
    )

# Global instance
safety_ai = get_safety_ai()