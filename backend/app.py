"""
Main entry point for Tryver Safety Routing System
Combines old and new features with real API integration.
"""

import os
import sys
import time
import argparse
import logging
from datetime import datetime
from pathlib import Path
import uuid
import math
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

# Initialize routers and API clients
if TOMTOM_AVAILABLE:
    tomtom_router = TomTomRouter()
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

safety_ai = None

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
                'google_maps': GOOGLE_MAPS_AVAILABLE
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
                    'google_routing_available': GOOGLE_ROUTING_AVAILABLE
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
    
    @app.route("/api/calculate-route", methods=['POST'])
    def calculate_route():
        """Calculate accessible route between two points (Enhanced endpoint)"""
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
            
            if not all([start_lat, start_lng, end_lat, end_lng]):
                return jsonify({
                    'success': False,
                    'error': 'Missing coordinates'
                }), 400
            
            # Extract travel mode
            travel_mode = data.get('travel_mode', 'pedestrian')
            
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
            
            # TRY 1: Google Maps Transit (if travel_mode is transit)
            if travel_mode == 'transit' and google_router:
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
            
            # TRY 2: TomTom API (for pedestrian routes)
            if not route_result and tomtom_router and tomtom_router.api_key and travel_mode != 'transit':
                try:
                    logger.info(f"Attempting TomTom route from {start_lat},{start_lng} to {end_lat},{end_lng}")
                    route_result = tomtom_router.calculate_route(
                        float(start_lat), float(start_lng),
                        float(end_lat), float(end_lng),
                        travel_mode="pedestrian",
                        avoid_hazards=True,
                        accessibility_needs=accessibility_needs if accessibility_needs else None
                    )
                    if route_result and route_result.get('points') and len(route_result['points']) > 1:
                        provider_used = "TomTom"
                        logger.info("TomTom route successful")
                except Exception as e:
                    logger.warning(f"TomTom API failed: {e}")
                    error_messages.append(f"TomTom: {str(e)}")
            
            # If any provider succeeded, process and return the route
            if route_result:
                # Convert points to coordinate objects
                route_coords = [{'lat': p[0], 'lng': p[1]} for p in route_result['points']]
                
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
                if safety_ai_instance and safety_ai_instance.is_trained:
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
                distance_val = route_result['distance_meters']
                duration_val = route_result['duration_seconds']
                
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
                
                response_data = {
                    'success': True,
                    'route': {
                        'distance': distance_str,
                        'distance_meters': distance_val,
                        'duration': duration_str,
                        'duration_seconds': duration_val,
                        'steps': route_result.get('instructions', []),
                        'coordinates': route_coords,
                        'points': route_result['points'],
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
                if travel_mode == 'transit' and 'transit_steps' in route_result:
                    response_data['route']['transit_details'] = {
                        'steps': route_result.get('transit_steps', []),
                        'total_transit_time': route_result.get('total_transit_time', 0),
                        'total_walking_time': route_result.get('total_walking_time', 0)
                    }
                
                # Update session with route data
                if session_id:
                    sesh_manager.update_session(
                        session_id, 
                        route=route_result, 
                        score=safety_dict.get('overall_safety', 0.8), 
                        prefs=accessibility_preferences
                    )
                
                # Try to cache the response
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
                        cached_result = vdb.compare(query_vector)
                        
                        if cached_result and isinstance(cached_result, dict):
                            cached_value = cached_result.get('value')
                            if cached_value:
                                logger.info("Using cached route result")
                                return jsonify(cached_value)
                        
                        vdb.insert(query_vector, response_data)
                except Exception as e:
                    logger.warning(f"Caching failed (non-critical): {e}")
                
                return jsonify(response_data)
            
            # If ALL providers failed, use fallback
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
            
            response_data = {
                'success': True,
                'route': {
                    'distance': distance_str,
                    'distance_meters': approx_distance,
                    'duration': duration_str,
                    'duration_seconds': approx_duration,
                    'steps': [],
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
    
    # ============================================================================
    # NEW TRANSIT AND OBSTRUCTION ENDPOINTS
    # ============================================================================

    @app.route("/api/area-obstructions", methods=['POST'])
    def get_area_obstructions():
        """Get real obstructions in a specific area using TomTom Traffic Incidents API"""
        try:
            data = request.json
            lat = float(data.get('lat', 40.4406))
            lng = float(data.get('lng', -79.9959))
            radius = float(data.get('radius', 2000))

            construction_zones = []
            hazards = []

            tomtom_key = os.getenv('TOMTOM_API_KEY') or (tomtom_router.api_key if tomtom_router else None)
            if tomtom_key:
                try:
                    km = radius / 1000.0
                    delta_lat = km * 0.009
                    delta_lng = km * 0.012

                    min_lat = lat - delta_lat
                    max_lat = lat + delta_lat
                    min_lng = lng - delta_lng
                    max_lng = lng + delta_lng

                    # IMPORTANT: fields param must NOT be in an f-string or Python eats the braces
                    fields_param = "{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to}}}"

                    incidents_url = (
                        f"https://api.tomtom.com/traffic/services/5/incidentDetails"
                        f"?key={tomtom_key}"
                        f"&bbox={min_lng},{min_lat},{max_lng},{max_lat}"
                        f"&fields={fields_param}"
                        f"&language=en-US"
                        f"&timeValidityFilter=present"
                    )

                    logger.info(f"Fetching TomTom incidents for bbox: {min_lat},{min_lng} to {max_lat},{max_lng}")
                    logger.info(f"TomTom incidents URL: {incidents_url}")
                    resp = requests.get(incidents_url, timeout=8)

                    if resp.status_code == 200:
                        incidents_data = resp.json()
                        incidents = incidents_data.get('incidents', [])
                        logger.info(f"TomTom returned {len(incidents)} incidents. Keys: {list(incidents_data.keys())}")

                        if len(incidents) == 0:
                            logger.info(f"TomTom response (first 500 chars): {resp.text[:500]}")

                        construction_categories = {7, 8, 9}
                        hazard_categories = {1, 2, 3, 4, 5, 10, 11, 14}

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
                                    'end_time': props.get('endTime', '')
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
                                    'icon_category': icon_cat
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
                                    'icon_category': icon_cat
                                })

                        logger.info(f"Parsed {len(construction_zones)} construction zones, {len(hazards)} hazards from TomTom")
                    else:
                        logger.warning(f"TomTom incidents API returned {resp.status_code}: {resp.text[:300]}")

                except Exception as e:
                    logger.error(f"TomTom incidents API error: {e}", exc_info=True)

            return jsonify({
                'success': True,
                'construction_zones': construction_zones,
                'hazards': hazards,
                'area_center': {'lat': lat, 'lng': lng},
                'radius_meters': radius,
                'source': 'tomtom_incidents' if (construction_zones or hazards) else 'none',
                'total_incidents': len(construction_zones) + len(hazards)
            })

        except Exception as e:
            logger.error(f"Error getting area obstructions: {e}", exc_info=True)
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
        
    @app.route("/api/route-alternatives", methods=['POST', 'GET', 'OPTIONS'])
    def get_route_alternatives():
        """Get multiple route alternatives including different transit options"""
        # Handle OPTIONS preflight
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
            
            # Use the global tracker instance
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
            
            # Format for frontend
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
    
    @app.route("/api/check-obstructions", methods=['POST', 'GET', 'OPTIONS'])
    def check_obstructions():
        """Check for obstructions along a route"""
        # Handle OPTIONS preflight
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
            
            if not route_coords:
                return jsonify({
                    'success': False,
                    'error': 'No route coordinates provided'
                }), 400
            
            # Handle different coordinate formats
            waypoints = []
            for coord in route_coords:
                # Check if coord is a dictionary with lat/lng
                if isinstance(coord, dict):
                    if 'lat' in coord and 'lng' in coord:
                        waypoints.append((coord['lat'], coord['lng']))
                    elif 'latitude' in coord and 'longitude' in coord:
                        waypoints.append((coord['latitude'], coord['longitude']))
                    else:
                        logger.warning(f"Unknown coordinate format: {coord}")
                        continue
                # Check if coord is a list/tuple of two values
                elif isinstance(coord, (list, tuple)) and len(coord) >= 2:
                    waypoints.append((coord[0], coord[1]))
                else:
                    logger.warning(f"Unsupported coordinate type: {type(coord)}")
                    continue
            
            if not waypoints:
                return jsonify({
                    'success': False,
                    'error': 'No valid coordinates found'
                }), 400
            
            # Use the global tracker instance
            global tracker_instance
            
            if tracker_instance is None:
                try:
                    from real_time_tracker import RealTimeTracker
                    tracker_instance = RealTimeTracker(None, None)
                    logger.warning("Created temporary tracker for obstruction checking")
                except ImportError as e:
                    logger.warning(f"RealTimeTracker not available: {e}")
                    return jsonify({
                        'success': True,
                        'obstructions': {
                            'has_obstruction': False,
                            'construction_zones': [],
                            'hazards': []
                        }
                    })
            
            # Check obstructions
            obstructions = tracker_instance.check_route_obstructions(waypoints)
            
            # Format for frontend
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
                    'severity': hazard.get('severity', 0.5)
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
    
    # ============================================================================
    # EXISTING ENDPOINTS (keep all existing ones)
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
                            'travel_mode': 'transit'
                        })
                        return
            
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
                        'travel_mode': 'pedestrian'
                    })
                    return
            
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
                'travel_mode': travel_mode
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
                       logger=True,
                       engineio_logger=args.debug)
    
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
    
    # Add model endpoints
    app = add_model_endpoints(app)
    
    # Setup SocketIO handlers
    setup_socketio_handlers(socketio, app)

    # ============================================================================
    # SOCKETIO HANDLERS
    # ============================================================================

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
    
    # Create models directory
    os.makedirs('models', exist_ok=True)
    
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
    
    print("="*60)
    print("Press Ctrl+C to stop the server")
    print("="*60 + "\n")
    
    try:
        socketio.run(app,
                    host=args.host,
                    port=args.port,
                    debug=args.debug,
                    use_reloader=False,
                    allow_unsafe_werkzeug=True)
    except KeyboardInterrupt:
        print("\n\nServer stopped by user")
    except Exception as e:
        logger.error(f"Server error: {e}", exc_info=True)
        print(f"\n❌ Server error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()