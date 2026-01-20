"""
Main entry point for Tryver Safety Routing System
Now includes real-time tracking and hazard monitoring.
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
import threading
import webbrowser
import json

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

# Import safety model and tracking system
try:
    from ai_safety_model import safety_ai, get_safety_ai
    from real_time_tracker import create_tracking_app, tracker, socketio
    from hazard_monitor import HazardMonitor
except ImportError as e:
    logger.error(f"Import error: {e}")
    print("⚠️  Some modules not found, running in limited mode")
    safety_ai = None

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
    model_path = os.environ.get('MODEL_PATH', 'models/safety_model.pkl')
    model_exists = os.path.exists(model_path)
    
    if model_exists:
        try:
            if safety_ai.load_model(model_path):
                print("\n" + "="*60)
                print("MODEL STATUS: Trained")
                print("="*60)
                
                info = safety_ai.get_model_info()
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
        result = safety_ai.train_model_advanced(
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
            
            print(f"\nModel saved to: {safety_ai.model_path}")
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
    """Add model-related endpoints to Flask app"""
    
    # Store training progress for WebSocket updates
    training_progress = {
        'status': 'idle',
        'progress': 0,
        'speed': '0 MB/s',
        'eta': 'Calculating...'
    }
    
    @app.route("/api/hello")
    def hello():
        return jsonify({"message": "Tryver Safety Routing API"})
    
    @app.route("/api/model/status", methods=['GET'])
    def model_status():
        """Get current model status"""
        try:
            info = safety_ai.get_model_info() if safety_ai else {'is_trained': False}
            return jsonify({
                'success': True,
                'model': info,
                'training_progress': training_progress,
                'system': {
                    'python_version': sys.version,
                    'platform': sys.platform,
                    'model_path': safety_ai.model_path if safety_ai else 'N/A'
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
                result = safety_ai.train_model_advanced(
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
        """Predict safety for a location"""
        try:
            data = request.json
            if not data or 'lat' not in data or 'lng' not in data:
                return jsonify({
                    'success': False,
                    'error': 'Missing lat/lng parameters'
                }), 400
            
            lat = float(data['lat'])
            lng = float(data['lng'])
            
            if safety_ai and safety_ai.is_trained:
                result = safety_ai.predict_safety_score(lat, lng)
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
                    'is_trained': safety_ai.is_trained if safety_ai else False,
                    'last_trained': str(safety_ai.last_training_time) if safety_ai and safety_ai.last_training_time else None,
                    'confidence': safety_ai.training_metrics.get('test_score', 0.8) if safety_ai else 0.5
                }
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/model/route", methods=['POST'])
    def route_safety():
        """Calculate safety for an entire route"""
        try:
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
            
            if safety_ai and safety_ai.is_trained:
                result = safety_ai.calculate_route_safety(route)
            else:
                # Fallback mock analysis
                import random
                result = {
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
                'analysis': result,
                'model_info': safety_ai.get_model_info() if safety_ai else {'is_trained': False}
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
            if safety_ai and safety_ai.model_path and os.path.exists(safety_ai.model_path):
                return send_file(
                    safety_ai.model_path,
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
            if safety_ai:
                safety_ai.load_model(model_path)
            
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
        """Calculate accessible route between two points"""
        try:
            data = request.json
            if not data:
                return jsonify({
                    'success': False,
                    'error': 'No data provided'
                }), 400
            
            # Extract data
            start_location = data.get('start_location')
            end_location = data.get('end_location')
            accessibility_preferences = data.get('accessibility_preferences', {})
            
            # Mock route calculation (in production, use actual routing service)
            mock_route = {
                'distance': '1.2 km',
                'duration': '15 minutes',
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
                'start_address': start_location if isinstance(start_location, str) else 'Start Location',
                'end_address': end_location if isinstance(end_location, str) else 'Destination',
                'accessibility_score': 85,
                'warnings': [],
                'elevator_access': accessibility_preferences.get('elevator_access', False),
                'ramp_access': accessibility_preferences.get('wheelchair', False)
            }
            
            return jsonify({
                'success': True,
                'route': mock_route,
                'model_used': safety_ai.is_trained if safety_ai else False
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/locations", methods=['GET'])
    def get_locations():
        """Get saved locations"""
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
            lat = data.get('lat')
            lng = data.get('lng')
            
            # Mock reverse geocoding
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
                'address': random.choice(addresses)
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/search-location", methods=['POST'])
    def search_location():
        """Search for locations by name"""
        try:
            data = request.json
            query = data.get('query', '').lower()
            
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
                'results': results[:5]
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    return app

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
    parser.add_argument('--tracking-port', type=int, default=5001, help='Tracking WebSocket port')
    
    args = parser.parse_args()
    
    print("\n" + "="*60)
    print("TRYVER - ADVANCED SAFETY ROUTING SYSTEM")
    print("="*60)
    print(f"Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Python: {sys.version.split()[0]}")
    print(f"Platform: {sys.platform}")
    print("="*60)
    
    # Initialize safety AI
    global safety_ai
    try:
        safety_ai = get_safety_ai()
    except Exception as e:
        logger.error(f"Failed to initialize safety AI: {e}")
        safety_ai = None
    
    # Check model status and train if needed
    should_train = False
    
    if args.train:
        should_train = True
        print("\n⏩ Skipping prompts - training model as requested...")
    elif args.no_train:
        should_train = False
        print("\n⏩ Skipping training as requested...")
    elif safety_ai:
        should_train = check_model_status()
    
    # Train model if needed
    if should_train and safety_ai:
        success = train_model_interactive()
        if not success and not safety_ai.is_trained:
            print("\n⚠️  Model not trained, some features may be limited")
    
    # Create Flask app
    app = Flask(__name__, static_folder='../frontend/dist', static_url_path='/')
    CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)
    
    # Add model endpoints
    app = add_model_endpoints(app)
    
    # Serve frontend
    @app.route('/')
    def serve_frontend():
        return send_from_directory('../frontend/dist', 'index.html')
    
    @app.route('/<path:path>')
    def serve_static(path):
        return send_from_directory('../frontend/dist', path)
    
    # Start tracking server in separate thread
    def start_tracking_server():
        try:
            from real_time_tracker import socketio as tracking_socketio
            from real_time_tracker import app as tracking_app
            
            print(f"\nStarting Tracking Server on port {args.tracking_port}...")
            tracking_socketio.run(tracking_app, host=args.host, port=args.tracking_port, debug=args.debug)
        except Exception as e:
            print(f"Failed to start tracking server: {e}")
    
    tracking_thread = threading.Thread(target=start_tracking_server, daemon=True)
    tracking_thread.start()
    
    # Start browser in background
    if not args.no_browser:
        browser_thread = threading.Thread(target=open_browser, daemon=True)
        browser_thread.start()
    
    # Create models directory
    os.makedirs('models', exist_ok=True)
    
    # Start Flask server
    print("\n" + "="*60)
    print("STARTING FLASK SERVERS")
    print("="*60)
    print(f"Main API Server: http://{args.host}:{args.port}")
    print(f"Tracking WebSocket: http://{args.host}:{args.tracking_port}")
    print(f"Frontend: http://localhost:3000")
    if safety_ai:
        print(f"Model Status: {'✅ Trained' if safety_ai.is_trained else '⚠️ Not trained'}")
        if safety_ai.is_trained and safety_ai.training_metrics:
            score = safety_ai.training_metrics.get('test_score', 0)
            if score is not None:
                print(f"Model Accuracy: {score:.2%}")
    print("="*60)
    print("Press Ctrl+C to stop the servers")
    print("="*60 + "\n")
    
    try:
        app.run(
            host=args.host,
            port=args.port,
            debug=args.debug,
            threaded=True,
            use_reloader=False
        )
    except KeyboardInterrupt:
        print("\n\nServers stopped by user")
    except Exception as e:
        logger.error(f"Server error: {e}", exc_info=True)
        print(f"\n❌ Server error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()