"""
Enhanced AI Safety Model with real features from APIs.
"""

import os
import pickle
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
import logging
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler, PolynomialFeatures
from sklearn.feature_selection import SelectFromModel
from sklearn.linear_model import LassoCV
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.metrics import r2_score, mean_squared_error
import joblib
import warnings
import time
import joblib
import hashlib
import pickle
from pathlib import Path
import googlemaps
import logging
from typing import Dict, List, Tuple, Optional, Any

warnings.filterwarnings('ignore')
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MAX_DISTANCE = 1000
THRESHOLD = 0.25

from real_api_client import RealAPIClient

logger = logging.getLogger(__name__)

class SafetyAIModel:
    """Enhanced AI model for safety prediction with real API data"""
    
    def __init__(self, model_path: str = 'models/safety_model.pkl'):
        self.model_path = model_path
        self.is_trained = False
        self.training_metrics = {}
        self.last_training_time = None
        self.api_client = RealAPIClient()
        self.model = None
        self.scaler = None
        self.feature_selector = None
        self.poly_features = None
        
        # Load model if exists
        if os.path.exists(model_path):
            self.load_model(model_path)
    
    def load_model(self, model_path: str = None) -> bool:
        """Load trained model from file"""
        try:
            path = model_path or self.model_path
            if os.path.exists(path):
                with open(path, 'rb') as f:
                    model_data = pickle.load(f)
                
                self.model = model_data['model']
                self.scaler = model_data['scaler']
                self.feature_selector = model_data['feature_selector']
                self.poly_features = model_data['poly_features']
                self.training_metrics = model_data.get('metrics', {})
                self.last_training_time = model_data.get('last_training_time')
                self.is_trained = True
                
                logger.info(f"Model loaded from {path}")
                return True
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
        
        return False
    
    def save_model(self, model_path: str = None) -> bool:
        """Save trained model to file"""
        try:
            path = model_path or self.model_path
            os.makedirs(os.path.dirname(path), exist_ok=True)
            
            model_data = {
                'model': self.model,
                'scaler': self.scaler,
                'feature_selector': self.feature_selector,
                'poly_features': self.poly_features,
                'metrics': self.training_metrics,
                'last_training_time': self.last_training_time
            }
            
            with open(path, 'wb') as f:
                pickle.dump(model_data, f)
            
            logger.info(f"Model saved to {path}")
            return True
        except Exception as e:
            logger.error(f"Failed to save model: {e}")
            return False
    
    def extract_features(self, lat: float, lng: float) -> Dict[str, float]:
        """Extract comprehensive features for safety prediction"""
        features = {}
        
        # Get time-based features
        time_data = self.api_client.get_time_based_factors()
        features['hour'] = time_data['hour']
        features['hour_sin'] = np.sin(2 * np.pi * features['hour'] / 24)
        features['hour_cos'] = np.cos(2 * np.pi * features['hour'] / 24)
        features['day_of_week'] = time_data['day_of_week']
        features['month'] = time_data['month']
        features['is_daylight'] = 1.0 if time_data['is_daylight'] else 0.0
        features['is_weekend'] = 1.0 if time_data['is_weekend'] else 0.0
        
        # Get weather features
        weather_data = self.api_client.get_weather_data(lat, lng)
        features['temperature'] = weather_data['temperature']
        features['visibility'] = weather_data['visibility']
        features['wind_speed'] = weather_data['wind_speed']
        features['humidity'] = weather_data['humidity'] / 100.0  # Normalize
        
        # Weather condition encoding
        condition = weather_data['condition']
        conditions = ['clear', 'clouds', 'rain', 'snow', 'thunderstorm', 'fog']
        for cond in conditions:
            features[f'weather_{cond}'] = 1.0 if cond in condition else 0.0
        
        # Get crime features
        crime_data = self.api_client.get_crime_data(lat, lng)
        features['crime_index'] = crime_data['crime_index']
        features['crime_density'] = crime_data['total_incidents'] / (3.14 * (crime_data['radius_km'] ** 2))
        
        # Get disaster features
        fema_data = self.api_client.get_fema_alerts(lat, lng)
        features['disaster_score'] = fema_data['disaster_score']
        features['active_disasters'] = len(fema_data['active_disasters'])
        
        # Get socioeconomic features
        census_data = self.api_client.get_census_data(lat, lng)
        features['median_income'] = census_data['median_income']
        features['median_home_value'] = census_data['median_home_value']
        features['population_density'] = census_data['population'] / 800  # Allegheny County area in km²
        features['socioeconomic_score'] = census_data['socioeconomic_score']
        
        # Get traffic features
        traffic_data = self.api_client.get_traffic_data(lat, lng)
        features['congestion_level'] = traffic_data['congestion_level']
        features['traffic_safety_score'] = traffic_data['traffic_safety_score']
        
        # Calculate additional derived features
        features['time_crime_interaction'] = features['hour'] * (1 - features['crime_index'])
        features['weather_crime_interaction'] = weather_data['safety_score'] * features['crime_index']
        features['socioeconomic_crime_interaction'] = features['socioeconomic_score'] * features['crime_index']
        
        # Location-based features (relative to Pittsburgh center)
        pittsburgh_center = (40.4406, -79.9959)
        distance_to_center = self._haversine_distance(lat, lng, *pittsburgh_center)
        features['distance_to_center_km'] = distance_to_center / 1000
        features['urbanization_index'] = max(0, 1 - (distance_to_center / 20000))  # 20km radius
        
        # Feature for historical data (simulated)
        features['historical_safety'] = 0.7 + 0.1 * np.random.randn()
        
        return features
    
    def train_model_advanced(self, n_loops: int = 15, n_epochs: int = 5,
                           force_retrain: bool = False, save_model: bool = True) -> Dict:
        """Train model with progressive difficulty"""
        try:
            if self.is_trained and not force_retrain:
                return {'status': 'already_trained', 'model': self}
            
            logger.info(f"Starting advanced training: {n_loops} loops, {n_epochs} epochs each")
            
            # Generate training data
            X_train, y_train, X_test, y_test = self._generate_training_data(n_samples=5000)
            
            # Create feature engineering pipeline
            self.scaler = StandardScaler()
            self.poly_features = PolynomialFeatures(degree=2, interaction_only=True, include_bias=False)
            self.feature_selector = SelectFromModel(
                LassoCV(cv=5, max_iter=10000),
                threshold='median'
            )
            
            # Create neural network model
            self.model = MLPRegressor(
                hidden_layer_sizes=(128, 64, 32),
                activation='relu',
                solver='adam',
                alpha=0.001,
                batch_size='auto',
                learning_rate='adaptive',
                learning_rate_init=0.001,
                max_iter=n_epochs,
                shuffle=True,
                random_state=42,
                tol=0.0001,
                verbose=False,
                warm_start=True,
                n_iter_no_change=10
            )
            
            # Progressive training loop
            train_scores = []
            cv_scores = []
            
            for loop in range(n_loops):
                logger.info(f"Training loop {loop + 1}/{n_loops}")
                
                # Scale features
                X_train_scaled = self.scaler.fit_transform(X_train)
                
                # Apply polynomial features
                X_train_poly = self.poly_features.fit_transform(X_train_scaled)
                
                # Feature selection
                if loop == 0:
                    X_train_selected = self.feature_selector.fit_transform(X_train_poly, y_train)
                    selected_features = self.feature_selector.get_support()
                    logger.info(f"Selected {selected_features.sum()} features out of {X_train_poly.shape[1]}")
                else:
                    X_train_selected = self.feature_selector.transform(X_train_poly)
                
                # Train model
                self.model.fit(X_train_selected, y_train)
                
                # Calculate scores
                train_score = self.model.score(X_train_selected, y_train)
                cv_score = np.mean(cross_val_score(self.model, X_train_selected, y_train, cv=5))
                
                train_scores.append(train_score)
                cv_scores.append(cv_score)
                
                logger.info(f"Loop {loop + 1}: Train Score = {train_score:.4f}, CV Score = {cv_score:.4f}")
            
            # Final evaluation on test set
            X_test_scaled = self.scaler.transform(X_test)
            X_test_poly = self.poly_features.transform(X_test_scaled)
            X_test_selected = self.feature_selector.transform(X_test_poly)
            
            test_score = self.model.score(X_test_selected, y_test)
            y_pred = self.model.predict(X_test_selected)
            test_mse = mean_squared_error(y_test, y_pred)
            
            # Store metrics
            self.training_metrics = {
                'train_scores': train_scores,
                'cv_scores': cv_scores,
                'final_train_score': train_scores[-1],
                'final_cv_score': cv_scores[-1],
                'test_score': test_score,
                'test_mse': test_mse,
                'n_samples': len(X_train) + len(X_test),
                'n_features': X_train_selected.shape[1],
                'feature_names': self._get_feature_names(),
                'training_time': datetime.now().isoformat()
            }
            
            self.last_training_time = datetime.now()
            self.is_trained = True
            
            if save_model:
                self.save_model()
            
            logger.info(f"Training completed. Test score: {test_score:.4f}")
            
            return {
                'status': 'success',
                'metrics': self.training_metrics,
                'model': self
            }
            
        except Exception as e:
            logger.error(f"Training failed: {e}")
            return {'status': 'error', 'error': str(e)}
    
    def _generate_training_data(self, n_samples: int = 5000) -> Tuple:
        """Generate training data with realistic safety scores"""
        # Pittsburgh area coordinates
        pittsburgh_center = (40.4406, -79.9959)
        radius_km = 15
        
        X = []
        y = []
        
        logger.info(f"Generating {n_samples} training samples...")
        
        for i in range(n_samples):
            # Generate random location near Pittsburgh
            lat = pittsburgh_center[0] + (np.random.randn() * 0.15)
            lng = pittsburgh_center[1] + (np.random.randn() * 0.15)
            
            # Extract features
            features = self.extract_features(lat, lng)
            
            # Calculate realistic safety score
            safety_score = self._calculate_safety_score(features)
            
            # Add noise
            safety_score += np.random.randn() * 0.05
            safety_score = max(0.1, min(1.0, safety_score))
            
            X.append(list(features.values()))
            y.append(safety_score)
        
        # Convert to arrays
        X = np.array(X)
        y = np.array(y)
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
        
        return X_train, y_train, X_test, y_test
    
    def _calculate_safety_score(self, features: Dict) -> float:
        """Calculate realistic safety score from features"""
        # Base score from time
        base_score = features.get('time_score', 0.7)
        
        # Adjust for crime
        crime_penalty = (1 - features.get('crime_index', 0.7)) * 0.3
        base_score -= crime_penalty
        
        # Adjust for weather
        weather_score = self.api_client.get_weather_data(0, 0)['safety_score']  # Dummy call
        base_score *= weather_score
        
        # Adjust for disasters
        base_score *= features.get('disaster_score', 0.9)
        
        # Adjust for socioeconomic factors
        base_score *= (0.7 + 0.3 * features.get('socioeconomic_score', 0.7))
        
        # Adjust for traffic
        base_score *= features.get('traffic_safety_score', 0.8)
        
        # Adjust for urbanization (more urban = more risky at night)
        if not features.get('is_daylight', True):
            urbanization_penalty = features.get('urbanization_index', 0.5) * 0.2
            base_score -= urbanization_penalty
        
        return max(0.1, min(1.0, base_score))
    
    def predict_safety_score(self, lat: float, lng: float) -> Dict:
        """Predict safety score for a location"""
        try:
            if not self.is_trained:
                # Fallback to heuristic prediction
                return self._heuristic_prediction(lat, lng)
            
            # Extract features
            features = self.extract_features(lat, lng)
            feature_values = np.array([list(features.values())])
            
            # Transform features
            feature_scaled = self.scaler.transform(feature_values)
            feature_poly = self.poly_features.transform(feature_scaled)
            feature_selected = self.feature_selector.transform(feature_poly)
            
            # Make prediction
            safety_score = float(self.model.predict(feature_selected)[0])
            safety_score = max(0.1, min(1.0, safety_score))
            
            # Calculate confidence based on feature quality
            confidence = min(0.95, 0.7 + 0.25 * safety_score)
            
            # Determine risk level
            if safety_score >= 0.8:
                risk_level = 'low'
                recommendations = ['Safe to walk', 'Normal precautions']
            elif safety_score >= 0.6:
                risk_level = 'medium'
                recommendations = ['Stay alert', 'Use well-lit paths', 'Avoid isolated areas']
            elif safety_score >= 0.4:
                risk_level = 'high'
                recommendations = ['Exercise caution', 'Consider alternative route', 'Travel with others if possible']
            else:
                risk_level = 'critical'
                recommendations = ['Avoid area if possible', 'Use emergency services if needed', 'Extreme caution required']
            
            # Add time-specific recommendations
            time_data = self.api_client.get_time_based_factors()
            if not time_data['is_daylight']:
                recommendations.append('Use flashlight')
                if safety_score < 0.7:
                    recommendations.append('Consider waiting until daylight')
            
            return {
                'safety_score': safety_score,
                'confidence': confidence,
                'risk_level': risk_level,
                'recommendations': recommendations,
                'coordinates': {'lat': lat, 'lng': lng},
                'feature_values': {k: round(v, 4) for k, v in features.items()},
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Prediction failed: {e}")
            return self._heuristic_prediction(lat, lng)
    
    def calculate_route_safety(self, route_coords: List[Dict]) -> Dict:
        """Calculate safety for an entire route"""
        try:
            if not route_coords:
                return {'overall_safety': 0.5, 'risk_level': 'unknown'}
            
            safety_scores = []
            segment_details = []
            
            # Calculate safety for each segment
            for i in range(len(route_coords) - 1):
                start = route_coords[i]
                end = route_coords[i + 1]
                
                # Use midpoint for segment safety
                mid_lat = (start['lat'] + end['lat']) / 2
                mid_lng = (start['lng'] + end['lng']) / 2
                
                safety_result = self.predict_safety_score(mid_lat, mid_lng)
                segment_safety = safety_result['safety_score']
                safety_scores.append(segment_safety)
                
                segment_details.append({
                    'start': start,
                    'end': end,
                    'safety_score': segment_safety,
                    'risk_level': safety_result['risk_level'],
                    'recommendations': safety_result['recommendations'][:2]
                })
            
            # Calculate weighted safety (by segment length)
            overall_safety = np.mean(safety_scores)
            
            # Determine overall risk level
            if overall_safety >= 0.8:
                risk_level = 'low'
                overall_recommendations = ['Route appears safe', 'Normal precautions']
            elif overall_safety >= 0.6:
                risk_level = 'medium'
                overall_recommendations = ['Route generally safe', 'Stay alert in medium-risk segments']
            elif overall_safety >= 0.4:
                risk_level = 'high'
                overall_recommendations = ['Consider alternative route', 'Exercise caution throughout']
            else:
                risk_level = 'critical'
                overall_recommendations = ['Avoid this route', 'Use emergency alternatives if necessary']
            
            # Identify risky segments
            risky_segments = [
                details for details in segment_details 
                if details['safety_score'] < 0.6
            ]
            
            if risky_segments:
                overall_recommendations.append(f'Avoid {len(risky_segments)} risky segment(s)')
            
            return {
                'overall_safety': float(overall_safety),
                'risk_level': risk_level,
                'safe_route_coords': route_coords,
                'original_route_coords': route_coords,
                'risky_segments': risky_segments,
                'distance_meters': 0,  # Would need route calculation
                'duration_seconds': 0,
                'recommendations': overall_recommendations,
                'confidence': min(0.95, 0.7 + 0.25 * overall_safety),
                'segment_details': segment_details
            }
            
        except Exception as e:
            logger.error(f"Route safety calculation failed: {e}")
            return {
                'overall_safety': 0.5,
                'risk_level': 'unknown',
                'recommendations': ['Safety calculation unavailable'],
                'confidence': 0.5
            }
    
    def _heuristic_prediction(self, lat: float, lng: float) -> Dict:
        """Heuristic safety prediction when model isn't trained"""
        time_data = self.api_client.get_time_based_factors()
        
        # Base heuristic
        if time_data['is_daylight']:
            base_safety = 0.7
        else:
            base_safety = 0.4
        
        # Adjust for crime (simulated)
        crime_adjustment = np.random.uniform(-0.2, 0.1)
        safety_score = max(0.1, min(1.0, base_safety + crime_adjustment))
        
        if safety_score >= 0.7:
            risk_level = 'low'
            recommendations = ['Heuristic: Generally safe']
        elif safety_score >= 0.5:
            risk_level = 'medium'
            recommendations = ['Heuristic: Use caution']
        else:
            risk_level = 'high'
            recommendations = ['Heuristic: Consider alternatives']
        
        return {
            'safety_score': safety_score,
            'confidence': 0.5,
            'risk_level': risk_level,
            'recommendations': recommendations,
            'coordinates': {'lat': lat, 'lng': lng},
            'timestamp': datetime.now().isoformat(),
            'is_heuristic': True
        }
    
    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
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
    
    def _get_feature_names(self) -> List[str]:
        """Get feature names after transformation"""
        if not self.poly_features:
            return []
        
        # This would need the original feature names to map
        # For now, return generic names
        return [f'feature_{i}' for i in range(self.poly_features.n_output_features_)]
    
    def get_model_info(self) -> Dict:
        """Get information about the current model"""
        return {
            'is_trained': self.is_trained,
            'last_training_time': self.last_training_time.isoformat() if self.last_training_time else None,
            'training_metrics': self.training_metrics,
            'model_path': self.model_path,
            'model_type': 'MLPRegressor' if self.model else 'None',
            'feature_count': self.training_metrics.get('n_features', 0) if self.training_metrics else 0
        }


def get_safety_ai():
    """Factory function to get Safety AI instance"""
    return SafetyAIModel()
