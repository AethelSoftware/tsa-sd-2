"""
Main entry point for the Tryver Safety Routing System
Handles model training, API server startup, and user prompts
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

from flask import Flask, jsonify, request
from flask_cors import CORS
import threading
import webbrowser

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

# Import after path setup
try:
    from ai_safety_model import safety_ai, get_safety_ai
    from backend.app import app as flask_app, mongo, google
except ImportError as e:
    logger.error(f"Import error: {e}")
    logger.info("Creating minimal Flask app for testing")
    
    # Create minimal Flask app if imports fail
    flask_app = Flask(__name__)
    CORS(flask_app, resources={r"/api/*": {"origins": "http://localhost:3000"}}, supports_credentials=True)
    
    @flask_app.route("/api/hello")
    def hello():
        return jsonify({"message": "Hello from Flask!"})


def check_model_status():
    """Check if model exists and prompt for training"""
    model_path = os.environ.get('MODEL_PATH', 'models/safety_model.pkl')
    model_exists = os.path.exists(model_path)
    
    if model_exists:
        # Try to load model
        try:
            from ai_safety_model import AdvancedSafetyRoutingAI
            temp_ai = AdvancedSafetyRoutingAI(model_path=model_path)
            if temp_ai.load_model(model_path):
                print("\n" + "="*60)
                print("MODEL STATUS: Trained")
                print("="*60)
                
                info = temp_ai.get_model_info()
                if info['last_training_time']:
                    print(f"Last Training: {info['last_training_time']}")
                
                if info['training_metrics']:
                    metrics = info['training_metrics']
                    print(f"\nModel Performance:")
                    print(f"  Cross-Validation Score: {metrics.get('cv_mean', 'N/A'):.4f}")
                    print(f"  Test Score: {metrics.get('test_score', 'N/A'):.4f}")
                    print(f"  Training Samples: {metrics.get('n_samples', 'N/A')}")
                    print(f"  Features: {metrics.get('n_features', 'N/A')}")
                
                print(f"\nModel Location: {model_path}")
                print("="*60)
                
                # Ask about retraining
                response = input("\nDo you want to retrain the model? (y/N): ").strip().lower()
                return response in ['y', 'yes']
        except Exception as e:
            logger.error(f"Error checking model: {e}")
            print(f"\n⚠️  Model exists but could not be loaded: {e}")
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
    """Interactive model training with user options"""
    print("\n" + "="*60)
    print("MODEL TRAINING CONFIGURATION")
    print("="*60)
    
    # Get training parameters
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
    
    # Confirm training
    print(f"\nTraining Configuration:")
    print(f"  Loops: {n_loops}")
    print(f"  Epochs per loop: {n_epochs}")
    print(f"  Total epochs: {n_loops * n_epochs}")
    
    confirm = input("\nStart training? (Y/n): ").strip().lower()
    if confirm in ['n', 'no']:
        print("Training cancelled.")
        return False
    
    # Start training
    print("\n" + "="*60)
    print("STARTING MODEL TRAINING")
    print("="*60)
    print("This may take a few minutes...")
    print("Training progress will be logged to app.log")
    print("\nTraining steps:")
    print("  1. Generating synthetic training data")
    print("  2. Feature engineering and selection")
    print("  3. Training ensemble models")
    print("  4. Training neural network")
    print("  5. Creating stacking ensemble")
    print("  6. Evaluating model performance")
    print("="*60)
    
    try:
        # Reinitialize AI with fresh instance
        global safety_ai
        safety_ai = get_safety_ai()
        
        # Train model
        start_time = time.time()
        result = safety_ai.train_model_advanced(
            n_loops=n_loops,
            n_epochs=n_epochs,
            force_retrain=True,
            save_model=True
        )
        training_time = time.time() - start_time
        
        # Display results
        print("\n" + "="*60)
        print("TRAINING COMPLETED SUCCESSFULLY!")
        print("="*60)
        
        if result['status'] == 'success':
            metrics = result['metrics']
            print(f"\nTraining Time: {training_time:.1f} seconds")
            print(f"\nModel Performance Metrics:")
            print(f"  Cross-Validation Score: {metrics['cv_mean']:.4f} ± {metrics['cv_std']:.4f}")
            print(f"  Training Score: {metrics['train_score']:.4f}")
            print(f"  Test Score: {metrics['test_score']:.4f}")
            print(f"  Samples Trained: {metrics['n_samples']:,}")
            print(f"  Features Used: {metrics['n_features']}")
            
            # Interpret scores
            print(f"\nModel Interpretation:")
            if metrics['test_score'] >= 0.8:
                print("  ✅ Excellent model performance")
            elif metrics['test_score'] >= 0.7:
                print("  👍 Good model performance")
            elif metrics['test_score'] >= 0.6:
                print("  ⚠️  Acceptable model performance")
            else:
                print("  ⚠️  Model may need more training data")
            
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
    
    @app.route("/api/model/status", methods=['GET'])
    def model_status():
        """Get current model status"""
        try:
            info = safety_ai.get_model_info()
            return jsonify({
                'success': True,
                'model': info,
                'system': {
                    'python_version': sys.version,
                    'platform': sys.platform,
                    'model_path': safety_ai.model_path
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
            
            result = safety_ai.train_model_advanced(
                n_loops=n_loops,
                n_epochs=n_epochs,
                force_retrain=force,
                save_model=True
            )
            
            return jsonify({
                'success': True,
                'result': result
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
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
            
            result = safety_ai.predict_safety_score(lat, lng)
            
            return jsonify({
                'success': True,
                'prediction': result,
                'model_info': {
                    'is_trained': safety_ai.is_trained,
                    'last_trained': safety_ai.last_training_time,
                    'confidence': safety_ai.training_metrics.get('test_score', 0.8)
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
            
            result = safety_ai.calculate_route_safety(route)
            
            return jsonify({
                'success': True,
                'analysis': result,
                'model_info': safety_ai.get_model_info()
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    @app.route("/api/model/incremental", methods=['POST'])
    def incremental_train():
        """Perform incremental training"""
        try:
            data = request.json or {}
            epochs = data.get('epochs', 1)
            
            result = safety_ai.incremental_train(epochs=epochs)
            
            return jsonify({
                'success': result['status'] == 'success',
                'result': result
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    return app


def open_browser():
    """Open web browser to the application"""
    time.sleep(2)  # Wait for server to start
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
    print("="*60)
    
    # Check model status and train if needed
    should_train = False
    
    if args.train:
        should_train = True
        print("\n⏩ Skipping prompts - training model as requested...")
    elif args.no_train:
        should_train = False
        print("\n⏩ Skipping training as requested...")
    else:
        should_train = check_model_status()
    
    # Train model if needed
    if should_train:
        success = train_model_interactive()
        if not success:
            print("\n⚠️  Training failed or was cancelled")
            if not safety_ai.is_trained:
                response = input("Continue without trained model? (y/N): ").strip().lower()
                if response not in ['y', 'yes']:
                    print("Exiting...")
                    sys.exit(1)
    
    # Add model endpoints to Flask app
    flask_app = add_model_endpoints(flask_app)
    
    # Start browser in background
    if not args.no_browser:
        browser_thread = threading.Thread(target=open_browser, daemon=True)
        browser_thread.start()
    
    # Start Flask server
    print("\n" + "="*60)
    print("STARTING FLASK SERVER")
    print("="*60)
    print(f"API Server: http://{args.host}:{args.port}")
    print(f"Frontend: http://localhost:3000")
    print(f"Model Status: {'✅ Trained' if safety_ai.is_trained else '⚠️ Not trained'}")
    if safety_ai.is_trained and safety_ai.training_metrics:
        score = safety_ai.training_metrics.get('test_score', 0)
        print(f"Model Accuracy: {score:.2%}")
    print("="*60)
    print("Press Ctrl+C to stop the server")
    print("="*60 + "\n")
    
    try:
        flask_app.run(
            host=args.host,
            port=args.port,
            debug=args.debug,
            threaded=True,
            use_reloader=False
        )
    except KeyboardInterrupt:
        print("\n\nServer stopped by user")
    except Exception as e:
        logger.error(f"Server error: {e}", exc_info=True)
        print(f"\n❌ Server error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()