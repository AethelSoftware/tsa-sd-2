"""
Main entry point for Tryver Safety Routing System
Includes ML safety wiring for transit routes and all bug fixes.
"""
#app.py
import os
import sys
import time
import argparse
import logging
from datetime import datetime, timedelta
from pathlib import Path
import uuid
import math
import random
from math import radians, sin, cos, sqrt, atan2
import googlemaps
from authlib.integrations.flask_client import OAuth
import secrets
import hashlib

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, jsonify, request, send_file, send_from_directory, url_for, session, redirect
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import threading
import webbrowser
import json
import numpy as np
import requests
from vector_db import VectorDB
from session_manager import SessionManager

from emergency_data_fetcher import get_emergency_fetcher
from news_hazard_fetcher import get_news_fetcher

# Try to import dateutil for robust date parsing
try:
    from dateutil import parser as date_parser
    HAS_DATEUTIL = True
except ImportError:
    HAS_DATEUTIL = False
    logging.warning("python-dateutil not installed. Install with: pip install python-dateutil")

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

# Initialize global variables
vdb = VectorDB(0.90)
sesh_manager = SessionManager()
tracker_instance = None  # Global RealTimeTracker instance

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('app.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Check API availability
GOOGLE_MAPS_AVAILABLE = bool(os.getenv('GOOGLE_MAPS_API_KEY'))

# Try to import new modules, fall back gracefully
try:
    from tomtom_router import TomTomRouter
    from real_api_client import RealAPIClient
    TOMTOM_AVAILABLE = True
    REAL_API_AVAILABLE = True
except ImportError as e:
    logger.warning(f"New modules not available: {e}")
    TOMTOM_AVAILABLE = False
    REAL_API_AVAILABLE = False
    TomTomRouter = None
    RealAPIClient = None

# Try to import Geoapify client
try:
    from geoapify_client import GeoapifyClient
    GEOAPIFY_AVAILABLE = True
except ImportError as e:
    GEOAPIFY_AVAILABLE = False
    GeoapifyClient = None
    logger.warning(f"Geoapify client not available: {e}")

# Try to import Google Maps router
try:
    from google_routing import GoogleMapsRouter
    GOOGLE_ROUTING_AVAILABLE = True
except ImportError as e:
    GOOGLE_ROUTING_AVAILABLE = False
    GoogleMapsRouter = None
    logger.warning(f"Google Maps router not available: {e}")

# Try to import GTFS transit router
try:
    from transit_router import TransitRouter
    GTFS_AVAILABLE = True
except ImportError as e:
    GTFS_AVAILABLE = False
    TransitRouter = None
    logger.warning(f"GTFS transit router not available: {e}")

# Initialize routers and API clients
if TOMTOM_AVAILABLE:
    tomtom_router = TomTomRouter()
    tomtom_router.clear_cache()
    logger.info("TomTom router cache cleared on startup")
else:
    tomtom_router = None
    logger.warning("TomTom router not available - routing will use mock data")

if REAL_API_AVAILABLE:
    api_client = RealAPIClient()
else:
    api_client = None
    logger.warning("Real API client not available - using mock data")

if GEOAPIFY_AVAILABLE:
    geoapify_client = GeoapifyClient()
else:
    geoapify_client = None
    logger.warning("Geoapify client not available - search will use fallback")

if GOOGLE_ROUTING_AVAILABLE:
    google_router = GoogleMapsRouter()
else:
    google_router = None
    logger.warning("Google Maps router not available - transit routing will be limited")

# Initialize GTFS transit router
transit_router = None
GTFS_PATH = os.path.join(os.path.dirname(__file__), 'GTFS.zip')
if GTFS_AVAILABLE and os.path.exists(GTFS_PATH):
    try:
        transit_router = TransitRouter(GTFS_PATH)
        logger.info("GTFS transit router initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize GTFS transit router: {e}")
        transit_router = None
else:
    if GTFS_AVAILABLE:
        logger.warning(f"GTFS file not found at {GTFS_PATH}")
    else:
        logger.warning("GTFS transit router not available")

safety_ai = None


# Add this class at the top of app.py (around line 50):
class RequestDebouncer:
    def __init__(self):
        self.pending = {}
        self.lock = threading.Lock()
    
    def debounce(self, key, callback, delay_ms=500):
        with self.lock:
            if key in self.pending:
                logger.info(f"Deduplicating request for {key}")
                return self.pending[key]
            
            # Store a placeholder
            self.pending[key] = None
        
        try:
            time.sleep(delay_ms / 1000)
            result = callback()
            with self.lock:
                self.pending[key] = result
            return result
        except Exception as e:
            with self.lock:
                self.pending.pop(key, None)
            raise e
        finally:
            # Clean up after delay
            def cleanup():
                time.sleep(1)
                with self.lock:
                    self.pending.pop(key, None)
            threading.Thread(target=cleanup, daemon=True).start()

# Create instance
request_debouncer = RequestDebouncer()

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance between two points in meters using Haversine formula"""
    R = 6371000  # Earth radius in meters
    
    lat1_rad = radians(float(lat1))
    lat2_rad = radians(float(lat2))
    delta_lat = radians(float(lat2) - float(lat1))
    delta_lon = radians(float(lon2) - float(lon1))
    
    a = sin(delta_lat/2)**2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    
    return R * c

def calculate_route_osrm(lat1, lng1, lat2, lng2):
    """Stub for OSRM - replace with actual implementation if needed."""
    return None

def calculate_route_google(lat1, lng1, lat2, lng2):
    """Stub for Google Maps - replace with actual implementation if needed."""
    return None

def embed_simple(text: str):
    """Simple fallback embedding using TF-IDF style hashing"""
    words = text.lower().split()
    embedding = np.zeros(384)
    
    for i, word in enumerate(words[:100]):  # Limit to 100 words
        hash_val = int(hashlib.md5(word.encode()).hexdigest(), 16)
        idx = hash_val % 384
        embedding[idx] += 1
    
    # Normalize
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm
    
    return embedding

def embed(text: str):
    """Get embedding from Hugging Face, with fallback on failure."""
    hf_token = os.environ.get("HF_TOKEN")
    
    # Try multiple endpoints
    endpoints = [
        f"https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2",
        f"https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2",
    ]
    
    for url in endpoints:
        try:
            headers = {"Authorization": f"Bearer {hf_token}"} if hf_token else {}
            response = requests.post(
                url,
                headers=headers,
                json={"inputs": text},
                timeout=3
            )
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    if isinstance(data[0], list):
                        return np.array(data[0])
                    else:
                        return np.array(data)
            elif response.status_code == 410:
                # Endpoint gone, try next
                continue
        except Exception as e:
            logger.warning(f"Embedding endpoint {url} failed: {e}")
            continue
    
    # If all endpoints fail, use simple fallback
    logger.warning("All embedding endpoints failed, using simple fallback")
    return embed_simple(text)

def get_safety_ai_instance():
    """Lazy load safety AI to avoid circular imports"""
    global safety_ai
    if safety_ai is None:
        try:
            from ai_safety_model import get_safety_ai
            safety_ai = get_safety_ai()
            logger.info("Safety AI loaded successfully")
        except ImportError as e:
            logger.error(f"Failed to load safety AI: {e}")
            safety_ai = None
    return safety_ai

def format_metric(value, format_str='.4f'):
    """Safely format a metric value"""
    if value is None:
        return 'N/A'
    try:
        if isinstance(value, str):
            try:
                value = float(value)
            except ValueError:
                return str(value)
        return format(value, format_str)
    except Exception:
        return str(value)

def fmt_dist(meters):
    """Format meters to readable string"""
    if not meters:
        return ""
    if meters >= 1000:
        return f"{meters/1000:.1f} km"
    return f"{meters:.0f} m"

def fmt_duration(seconds):
    """Format seconds to readable string"""
    if not seconds:
        return ""
    if seconds < 60:
        return f"{seconds:.0f} sec"
    elif seconds < 3600:
        return f"{seconds/60:.0f} min"
    else:
        hours = int(seconds / 3600)
        minutes = int((seconds % 3600) / 60)
        return f"{hours}h {minutes}m"

def extract_all_coords_from_steps(steps):
    """Extract lat/lng coordinate list from route steps (walk + transit)."""
    coords = []
    for step in steps:
        geom = step.get('path_geometry', [])
        for pt in geom:
            if isinstance(pt, (list, tuple)) and len(pt) == 2:
                coords.append({'lat': pt[0], 'lng': pt[1]})
            elif isinstance(pt, dict):
                coords.append({'lat': pt['lat'], 'lng': pt.get('lng', pt.get('lon'))})
    # Deduplicate consecutive identical points
    deduped = []
    for c in coords:
        if not deduped or (abs(deduped[-1]['lat'] - c['lat']) > 1e-8 or 
                           abs(deduped[-1]['lng'] - c['lng']) > 1e-8):
            deduped.append(c)
    return deduped

def build_display_steps(steps):
    """Convert internal steps to frontend-friendly instruction objects."""
    display = []
    for step in steps:
        if step['type'] == 'walk':
            to_name = step.get('to_stop') or step.get('to_location', {})
            if isinstance(to_name, dict):
                to_name = 'destination'
            dist = step.get('distance_meters', 0)
            dur = step.get('duration_seconds', 0)
            display.append({
                'type': 'walk',
                'travel_mode': 'WALKING',
                'instruction': f"Walk to {to_name}",
                'distance_meters': dist,
                'duration_seconds': dur,
                'distance': fmt_dist(dist),
                'duration': fmt_duration(dur),
                'path_geometry': step.get('path_geometry', [])
            })
        elif step['type'] == 'transit':
            route_name = step.get('route_short_name', '')
            route_long = step.get('route_long_name', '')
            from_stop = step.get('start_stop', '')
            to_stop = step.get('end_stop', '')
            dur = step.get('duration_seconds', 0)
            label = f"Bus {route_name}" if route_name else "Bus"
            if route_long:
                label += f" ({route_long.title()})"
            display.append({
                'type': 'transit',
                'travel_mode': 'TRANSIT',
                'instruction': f"Take {label} from {from_stop} to {to_stop}",
                'route_short_name': route_name,
                'route_long_name': route_long,
                'departure_stop': from_stop,
                'arrival_stop': to_stop,
                'duration_seconds': dur,
                'duration': fmt_duration(dur),
                'path_geometry': step.get('path_geometry', [])
            })
    return display

# ============================================================================
# MODEL MANAGEMENT FUNCTIONS
# ============================================================================

def check_model_status():
    """Check if model exists and prompt for training"""
    safety_ai_instance = get_safety_ai_instance()
    if safety_ai_instance is None:
        print("\n⚠️  Safety AI not available, cannot check model status")
        return False
    
    model_path = safety_ai_instance.model_path
    model_exists = os.path.exists(model_path)
    
    if model_exists:
        try:
            if safety_ai_instance.load_model(model_path):
                print("\n" + "="*60)
                print("MODEL STATUS: Trained")
                print("="*60)
                
                info = safety_ai_instance.get_model_info()
                if info['last_training_time']:
                    print(f"Last Training: {info['last_training_time']}")
                
                if info['training_metrics']:
                    metrics = info['training_metrics']
                    print(f"\nModel Performance:")
                    cv_mean = metrics.get('cv_mean')
                    cv_std = metrics.get('cv_std')
                    
                    if cv_mean is not None and cv_std is not None:
                        print(f"  Cross-Validation Score: {format_metric(cv_mean)} ± {format_metric(cv_std)}")
                    else:
                        print(f"  Cross-Validation Score: N/A")
                    
                    print(f"  Test Score: {format_metric(metrics.get('test_score'))}")
                    print(f"  Training Samples: {format_metric(metrics.get('n_samples'), ',d')}")
                    print(f"  Features: {format_metric(metrics.get('n_features'))}")
                
                print(f"\nModel Location: {model_path}")
                print("="*60)
                
                response = input("\nDo you want to retrain the model? (y/N): ").strip().lower()
                return response in ['y', 'yes']
        except Exception as e:
            logger.error(f"Error checking model: {e}")
            print(f"\n⚠️  Model exists but could not be loaded: {str(e)[:100]}...")
            response = input("Do you want to retrain? (y/N): ").strip().lower()
            return response in ['y', 'yes']
    else:
        print("\n" + "="*60)
        print("MODEL STATUS: Not Trained")
        print("="*60)
        print("No trained model found.")
        print(f"Model will be saved to: {model_path}")
        print("="*60)
        
        response = input("\nDo you want to train the model now? (Y/n): ").strip().lower()
        return response not in ['n', 'no']
    
    return False

def train_model_interactive():
    """Interactive model training"""
    safety_ai_instance = get_safety_ai_instance()
    if safety_ai_instance is None:
        print("❌ Safety AI not available for training")
        return False
    
    print("\n" + "="*60)
    print("MODEL TRAINING CONFIGURATION")
    print("="*60)
    
    print("\nSelect training intensity:")
    print("  1. Quick Training (5 loops, 2 epochs)")
    print("  2. Standard Training (10 loops, 3 epochs)")
    print("  3. Advanced Training (15 loops, 5 epochs)")
    print("  4. Custom Parameters")
    
    choice = input("\nEnter choice (1-4): ").strip()
    
    if choice == '1':
        n_loops, n_epochs = 5, 2
    elif choice == '2':
        n_loops, n_epochs = 10, 3
    elif choice == '3':
        n_loops, n_epochs = 15, 5
    elif choice == '4':
        try:
            n_loops = int(input("Number of loops (recommended 5-20): ").strip() or 15)
            n_epochs = int(input("Number of epochs per loop (recommended 2-10): ").strip() or 5)
        except ValueError:
            print("Invalid input, using defaults")
            n_loops, n_epochs = 15, 5
    else:
        print("Invalid choice, using standard training")
        n_loops, n_epochs = 10, 3
    
    print(f"\nTraining Configuration:")
    print(f"  Loops: {n_loops}")
    print(f"  Epochs per loop: {n_epochs}")
    print(f"  Total epochs: {n_loops * n_epochs}")
    
    confirm = input("\nStart training? (Y/n): ").strip().lower()
    if confirm in ['n', 'no']:
        print("Training cancelled.")
        return False
    
    print("\n" + "="*60)
    print("STARTING MODEL TRAINING")
    print("="*60)
    print("This may take a few minutes...")
    
    try:
        start_time = time.time()
        result = safety_ai_instance.train_model_advanced(
            n_loops=n_loops,
            n_epochs=n_epochs,
            force_retrain=True,
            save_model=True
        )
        training_time = time.time() - start_time
        
        print("\n" + "="*60)
        print("TRAINING COMPLETED SUCCESSFULLY!")
        print("="*60)
        
        if result['status'] == 'success':
            metrics = result['metrics']
            print(f"\nTraining Time: {training_time:.1f} seconds")
            print(f"\nModel Performance Metrics:")
            print(f"  Cross-Validation Score: {format_metric(metrics.get('cv_mean'))} ± {format_metric(metrics.get('cv_std'))}")
            print(f"  Training Score: {format_metric(metrics.get('train_score'))}")
            print(f"  Test Score: {format_metric(metrics.get('test_score'))}")
            print(f"  Samples Trained: {format_metric(metrics.get('n_samples'), ',d')}")
            print(f"  Features Used: {format_metric(metrics.get('n_features'))}")
            
            test_score = metrics.get('test_score')
            if test_score is not None:
                if test_score >= 0.8:
                    print("  ✅ Excellent model performance")
                elif test_score >= 0.7:
                    print("  👍 Good model performance")
                elif test_score >= 0.6:
                    print("  ⚠️  Acceptable model performance")
                else:
                    print("  ⚠️  Model may need more training data")
            else:
                print("  ⚠️  Test score not available")
            
            print(f"\nModel saved to: {safety_ai_instance.model_path}")
            print(f"Next recommended training: In 1-7 days")
        else:
            print(f"Training status: {result['status']}")
            if 'message' in result:
                print(f"Message: {result['message']}")
        
        print("="*60)
        return True
        
    except Exception as e:
        logger.error(f"Training failed: {e}", exc_info=True)
        print(f"\n❌ Training failed with error: {e}")
        print("Check app.log for details.")
        return False

# ============================================================================
# API ENDPOINTS
# ============================================================================

def add_model_endpoints(app):
    """Add model-related endpoints to Flask app with combined features"""

    # Store training progress for WebSocket updates
    training_progress = {
        'status': 'idle',
        'progress': 0,
        'speed': '0 MB/s',
        'eta': 'Calculating...'
    }
    
    @app.route("/api/hello")
    def hello():
        return jsonify({"message": "Tryver Safety Routing API v2.0 (Combined)"})
    
    @app.route("/api/model/status", methods=['GET'])
    def model_status():
        """Get current model status"""
        try:
            safety_ai_instance = get_safety_ai_instance()
            info = safety_ai_instance.get_model_info() if safety_ai_instance else {'is_trained': False}
            
            # Check API availability
            apis_available = {
                'tomtom': tomtom_router.api_key is not None if tomtom_router else False,
                'openweather': api_client.openweather_key is not None if api_client else False,
                'census': api_client.census_key is not None if api_client else False,
                'geoapify': geoapify_client.api_key is not None if geoapify_client else False,
                'google_maps': GOOGLE_MAPS_AVAILABLE,
                'gtfs': transit_router is not None
            }
            
            return jsonify({
                'success': True,
                'model': info,
                'training_progress': training_progress,
                'system': {
                    'python_version': sys.version,
                    'platform': sys.platform,
                    'model_path': safety_ai_instance.model_path if safety_ai_instance else 'N/A',
                    'apis_available': apis_available,
                    'tomtom_available': TOMTOM_AVAILABLE,
                    'real_api_available': REAL_API_AVAILABLE,
                    'geoapify_available': GEOAPIFY_AVAILABLE,
                    'google_routing_available': GOOGLE_ROUTING_AVAILABLE,
                    'gtfs_available': GTFS_AVAILABLE and transit_router is not None
                }
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/model/train", methods=['POST'])
    def train_model():
        """Train or retrain the model"""
        try:
            safety_ai_instance = get_safety_ai_instance()
            if safety_ai_instance is None:
                return jsonify({'success': False, 'error': 'Safety AI not available'}), 500
            
            data = request.json or {}
            n_loops = data.get('n_loops', 15)
            n_epochs = data.get('n_epochs', 5)
            force = data.get('force', False)
            
            # Update training progress
            training_progress.update({
                'status': 'downloading',
                'progress': 0,
                'speed': '5.2 MB/s',
                'eta': '2 minutes'
            })
            
            # Simulate download progress
            def simulate_training():
                for i in range(101):
                    training_progress['progress'] = i
                    training_progress['speed'] = f"{5 + i % 10:.1f} MB/s"
                    training_progress['eta'] = f"{120 - i:.0f} seconds"
                    time.sleep(0.1)
                
                # Actual training
                training_progress['status'] = 'training'
                result = safety_ai_instance.train_model_advanced(
                    n_loops=n_loops,
                    n_epochs=n_epochs,
                    force_retrain=force,
                    save_model=True
                )
                
                training_progress.update({
                    'status': 'completed',
                    'progress': 100,
                    'speed': '0 MB/s',
                    'eta': 'Complete'
                })
                
                return result
            
            # Start training in background
            thread = threading.Thread(target=simulate_training)
            thread.daemon = True
            thread.start()
            
            return jsonify({
                'success': True,
                'message': 'Training started',
                'tracking_id': str(time.time())
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/model/train/progress", methods=['GET'])
    def training_progress_endpoint():
        """Get current training progress"""
        return jsonify({
            'success': True,
            'progress': training_progress
        })
    
    @app.route("/api/model/predict", methods=['POST'])
    def predict_safety():
        """Predict safety for a location (Old endpoint)"""
        try:
            safety_ai_instance = get_safety_ai_instance()
            data = request.json
            if not data or 'lat' not in data or 'lng' not in data:
                return jsonify({
                    'success': False,
                    'error': 'Missing lat/lng parameters'
                }), 400
            
            lat = float(data['lat'])
            lng = float(data['lng'])
            
            if safety_ai_instance and safety_ai_instance.is_trained:
                result = safety_ai_instance.predict_safety_score(lat, lng)
            else:
                # Fallback to mock data
                result = {
                    'safety_score': 0.7,
                    'confidence': 0.5,
                    'risk_level': 'medium',
                    'recommendations': ['Use caution', 'Stay in well-lit areas'],
                    'coordinates': {'lat': lat, 'lng': lng},
                    'timestamp': datetime.now().isoformat()
                }
            
            return jsonify({
                'success': True,
                'prediction': result,
                'model_info': {
                    'is_trained': safety_ai_instance.is_trained if safety_ai_instance else False,
                    'last_trained': str(safety_ai_instance.last_training_time) if safety_ai_instance and safety_ai_instance.last_training_time else None,
                    'confidence': safety_ai_instance.training_metrics.get('test_score', 0.8) if safety_ai_instance else 0.5
                }
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/safety-prediction", methods=['POST'])
    def safety_prediction():
        """Get safety prediction for a location (New endpoint)"""
        try:
            data = request.json
            lat = float(data.get('lat', 40.4406))
            lng = float(data.get('lng', -79.9959))
            
            safety_ai_instance = get_safety_ai_instance()
            if safety_ai_instance:
                prediction = safety_ai_instance.predict_safety_score(lat, lng)
            else:
                prediction = {
                    'safety_score': 0.7,
                    'confidence': 0.5,
                    'risk_level': 'medium',
                    'recommendations': ['Model not trained, use caution'],
                    'coordinates': {'lat': lat, 'lng': lng},
                    'timestamp': datetime.now().isoformat()
                }
            
            return jsonify({
                'success': True,
                'prediction': prediction
            })
        except Exception as e:
            logger.error(f"Safety prediction error: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/model/route", methods=['POST'])
    def route_safety():
        """Calculate safety for an entire route (Old endpoint)"""
        try:
            safety_ai_instance = get_safety_ai_instance()
            data = request.json
            if not data or 'route' not in data:
                return jsonify({
                    'success': False,
                    'error': 'Missing route data'
                }), 400
            
            route = data['route']
            if not isinstance(route, list) or len(route) == 0:
                return jsonify({
                    'success': False,
                    'error': 'Route must be a non-empty list of coordinates'
                }), 400
            
            if safety_ai_instance and safety_ai_instance.is_trained:
                result = safety_ai_instance.calculate_route_safety(route)
                result_dict = {
                    'overall_safety': result['overall_safety'],
                    'risk_level': result['risk_level'],
                    'safe_route_coords': result.get('safe_route_coords', route),
                    'original_route_coords': result.get('original_route_coords', route),
                    'risky_segments': result.get('risky_segments', []),
                    'distance_meters': result.get('distance_meters', 0),
                    'duration_seconds': result.get('duration_seconds', 0),
                    'recommendations': result.get('recommendations', []),
                    'confidence': result.get('confidence', 0.7),
                    'segment_details': result.get('segment_details', [])
                }
            else:
                # Fallback mock analysis
                import random
                result_dict = {
                    'overall_safety': random.uniform(0.6, 0.9),
                    'risk_level': 'low',
                    'safe_route_coords': route,
                    'original_route_coords': route,
                    'risky_segments': [],
                    'distance_meters': 1000,
                    'duration_seconds': 1200,
                    'recommendations': ['Route appears safe'],
                    'confidence': 0.7,
                    'segment_details': []
                }
            
            return jsonify({
                'success': True,
                'analysis': result_dict,
                'model_info': safety_ai_instance.get_model_info() if safety_ai_instance else {'is_trained': False}
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/model/download", methods=['GET'])
    def download_model():
        """Download the current model"""
        try:
            safety_ai_instance = get_safety_ai_instance()
            if safety_ai_instance and safety_ai_instance.model_path and os.path.exists(safety_ai_instance.model_path):
                return send_file(
                    safety_ai_instance.model_path,
                    as_attachment=True,
                    download_name='tryver_safety_model.pkl'
                )
            else:
                return jsonify({
                    'success': False,
                    'error': 'Model not found'
                }), 404
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/model/upload", methods=['POST'])
    def upload_model():
        """Upload a new model file"""
        try:
            if 'model' not in request.files:
                return jsonify({'success': False, 'error': 'No file uploaded'}), 400
            
            file = request.files['model']
            if file.filename == '':
                return jsonify({'success': False, 'error': 'No file selected'}), 400
            
            # Save the file
            model_path = 'models/uploaded_model.pkl'
            os.makedirs('models', exist_ok=True)
            file.save(model_path)
            
            # Load the model
            safety_ai_instance = get_safety_ai_instance()
            if safety_ai_instance:
                safety_ai_instance.load_model(model_path)
            
            return jsonify({
                'success': True,
                'message': 'Model uploaded and loaded successfully'
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    # ============================================================================
    # GTFS TRANSIT ROUTING ENDPOINTS
    # ============================================================================
    
    @app.route("/api/transit-route", methods=['POST'])
    def get_transit_route():
        try:
            if not transit_router:
                return jsonify({'success': False, 'error': 'GTFS transit router not initialized'}), 503
            
            data = request.json
            if not data:
                return jsonify({'success': False, 'error': 'No data provided'}), 400
            
            start_lat = float(data.get('start_lat'))
            start_lng = float(data.get('start_lng'))
            end_lat = float(data.get('end_lat'))
            end_lng = float(data.get('end_lng'))
            start_time_str = data.get('start_time')
            max_walk = float(data.get('max_walk_distance', 800))
            
            # Parse start_time
            try:
                if HAS_DATEUTIL:
                    start_time = date_parser.parse(start_time_str)
                else:
                    cleaned = start_time_str.replace('Z', '+00:00')
                    if '.' in cleaned and '+' in cleaned:
                        parts = cleaned.split('.')
                        micro_sec = parts[1].split('+')[0][:6]
                        tz = parts[1].split('+')[1] if '+' in parts[1] else ''
                        cleaned = f"{parts[0]}.{micro_sec}+{tz}"
                    start_time = datetime.fromisoformat(cleaned)
            except Exception as e:
                logger.error(f"Date parsing error: {e}")
                return jsonify({'success': False, 'error': 'Invalid start_time format'}), 400
            
            routes = transit_router.find_route(
                start_lat, start_lng, end_lat, end_lng,
                start_time,
                max_walk_distance=max_walk,
                max_transfers=4,
                time_window_minutes=120,
                num_alternatives=3
            )
            
            if not routes:
                return jsonify({
                    'success': False,
                    'error': 'No transit route found for this origin/destination pair.',
                    'suggestion': 'Try walking mode or a different location'
                }), 404
            
            # ─── WIRE ML SAFETY INTO TRANSIT RESPONSE ───
            safety_model = get_safety_ai_instance()
            for route in routes:
                # Extract coordinates from route steps
                transit_coords = []
                for step in route.get('steps', []):
                    geom = step.get('path_geometry', [])
                    for pt in geom:
                        if isinstance(pt, (list, tuple)) and len(pt) == 2:
                            transit_coords.append({'lat': float(pt[0]), 'lng': float(pt[1])})
                
                if len(transit_coords) >= 2 and safety_model and safety_model.is_trained:
                    mid = transit_coords[len(transit_coords) // 2]
                    heuristic_score = heuristic_safety(mid['lat'], mid['lng'])
                    transit_safety = safety_model.calculate_route_safety(transit_coords)
                    route['safety'] = transit_safety
                    logger.info(
                        f"Transit ML safety: {transit_safety['overall_safety']:.3f} | "
                        f"Heuristic: {heuristic_score:.3f} | "
                        f"Δ: {(transit_safety['overall_safety'] - heuristic_score)*100:+.1f}pp"
                    )
                else:
                    route['safety'] = {'overall_safety': 0.7, 'risk_level': 'medium', 'recommendations': []}
            
            # Sort by weighted score (60% time, 40% inverse safety)
            routes.sort(key=lambda r: (
                0.6 * r['total_time_seconds'] / 3600 +
                0.4 * (1.0 - r.get('safety', {}).get('overall_safety', 0.7))
            ))
            
            return jsonify({
                'success': True,
                'routes': routes,
                'best_route': routes[0],
                'num_alternatives': len(routes)
            })
            
        except Exception as e:
            logger.error(f"Error in transit routing: {e}", exc_info=True)
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route("/api/nearby-stops", methods=['GET'])
    def get_nearby_stops():
        """
        Get stops near a location
        Query params: lat, lng, radius (meters)
        """
        try:
            if not transit_router:
                return jsonify({
                    'success': False, 
                    'error': 'GTFS transit router not initialized'
                }), 503
            
            lat = float(request.args.get('lat'))
            lng = float(request.args.get('lng'))
            radius = float(request.args.get('radius', 500))
            
            if lat is None or lng is None:
                return jsonify({'success': False, 'error': 'Missing lat/lng parameters'}), 400
            
            stops = transit_router.gtfs.find_nearby_stops(lat, lng, radius)
            
            result = []
            for stop, distance in stops:
                result.append({
                    'stop_id': stop.stop_id,
                    'name': stop.name,
                    'lat': stop.lat,
                    'lon': stop.lon,
                    'distance_meters': distance
                })
            
            return jsonify({
                'success': True,
                'stops': result
            })
            
        except Exception as e:
            logger.error(f"Error finding nearby stops: {e}")
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route("/api/gtfs-status", methods=['GET'])
    def gtfs_status():
        """Get GTFS data status"""
        if transit_router:
            return jsonify({
                'success': True,
                'status': 'initialized',
                'stats': {
                    'stops': len(transit_router.gtfs.stops),
                    'trips': len(transit_router.gtfs.trips),
                    'gtfs_path': GTFS_PATH
                }
            })
        else:
            return jsonify({
                'success': False,
                'status': 'not_initialized',
                'error': 'GTFS transit router not available',
                'expected_path': GTFS_PATH
            }), 503
    
    # ============================================================================
    # EXISTING CALCULATE ROUTE ENDPOINT (UPDATED WITH GTFS AND IMPROVED STEPS)
    # ============================================================================
    
    @app.route("/api/calculate-route", methods=['POST'])
    def calculate_route():
        """Calculate accessible route between two points (Enhanced endpoint with GTFS transit and turn-by-turn steps)"""
        try:
            data = request.json
            if not data:
                return jsonify({
                    'success': False,
                    'error': 'No data provided'
                }), 400
            
            session_id = request.headers.get("X-Session-ID")
            session = sesh_manager.get_session_state(session_id)
            if not session and session_id:
                sesh_manager.create_session(session_id)
                session = sesh_manager.get_session_state(session_id)

            if session:
                session.touch()
            
            # Extract coordinates
            start_lat = data.get('start_lat') or (data.get('start_location', {}).get('lat') if isinstance(data.get('start_location'), dict) else None)
            start_lng = data.get('start_lng') or (data.get('start_location', {}).get('lng') if isinstance(data.get('start_location'), dict) else None)
            end_lat = data.get('end_lat') or (data.get('end_location', {}).get('lat') if isinstance(data.get('end_location'), dict) else None)
            end_lng = data.get('end_lng') or (data.get('end_location', {}).get('lng') if isinstance(data.get('end_location'), dict) else None)
            
            # Check for force refresh flag from frontend
            force_refresh = data.get('force_refresh', False)
            
            # Log the request for debugging
            logger.info(f"=== ROUTE REQUEST ===")
            logger.info(f"From: {start_lat},{start_lng}")
            logger.info(f"To: {end_lat},{end_lng}")
            logger.info(f"Mode: {data.get('travel_mode', 'pedestrian')}")
            logger.info(f"Force refresh: {force_refresh}")
            
            if not all([start_lat, start_lng, end_lat, end_lng]):
                return jsonify({
                    'success': False,
                    'error': 'Missing coordinates'
                }), 400
            
            # Extract travel mode
            travel_mode = data.get('travel_mode', 'pedestrian')
            
            # Extract start time for transit
            start_time_str = data.get('start_time')
            start_time = None
            if start_time_str:
                try:
                    # Robust date parsing using dateutil if available
                    if HAS_DATEUTIL:
                        start_time = date_parser.parse(start_time_str)
                    else:
                        if start_time_str.endswith('Z'):
                            start_time_str = start_time_str[:-1] + '+00:00'
                        start_time = datetime.fromisoformat(start_time_str)
                except ValueError:
                    logger.warning(f"Invalid start_time format: {start_time_str}")
                    start_time = datetime.now()
            else:
                start_time = datetime.now()
            
            accessibility_preferences = data.get('accessibility_preferences', {})
            accessibility_needs = []
            
            if accessibility_preferences.get('wheelchair'):
                accessibility_needs.append('wheelchair')
            if accessibility_preferences.get('blind'):
                accessibility_needs.append('blind')
            if accessibility_preferences.get('deaf'):
                accessibility_needs.append('deaf')
            if accessibility_preferences.get('elevator_access'):
                accessibility_needs.append('elevator')
            
            route_result = None
            provider_used = None
            error_messages = []
            
            # ========== TRY 1: GTFS Transit Router ==========
            if travel_mode == 'transit' and transit_router:
                try:
                    logger.info(f"Attempting GTFS transit route from {start_lat},{start_lng} to {end_lat},{end_lng}")
                    routes = transit_router.find_route(
                        float(start_lat), float(start_lng),
                        float(end_lat), float(end_lng),
                        start_time,
                        max_walk_distance=800,
                        max_transfers=4,
                        time_window_minutes=120,
                        num_alternatives=3
                    )
                    
                    if routes:
                        primary = routes[0]
                        alternatives = routes[1:]
                        
                        # Build coordinates and steps
                        route_coords = extract_all_coords_from_steps(primary['steps'])
                        display_steps = build_display_steps(primary['steps'])
                        
                        # Build alternative structures
                        alt_routes = []
                        for alt in alternatives:
                            alt_coords = extract_all_coords_from_steps(alt['steps'])
                            alt_routes.append({
                                'steps': build_display_steps(alt['steps']),
                                'total_time_seconds': alt['total_time_seconds'],
                                'route_summary': alt['route_summary'],
                                'coords': alt_coords,
                                'safety': alt.get('safety', {})
                            })
                        
                        route_result = {
                            'points': [[c['lat'], c['lng']] for c in route_coords],
                            'distance_meters': primary['total_distance_meters'],
                            'duration_seconds': primary['total_time_seconds'],
                            'instructions': display_steps,
                            'transit_steps': primary['steps'],
                            'alternative_routes': alt_routes,
                            'walking_steps': [s for s in primary['steps'] if s['type'] == 'walk']
                        }
                        provider_used = "GTFS Transit"
                        logger.info(f"GTFS transit route successful - Duration: {primary['total_time_seconds']/60:.0f} minutes")
                except Exception as e:
                    logger.warning(f"GTFS transit routing failed: {e}")
                    error_messages.append(f"GTFS Transit: {str(e)}")
            
            # ========== TRY 2: Google Maps Transit ==========
            if not route_result and travel_mode == 'transit' and google_router:
                try:
                    logger.info(f"Attempting Google Maps transit route from {start_lat},{start_lng} to {end_lat},{end_lng}")
                    routes = google_router.get_transit_route(
                        float(start_lat), float(start_lng),
                        float(end_lat), float(end_lng),
                        alternatives=True
                    )
                    if routes:
                        route_data = routes[0]
                        waypoints = route_data.get('waypoints', [])
                        if waypoints:
                            route_coords = [{'lat': p[0], 'lng': p[1]} for p in waypoints]
                            provider_used = "Google Maps Transit"
                            
                            # Build instructions with transit details
                            instructions = []
                            for step in route_data.get('steps', []):
                                instruction_text = step['instruction']
                                instruction_text = instruction_text.replace('<b>', '').replace('</b>', '').replace('<div>', ' ').replace('</div>', ' ')
                                instructions.append({
                                    'instruction': instruction_text,
                                    'distance': step.get('distance', ''),
                                    'distance_meters': step.get('distance_meters', 0),
                                    'duration': step.get('duration', ''),
                                    'duration_seconds': step.get('duration_seconds', 0),
                                    'travel_mode': step.get('travel_mode', 'WALKING'),
                                    'transit_line': step.get('transit_line', ''),
                                    'departure_stop': step.get('departure_stop', ''),
                                    'arrival_stop': step.get('arrival_stop', '')
                                })
                            
                            total_walking_time = route_data.get('total_walking_time', 0)
                            total_transit_time = route_data.get('total_transit_time', 0)
                            
                            route_result = {
                                'points': waypoints,
                                'distance_meters': route_data['total_distance_meters'],
                                'duration_seconds': route_data['total_duration_seconds'],
                                'instructions': instructions,
                                'transit_steps': route_data.get('transit_steps', []),
                                'walking_steps': route_data.get('walking_steps', []),
                                'segments': [],
                                'total_walking_time': total_walking_time,
                                'total_transit_time': total_transit_time
                            }
                            logger.info(f"Google Maps transit route successful - Duration: {route_data['total_duration_seconds']/60:.0f} minutes")
                except Exception as e:
                    logger.warning(f"Google Maps transit API failed: {e}")
                    error_messages.append(f"Google Transit: {str(e)}")
            
            # ========== TRY 3: TomTom API (Pedestrian with Hazard Avoidance) ==========
            if not route_result and tomtom_router and tomtom_router.api_key and travel_mode != 'transit':
                try:
                    # FORCE REFRESH - Clear TomTom cache for this specific destination
                    if hasattr(tomtom_router, 'clear_cache'):
                        tomtom_router.clear_cache()
                        logger.info("TomTom cache cleared before route calculation")
                    
                    # Force refresh hazards to avoid stale data
                    from news_hazard_fetcher import get_news_fetcher
                    news_fetcher = get_news_fetcher()
                    
                    # Force refresh the hazard cache
                    if hasattr(news_fetcher, 'force_refresh_cache'):
                        news_fetcher.force_refresh_cache()
                        logger.info("Hazard cache force refreshed")
                    
                    # Get hazards near the route area (midpoint with buffer)
                    mid_lat = (float(start_lat) + float(end_lat)) / 2
                    mid_lng = (float(start_lng) + float(end_lng)) / 2
                    route_length = haversine_distance(float(start_lat), float(start_lng), float(end_lat), float(end_lng))
                    search_radius = max(2000, min(5000, route_length / 2))
                    
                    logger.info(f"Fetching hazards within {search_radius}m of route midpoint")
                    hazards = news_fetcher.get_hazards_in_area(mid_lat, mid_lng, radius_meters=search_radius)
                    
                    # Convert to obstruction zones format
                    obstruction_zones = []
                    for hazard in hazards:
                        obstruction_zones.append({
                            'lat': hazard['lat'],
                            'lng': hazard['lng'],
                            'radius': hazard.get('radius', 100),
                            'severity': hazard.get('severity', 0.7),
                            'type': hazard.get('type', 'hazard'),
                            'description': hazard.get('description', 'Hazard area')
                        })
                    
                    logger.info(f"Found {len(obstruction_zones)} crime/hazard zones to avoid")
                    
                    # Also fetch TomTom construction zones
                    try:
                        tomtom_key = os.getenv('TOMTOM_API_KEY') or tomtom_router.api_key
                        km = 3.0
                        d_lat = km * 0.009
                        d_lng = km * 0.012
                        fields_param = "{incidents{type,geometry{type,coordinates},properties{iconCategory}}}"
                        inc_url = (
                            f"https://api.tomtom.com/traffic/services/5/incidentDetails"
                            f"?key={tomtom_key}"
                            f"&bbox={mid_lng - d_lng},{mid_lat - d_lat},{mid_lng + d_lng},{mid_lat + d_lat}"
                            f"&fields={fields_param}"
                            f"&language=en-US&timeValidityFilter=present"
                        )
                        inc_resp = requests.get(inc_url, timeout=5)
                        if inc_resp.status_code == 200:
                            inc_data = inc_resp.json()
                            construction_cats = {7, 8, 9, 10}
                            for inc in inc_data.get('incidents', []):
                                icon_cat = inc.get('properties', {}).get('iconCategory', 0)
                                if icon_cat in construction_cats:
                                    geom = inc.get('geometry', {})
                                    coords = geom.get('coordinates', [])
                                    if coords:
                                        g_type = geom.get('type', 'Point')
                                        if g_type == 'Point':
                                            obstruction_zones.append({
                                                'lat': coords[1], 'lng': coords[0], 'radius': 50,
                                                'severity': 0.8, 'type': 'construction',
                                                'description': 'Construction zone'
                                            })
                                        elif g_type == 'LineString' and len(coords) > 0:
                                            mid = coords[len(coords) // 2]
                                            obstruction_zones.append({
                                                'lat': mid[1], 'lng': mid[0], 'radius': 50,
                                                'severity': 0.8, 'type': 'construction',
                                                'description': 'Construction zone'
                                            })
                            logger.info(f"Added {len(obstruction_zones) - len(hazards)} construction zones to avoidance list")
                    except Exception as obs_err:
                        logger.warning(f"Failed to fetch construction zones: {obs_err}")
                    
                    # Call TomTom router with obstruction zones and force_refresh
                    if obstruction_zones:
                        logger.info(f"Routing with {len(obstruction_zones)} total hazards to avoid")
                    
                    # Add cache-busting timestamp to prevent stale routes
                    import time
                    cache_buster = time.time()
                    logger.info(f"Route request cache buster: {cache_buster}")
                    
                    # Log the exact coordinates being sent
                    logger.info(f"=== CALLING TOMTOM ROUTER ===")
                    logger.info(f"Start: {float(start_lat):.6f}, {float(start_lng):.6f}")
                    logger.info(f"Dest: {float(end_lat):.6f}, {float(end_lng):.6f}")
                    logger.info(f"force_refresh: True")
                    
                    route_result = tomtom_router.calculate_route(
                        float(start_lat), float(start_lng),
                        float(end_lat), float(end_lng),
                        travel_mode='pedestrian',
                        accessibility_needs=accessibility_needs if accessibility_needs else None,
                        obstruction_zones=obstruction_zones if obstruction_zones else None,
                        force_refresh=True  # FORCE FRESH - prevents stale routes
                    )
                    
                    # Log the result
                    if route_result:
                        end_point = route_result.get('end_point', {})
                        logger.info(f"TomTom returned route ending at: {end_point.get('lat')}, {end_point.get('lng')}")
                    else:
                        logger.warning("TomTom returned no route result")
                    
                    if route_result:
                        provider_used = "TomTom (Hazard Avoidance)"
                        logger.info(f"TomTom route with hazard avoidance successful")
                        
                        # Verify destination matches (safety check)
                        if 'end_point' in route_result:
                            route_end_lat = route_result['end_point'].get('lat')
                            route_end_lng = route_result['end_point'].get('lng')
                            if route_end_lat and route_end_lng:
                                dest_matches = (abs(route_end_lat - float(end_lat)) < 0.0001 and
                                            abs(route_end_lng - float(end_lng)) < 0.0001)
                                if not dest_matches:
                                    logger.warning(f"Route destination mismatch! Route ends at {route_end_lat},{route_end_lng} but requested {end_lat},{end_lng}")
                                    # Force another attempt without cache
                                    route_result = None
                                    logger.info("Retrying route calculation without cache...")
                                    # Clear TomTom router cache for this destination
                                    if hasattr(tomtom_router, 'route_cache'):
                                        with tomtom_router.cache_lock:
                                            # Clear all cache entries (aggressive but effective)
                                            tomtom_router.route_cache.clear()
                                            logger.info("TomTom router cache cleared")
                                    # Retry
                                    route_result = tomtom_router.calculate_route(
                                        float(start_lat), float(start_lng),
                                        float(end_lat), float(end_lng),
                                        travel_mode='pedestrian',
                                        accessibility_needs=accessibility_needs if accessibility_needs else None,
                                        obstruction_zones=obstruction_zones if obstruction_zones else None,
                                        force_refresh=True
                                    )
                                    if route_result:
                                        provider_used = "TomTom (Hazard Avoidance - Retry)"
                                        logger.info("TomTom route retry successful")
                            
                except Exception as e:
                    logger.warning(f"TomTom API failed: {e}")
                    error_messages.append(f"TomTom: {str(e)}")
            
            # ========== PROCESS SUCCESSFUL ROUTE ==========
            if route_result:
                # Convert points to coordinate objects
                route_coords = [{'lat': p[0], 'lng': p[1]} for p in route_result['points']] if route_result.get('points') else []
                
                # Get addresses
                start_address = f"{float(start_lat):.4f}, {float(start_lng):.4f}"
                end_address = f"{float(end_lat):.4f}, {float(end_lng):.4f}"
                
                if tomtom_router and tomtom_router.api_key:
                    try:
                        start_address = tomtom_router.reverse_geocode(float(start_lat), float(start_lng))
                        end_address = tomtom_router.reverse_geocode(float(end_lat), float(end_lng))
                    except:
                        pass
                
                # Calculate safety
                safety_ai_instance = get_safety_ai_instance()
                if safety_ai_instance and safety_ai_instance.is_trained and route_coords:
                    try:
                        safety_result = safety_ai_instance.calculate_route_safety(route_coords)
                        safety_dict = {
                            'overall_safety': safety_result.get('overall_safety', 0.8),
                            'risk_level': safety_result.get('risk_level', 'low'),
                            'recommendations': safety_result.get('recommendations', ['Route appears safe'])
                        }
                    except Exception as e:
                        logger.warning(f"Safety calculation failed: {e}")
                        safety_dict = {
                            'overall_safety': 0.8,
                            'risk_level': 'low',
                            'recommendations': ['Route appears safe']
                        }
                else:
                    safety_dict = {
                        'overall_safety': 0.8,
                        'risk_level': 'low',
                        'recommendations': ['Route appears safe']
                    }
                
                # Format distance and duration nicely
                distance_val = route_result.get('distance_meters', 0)
                duration_val = route_result.get('duration_seconds', 0)
                
                if distance_val < 1000:
                    distance_str = f"{distance_val:.0f} m"
                else:
                    distance_str = f"{distance_val/1000:.1f} km"
                
                if duration_val < 60:
                    duration_str = f"{duration_val:.0f} sec"
                elif duration_val < 3600:
                    duration_str = f"{duration_val/60:.0f} min"
                else:
                    hours = int(duration_val / 3600)
                    minutes = int((duration_val % 3600) / 60)
                    duration_str = f"{hours}h {minutes}m"
                
                # Get the instructions (steps) for turn-by-turn directions
                steps = route_result.get('instructions', [])
                
                # Add start and end instructions if missing
                if not steps:
                    steps = [
                        {
                            'instruction': f"Head towards {end_address}",
                            'distance': distance_str,
                            'distance_meters': distance_val,
                            'duration': duration_str,
                            'duration_seconds': duration_val,
                            'travel_mode': 'WALKING'
                        },
                        {
                            'instruction': f"Arrive at {end_address}",
                            'distance': '0 m',
                            'distance_meters': 0,
                            'duration': '0 sec',
                            'duration_seconds': 0,
                            'travel_mode': 'ARRIVE'
                        }
                    ]
                
                response_data = {
                    'success': True,
                    'route': {
                        'distance': distance_str,
                        'distance_meters': distance_val,
                        'duration': duration_str,
                        'duration_seconds': duration_val,
                        'steps': steps,
                        'coordinates': route_coords,
                        'points': route_result.get('points', []),
                        'segments': route_result.get('segments', []),
                        'start_address': start_address,
                        'end_address': end_address,
                        'accessibility_score': 85 if not accessibility_needs else 90,
                        'warnings': [],
                        'elevator_access': 'wheelchair' in accessibility_needs,
                        'ramp_access': 'wheelchair' in accessibility_needs,
                        'safety': safety_dict,
                        'arrival_time': (datetime.now().timestamp() + duration_val),
                        'bounds': {
                            'north': max(float(start_lat), float(end_lat)),
                            'south': min(float(start_lat), float(end_lat)),
                            'east': max(float(start_lng), float(end_lng)),
                            'west': min(float(start_lng), float(end_lng))
                        },
                        'travel_mode': travel_mode
                    },
                    'provider': provider_used,
                    'model_used': safety_ai_instance.is_trained if safety_ai_instance else False,
                    'real_api_used': provider_used is not None
                }
                
                # Add transit-specific details if available
                if travel_mode == 'transit':
                    if 'transit_steps' in route_result:
                        response_data['route']['transit_details'] = {
                            'steps': route_result.get('transit_steps', []),
                            'total_transit_time': route_result.get('total_transit_time', 0),
                            'total_walking_time': route_result.get('total_walking_time', 0)
                        }
                    elif provider_used == "GTFS Transit":
                        response_data['route']['transit_details'] = {
                            'steps': route_result.get('transit_steps', []),
                            'total_time_minutes': duration_val / 60
                        }
                        if 'alternative_routes' in route_result:
                            response_data['route']['alternative_routes'] = route_result['alternative_routes']
                
                # Update session with route data
                if session_id:
                    sesh_manager.update_session(
                        session_id, 
                        route=route_result, 
                        score=safety_dict.get('overall_safety', 0.8), 
                        prefs=accessibility_preferences
                    )
                
                # Only cache if not force_refresh
                if not force_refresh:
                    try:
                        query_text = (
                            f"route from {start_address} to {end_address} "
                            f"travel mode {travel_mode} "
                            f"the estimated distance was {distance_str} "
                            f"the duration was {duration_str} "
                            f"accessibility needs are {json.dumps(accessibility_preferences, sort_keys=True)} "
                            f"safety features include {json.dumps(safety_dict)}"
                        )
                        query_vector = embed(query_text)
                        
                        # Check if query_vector is valid
                        if query_vector is not None and np.any(query_vector):
                            # FIX 3: DISABLE VECTORDB CACHE READ - only insert, never read
                            # cached_result = vdb.compare(query_vector)
                            # if cached_result and isinstance(cached_result, dict):
                            #     cached_value = cached_result.get('value')
                            #     if cached_value:
                            #         logger.info("Using cached route result")
                            #         return jsonify(cached_value)
                            
                            vdb.insert(query_vector, response_data)
                    except Exception as e:
                        logger.warning(f"Caching failed (non-critical): {e}")
                
                return jsonify(response_data)
            
            # ========== FALLBACK: CALCULATED ROUTE ==========
            logger.warning(f"All routing providers failed: {error_messages}. Using calculated fallback.")
            
            straight_distance = haversine_distance(
                float(start_lat), float(start_lng),
                float(end_lat), float(end_lng)
            )
            
            approx_distance = straight_distance * 1.3
            if travel_mode == 'transit':
                transit_speed = 5.56  # 20 km/h
                approx_duration = approx_distance / transit_speed
            else:
                approx_duration = approx_distance / 1.4
            
            num_points = 20
            route_coords = []
            for i in range(num_points + 1):
                t = i / num_points
                lat = float(start_lat) + (float(end_lat) - float(start_lat)) * t + math.sin(t * math.pi) * 0.0005
                lng = float(start_lng) + (float(end_lng) - float(start_lng)) * t + math.cos(t * math.pi) * 0.0005
                route_coords.append({'lat': lat, 'lng': lng})
            
            points = [[c['lat'], c['lng']] for c in route_coords]
            
            if approx_distance < 1000:
                distance_str = f"{approx_distance:.0f} m"
            else:
                distance_str = f"{approx_distance/1000:.1f} km"
            
            if approx_duration < 60:
                duration_str = f"{approx_duration:.0f} sec"
            elif approx_duration < 3600:
                duration_str = f"{approx_duration/60:.0f} min"
            else:
                hours = int(approx_duration / 3600)
                minutes = int((approx_duration % 3600) / 60)
                duration_str = f"{hours}h {minutes}m"
            
            # Add fallback steps
            fallback_steps = [
                {
                    'instruction': f"Head towards destination",
                    'distance': distance_str,
                    'distance_meters': approx_distance,
                    'duration': duration_str,
                    'duration_seconds': approx_duration,
                    'travel_mode': 'WALKING'
                },
                {
                    'instruction': f"Arrive at destination",
                    'distance': '0 m',
                    'distance_meters': 0,
                    'duration': '0 sec',
                    'duration_seconds': 0,
                    'travel_mode': 'ARRIVE'
                }
            ]
            
            response_data = {
                'success': True,
                'route': {
                    'distance': distance_str,
                    'distance_meters': approx_distance,
                    'duration': duration_str,
                    'duration_seconds': approx_duration,
                    'steps': fallback_steps,
                    'coordinates': route_coords,
                    'points': points,
                    'segments': [],
                    'start_address': f"{float(start_lat):.4f}, {float(start_lng):.4f}",
                    'end_address': f"{float(end_lat):.4f}, {float(end_lng):.4f}",
                    'accessibility_score': 70,
                    'warnings': ['Using estimated route due to API unavailability'],
                    'elevator_access': 'wheelchair' in accessibility_needs,
                    'ramp_access': 'wheelchair' in accessibility_needs,
                    'safety': {'overall_safety': 0.7, 'risk_level': 'medium', 'recommendations': ['Estimated route - use caution']},
                    'arrival_time': (datetime.now().timestamp() + approx_duration),
                    'bounds': {
                        'north': max(float(start_lat), float(end_lat)),
                        'south': min(float(start_lat), float(end_lat)),
                        'east': max(float(start_lng), float(end_lng)),
                        'west': min(float(start_lng), float(end_lng))
                    },
                    'travel_mode': travel_mode
                },
                'provider': 'fallback-calculation',
                'model_used': False,
                'real_api_used': False
            }
            
            return jsonify(response_data)
            
        except Exception as e:
            logger.error(f"Route calculation error: {e}", exc_info=True)
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

    @app.route('/api/voice-route', methods=['POST', 'OPTIONS'])
    def voice_route():
        """Voice-activated route endpoint - returns coordinates for mapping"""
        if request.method == 'OPTIONS':
            return jsonify({'success': True}), 200
        
        try:
            data = request.json
            start = data.get('start', '')
            destination = data.get('destination', '')
            mode = data.get('mode', 'walk')
            user_lat = float(data.get('user_lat', 40.4406))
            user_lng = float(data.get('user_lng', -79.9959))
            
            logger.info(f"Voice route request: from '{start}' to '{destination}' mode '{mode}'")
            
            # Import geocoding functions
            from voice_handler import geocode_address, correct_transcript, detect_current_location_intent
            
            # ========== GEOCODE START LOCATION ==========
            is_current = detect_current_location_intent(start) if hasattr(detect_current_location_intent, '__call__') else False
            is_current = is_current or start.lower() == 'current location'
            
            if is_current:
                start_lat, start_lng = user_lat, user_lng
                start_address = "Your Current Location"
                logger.info(f"Start is current location: ({start_lat}, {start_lng})")
            else:
                geocoded = geocode_address(start, bias_lat=user_lat, bias_lng=user_lng)
                if not geocoded:
                    corrected, _ = correct_transcript(start, context="address")
                    if corrected != start:
                        logger.info(f"Corrected start from '{start}' to '{corrected}'")
                        geocoded = geocode_address(corrected, bias_lat=user_lat, bias_lng=user_lng)
                
                if not geocoded:
                    return jsonify({
                        'success': False,
                        'error': f'Could not find starting location: {start}',
                        'code': 'GEOCODE_FAILED_START'
                    }), 422
                
                start_lat, start_lng, start_address = geocoded
                logger.info(f"Start geocoded: '{start_address}' → ({start_lat:.6f}, {start_lng:.6f})")
            
            # ========== GEOCODE DESTINATION ==========
            geocoded = geocode_address(destination, bias_lat=user_lat, bias_lng=user_lng)
            if not geocoded:
                corrected, _ = correct_transcript(destination, context="address")
                if corrected != destination:
                    logger.info(f"Corrected destination from '{destination}' to '{corrected}'")
                    geocoded = geocode_address(corrected, bias_lat=user_lat, bias_lng=user_lng)
            
            if not geocoded:
                return jsonify({
                    'success': False,
                    'error': f'Could not find destination: {destination}',
                    'code': 'GEOCODE_FAILED_DEST'
                }), 422
            
            dest_lat, dest_lng, dest_address = geocoded
            logger.info(f"Destination geocoded: '{dest_address}' → ({dest_lat:.6f}, {dest_lng:.6f})")
            
            # ========== CALCULATE ROUTE BASED ON MODE ==========
            route_coords = []
            steps = []
            distance_str = ""
            duration_str = ""
            safety_dict = {'overall_safety': 0.8, 'risk_level': 'low', 'recommendations': []}
            provider_used = "geocoding_only"
            
            # ========== TRANSIT MODE - USE GTFS TRANSIT ROUTER ==========
            if mode == 'transit' and transit_router:
                try:
                    logger.info(f"Using GTFS transit router for route from ({start_lat},{start_lng}) to ({dest_lat},{dest_lng})")
                    
                    # Get current time
                    from datetime import datetime
                    current_time = datetime.now()
                    
                    # Find transit route
                    routes = transit_router.find_route(
                        start_lat, start_lng,
                        dest_lat, dest_lng,
                        current_time,
                        max_walk_distance=800,
                        max_transfers=4,
                        time_window_minutes=120,
                        num_alternatives=1
                    )
                    
                    if routes and len(routes) > 0:
                        best_route = routes[0]
                        
                        # Extract route coordinates from steps
                        all_coords = []
                        for step in best_route.get('steps', []):
                            geom = step.get('path_geometry', [])
                            for pt in geom:
                                if isinstance(pt, list) and len(pt) == 2:
                                    all_coords.append([pt[0], pt[1]])
                                elif isinstance(pt, dict):
                                    all_coords.append([pt.get('lat', 0), pt.get('lng', 0)])
                        
                        route_coords = all_coords if all_coords else [[start_lat, start_lng], [dest_lat, dest_lng]]
                        
                        # Format distance and duration
                        dist_m = best_route.get('total_distance_meters', 0)
                        dur_s = best_route.get('total_time_seconds', 0)
                        
                        if dist_m >= 1000:
                            distance_str = f"{dist_m/1000:.1f} km"
                        else:
                            distance_str = f"{int(dist_m)} m"
                        
                        if dur_s < 60:
                            duration_str = f"{int(dur_s)} seconds"
                        elif dur_s < 3600:
                            mins = int(dur_s / 60)
                            duration_str = f"{mins} minute{'s' if mins != 1 else ''}"
                        else:
                            hours = int(dur_s / 3600)
                            mins = int((dur_s % 3600) / 60)
                            duration_str = f"{hours} hour{'s' if hours != 1 else ''} and {mins} minute{'s' if mins != 1 else ''}"
                        
                        # Build steps for frontend
                        steps = []
                        for step in best_route.get('steps', []):
                            if step.get('type') == 'walk':
                                steps.append({
                                    'instruction': step.get('instruction', 'Walk'),
                                    'distance': fmt_dist(step.get('distance_meters', 0)),
                                    'duration': fmt_duration(step.get('duration_seconds', 0)),
                                    'travel_mode': 'WALKING'
                                })
                            elif step.get('type') == 'transit':
                                route_name = step.get('route_short_name', 'Bus')
                                from_stop = step.get('start_stop', 'Stop')
                                to_stop = step.get('end_stop', 'Stop')
                                steps.append({
                                    'instruction': f"Take {route_name} from {from_stop} to {to_stop}",
                                    'distance': fmt_dist(step.get('distance_meters', 0)),
                                    'duration': fmt_duration(step.get('duration_seconds', 0)),
                                    'travel_mode': 'TRANSIT',
                                    'transit_line': route_name,
                                    'departure_stop': from_stop,
                                    'arrival_stop': to_stop
                                })
                        
                        # Add start and end steps if missing
                        if not steps:
                            steps = [
                                {'instruction': f"Head from {start_address} to {dest_address}", 'distance': distance_str, 'duration': duration_str},
                                {'instruction': f"Arrive at {dest_address}", 'distance': '0 m', 'duration': '0 sec'}
                            ]
                        
                        provider_used = "gtfs_transit"
                        logger.info(f"GTFS transit route found: {distance_str}, {duration_str}")
                        
                        # Get safety score
                        safety_ai_instance = get_safety_ai_instance()
                        if safety_ai_instance and safety_ai_instance.is_trained and route_coords:
                            try:
                                route_coords_for_safety = [{'lat': p[0], 'lng': p[1]} for p in route_coords]
                                safety_result = safety_ai_instance.calculate_route_safety(route_coords_for_safety)
                                safety_dict = {
                                    'overall_safety': safety_result.get('overall_safety', 0.8),
                                    'risk_level': safety_result.get('risk_level', 'low'),
                                    'recommendations': safety_result.get('recommendations', [])
                                }
                            except:
                                pass
                    else:
                        logger.warning("GTFS transit router found no routes, falling back to walking")
                        mode = 'walk'  # Fall back to walking
                        
                except Exception as e:
                    logger.error(f"GTFS transit routing failed: {e}", exc_info=True)
                    mode = 'walk'  # Fall back to walking
            
            # ========== WALK/WHEELCHAIR MODE - USE TOMTOM ==========
            if mode != 'transit' and tomtom_router:
                try:
                    travel_mode = 'pedestrian'
                    accessibility = ['wheelchair'] if mode == 'wheelchair' else None
                    
                    route_result = tomtom_router.calculate_route(
                        start_lat, start_lng,
                        dest_lat, dest_lng,
                        travel_mode=travel_mode,
                        accessibility_needs=accessibility
                    )
                    
                    if route_result and route_result.get('points'):
                        route_coords = route_result.get('points', [])
                        dist_m = route_result.get('distance_meters', 0)
                        dur_s = route_result.get('duration_seconds', 0)
                        
                        if dist_m >= 1000:
                            distance_str = f"{dist_m/1000:.1f} km"
                        else:
                            distance_str = f"{int(dist_m)} m"
                        
                        if dur_s < 60:
                            duration_str = f"{int(dur_s)} seconds"
                        elif dur_s < 3600:
                            mins = int(dur_s / 60)
                            duration_str = f"{mins} minute{'s' if mins != 1 else ''}"
                        else:
                            hours = int(dur_s / 3600)
                            mins = int((dur_s % 3600) / 60)
                            duration_str = f"{hours} hour{'s' if hours != 1 else ''} and {mins} minute{'s' if mins != 1 else ''}"
                        
                        steps = route_result.get('instructions', [])
                        if not steps:
                            steps = [
                                {'instruction': f"Head towards {dest_address}", 'distance': distance_str, 'duration': duration_str},
                                {'instruction': f"Arrive at {dest_address}", 'distance': '0 m', 'duration': '0 sec'}
                            ]
                        
                        provider_used = "tomtom"
                        logger.info(f"TomTom route found with {len(route_coords)} points")
                        
                        safety_ai_instance = get_safety_ai_instance()
                        if safety_ai_instance and safety_ai_instance.is_trained and route_coords:
                            try:
                                route_coords_for_safety = [{'lat': p[0], 'lng': p[1]} for p in route_coords]
                                safety_result = safety_ai_instance.calculate_route_safety(route_coords_for_safety)
                                safety_dict = {
                                    'overall_safety': safety_result.get('overall_safety', 0.8),
                                    'risk_level': safety_result.get('risk_level', 'low'),
                                    'recommendations': safety_result.get('recommendations', [])
                                }
                            except:
                                pass
                                
                except Exception as e:
                    logger.warning(f"TomTom routing failed: {e}")
            
            # ========== FALLBACK TO DIRECT LINE ==========
            if not route_coords:
                dist_m = haversine_distance(start_lat, start_lng, dest_lat, dest_lng)
                if dist_m >= 1000:
                    distance_str = f"{dist_m/1000:.1f} km"
                else:
                    distance_str = f"{int(dist_m)} m"
                
                if dist_m / 1.4 < 60:
                    duration_str = f"{int(dist_m / 1.4)} seconds"
                else:
                    mins = int(dist_m / 1.4 / 60)
                    duration_str = f"{mins} minute{'s' if mins != 1 else ''}"
                
                route_coords = []
                for i in range(11):
                    t = i / 10
                    route_coords.append([
                        start_lat + (dest_lat - start_lat) * t,
                        start_lng + (dest_lng - start_lng) * t
                    ])
                
                steps = [
                    {'instruction': f"Head from {start_address} to {dest_address}", 'distance': distance_str, 'duration': duration_str},
                    {'instruction': f"Arrive at {dest_address}", 'distance': '0 m', 'duration': '0 sec'}
                ]
                provider_used = "direct_line"
            
            # ========== GENERATE RESPONSE ==========
            response = {
                'success': True,
                'route_id': f"VR-{int(time.time())}-{random.randint(100, 999)}",
                'start_address': start_address,
                'end_address': dest_address,
                'start_lat': start_lat,
                'start_lng': start_lng,
                'end_lat': dest_lat,
                'end_lng': dest_lng,
                'distance': distance_str,
                'distance_meters': dist_m if 'dist_m' in dir() else 0,
                'duration': duration_str,
                'steps': steps,
                'route_coords': route_coords,
                'safety': safety_dict,
                'travel_mode': mode,
                'provider': provider_used
            }
            
            logger.info(f"Voice route successful: {start_address} → {dest_address} using {provider_used}")
            return jsonify(response)
            
        except Exception as e:
            logger.error(f"Voice route error: {e}", exc_info=True)
            return jsonify({'success': False, 'error': str(e)}), 500
        
    # ============================================================================
    # NEW TRANSIT AND OBSTRUCTION ENDPOINTS
    # ============================================================================

    @app.route("/api/area-obstructions", methods=['POST'])
    def get_area_obstructions():
        """Get real obstructions using TomTom Traffic API, 911 emergencies, and News API"""
        try:
            data = request.json
            lat = float(data.get('lat', 40.4406))
            lng = float(data.get('lng', -79.9959))
            radius = float(data.get('radius', 2000))
            
            # Allow custom bounding box to override radius calculation
            use_custom_bbox = data.get('use_custom_bbox', False)
            custom_min_lat = data.get('min_lat')
            custom_max_lat = data.get('max_lat')
            custom_min_lng = data.get('min_lng')
            custom_max_lng = data.get('max_lng')
            
            # Options to include different data sources
            include_emergencies = data.get('include_emergencies', True)
            include_news = data.get('include_news', True)
            
            construction_zones = []
            hazards = []
            emergencies_911 = []
            news_hazards = []

            # PART 1: FETCH TOMTOM TRAFFIC INCIDENTS
            tomtom_key = os.getenv('TOMTOM_API_KEY') or (tomtom_router.api_key if tomtom_router else None)
            if tomtom_key:
                try:
                    if use_custom_bbox and all([custom_min_lat, custom_max_lat, custom_min_lng, custom_max_lng]):
                        min_lat = custom_min_lat
                        max_lat = custom_max_lat
                        min_lng = custom_min_lng
                        max_lng = custom_max_lng
                        logger.info(f"Using custom bounding box: {min_lat},{min_lng} to {max_lat},{max_lng}")
                    else:
                        km = radius / 1000.0
                        delta_lat = km * 0.009
                        delta_lng = km * 0.012
                        min_lat = lat - delta_lat
                        max_lat = lat + delta_lat
                        min_lng = lng - delta_lng
                        max_lng = lng + delta_lng

                    fields_param = "{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to}}}"

                    incidents_url = (
                        f"https://api.tomtom.com/traffic/services/5/incidentDetails"
                        f"?key={tomtom_key}"
                        f"&bbox={min_lng},{min_lat},{max_lng},{max_lat}"
                        f"&fields={fields_param}"
                        f"&language=en-US"
                        f"&timeValidityFilter=present"
                    )

                    resp = requests.get(incidents_url, timeout=8)

                    if resp.status_code == 200:
                        incidents_data = resp.json()
                        incidents = incidents_data.get('incidents', [])
                        logger.info(f"TomTom returned {len(incidents)} incidents")

                        construction_categories = {7, 8, 9, 10}
                        hazard_categories = {1, 2, 3, 4, 5, 11, 14}

                        for inc in incidents:
                            props = inc.get('properties', {})
                            geom = inc.get('geometry', {})

                            coords = geom.get('coordinates', [])
                            if not coords:
                                continue

                            geom_type = geom.get('type', 'Point')
                            if geom_type == 'Point':
                                inc_lng, inc_lat = coords[0], coords[1]
                            elif geom_type == 'LineString' and len(coords) > 0:
                                mid_idx = len(coords) // 2
                                inc_lng, inc_lat = coords[mid_idx][0], coords[mid_idx][1]
                            else:
                                continue

                            events = props.get('events', [])
                            description_parts = [e.get('description', '') for e in events if e.get('description')]
                            description = '; '.join(description_parts) if description_parts else 'Traffic incident'

                            from_str = props.get('from', '')
                            to_str = props.get('to', '')
                            if from_str:
                                description += f" - from {from_str}"
                            if to_str:
                                description += f" to {to_str}"

                            icon_cat = props.get('iconCategory', 0)
                            distance = haversine_distance(lat, lng, inc_lat, inc_lng)

                            if icon_cat in construction_categories:
                                construction_zones.append({
                                    'lat': inc_lat,
                                    'lng': inc_lng,
                                    'radius': 30,
                                    'description': description,
                                    'distance_meters': round(distance, 1),
                                    'icon_category': icon_cat,
                                    'start_time': props.get('startTime', ''),
                                    'end_time': props.get('endTime', ''),
                                    'source': 'tomtom'
                                })
                            elif icon_cat in hazard_categories:
                                magnitude = props.get('magnitudeOfDelay', 0)
                                severity = min(1.0, 0.3 + (magnitude / 4) * 0.7) if magnitude else 0.5
                                hazards.append({
                                    'lat': inc_lat,
                                    'lng': inc_lng,
                                    'radius': 40,
                                    'type': description_parts[0] if description_parts else 'incident',
                                    'description': description,
                                    'severity': severity,
                                    'distance_meters': round(distance, 1),
                                    'icon_category': icon_cat,
                                    'source': 'tomtom'
                                })
                            else:
                                hazards.append({
                                    'lat': inc_lat,
                                    'lng': inc_lng,
                                    'radius': 35,
                                    'type': 'traffic_incident',
                                    'description': description,
                                    'severity': 0.4,
                                    'distance_meters': round(distance, 1),
                                    'icon_category': icon_cat,
                                    'source': 'tomtom'
                                })
                except Exception as e:
                    logger.error(f"TomTom incidents API error: {e}")

            # PART 2: FETCH 911 EMERGENCIES
            if include_emergencies:
                try:
                    from emergency_data_fetcher import get_emergency_fetcher
                    fetcher = get_emergency_fetcher()
                    area_emergencies = fetcher.get_emergencies_in_area(lat, lng, radius)
                    logger.info(f"Found {len(area_emergencies)} active 911 emergencies in area")
                    
                    for emergency in area_emergencies:
                        subtype = emergency.get('subtype', 'emergency')
                        severity = emergency.get('severity', 0.5)
                        
                        emergency_hazard = {
                            'lat': emergency['lat'],
                            'lng': emergency['lng'],
                            'radius': emergency['radius'],
                            'type': subtype,
                            'description': emergency['description'],
                            'severity': severity,
                            'distance_meters': emergency.get('distance_meters', 0),
                            'source': '911_dispatch',
                            'timestamp': emergency.get('timestamp', ''),
                            'is_active': emergency.get('is_active', True),
                            'category': 'emergency'
                        }
                        
                        emergencies_911.append(emergency_hazard)
                        hazards.append(emergency_hazard)
                        
                except ImportError as e:
                    logger.warning(f"Emergency data fetcher not available: {e}")
                except Exception as e:
                    logger.error(f"Failed to fetch 911 emergencies: {e}")

            # PART 3: FETCH NEWS-BASED HAZARDS
            if include_news:
                try:
                    from news_hazard_fetcher import get_news_fetcher
                    news_fetcher = get_news_fetcher()
                    news_hazards_list = news_fetcher.get_hazards_in_area(lat, lng, radius)
                    logger.info(f"Found {len(news_hazards_list)} news-based hazards in area")
                    
                    for news_hazard in news_hazards_list:
                        news_formatted = {
                            'lat': news_hazard['lat'],
                            'lng': news_hazard['lng'],
                            'radius': 100,
                            'type': news_hazard['type'],
                            'description': news_hazard['description'],
                            'severity': news_hazard['severity'],
                            'distance_meters': news_hazard.get('distance_meters', 0),
                            'source': 'news_api',
                            'title': news_hazard.get('title', ''),
                            'url': news_hazard.get('url', ''),
                            'publisher': news_hazard.get('publisher', ''),
                            'published_date': news_hazard.get('published_date', ''),
                            'location_name': news_hazard.get('location_name', ''),
                            'category': 'news_hazard'
                        }
                        news_hazards.append(news_formatted)
                        hazards.append(news_formatted)
                        
                except ImportError as e:
                    logger.warning(f"News hazard fetcher not available: {e}")
                except Exception as e:
                    logger.error(f"Failed to fetch news hazards: {e}")

            # PART 4: PREPARE RESPONSE
            if use_custom_bbox and all([custom_min_lat, custom_max_lat, custom_min_lng, custom_max_lng]):
                response_bbox = {
                    'min_lat': custom_min_lat,
                    'max_lat': custom_max_lat,
                    'min_lng': custom_min_lng,
                    'max_lng': custom_max_lng
                }
            else:
                response_bbox = None

            return jsonify({
                'success': True,
                'construction_zones': construction_zones,
                'hazards': hazards,
                'emergencies_911': emergencies_911,
                'news_hazards': news_hazards,
                'area_center': {'lat': lat, 'lng': lng},
                'radius_meters': radius if not use_custom_bbox else None,
                'bounding_box': response_bbox,
                'source': 'tomtom_incidents_911_news',
                'total_incidents': len(construction_zones) + len(hazards),
                'total_911_emergencies': len(emergencies_911),
                'total_news_hazards': len(news_hazards),
                'timestamp': datetime.now().isoformat()
            })

        except Exception as e:
            logger.error(f"Error getting area obstructions: {e}", exc_info=True)
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
        
    @app.route("/api/news-hazards", methods=['GET', 'POST'])
    def get_news_hazards_endpoint():
        """Get hazards from recent news articles"""
        try:
            data = request.json or {}
            lat = data.get('lat')
            lng = data.get('lng')
            radius = data.get('radius', 1000)
            
            from news_hazard_fetcher import get_news_fetcher
            fetcher = get_news_fetcher()
            
            if lat and lng:
                hazards = fetcher.get_hazards_in_area(lat, lng, radius)
            else:
                hazards = fetcher.fetch_hazards()
            
            return jsonify({
                'success': True,
                'hazards': hazards,
                'count': len(hazards),
                'source': 'gnews_api'
            })
        except Exception as e:
            logger.error(f"Error fetching news hazards: {e}")
            return jsonify({'success': False, 'error': str(e)}), 500
        
    @app.route("/api/route-alternatives", methods=['POST', 'GET', 'OPTIONS'])
    def get_route_alternatives():
        """Get multiple route alternatives including different transit options"""
        if request.method == 'OPTIONS':
            return jsonify({'success': True}), 200
        
        try:
            data = request.json
            start_lat = float(data.get('start_lat'))
            start_lng = float(data.get('start_lng'))
            end_lat = float(data.get('end_lat'))
            end_lng = float(data.get('end_lng'))
            accessibility_preferences = data.get('accessibility_preferences', {})
            
            accessibility_needs = []
            if accessibility_preferences.get('wheelchair'):
                accessibility_needs.append('wheelchair')
            if accessibility_preferences.get('blind'):
                accessibility_needs.append('blind')
            
            global tracker_instance
            
            if tracker_instance is None:
                try:
                    from real_time_tracker import RealTimeTracker, Position
                    tracker_instance = RealTimeTracker(None, None)
                    logger.warning("Created temporary tracker for route alternatives")
                except ImportError:
                    return jsonify({
                        'success': True,
                        'alternatives': []
                    })
            
            start = Position(lat=start_lat, lng=start_lng)
            dest = Position(lat=end_lat, lng=end_lng)
            
            alternatives = tracker_instance.get_route_alternatives_with_transit(
                start, dest, set(accessibility_needs)
            )
            
            formatted_alternatives = []
            for alt in alternatives:
                formatted_alt = {
                    'index': alt.get('index', 0),
                    'type': alt.get('type', 'pedestrian'),
                    'duration_minutes': round(alt.get('total_duration_minutes', 0)),
                    'distance_meters': alt.get('total_distance_meters', 0),
                    'safety_score': alt.get('safety_score', 0.7),
                    'has_obstruction': alt.get('has_obstruction', False),
                    'waypoints': alt.get('waypoints', [])
                }
                
                if alt.get('type') == 'transit':
                    formatted_alt['transit_lines'] = alt.get('transit_lines', [])
                    formatted_alt['walking_minutes'] = round(alt.get('walking_time_minutes', 0))
                    formatted_alt['transit_minutes'] = round(alt.get('transit_time_minutes', 0))
                
                if alt.get('construction_warnings'):
                    formatted_alt['warnings'] = alt['construction_warnings']
                
                formatted_alternatives.append(formatted_alt)
            
            return jsonify({
                'success': True,
                'alternatives': formatted_alternatives
            })
            
        except Exception as e:
            logger.error(f"Error getting route alternatives: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

    @app.route("/api/emergencies", methods=['GET'])
    def get_emergencies():
        """Get all active emergencies"""
        try:
            fetcher = get_emergency_fetcher()
            lat = request.args.get('lat', type=float)
            lng = request.args.get('lng', type=float)
            radius = request.args.get('radius', 1000, type=float)
            
            if lat and lng:
                emergencies = fetcher.get_emergencies_in_area(lat, lng, radius)
            else:
                emergencies = fetcher.emergencies
            
            return jsonify({
                'success': True,
                'emergencies': emergencies,
                'stats': fetcher.get_summary_stats()
            })
        except Exception as e:
            logger.error(f"Error fetching emergencies: {e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route("/api/emergencies/refresh", methods=['POST'])
    def refresh_emergencies():
        """Force refresh emergency data"""
        try:
            fetcher = get_emergency_fetcher()
            emergencies = fetcher.fetch_all_data(force_refresh=True)
            return jsonify({
                'success': True,
                'message': f'Refreshed {len(emergencies)} emergencies',
                'emergencies': emergencies
            })
        except Exception as e:
            logger.error(f"Error refreshing emergencies: {e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route("/api/emergencies/stats", methods=['GET'])
    def get_emergency_stats():
        """Get summary statistics of emergencies"""
        try:
            fetcher = get_emergency_fetcher()
            return jsonify({
                'success': True,
                'stats': fetcher.get_summary_stats()
            })
        except Exception as e:
            logger.error(f"Error getting emergency stats: {e}")
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route("/api/check-obstructions", methods=['POST', 'GET', 'OPTIONS'])
    def check_obstructions():
        """Check for obstructions along a route including TomTom and 911 emergencies"""
        if request.method == 'OPTIONS':
            response = jsonify({'success': True})
            response.headers.add('Access-Control-Allow-Origin', '*')
            response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
            response.headers.add('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
            return response
        
        try:
            data = request.json
            if not data:
                return jsonify({
                    'success': False,
                    'error': 'No data provided'
                }), 400
                
            route_coords = data.get('route_coords', [])
            include_emergencies = data.get('include_emergencies', True)
            
            if not route_coords:
                return jsonify({
                    'success': False,
                    'error': 'No route coordinates provided'
                }), 400
            
            waypoints = []
            for coord in route_coords:
                if isinstance(coord, dict):
                    if 'lat' in coord and 'lng' in coord:
                        waypoints.append((coord['lat'], coord['lng']))
                    elif 'latitude' in coord and 'longitude' in coord:
                        waypoints.append((coord['latitude'], coord['longitude']))
                elif isinstance(coord, (list, tuple)) and len(coord) >= 2:
                    waypoints.append((coord[0], coord[1]))
            
            if not waypoints:
                return jsonify({
                    'success': False,
                    'error': 'No valid coordinates found'
                }), 400
            
            global tracker_instance
            
            if tracker_instance is None:
                try:
                    from real_time_tracker import RealTimeTracker
                    tracker_instance = RealTimeTracker(None, None)
                except ImportError:
                    tracker_instance = None
            
            obstructions = {'has_obstruction': False, 'construction_zones': [], 'hazards': []}
            
            if tracker_instance:
                obstructions = tracker_instance.check_route_obstructions(waypoints)
            
            if include_emergencies:
                try:
                    fetcher = get_emergency_fetcher()
                    route_emergencies = fetcher.get_emergencies_on_route(waypoints, buffer_meters=200)
                    
                    for emergency in route_emergencies:
                        hazard = {
                            'type': emergency['subtype'],
                            'description': f"911 Dispatch: {emergency['description']}",
                            'severity': emergency['severity'],
                            'location': {'lat': emergency['lat'], 'lng': emergency['lng']},
                            'distance_meters': emergency.get('distance_meters', 0),
                            'source': '911_dispatch'
                        }
                        obstructions['hazards'].append(hazard)
                    
                    if route_emergencies:
                        obstructions['has_obstruction'] = True
                        logger.info(f"Found {len(route_emergencies)} emergencies near route")
                        
                except Exception as e:
                    logger.warning(f"Failed to get route emergencies: {e}")
            
            formatted_obstructions = {
                'has_obstruction': obstructions.get('has_obstruction', False),
                'construction_zones': [],
                'hazards': []
            }
            
            for zone in obstructions.get('construction_zones', []):
                formatted_obstructions['construction_zones'].append({
                    'description': zone.get('description', 'Construction zone'),
                    'location': {'lat': zone.get('lat', 0), 'lng': zone.get('lng', 0)},
                    'distance_meters': zone.get('distance_meters', 0)
                })
            
            for hazard in obstructions.get('hazards', []):
                formatted_obstructions['hazards'].append({
                    'type': hazard.get('type', 'hazard'),
                    'description': hazard.get('description', 'Unknown hazard'),
                    'severity': hazard.get('severity', 0.5),
                    'source': hazard.get('source', 'unknown')
                })
            
            return jsonify({
                'success': True,
                'obstructions': formatted_obstructions
            })
            
        except Exception as e:
            logger.error(f"Error checking obstructions: {e}", exc_info=True)
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

    # ── INSERT AFTER /api/check-obstructions endpoint ─────────────────
    # (new endpoint 1 of 2)

    @app.route("/api/alternate-destinations/check", methods=['POST'])
    def check_alternate_destinations_needed():
        """
        Lightweight endpoint: checks if a route passes through hazards and
        whether alternate destinations should be suggested.
        Used by frontend to decide whether to trigger full alternate computation.
        """
        try:
            data = request.json
            route_coords = data.get('route_coords', [])
            dest_lat = float(data.get('dest_lat', 0))
            dest_lng = float(data.get('dest_lng', 0))
            buffer_meters = float(data.get('buffer_meters', 120))
            
            if not route_coords:
                return jsonify({'success': False, 'error': 'No route coordinates provided'}), 400
            
            waypoints = []
            for coord in route_coords:
                if isinstance(coord, (list, tuple)) and len(coord) >= 2:
                    waypoints.append((float(coord[0]), float(coord[1])))
                elif isinstance(coord, dict):
                    waypoints.append((float(coord.get('lat', 0)), float(coord.get('lng', 0))))
            
            # Fetch current hazards for the route area
            if not waypoints:
                return jsonify({'success': False, 'error': 'No valid coordinates'}), 400
            
            mid_lat = sum(w[0] for w in waypoints) / len(waypoints)
            mid_lng = sum(w[1] for w in waypoints) / len(waypoints)
            
            # Get TomTom incidents + news hazards in route area
            all_hazards = []
            tomtom_key = os.getenv('TOMTOM_API_KEY') or (tomtom_router.api_key if tomtom_router else None)
            
            if tomtom_key:
                try:
                    route_span_lat = max(w[0] for w in waypoints) - min(w[0] for w in waypoints)
                    route_span_lng = max(w[1] for w in waypoints) - min(w[1] for w in waypoints)
                    buf_lat = max(0.005, route_span_lat / 2 + 0.002)
                    buf_lng = max(0.007, route_span_lng / 2 + 0.003)
                    bbox = f"{mid_lng - buf_lng},{mid_lat - buf_lat},{mid_lng + buf_lng},{mid_lat + buf_lat}"
                    fields = "{incidents{geometry{type,coordinates},properties{iconCategory,events{description}}}}"
                    url = (f"https://api.tomtom.com/traffic/services/5/incidentDetails"
                           f"?key={tomtom_key}&bbox={bbox}&fields={fields}&timeValidityFilter=present")
                    resp = requests.get(url, timeout=6)
                    if resp.status_code == 200:
                        for inc in resp.json().get('incidents', []):
                            geom = inc.get('geometry', {}); coords = geom.get('coordinates', [])
                            if not coords: continue
                            if geom.get('type') == 'Point':
                                inc_lat, inc_lng = coords[1], coords[0]
                            elif geom.get('type') == 'LineString' and coords:
                                mid_i = coords[len(coords)//2]; inc_lat, inc_lng = mid_i[1], mid_i[0]
                            else: continue
                            all_hazards.append({'lat': inc_lat, 'lng': inc_lng, 'radius': 50, 'severity': 0.6,
                                                'type': 'incident', 'source': 'tomtom'})
                except Exception as e:
                    logger.warning(f"TomTom fetch for alt-dest check failed: {e}")
            
            try:
                from news_hazard_fetcher import get_news_fetcher
                news = get_news_fetcher()
                for h in news.get_hazards_in_area(mid_lat, mid_lng, 1500):
                    all_hazards.append({'lat': h['lat'], 'lng': h['lng'],
                                        'radius': 100, 'severity': h.get('severity', 0.5),
                                        'type': h.get('type', 'hazard'), 'source': 'news'})
            except Exception as e:
                logger.debug(f"News hazard fetch for alt-dest check: {e}")
            
            # Check each route segment against each hazard
            route_hazards = []
            for hazard in all_hazards:
                if hazard.get('severity', 0) < 0.5: continue
                effective_radius = hazard.get('radius', 50) + buffer_meters
                for i in range(len(waypoints) - 1):
                    seg_s = [waypoints[i][1], waypoints[i][0]]
                    seg_e = [waypoints[i+1][1], waypoints[i+1][0]]
                    hz_pt = [hazard['lng'], hazard['lat']]
                    
                    # Simplified point-to-segment distance
                    dx, dy = seg_e[0]-seg_s[0], seg_e[1]-seg_s[1]
                    if dx == 0 and dy == 0:
                        dist = haversine_distance(hazard['lat'], hazard['lng'], waypoints[i][0], waypoints[i][1])
                    else:
                        t = max(0, min(1, ((hz_pt[0]-seg_s[0])*dx + (hz_pt[1]-seg_s[1])*dy) / (dx*dx+dy*dy)))
                        proj_lng = seg_s[0] + t*dx; proj_lat = seg_s[1] + t*dy
                        dist = haversine_distance(hazard['lat'], hazard['lng'], proj_lat, proj_lng)
                    
                    if dist < effective_radius:
                        if not any(abs(h['lat']-hazard['lat'])<0.0001 and abs(h['lng']-hazard['lng'])<0.0001
                                   for h in route_hazards):
                            route_hazards.append({**hazard, 'distance_from_route': round(dist, 1)})
                        break
            
            # Check if destination itself is in hazard
            dest_in_hazard = None
            for h in all_hazards:
                d = haversine_distance(dest_lat, dest_lng, h['lat'], h['lng'])
                if d < h.get('radius', 50) and h.get('severity', 0) >= 0.6:
                    dest_in_hazard = h; break
            
            worst_severity = max((h['severity'] for h in route_hazards), default=0)
            
            return jsonify({
                'success': True,
                'should_suggest_alternates': len(route_hazards) > 0 or dest_in_hazard is not None,
                'route_hazards': route_hazards,
                'dest_in_hazard': dest_in_hazard,
                'hazard_count': len(route_hazards),
                'worst_severity': worst_severity,
                'trigger_reason': (
                    'destination_in_hazard' if dest_in_hazard
                    else 'route_through_hazard' if route_hazards
                    else None
                ),
            })
            
        except Exception as e:
            logger.error(f"Alternate destinations check error: {e}", exc_info=True)
            return jsonify({'success': False, 'error': str(e)}), 500


    # ── INSERT AFTER /api/alternate-destinations/check endpoint ─────────
    # (new endpoint 2 of 2)

    @app.route("/api/alternate-destinations/search", methods=['POST'])
    def search_alternate_destinations():
        """
        Searches for semantically similar POIs near the original destination
        that are NOT in hazard zones. Returns candidates with basic metadata.
        The frontend will fetch routes for each candidate separately.
        """
        try:
            data = request.json
            dest_lat = float(data.get('dest_lat'))
            dest_lng = float(data.get('dest_lng'))
            dest_name = data.get('dest_name', '')
            user_lat = float(data.get('user_lat'))
            user_lng = float(data.get('user_lng'))
            category = data.get('category', 'general')
            search_radius_m = float(data.get('search_radius_m', 1500))
            max_results = int(data.get('max_results', 8))
            
            CATEGORY_SEARCH_MAP = {
                'museum': 'museum', 'medical': 'hospital', 'education': 'university',
                'cafe': 'coffee shop', 'restaurant': 'restaurant', 'park': 'park',
                'shopping': 'shopping mall', 'pharmacy': 'pharmacy', 'library': 'library',
                'transit': 'transit station', 'general': 'point of interest',
            }
            search_query = CATEGORY_SEARCH_MAP.get(category, 'point of interest')
            
            tomtom_key = os.getenv('TOMTOM_API_KEY') or (tomtom_router.api_key if tomtom_router else None)
            if not tomtom_key:
                return jsonify({'success': False, 'error': 'TomTom API key not configured'}), 503
            
            search_url = (f"https://api.tomtom.com/search/2/categorySearch/{requests.utils.quote(search_query)}.json"
                          f"?key={tomtom_key}&lat={dest_lat}&lon={dest_lng}"
                          f"&radius={int(search_radius_m)}&limit={max_results + 4}&language=en-US")
            resp = requests.get(search_url, timeout=8)
            
            if resp.status_code != 200:
                return jsonify({'success': False, 'error': f'TomTom search returned {resp.status_code}'}), 502
            
            poi_data = resp.json()
            candidates = []
            
            # Fetch current hazards in area
            all_hazards = []
            try:
                from news_hazard_fetcher import get_news_fetcher
                news = get_news_fetcher()
                for h in news.get_hazards_in_area(dest_lat, dest_lng, search_radius_m + 500):
                    all_hazards.append(h)
            except Exception: pass
            
            for result in poi_data.get('results', []):
                pos = result.get('position', {})
                c_lat, c_lng = pos.get('lat'), pos.get('lon')
                if c_lat is None or c_lng is None: continue
                
                name = result.get('poi', {}).get('name') or result.get('address', {}).get('freeformAddress', 'Unknown')
                address = result.get('address', {}).get('freeformAddress', '')
                
                dist_from_original = haversine_distance(c_lat, c_lng, dest_lat, dest_lng)
                if dist_from_original < 80 or dist_from_original > 2500: continue
                
                # Check if this candidate is in a hazard zone
                in_hazard = False
                for h in all_hazards:
                    if haversine_distance(c_lat, c_lng, h['lat'], h['lng']) < (h.get('radius', 100) + 30):
                        if h.get('severity', 0) >= 0.6:
                            in_hazard = True; break
                if in_hazard: continue
                
                dist_from_user = haversine_distance(c_lat, c_lng, user_lat, user_lng)
                
                candidates.append({
                    'id': result.get('id', f'poi_{len(candidates)}'),
                    'name': name,
                    'address': address,
                    'lat': c_lat,
                    'lng': c_lng,
                    'category': category,
                    'dist_from_original_m': round(dist_from_original, 1),
                    'dist_from_user_m': round(dist_from_user, 1),
                    'phone': result.get('poi', {}).get('phone', ''),
                    'url': result.get('poi', {}).get('url', ''),
                })
            
            candidates.sort(key=lambda c: c['dist_from_original_m'])
            return jsonify({'success': True, 'candidates': candidates[:max_results]})
            
        except Exception as e:
            logger.error(f"Alternate destinations search error: {e}", exc_info=True)
            return jsonify({'success': False, 'error': str(e)}), 500

    # ============================================================================
    # EXISTING ENDPOINTS
    # ============================================================================
    
    @app.route("/api/locations", methods=['GET'])
    def get_locations():
        """Get saved locations"""
        try:
            if tomtom_router and tomtom_router.api_key:
                locations = tomtom_router.search_places("Pittsburgh")
                if locations:
                    formatted_locations = []
                    for i, loc in enumerate(locations[:5]):
                        formatted_locations.append({
                            'id': i + 1,
                            'name': loc.get('name', 'Unknown'),
                            'type': loc.get('type', 'Place'),
                            'lat': loc.get('lat', 40.4406),
                            'lng': loc.get('lng', -79.9959)
                        })
                    locations = formatted_locations
                else:
                    raise Exception("No locations found from API")
            else:
                raise Exception("TomTom not available")
        except:
            locations = [
                {'id': 1, 'name': 'University of Pittsburgh', 'type': 'Education', 'lat': 40.4440, 'lng': -79.9545},
                {'id': 2, 'name': 'Carnegie Museum of Art', 'type': 'Museum', 'lat': 40.4434, 'lng': -79.9498},
                {'id': 3, 'name': 'UPMC Presbyterian', 'type': 'Medical', 'lat': 40.4419, 'lng': -79.9620},
                {'id': 4, 'name': 'Pittsburgh City Hall', 'type': 'Government', 'lat': 40.4406, 'lng': -79.9959},
                {'id': 5, 'name': 'Carnegie Library', 'type': 'Library', 'lat': 40.4434, 'lng': -79.9533}
            ]
        
        return jsonify({
            'success': True,
            'locations': locations
        })
    
    @app.route("/api/routes/save", methods=['POST'])
    def save_route():
        """Save a route to history"""
        try:
            data = request.json
            logger.info(f"Route saved: {data.get('description', 'Untitled route')}")
            return jsonify({
                'success': True,
                'message': 'Route saved successfully'
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/reverse-geocode", methods=['POST'])
    def reverse_geocode():
        """Convert coordinates to address with multiple fallbacks"""
        try:
            data = request.json
            lat = float(data.get('lat', 40.4406))
            lng = float(data.get('lng', -79.9959))
            
            if tomtom_router and tomtom_router.api_key:
                try:
                    address = tomtom_router.reverse_geocode(lat, lng)
                    if address and not address.startswith(f"{lat:.4f}"):
                        return jsonify({
                            'success': True,
                            'address': address,
                            'coordinates': {'lat': lat, 'lng': lng},
                            'provider': 'tomtom'
                        })
                except Exception as e:
                    logger.warning(f"TomTom reverse geocode failed: {e}")
            
            if geoapify_client and geoapify_client.api_key:
                try:
                    address = geoapify_client.reverse_geocode(lat, lng)
                    if address and not address.startswith(f"{lat:.4f}"):
                        return jsonify({
                            'success': True,
                            'address': address,
                            'coordinates': {'lat': lat, 'lng': lng},
                            'provider': 'geoapify'
                        })
                except Exception as e:
                    logger.warning(f"Geoapify reverse geocode failed: {e}")
            
            addresses = [
                'University of Pittsburgh, Pittsburgh, PA',
                'Carnegie Mellon University, Pittsburgh, PA',
                'Downtown Pittsburgh, PA',
                'Squirrel Hill, Pittsburgh, PA',
                'Oakland, Pittsburgh, PA'
            ]
            
            import random
            return jsonify({
                'success': True,
                'address': random.choice(addresses),
                'coordinates': {'lat': lat, 'lng': lng},
                'provider': 'fallback'
            })
            
        except Exception as e:
            logger.error(f"Reverse geocode error: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/search-location", methods=['POST'])
    def search_location():
        """Search for locations by name with multiple fallbacks"""
        try:
            data = request.json
            query = data.get('query', '').strip()
            
            if not query or len(query) < 2:
                return jsonify({
                    'success': False,
                    'error': 'Query too short'
                }), 400
            
            if tomtom_router and tomtom_router.api_key:
                try:
                    lat = data.get('lat')
                    lng = data.get('lng')
                    results = tomtom_router.search_places(query, lat, lng)
                    if results:
                        return jsonify({
                            'success': True,
                            'results': results[:8],
                            'provider': 'tomtom'
                        })
                except Exception as e:
                    logger.warning(f"TomTom search failed: {e}")
            
            if geoapify_client and geoapify_client.api_key:
                try:
                    lat = data.get('lat')
                    lng = data.get('lng')
                    results = geoapify_client.search_places(query, lat, lng)
                    if results:
                        return jsonify({
                            'success': True,
                            'results': results[:8],
                            'provider': 'geoapify'
                        })
                except Exception as e:
                    logger.warning(f"Geoapify search failed: {e}")
            
            all_locations = [
                {'name': 'University of Pittsburgh', 'type': 'Education', 'lat': 40.4440, 'lng': -79.9545},
                {'name': 'Carnegie Museum', 'type': 'Museum', 'lat': 40.4434, 'lng': -79.9498},
                {'name': 'UPMC Presbyterian', 'type': 'Medical', 'lat': 40.4419, 'lng': -79.9620},
                {'name': 'Pittsburgh City Hall', 'type': 'Government', 'lat': 40.4406, 'lng': -79.9959},
                {'name': 'Carnegie Library', 'type': 'Library', 'lat': 40.4434, 'lng': -79.9533},
                {'name': 'Accessible Transit Center', 'type': 'Transport', 'lat': 40.4450, 'lng': -79.9500},
                {'name': 'City Park', 'type': 'Park', 'lat': 40.4500, 'lng': -79.9400},
                {'name': 'Shopping Center', 'type': 'Commercial', 'lat': 40.4600, 'lng': -79.9300},
                {'name': 'Train Station', 'type': 'Transport', 'lat': 40.4700, 'lng': -79.9200}
            ]
            
            results = [loc for loc in all_locations if query.lower() in loc['name'].lower()]
            
            return jsonify({
                'success': True,
                'results': results[:5],
                'provider': 'fallback'
            })
            
        except Exception as e:
            logger.error(f"Location search error: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/weather", methods=['POST'])
    def get_weather():
        """Get real weather data"""
        try:
            data = request.json
            lat = float(data.get('lat', 40.4406))
            lng = float(data.get('lng', -79.9959))
            
            if api_client and api_client.openweather_key:
                weather = api_client.get_weather_data(lat, lng)
                return jsonify({
                    'success': True,
                    'weather': weather,
                    'real_api_used': True
                })
            
            import random
            conditions = ['Clear', 'Cloudy', 'Rain', 'Snow']
            return jsonify({
                'success': True,
                'weather': {
                    'temperature': random.randint(50, 80),
                    'condition': random.choice(conditions),
                    'humidity': random.randint(30, 80),
                    'wind_speed': random.randint(0, 20)
                },
                'real_api_used': False
            })
        except Exception as e:
            logger.error(f"Weather API error: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/crime", methods=['POST'])
    def get_crime():
        """Get real crime data"""
        try:
            data = request.json
            lat = float(data.get('lat', 40.4406))
            lng = float(data.get('lng', -79.9959))
            
            if api_client and api_client.census_key:
                crime = api_client.get_crime_data(lat, lng)
                return jsonify({
                    'success': True,
                    'crime': crime,
                    'real_api_used': True
                })
            
            import random
            return jsonify({
                'success': True,
                'crime': {
                    'risk_level': random.choice(['low', 'medium', 'high']),
                    'incidents': random.randint(0, 10),
                    'safety_tips': ['Stay in well-lit areas', 'Be aware of surroundings']
                },
                'real_api_used': False
            })
        except Exception as e:
            logger.error(f"Crime API error: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/fema", methods=['POST'])
    def get_fema():
        """Get FEMA disaster data"""
        try:
            data = request.json
            lat = float(data.get('lat', 40.4406))
            lng = float(data.get('lng', -79.9959))
            
            if api_client:
                fema = api_client.get_fema_alerts(lat, lng)
                return jsonify({
                    'success': True,
                    'fema': fema,
                    'real_api_used': True
                })
            
            return jsonify({
                'success': True,
                'fema': {
                    'alerts': [],
                    'disasters': [],
                    'message': 'No active alerts in this area'
                },
                'real_api_used': False
            })
        except Exception as e:
            logger.error(f"FEMA API error: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/traffic", methods=['POST'])
    def get_traffic():
        """Get real traffic data"""
        try:
            data = request.json
            lat = float(data.get('lat', 40.4406))
            lng = float(data.get('lng', -79.9959))
            
            if api_client:
                traffic = api_client.get_traffic_data(lat, lng)
                return jsonify({
                    'success': True,
                    'traffic': traffic,
                    'real_api_used': True
                })
            
            import random
            return jsonify({
                'success': True,
                'traffic': {
                    'congestion': random.randint(0, 100),
                    'level': random.choice(['light', 'moderate', 'heavy']),
                    'message': 'Normal traffic conditions'
                },
                'real_api_used': False
            })
        except Exception as e:
            logger.error(f"Traffic API error: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/session/create", methods=['GET'])
    def generate_session_id():
        uuid1 = str(uuid.uuid1())
        logger.info(f"Created session: {uuid1}")
        sesh_manager.create_session(session_id=uuid1)
        return jsonify({
            "session_id": uuid1
        })

    @app.route("/api/auth/signup", methods=['POST'])
    def signup():
        """User registration"""
        try:
            data = request.json
            name = data.get('name', '').strip()
            email = data.get('email', '').strip()
            password = data.get('password', '')

            if name and email and password:
                return jsonify({
                    'success': True,
                    'token': 'demo-token-' + str(int(time.time())),
                    'user': {
                        'name': name,
                        'email': email,
                        'role': 'user'
                    }
                })
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    app.secret_key = os.environ.get("SECRET_KEY")
    oauth = OAuth(app)

    google = oauth.register(
        name='google',
        client_id=os.environ.get("GOOGLE_CLIENT_ID"),
        client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
        server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
        client_kwargs={
            'scope': 'openid email profile'
        }
    )

    @app.route('/api/auth/login', methods=['GET'])
    def login():
        return google.authorize_redirect(
            redirect_uri=url_for('callback', _external=True)
        )

    @app.route('/api/callback')
    def callback():
        token = google.authorize_access_token()
        user_info = token.get("userinfo")
        return redirect("http://localhost:3000/dashboard")
    
    return app

# ============================================================================
# SOCKETIO SETUP
# ============================================================================

def setup_socketio_handlers(socketio_instance, app):
    """Setup SocketIO event handlers with combined features"""
    
    @socketio_instance.on('connect')
    def handle_connect():
        logger.info(f"Client connected: {request.sid}")
        emit('connected', {'message': 'Connected to Tryver tracking server'})
    
    @socketio_instance.on('disconnect')
    def handle_disconnect():
        logger.info(f"Client disconnected: {request.sid}")
    
    @socketio_instance.on('track_position')
    def handle_track_position(data):
        """Handle position tracking updates"""
        try:
            user_id = data.get('user_id', request.sid)
            lat = float(data['lat'])
            lng = float(data['lng'])
            
            safety_ai_instance = get_safety_ai_instance()
            if safety_ai_instance:
                safety_result = safety_ai_instance.predict_safety_score(lat, lng)
                
                weather = None
                crime = None
                if api_client:
                    try:
                        weather = api_client.get_weather_data(lat, lng)
                        crime = api_client.get_crime_data(lat, lng)
                    except:
                        pass
                
                emit('position_update', {
                    'user_id': user_id,
                    'position': {'lat': lat, 'lng': lng},
                    'safety': safety_result,
                    'weather': weather,
                    'crime': crime,
                    'timestamp': datetime.now().isoformat()
                }, broadcast=True)
            else:
                emit('position_update', {
                    'user_id': user_id,
                    'position': {'lat': lat, 'lng': lng},
                    'safety': {'safety_score': 0.7, 'risk_level': 'medium'},
                    'timestamp': datetime.now().isoformat()
                }, broadcast=True)
                
        except Exception as e:
            logger.error(f"Error handling position tracking: {e}")
            emit('error', {'message': str(e)})
    
    @socketio_instance.on('request_route')
    def handle_request_route(data):
        """Handle route calculation requests"""
        try:
            start_lat = float(data['start_lat'])
            start_lng = float(data['start_lng'])
            dest_lat = float(data['dest_lat'])
            dest_lng = float(data['dest_lng'])
            
            accessibility_needs = data.get('accessibility_needs', [])
            travel_mode = data.get('travel_mode', 'pedestrian')
            start_time_str = data.get('start_time')
            
            # Parse start time for transit
            start_time = None
            if start_time_str:
                try:
                    if HAS_DATEUTIL:
                        start_time = date_parser.parse(start_time_str)
                    else:
                        if start_time_str.endswith('Z'):
                            start_time_str = start_time_str[:-1] + '+00:00'
                        start_time = datetime.fromisoformat(start_time_str)
                except ValueError:
                    start_time = datetime.now()
            else:
                start_time = datetime.now()
            
            # Try GTFS transit first if transit mode
            if travel_mode == 'transit' and transit_router:
                try:
                    routes = transit_router.find_route(
                        start_lat, start_lng,
                        dest_lat, dest_lng,
                        start_time
                    )
                    if routes:
                        route = routes[0]
                        route_coords = []
                        for step in route.get('steps', []):
                            if 'to_location' in step:
                                route_coords.append({'lat': step['to_location']['lat'], 'lng': step['to_location']['lon']})
                        
                        safety_ai_instance = get_safety_ai_instance()
                        if safety_ai_instance:
                            safety_result = safety_ai_instance.calculate_route_safety(route_coords)
                            safety_dict = {
                                'overall_safety': safety_result.get('overall_safety', 0.8),
                                'risk_level': safety_result.get('risk_level', 'low'),
                                'recommendations': safety_result.get('recommendations', ['Route appears safe'])
                            }
                        else:
                            safety_dict = {
                                'overall_safety': 0.8,
                                'risk_level': 'low',
                                'recommendations': ['Route appears safe']
                            }
                        
                        emit('route_calculated', {
                            'route': route_coords,
                            'route_details': route,
                            'safety': safety_dict,
                            'timestamp': datetime.now().isoformat(),
                            'real_api_used': True,
                            'travel_mode': 'transit',
                            'provider': 'GTFS'
                        })
                        return
                except Exception as e:
                    logger.warning(f"GTFS transit routing in WebSocket failed: {e}")
            
            # Try Google Maps transit if transit mode
            if travel_mode == 'transit' and google_router:
                routes = google_router.get_transit_route(start_lat, start_lng, dest_lat, dest_lng)
                if routes:
                    route_data = routes[0]
                    waypoints = route_data.get('waypoints', [])
                    if waypoints:
                        route_coords = [{'lat': p[0], 'lng': p[1]} for p in waypoints]
                        
                        safety_ai_instance = get_safety_ai_instance()
                        if safety_ai_instance:
                            safety_result = safety_ai_instance.calculate_route_safety(route_coords)
                            safety_dict = {
                                'overall_safety': safety_result.get('overall_safety', 0.8),
                                'risk_level': safety_result.get('risk_level', 'low'),
                                'recommendations': safety_result.get('recommendations', ['Route appears safe'])
                            }
                        else:
                            safety_dict = {
                                'overall_safety': 0.8,
                                'risk_level': 'low',
                                'recommendations': ['Route appears safe']
                            }
                        
                        emit('route_calculated', {
                            'route': route_coords,
                            'route_details': route_data,
                            'safety': safety_dict,
                            'timestamp': datetime.now().isoformat(),
                            'real_api_used': True,
                            'travel_mode': 'transit',
                            'provider': 'Google Maps'
                        })
                        return
            
            # Try TomTom for pedestrian
            if tomtom_router and tomtom_router.api_key:
                route_result = tomtom_router.calculate_route(
                    start_lat, start_lng, dest_lat, dest_lng,
                    accessibility_needs=accessibility_needs if accessibility_needs else None
                )
                
                if route_result:
                    route_coords = [{'lat': p[0], 'lng': p[1]} for p in route_result['points']]
                    
                    safety_ai_instance = get_safety_ai_instance()
                    if safety_ai_instance:
                        safety_result = safety_ai_instance.calculate_route_safety(route_coords)
                        safety_dict = {
                            'overall_safety': safety_result.get('overall_safety', 0.8),
                            'risk_level': safety_result.get('risk_level', 'low'),
                            'recommendations': safety_result.get('recommendations', ['Route appears safe'])
                        }
                    else:
                        safety_dict = {
                            'overall_safety': 0.8,
                            'risk_level': 'low',
                            'recommendations': ['Route appears safe']
                        }
                    
                    emit('route_calculated', {
                        'route': route_coords,
                        'route_details': route_result,
                        'safety': safety_dict,
                        'timestamp': datetime.now().isoformat(),
                        'real_api_used': True,
                        'travel_mode': 'pedestrian',
                        'provider': 'TomTom'
                    })
                    return
            
            # Fallback
            safety_ai_instance = get_safety_ai_instance()
            if safety_ai_instance:
                route_coords = [
                    {'lat': start_lat, 'lng': start_lng},
                    {'lat': (start_lat + dest_lat) / 2, 'lng': (start_lng + dest_lng) / 2},
                    {'lat': dest_lat, 'lng': dest_lng}
                ]
                
                safety_result = safety_ai_instance.calculate_route_safety(route_coords)
                safety_dict = {
                    'overall_safety': safety_result.get('overall_safety', 0.7),
                    'risk_level': safety_result.get('risk_level', 'medium'),
                    'recommendations': safety_result.get('recommendations', ['Estimated route - use caution'])
                }
            else:
                safety_dict = {
                    'overall_safety': 0.7,
                    'risk_level': 'medium',
                    'recommendations': ['Estimated route - use caution']
                }
                route_coords = [
                    {'lat': start_lat, 'lng': start_lng},
                    {'lat': dest_lat, 'lng': dest_lng}
                ]
            
            emit('route_calculated', {
                'route': route_coords,
                'safety': safety_dict,
                'timestamp': datetime.now().isoformat(),
                'real_api_used': False,
                'travel_mode': travel_mode,
                'provider': 'fallback'
            })
                
        except Exception as e:
            logger.error(f"Error handling route request: {e}")
            emit('error', {'message': str(e)})

# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def open_browser():
    """Open web browser to the application"""
    time.sleep(2)
    webbrowser.open('http://localhost:3000')
    webbrowser.open('http://localhost:5000/api/hello')

def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description='Tryver Safety Routing System')
    parser.add_argument('--train', action='store_true', help='Skip interactive prompts and train model')
    parser.add_argument('--no-train', action='store_true', help='Skip training even if model doesnt exist')
    parser.add_argument('--no-browser', action='store_true', help='Dont open browser on startup')
    parser.add_argument('--host', default='127.0.0.1', help='Flask host address')
    parser.add_argument('--port', type=int, default=5000, help='Flask port')
    parser.add_argument('--debug', action='store_true', help='Enable debug mode')
    
    args = parser.parse_args()
    
    print("\n" + "="*60)
    print("TRYVER - ADVANCED SAFETY ROUTING SYSTEM")
    print("="*60)
    print(f"Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Python: {sys.version.split()[0]}")
    print(f"Platform: {sys.platform}")
    print(f"TomTom API: {'✅ Available' if tomtom_router and tomtom_router.api_key else '❌ Not Available'}")
    print(f"Google Maps API: {'✅ Available' if GOOGLE_MAPS_AVAILABLE else '❌ Not Available'}")
    print(f"Google Routing: {'✅ Available' if GOOGLE_ROUTING_AVAILABLE else '❌ Not Available'}")
    print(f"Real API Client: {'✅ Available' if api_client else '❌ Not Available'}")
    print(f"Geoapify API: {'✅ Available' if geoapify_client and geoapify_client.api_key else '❌ Not Available'}")
    print(f"GTFS Transit: {'✅ Available' if transit_router else '❌ Not Available'}")
    if transit_router:
        print(f"  - Stops: {len(transit_router.gtfs.stops)}")
        print(f"  - Trips: {len(transit_router.gtfs.trips)}")
    print("="*60)
    
    # Initialize safety AI
    safety_ai_instance = get_safety_ai_instance()
    
    # Check model status and train if needed
    should_train = False
    
    if args.train:
        should_train = True
        print("\n⏩ Skipping prompts - training model as requested...")
    elif args.no_train:
        should_train = False
        print("\n⏩ Skipping training as requested...")
    elif safety_ai_instance:
        should_train = check_model_status()
    
    # Train model if needed
    if should_train and safety_ai_instance:
        success = train_model_interactive()
        if not success and not safety_ai_instance.is_trained:
            print("\n⚠️  Model not trained, some features may be limited")
    
    # Create Flask app with SocketIO
    app = Flask(__name__, static_folder='../frontend/dist', static_url_path='/')
    CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)
    
    # Initialize SocketIO
    global socketio, tracker_instance
    socketio = SocketIO(app, 
                    cors_allowed_origins="*",
                    async_mode='threading',
                    logger=False,
                    engineio_logger=False,
                    ping_timeout=60,
                    ping_interval=25)
    
    try:
        from voice_handler import init_voice_handler
        init_voice_handler(app, socketio)
        logger.info("Voice handler registered successfully")
    except Exception as e:
        logger.warning(f"Voice handler failed to initialize (non-critical): {e}")
        logger.warning("Voice features will be unavailable. See voice_handler.py for setup.")
    
    
    # Initialize the RealTimeTracker with valid parameters
    try:
        from real_time_tracker import RealTimeTracker
        tracker_instance = RealTimeTracker(socketio, app)
        logger.info("RealTimeTracker initialized successfully")
    except ImportError as e:
        logger.warning(f"Could not import RealTimeTracker: {e}")
        tracker_instance = None
    except Exception as e:
        logger.error(f"Error initializing RealTimeTracker: {e}")
        tracker_instance = None
    
    # Initialize EMERGENCY DATA FETCHER
    try:
        from emergency_data_fetcher import get_emergency_fetcher
        emergency_fetcher = get_emergency_fetcher()
        logger.info("✅ Emergency data fetcher initialized successfully")
        
        # Get initial stats
        stats = emergency_fetcher.get_summary_stats()
        if stats['total'] > 0:
            print(f"\n📢 911 Emergency Monitor Active")
            print(f"   Active emergencies: {stats['total']}")
            print(f"   Last update: {stats.get('last_update', 'N/A')}")
            print(f"   Types: {', '.join([f'{k}: {v}' for k, v in stats['by_type'].items()])}")
    except ImportError as e:
        logger.warning(f"⚠️ Emergency data fetcher not available: {e}")
        print("\n⚠️ 911 Emergency data fetcher not available - install pandas and apscheduler")
        print("   Run: pip install pandas apscheduler")
    except Exception as e:
        logger.error(f"❌ Failed to initialize emergency data fetcher: {e}")
        print(f"\n❌ Failed to initialize 911 emergency data: {e}")
    
    # Add model endpoints
    app = add_model_endpoints(app)
    
    # Setup SocketIO handlers
    setup_socketio_handlers(socketio, app)

    # SOCKETIO HANDLERS
    @socketio.on("connect")
    def handle_connect():
        logger.info(f"Websocket connected: {request.sid}")

    @socketio.on("location-update")
    def update_location(data):
        """Handle location updates from clients"""
        session_id = request.args.get("session_id")
        if not session_id:
            return
        
        session_state = sesh_manager.get_session_state(session_id)
        if not session_state:
            sesh_manager.create_session(session_id)
            session_state = sesh_manager.get_session_state(session_id)

        new_lat = data["lat"]
        new_lng = data["lng"]

        updated_coords = np.array([new_lat, new_lng])

        if session_state.lng is None or session_state.lat is None:
            session_state.update_location(new_lat, new_lng)
            return
        
        old_coords = np.array([session_state.lat, session_state.lng])

        if np.linalg.norm(updated_coords - old_coords) > 5:
            session_state.update_location(new_lat, new_lng)
            
            # Check for nearby emergencies when user moves significantly
            try:
                from emergency_data_fetcher import get_emergency_fetcher
                fetcher = get_emergency_fetcher()
                nearby_emergencies = fetcher.get_emergencies_in_area(new_lat, new_lng, radius_meters=500)
                
                if nearby_emergencies:
                    socketio.emit('nearby_emergencies', {
                        'count': len(nearby_emergencies),
                        'emergencies': nearby_emergencies,
                        'user_location': {'lat': new_lat, 'lng': new_lng}
                    }, room=request.sid)
                    logger.info(f"User {session_id} has {len(nearby_emergencies)} nearby emergencies")
            except Exception as e:
                logger.debug(f"Could not check nearby emergencies: {e}")
    
    # Serve frontend
    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve(path):
        if path != "" and os.path.exists(f'../frontend/dist/{path}'):
            return send_from_directory('../frontend/dist', path)
        else:
            return send_from_directory('../frontend/dist', 'index.html')
    
    # Start browser in background
    if not args.no_browser:
        browser_thread = threading.Thread(target=open_browser, daemon=True)
        browser_thread.start()
    
    # Create necessary directories
    os.makedirs('models', exist_ok=True)
    os.makedirs('cache', exist_ok=True)
    
    # Start combined server
    print("\n" + "="*60)
    print("STARTING TRYVER SERVER")
    print("="*60)
    print(f"Server: http://{args.host}:{args.port}")
    print(f"API Endpoints: http://{args.host}:{args.port}/api/*")
    print(f"WebSocket: ws://{args.host}:{args.port}")
    print(f"Frontend: http://localhost:3000")
    
    if safety_ai_instance:
        print(f"Model Status: {'✅ Trained' if safety_ai_instance.is_trained else '⚠️ Not trained'}")
        if safety_ai_instance.is_trained and safety_ai_instance.training_metrics:
            score = safety_ai_instance.training_metrics.get('test_score', 0)
            if score is not None:
                print(f"Model Accuracy: {score:.2%}")
    
    if transit_router:
        print(f"GTFS Status: ✅ Loaded with {len(transit_router.gtfs.stops)} stops, {len(transit_router.gtfs.trips)} trips")
    
    # Print emergency monitor status
    try:
        from emergency_data_fetcher import get_emergency_fetcher
        fetcher = get_emergency_fetcher()
        stats = fetcher.get_summary_stats()
        if stats['total'] > 0:
            print(f"911 Monitor: ✅ Active with {stats['total']} current emergencies")
        else:
            print(f"911 Monitor: ✅ Active (no active emergencies at this time)")
    except:
        print(f"911 Monitor: ⚠️ Not available")
    
    print("="*60)
    print("Press Ctrl+C to stop the server")
    print("="*60 + "\n")
    
    try:
        socketio.run(app,
                    host=args.host,
                    port=args.port,
                    debug=False,
                    use_reloader=False,
                    allow_unsafe_werkzeug=True)
    except KeyboardInterrupt:
        print("\n\n🛑 Server stopped by user")
        
        # Clean shutdown for emergency fetcher
        try:
            from emergency_data_fetcher import get_emergency_fetcher
            fetcher = get_emergency_fetcher()
            if hasattr(fetcher, 'scheduler') and fetcher.scheduler:
                fetcher.scheduler.shutdown()
                print("✅ Emergency fetcher shutdown gracefully")
        except:
            pass
            
    except Exception as e:
        logger.error(f"Server error: {e}", exc_info=True)
        print(f"\n❌ Server error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()