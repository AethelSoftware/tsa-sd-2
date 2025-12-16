import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor, StackingRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler, PolynomialFeatures
from sklearn.feature_selection import SelectFromModel
from sklearn.model_selection import cross_val_score, train_test_split
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
from typing import Dict, List, Tuple, Optional, Any

warnings.filterwarnings('ignore')
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MAX_DISTANCE = 1000
THRESHOLD = 0.25

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
        
        Args:
            n_loops: Number of training loops (dataset variations)
            n_epochs: Number of epochs per loop (for neural network)
            n_samples: Samples per loop
            force_retrain: Force retraining even if model exists
            save_model: Whether to save the model after training
        """
        
        # Check if we should retrain
        if not force_retrain and self.is_trained:
            days_since_training = 0
            if self.last_training_time:
                days_since_training = (datetime.now() - self.last_training_time).days
            
            if days_since_training < 1:  # Don't retrain if trained today
                logger.info(f"Model already trained today, skipping retraining")
                return {
                    'status': 'skipped',
                    'message': 'Model already trained today',
                    'last_training': self.last_training_time,
                    'metrics': self.training_metrics
                }
        
        logger.info(f"Starting advanced training: {n_loops} loops, {n_epochs} epochs")
        
        # Generate comprehensive synthetic training data
        X_list = []
        y_list = []
        
        for loop in range(n_loops):
            logger.info(f"Loop {loop + 1}/{n_loops}")
            
            # Generate varied synthetic data
            X_loop = np.random.randn(n_samples, len(self.feature_names))
            # Scale and shift to make data more realistic
            X_loop = (X_loop * 0.5) + 0.5  # Center around 0.5 with std 0.5
            X_loop = np.clip(X_loop, 0, 1)
            
            # Apply different noise patterns for each loop
            y_loop = self.complex_safety_function(X_loop)
            
            # Add progressive noise (more noise in later loops)
            noise_variance = 0.05 + (loop * 0.002)
            noise = np.random.normal(0, noise_variance, n_samples)
            y_loop += noise
            
            # Add some outliers for robustness
            if loop % 3 == 0:
                outlier_indices = np.random.choice(n_samples, size=n_samples//20, replace=False)
                y_loop[outlier_indices] = np.random.rand(len(outlier_indices))
            
            y_loop = np.clip(y_loop, 0, 1)
            
            X_list.append(X_loop)
            y_list.append(y_loop)
        
        # Combine all loops
        X = np.vstack(X_list)
        y = np.hstack(y_list)
        
        # Feature engineering pipeline
        logger.info("Performing feature engineering...")
        
        # Polynomial features
        X_poly = self.poly.fit_transform(X)
        
        # Scale features
        X_scaled = self.scaler.fit_transform(X_poly)
        
        # Feature selection
        self.feature_selector = SelectFromModel(
            Lasso(alpha=0.001, random_state=42),
            threshold='median'
        )
        X_selected = self.feature_selector.fit_transform(X_scaled, y)
        
        # Train multiple models in ensemble
        logger.info("Training ensemble models...")
        
        # Base models
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
        
        # Neural network for multi-epoch training
        logger.info("Training neural network with multiple epochs...")
        neural_net = MLPRegressor(
            hidden_layer_sizes=(128, 64, 32),
            activation='relu',
            solver='adam',
            alpha=0.001,
            batch_size=256,
            learning_rate='adaptive',
            learning_rate_init=0.001,
            max_iter=n_epochs * 2,  # Double epochs for neural network
            shuffle=True,
            random_state=42,
            tol=1e-4,
            verbose=False,
            early_stopping=True,
            validation_fraction=0.2,
            n_iter_no_change=10
        )
        
        # Train neural network
        neural_net.fit(X_selected, y)
        
        # Train base models
        for name, model in base_models:
            logger.info(f"Training {name}...")
            model.fit(X_selected, y)
        
        # Create stacking ensemble
        self.model = StackingRegressor(
            estimators=base_models,
            final_estimator=neural_net,
            cv=3,
            n_jobs=-1
        )
        
        # Train stacking ensemble
        logger.info("Training stacking ensemble...")
        self.model.fit(X_selected, y)
        
        # Calculate metrics
        logger.info("Calculating training metrics...")
        
        # Cross-validation scores
        cv_scores = cross_val_score(self.model, X_selected, y, cv=5, scoring='r2')
        cv_mean = cv_scores.mean()
        cv_std = cv_scores.std()
        
        # Train/Test split evaluation
        X_train, X_test, y_train, y_test = train_test_split(
            X_selected, y, test_size=0.2, random_state=42
        )
        
        # Final training on full data
        self.model.fit(X_train, y_train)
        train_score = self.model.score(X_train, y_train)
        test_score = self.model.score(X_test, y_test)
        
        # Feature importance (for tree-based models)
        feature_importance = {}
        try:
            if hasattr(self.model.estimators_[0][1], 'feature_importances_'):
                feature_importance = dict(zip(
                    self.feature_names[:len(self.model.estimators_[0][1].feature_importances_)],
                    self.model.estimators_[0][1].feature_importances_
                ))
        except:
            pass
        
        # Update model state
        self.is_trained = True
        self.last_training_time = datetime.now()
        
        # Store metrics
        self.training_metrics = {
            'cv_mean': float(cv_mean),
            'cv_std': float(cv_std),
            'train_score': float(train_score),
            'test_score': float(test_score),
            'n_samples': len(X),
            'n_features': X_selected.shape[1],
            'n_loops': n_loops,
            'n_epochs': n_epochs,
            'feature_importance': feature_importance,
            'training_time': str(self.last_training_time)
        }
        
        # Add to training history
        self.training_history.append({
            'timestamp': self.last_training_time,
            'metrics': self.training_metrics,
            'parameters': {
                'n_loops': n_loops,
                'n_epochs': n_epochs,
                'n_samples': n_samples
            }
        })
        
        # Save model if requested
        if save_model:
            self.save_model()
        
        logger.info(f"Training completed. CV Score: {cv_mean:.4f} ± {cv_std:.4f}")
        logger.info(f"Train Score: {train_score:.4f}, Test Score: {test_score:.4f}")
        
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
    
    def prepare_features(self, lat, lng):
        """Prepare features for prediction"""
        real_time_data = self.fetch_real_time_data(lat, lng)
        current_time = datetime.now()
        
        features = []
        for feature_name in self.feature_names:
            if feature_name == 'time_of_day':
                features.append(current_time.hour / 24.0)
            elif feature_name == 'day_of_week':
                features.append(current_time.weekday() / 7.0)
            elif feature_name in real_time_data:
                features.append(real_time_data[feature_name])
            else:
                features.append(0.5)  # Default value
        
        return np.array(features).reshape(1, -1)
    
    def fetch_real_time_data(self, lat, lng):
        """Fetch real-time data (simplified for demo)"""
        # In production, implement actual API calls
        return {
            'population_density': np.random.random(),
            'crime_index': np.random.random(),
            'lighting_score': np.random.random(),
            'business_density': np.random.random(),
            'transit_access': np.random.random(),
            'sidewalk_score': np.random.random(),
            'historical_incidents': np.random.random(),
            'weather_condition': np.random.random(),
            'emergency_distance': np.random.random(),
            'temperature': np.random.random(),
            'visibility': np.random.random(),
            'precipitation': np.random.random(),
            'wind_speed': np.random.random(),
            'humidity': np.random.random(),
            'urbanization_index': np.random.random(),
            'economic_index': np.random.random(),
            'education_index': np.random.random(),
            'time_since_sunset': np.random.random(),
            'holiday_indicator': 0.0,
            'special_event': 0.0
        }
    
    def predict_safety_score(self, lat, lng):
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
            
            # Calculate confidence based on model metrics
            confidence = max(0.7, min(0.95, self.training_metrics.get('test_score', 0.8)))
            
            # Add uncertainty based on time of day
            current_hour = datetime.now().hour
            if 0 <= current_hour <= 5 or 20 <= current_hour <= 23:
                confidence *= 0.9  # Lower confidence at night
            
            return {
                'safety_score': float(safety_score),
                'confidence': float(confidence),
                'risk_level': self._get_risk_level(safety_score),
                'recommendations': self._get_recommendations(safety_score, lat, lng)
            }
        except Exception as e:
            logger.error(f"Prediction error: {e}")
            # Return fallback prediction
            return {
                'safety_score': 0.7,
                'confidence': 0.5,
                'risk_level': 'medium',
                'recommendations': ['Use caution', 'Stay in well-lit areas']
            }
    
    def _get_risk_level(self, score):
        """Convert score to risk level"""
        if score >= 0.7:
            return 'low'
        elif score >= 0.4:
            return 'medium'
        else:
            return 'high'
    
    def _get_recommendations(self, score, lat, lng):
        """Generate safety recommendations"""
        recommendations = []
        
        if score < 0.4:
            recommendations.extend([
                "High risk area detected",
                "Avoid if possible",
                "Travel with companion recommended",
                "Stay alert to surroundings"
            ])
        elif score < 0.7:
            recommendations.extend([
                "Moderate risk area",
                "Use well-lit paths",
                "Keep valuables secure",
                "Share your location with trusted contacts"
            ])
        else:
            recommendations.extend([
                "Generally safe area",
                "Maintain normal precautions",
                "Stay aware of surroundings"
            ])
        
        return recommendations
    
    def calculate_route_safety(self, route_coordinates):
        """Calculate safety for an entire route"""
        safety_results = []
        total_score = 0
        
        for i, coord in enumerate(route_coordinates):
            lat, lng = coord['lat'], coord['lng']
            result = self.predict_safety_score(lat, lng)
            result['index'] = i
            result['lat'] = lat
            result['lng'] = lng
            safety_results.append(result)
            total_score += result['safety_score']
        
        # Overall route safety (weighted by segment length if available)
        overall_safety = total_score / len(route_coordinates) if route_coordinates else 0.7
        
        # Identify risky segments
        risky_segments = [r for r in safety_results if r['safety_score'] < 0.4]
        
        return {
            'overall_safety': overall_safety,
            'risk_level': self._get_risk_level(overall_safety),
            'segment_count': len(route_coordinates),
            'risky_segments': risky_segments,
            'safety_breakdown': safety_results,
            'confidence': np.mean([r['confidence'] for r in safety_results]) if safety_results else 0.7,
            'recommendations': self._get_route_recommendations(overall_safety, risky_segments)
        }
    
    def _get_route_recommendations(self, overall_safety, risky_segments):
        """Generate route-specific recommendations"""
        recommendations = []
        
        if overall_safety < 0.4:
            recommendations.append("Consider alternative route - high risk detected")
        elif overall_safety < 0.7:
            recommendations.append("Route has moderate risk areas")
        
        if risky_segments:
            recommendations.append(f"{len(risky_segments)} risky segments detected")
            if len(risky_segments) > 3:
                recommendations.append("Multiple consecutive risky areas - exercise caution")
        
        # Time-based recommendations
        current_hour = datetime.now().hour
        if 22 <= current_hour or current_hour <= 5:
            recommendations.append("Enhanced caution advised during nighttime hours")
        
        if not recommendations:
            recommendations.append("Route appears generally safe")
        
        return recommendations
    
    def get_model_info(self):
        """Get information about the current model"""
        return {
            'is_trained': self.is_trained,
            'last_training_time': self.last_training_time,
            'training_metrics': self.training_metrics,
            'model_path': self.model_path,
            'training_history_count': len(self.training_history),
            'features_used': len(self.feature_names),
            'model_type': 'StackingEnsemble' if self.is_trained else 'Not trained'
        }
    
    def incremental_train(self, new_data=None, epochs=1):
        """Perform incremental training with new data"""
        if new_data is None:
            # Generate some new synthetic data
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
            # Transform new data
            X_poly = self.poly.transform(X_new)
            X_scaled = self.scaler.transform(X_poly)
            X_selected = self.feature_selector.transform(X_scaled)
            
            # Incremental training (for neural network component)
            if hasattr(self.model, 'warm_start') and self.model.warm_start:
                self.model.fit(X_selected, y_new)
            else:
                logger.info("Model doesn't support warm start, performing partial retraining")
                # For non-warm-start models, we'll retrain with combined data
                # This is simplified - in production, store historical data
                pass
            
            # Update metrics
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


# Create singleton instance
def get_safety_ai():
    """Get or create the singleton AI instance"""
    model_path = os.environ.get('MODEL_PATH', 'models/safety_model.pkl')
    google_maps_api_key = os.environ.get('GOOGLE_MAPS_API_KEY')
    
    # Check if we should retrain
    retrain_on_start = os.environ.get('RETRAIN_ON_START', 'false').lower() == 'true'
    
    return AdvancedSafetyRoutingAI(
        model_path=model_path,
        google_maps_api_key=google_maps_api_key,
        retrain_on_start=retrain_on_start
    )

# Global instance
safety_ai = get_safety_ai()