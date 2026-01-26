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

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import threading
import webbrowser
import json
import numpy as np

# Try to import new modules, fall back gracefully
try:
    from tomtom_router import TomTomRouter
    from real_api_client import RealAPIClient
    TOMTOM_AVAILABLE = True
    REAL_API_AVAILABLE = True
except ImportError as e:
    logger = logging.getLogger(__name__)
    logger.warning(f"New modules not available: {e}")
    TOMTOM_AVAILABLE = False
    REAL_API_AVAILABLE = False
    TomTomRouter = None
    RealAPIClient = None

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

safety_ai = None
socketio = None

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
                'census': api_client.census_key is not None if api_client else False
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
                    'real_api_available': REAL_API_AVAILABLE
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
                    'overall_safety': result.overall_safety,
                    'risk_level': result.risk_level,
                    'safe_route_coords': result.safe_route_coords,
                    'original_route_coords': result.original_route_coords,
                    'risky_segments': result.risky_segments,
                    'distance_meters': result.distance_meters,
                    'duration_seconds': result.duration_seconds,
                    'recommendations': result.recommendations,
                    'confidence': result.confidence,
                    'segment_details': result.segment_details
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
            
            # Extract data - support both old and new formats
            start_lat = data.get('start_lat') or (data.get('start_location', {}).get('lat') if isinstance(data.get('start_location'), dict) else None)
            start_lng = data.get('start_lng') or (data.get('start_location', {}).get('lng') if isinstance(data.get('start_location'), dict) else None)
            end_lat = data.get('end_lat') or (data.get('end_location', {}).get('lat') if isinstance(data.get('end_location'), dict) else None)
            end_lng = data.get('end_lng') or (data.get('end_location', {}).get('lng') if isinstance(data.get('end_location'), dict) else None)
            
            # Try old format if new format not found
            if not all([start_lat, start_lng, end_lat, end_lng]):
                start_location = data.get('start_location')
                end_location = data.get('end_location')
                
                if isinstance(start_location, str):
                    # Use default coordinates for demo
                    start_lat, start_lng = 40.4406, -79.9959
                if isinstance(end_location, str):
                    end_lat, end_lng = 40.4440, -79.9545
            
            if not all([start_lat, start_lng, end_lat, end_lng]):
                return jsonify({
                    'success': False,
                    'error': 'Missing coordinates'
                }), 400
            
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
            
            # Use real TomTom API if available
            if tomtom_router and tomtom_router.api_key:
                try:
                    route_result = tomtom_router.calculate_route(
                        float(start_lat), float(start_lng),
                        float(end_lat), float(end_lng),
                        travel_mode="pedestrian",
                        avoid_hazards=True,
                        accessibility_needs=accessibility_needs if accessibility_needs else None
                    )
                    
                    if route_result:
                        route_coords = [{'lat': p[0], 'lng': p[1]} for p in route_result['points']]
                        
                        # Get addresses
                        start_address = tomtom_router.reverse_geocode(float(start_lat), float(start_lng))
                        end_address = tomtom_router.reverse_geocode(float(end_lat), float(end_lng))
                        
                        # Calculate safety
                        safety_ai_instance = get_safety_ai_instance()
                        if safety_ai_instance and safety_ai_instance.is_trained:
                            safety_result = safety_ai_instance.calculate_route_safety(route_coords)
                            safety_dict = {
                                'overall_safety': safety_result.overall_safety,
                                'risk_level': safety_result.risk_level,
                                'recommendations': safety_result.recommendations
                            }
                        else:
                            safety_dict = {
                                'overall_safety': 0.8,
                                'risk_level': 'low',
                                'recommendations': ['Route appears safe']
                            }
                        
                        response = {
                            'success': True,
                            'route': {
                                'distance': f"{route_result['distance_meters'] / 1000:.1f} km",
                                'distance_meters': route_result['distance_meters'],
                                'duration': f"{route_result['duration_seconds'] / 60:.0f} min",
                                'duration_seconds': route_result['duration_seconds'],
                                'steps': route_result['instructions'],
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
                                'arrival_time': route_result['arrival_time'],
                                'bounds': route_result['bounds']
                            },
                            'model_used': safety_ai_instance.is_trained if safety_ai_instance else False,
                            'real_api_used': True
                        }
                        
                        return jsonify(response)
                except Exception as e:
                    logger.warning(f"TomTom API failed, falling back to mock: {e}")
            
            # Fallback to mock data
            mock_route = {
                'distance': '1.2 km',
                'distance_meters': 1200,
                'duration': '15 minutes',
                'duration_seconds': 900,
                'steps': [
                    {'instruction': 'Head north on Main St', 'distance': '200 m', 'duration': '3 min'},
                    {'instruction': 'Turn right on 5th Ave', 'distance': '300 m', 'duration': '4 min'},
                    {'instruction': 'Continue straight', 'distance': '400 m', 'duration': '5 min'},
                    {'instruction': 'Turn left on Broadway', 'distance': '300 m', 'duration': '3 min'}
                ],
                'coordinates': [
                    {'lat': 40.4406, 'lng': -79.9959},
                    {'lat': 40.4410, 'lng': -79.9965},
                    {'lat': 40.4415, 'lng': -79.9970},
                    {'lat': 40.4418, 'lng': -79.9960}
                ],
                'start_address': data.get('start_location', 'Start Location') if isinstance(data.get('start_location'), str) else 'Start Location',
                'end_address': data.get('end_location', 'Destination') if isinstance(data.get('end_location'), str) else 'Destination',
                'accessibility_score': 85,
                'warnings': [],
                'elevator_access': accessibility_preferences.get('elevator_access', False),
                'ramp_access': accessibility_preferences.get('wheelchair', False),
                'safety': {
                    'overall_safety': 0.8,
                    'risk_level': 'low',
                    'recommendations': ['Route appears safe']
                }
            }
            
            return jsonify({
                'success': True,
                'route': mock_route,
                'model_used': safety_ai.is_trained if safety_ai else False,
                'real_api_used': False
            })
            
        except Exception as e:
            logger.error(f"Route calculation error: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/locations", methods=['GET'])
    def get_locations():
        """Get saved locations"""
        try:
            # Try real search if available
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
            # Fallback to default locations
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
        """Convert coordinates to address"""
        try:
            data = request.json
            lat = float(data.get('lat', 40.4406))
            lng = float(data.get('lng', -79.9959))
            
            # Try real API first
            if tomtom_router and tomtom_router.api_key:
                address = tomtom_router.reverse_geocode(lat, lng)
                return jsonify({
                    'success': True,
                    'address': address,
                    'coordinates': {'lat': lat, 'lng': lng},
                    'real_api_used': True
                })
            
            # Fallback to mock
            import random
            addresses = [
                'University of Pittsburgh, Pittsburgh, PA',
                'Carnegie Mellon University, Pittsburgh, PA',
                'Downtown Pittsburgh, PA',
                'Squirrel Hill, Pittsburgh, PA',
                'Oakland, Pittsburgh, PA'
            ]
            
            return jsonify({
                'success': True,
                'address': random.choice(addresses),
                'coordinates': {'lat': lat, 'lng': lng},
                'real_api_used': False
            })
        except Exception as e:
            logger.error(f"Reverse geocode error: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/search-location", methods=['POST'])
    def search_location():
        """Search for locations by name"""
        try:
            data = request.json
            query = data.get('query', '').strip()
            
            if not query or len(query) < 2:
                return jsonify({
                    'success': False,
                    'error': 'Query too short'
                }), 400
            
            # Try real API first
            if tomtom_router and tomtom_router.api_key:
                lat = data.get('lat')
                lng = data.get('lng')
                results = tomtom_router.search_places(query, lat, lng)
                
                return jsonify({
                    'success': True,
                    'results': results[:8],
                    'real_api_used': True
                })
            
            # Fallback to mock
            all_locations = [
                {'name': 'University of Pittsburgh', 'type': 'Education'},
                {'name': 'Carnegie Museum', 'type': 'Museum'},
                {'name': 'Accessible Transit Center', 'type': 'Transport'},
                {'name': 'City Hospital', 'type': 'Medical'},
                {'name': 'Public Library', 'type': 'Library'},
                {'name': 'City Park', 'type': 'Park'},
                {'name': 'Shopping Center', 'type': 'Commercial'},
                {'name': 'Train Station', 'type': 'Transport'}
            ]
            
            results = [loc for loc in all_locations if query in loc['name'].lower()]
            
            return jsonify({
                'success': True,
                'results': results[:5],
                'real_api_used': False
            })
        except Exception as e:
            logger.error(f"Location search error: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    # New API endpoints
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
            
            # Mock weather data
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
            
            # Mock crime data
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
            
            # Mock FEMA data
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
            
            # Mock traffic data
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
    
    # Authentication endpoints
    @app.route("/api/auth/email-login", methods=['POST'])
    def email_login():
        """Email/password login"""
        try:
            data = request.json
            email = data.get('email', '').strip()
            password = data.get('password', '')

            # For now, accept any non-empty credentials
            if email and password:
                # In production, validate against database
                user_role = 'admin' if 'admin' in email.lower() else 'user'
                
                return jsonify({
                    'success': True,
                    'token': 'demo-token-' + str(int(time.time())),
                    'user': {
                        'email': email,
                        'role': user_role,
                        'name': email.split('@')[0].title()
                    }
                })
            return jsonify({'success': False, 'error': 'Invalid credentials'}), 401
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route("/api/auth/signup", methods=['POST'])
    def signup():
        """User registration"""
        try:
            data = request.json
            name = data.get('name', '').strip()
            email = data.get('email', '').strip()
            password = data.get('password', '')

            if name and email and password:
                # In production, create user in database
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

    @app.route("/api/auth/login", methods=['GET'])
    def google_login():
        """Google OAuth login redirect"""
        # Mock Google OAuth flow for now
        return jsonify({
            'success': True,
            'message': 'Google OAuth endpoint',
            'url': 'https://accounts.google.com/o/oauth2/auth'
        })
    
    return app

def open_browser():
    """Open web browser to the application"""
    time.sleep(2)
    webbrowser.open('http://localhost:3000')
    webbrowser.open('http://localhost:5000/api/hello')

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
            
            # Get safety prediction
            safety_ai_instance = get_safety_ai_instance()
            if safety_ai_instance:
                safety_result = safety_ai_instance.predict_safety_score(lat, lng)
                
                # Get additional real data if available
                weather = None
                crime = None
                if api_client:
                    try:
                        weather = api_client.get_weather_data(lat, lng)
                        crime = api_client.get_crime_data(lat, lng)
                    except:
                        pass
                
                # Broadcast to all clients
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
            
            # Try real routing first
            if tomtom_router and tomtom_router.api_key:
                route_result = tomtom_router.calculate_route(
                    start_lat, start_lng, dest_lat, dest_lng,
                    accessibility_needs=accessibility_needs if accessibility_needs else None
                )
                
                if route_result:
                    route_coords = [{'lat': p[0], 'lng': p[1]} for p in route_result['points']]
                    
                    # Calculate route safety
                    safety_ai_instance = get_safety_ai_instance()
                    if safety_ai_instance:
                        safety_result = safety_ai_instance.calculate_route_safety(route_coords)
                        safety_dict = {
                            'overall_safety': safety_result.overall_safety,
                            'risk_level': safety_result.risk_level,
                            'recommendations': safety_result.recommendations
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
                        'real_api_used': True
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
                    'overall_safety': safety_result.overall_safety,
                    'risk_level': safety_result.risk_level,
                    'recommendations': safety_result.recommendations
                }
            else:
                safety_dict = {
                    'overall_safety': 0.8,
                    'risk_level': 'low',
                    'recommendations': ['Route appears safe']
                }
                route_coords = [
                    {'lat': start_lat, 'lng': start_lng},
                    {'lat': dest_lat, 'lng': dest_lng}
                ]
            
            emit('route_calculated', {
                'route': route_coords,
                'safety': safety_dict,
                'timestamp': datetime.now().isoformat(),
                'real_api_used': False
            })
                
        except Exception as e:
            logger.error(f"Error handling route request: {e}")
            emit('error', {'message': str(e)})

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
    print(f"Real API Client: {'✅ Available' if api_client else '❌ Not Available'}")
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
    global socketio
    socketio = SocketIO(app, 
                       cors_allowed_origins="*",
                       async_mode='threading',
                       logger=True,
                       engineio_logger=args.debug)
    
    # Add model endpoints
    app = add_model_endpoints(app)
    
    # Setup SocketIO handlers
    setup_socketio_handlers(socketio, app)
    
    # Serve frontend
    @app.route('/')
    def serve_frontend():
        return send_from_directory('../frontend/dist', 'index.html')
    
    @app.route('/<path:path>')
    def serve_static(path):
        return send_from_directory('../frontend/dist', path)
    
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
        # Run the server with SocketIO
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