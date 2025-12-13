from flask import Flask, jsonify, redirect, session, url_for, request
from flask_cors import CORS
from flask_pymongo import PyMongo
from flask import g
from dotenv import load_dotenv
from bson import ObjectId
from authlib.integrations.flask_client import OAuth
from datetime import datetime, timezone
import os
import secrets

app = Flask(__name__)
app.config["MONGO_URI"] = "mongodb+srv://jshah26:tsasd2026@tsa-sd-2026.h9qb1rd.mongodb.net/TRYVER"

load_dotenv()

app.secret_key = os.environ.get("SESSION_SECRET") or secrets.token_hex(32)

# Instantiate the DB and OAuth authorization with our flask app. 
mongo = PyMongo(app)
oauth = OAuth(app)

CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}}, supports_credentials=True)

# Configure Google OAuth with proper state handling
google = oauth.register(
    name="google",
    client_id=os.environ.get("GOOGLE_CLIENT_ID"),
    client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={
        'scope': 'openid email profile',
        'code_challenge_method': 'S256'  # Enable PKCE for better security
    }
)

@app.route("/api/hello")
def hello():
    return jsonify({"message": "Hello from Flask!"})

# --- OAuth ---
@app.route("/api/auth/login")
def login():
    # Initiate OAuth flow with proper state management
    try:
        # Generate a secure state token
        state = secrets.token_urlsafe(16)
        session['oauth_state'] = state
        
        redirect_uri = url_for('auth_callback', _external=True)
        print(f"Redirect URI: {redirect_uri}")
        print(f"State: {state}")
        
        return google.authorize_redirect(redirect_uri, state=state)
    except Exception as e:
        return jsonify({"error": f"OAuth setup failed: {str(e)}"}), 500

@app.route("/api/auth/callback")
def auth_callback():
    # OAuth callback handler with state verification
    try:
        # Verify state parameter to prevent CSRF
        stored_state = session.get('oauth_state')
        received_state = request.args.get('state')
        
        print(f"Stored state: {stored_state}")
        print(f"Received state: {received_state}")
        
        if not stored_state or stored_state != received_state:
            session.pop('oauth_state', None)
            return jsonify({"error": "Invalid state parameter. Possible CSRF attack."}), 400
        
        # Clear the state after verification
        session.pop('oauth_state', None)
        
        # Get the token
        token = google.authorize_access_token()
        print(f"Token received: {bool(token)}")
        
        if not token:
            return jsonify({"error": "Failed to get access token"}), 400
            
        # Get user info
        user_info = google.userinfo()
        print(f"User info: {user_info}")
        
        if user_info and 'email' in user_info:
            # Store user in session
            session['user'] = dict(user_info)
            
            # Save/update user in database
            user_data = {
                'google_id': user_info['sub'],
                'email': user_info['email'],
                'name': user_info.get('name', ''),
                'picture': user_info.get('picture', ''),
                'last_login': datetime.now(timezone.utc),
                'preferences': {
                    'emergency_contacts': [],
                    'routines': [],
                    'accessibility_needs': []
                }
            }
            
            # Upsert user data
            result = mongo.db.User_Accounts.update_one(
                {'google_id': user_info['sub']},
                {'$set': user_data},
                upsert=True
            )
            
            print(f"Database update result: {result.modified_count} documents modified")
            
            # Redirect to frontend
            frontend_url = os.environ.get('FRONTEND_URL', 'http://localhost:3000')
            return redirect(f"{frontend_url}/dashboard")
        else:
            return jsonify({"error": "Failed to get user info from Google"}), 400
            
    except Exception as e:
        print(f"OAuth callback error: {str(e)}")
        return jsonify({"error": f"Authentication failed: {str(e)}"}), 400

@app.route("/api/auth/logout")
def logout():
    # Logout user and clear session
    session.pop('user', None)
    session.pop('oauth_state', None)
    return jsonify({"message": "Logged out successfully"})

@app.route("/api/auth/user")
def get_user():
    # Get current user info
    user = session.get('user')
    if user:
        db_user = mongo.db.User_Accounts.find_one({'google_id': user['sub']})
        return jsonify({
            'logged_in': True,
            'user': {
                'name': user.get('name'),
                'email': user.get('email'),
                'picture': user.get('picture'),
                'preferences': db_user.get('preferences', {}) if db_user else {}
            }
        })
    return jsonify({'logged_in': False})

# Debug endpoint to check session state
@app.route("/api/auth/debug")
def auth_debug():
    # Debug endpoint to check authentication state
    return jsonify({
        'session_keys': list(session.keys()),
        'has_oauth_state': 'oauth_state' in session,
        'has_user': 'user' in session,
        'user_info': session.get('user', {}).get('email') if session.get('user') else None
    })

# Email/Password Signup Route
@app.route("/api/auth/signup", methods=['POST'])
def email_signup():
    try:
        data = request.json
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')
        
        if not email or not password:
            return jsonify({"error": "Email and password required"}), 400
        
        # Check if user already exists
        existing_user = mongo.db.User_Accounts.find_one({'email': email})
        if existing_user:
            return jsonify({"error": "User already exists"}), 400
        
        # Create new user (in production, hash the password!)
        user_data = {
            'email': email,
            'name': name,
            'password': password,  # In production, use proper hashing!
            'created_at': datetime.now(timezone.utc),
            'last_login': datetime.now(timezone.utc),
            'preferences': {
                'emergency_contacts': [],
                'routines': [],
                'accessibility_needs': ['blind']
            }
        }
        
        # Insert new user
        result = mongo.db.User_Accounts.insert_one(user_data)
        
        # Create session
        session['user'] = {
            'sub': str(result.inserted_id),
            'email': email,
            'name': name
        }
        
        return jsonify({
            "message": "User created successfully",
            "user": {
                "name": name,
                "email": email
            }
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 400

# Email/Password Login Route
@app.route("/api/auth/email-login", methods=['POST'])
def email_login():
    try:
        data = request.json
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({"error": "Email and password required"}), 400
        
        # Find user (in production, verify hashed password!)
        user = mongo.db.User_Accounts.find_one({'email': email, 'password': password})
        if not user:
            return jsonify({"error": "Invalid credentials"}), 401
        
        # Update last login
        mongo.db.User_Accounts.update_one(
            {'_id': user['_id']},
            {'$set': {'last_login': datetime.now(timezone.utc)}}
        )
        
        # Create session
        session['user'] = {
            'sub': str(user['_id']),
            'email': user['email'],
            'name': user.get('name', ''),
            'picture': user.get('picture', '')
        }
        
        return jsonify({
            "message": "Login successful",
            "user": {
                "name": user.get('name'),
                "email": user['email']
            }
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 400

# Emergency and/or routine management
@app.route("/api/user/preferences", methods=["GET", "PUT"])
def manage_preferences():
    # Get or update user preferences
    user = session.get('user')
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    
    if request.method == "GET":
        db_user = mongo.db.User_Accounts.find_one({'google_id': user['sub']})
        return jsonify(db_user.get('preferences', {}))
    elif request.method == "PUT":
        preferences = request.json
        mongo.db.User_Accounts.update_one(
            {'google_id': user['sub']},
            {'$set': {'preferences': preferences}}
        )
        return jsonify({"message": "Preferences updated successfully"})

@app.route("/api/emergency/contacts", methods=['GET', 'POST', 'DELETE'])
def manage_emergency_contacts():
    # Manage emergency contacts
    user = session.get('user')
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    
    if request.method == 'GET':
        db_user = mongo.db.User_Accounts.find_one({'google_id': user['sub']})
        return jsonify(db_user.get('preferences', {}).get('emergency_contacts', []))
    
    elif request.method == 'POST':
        contact = request.json
        mongo.db.User_Accounts.update_one(
            {'google_id': user['sub']},
            {'$push': {'preferences.emergency_contacts': contact}}
        )
        return jsonify({"message": "Contact added successfully"})
    
    elif request.method == 'DELETE':
        contact_id = request.json.get('id')
        mongo.db.User_Accounts.update_one(
            {'google_id': user['sub']},
            {'$pull': {'preferences.emergency_contacts': {'id': contact_id}}}
        )
        return jsonify({"message": "Contact removed successfully"})

@app.route("/api/routines", methods=['GET', 'POST', 'PUT', 'DELETE'])
def manage_routines():
   # Manage daily routines
    user = session.get('user')
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    
    if request.method == 'GET':
        db_user = mongo.db.User_Accounts.find_one({'google_id': user['sub']})
        return jsonify(db_user.get('preferences', {}).get('routines', []))
    
    elif request.method == 'POST':
        routine = request.json
        routine['id'] = str(ObjectId())
        mongo.db.User_Accounts.update_one(
            {'google_id': user['sub']},
            {'$push': {'preferences.routines': routine}}
        )
        return jsonify({"message": "Routine added successfully", "id": routine['id']})
    
    elif request.method == 'PUT':
        routine = request.json
        mongo.db.User_Accounts.update_one(
            {'google_id': user['sub'], 'preferences.routines.id': routine['id']},
            {'$set': {'preferences.routines.$': routine}}
        )
        return jsonify({"message": "Routine updated successfully"})
    
    elif request.method == 'DELETE':
        routine_id = request.json.get('id')
        mongo.db.User_Accounts.update_one(
            {'google_id': user['sub']},
            {'$pull': {'preferences.routines': {'id': routine_id}}}
        )
        return jsonify({"message": "Routine removed successfully"})

# AI Safety Routes
@app.route("/api/ai/safety-score", methods=['POST'])
def get_safety_score():
    # Get AI-powered safety score for a location
    try:
        data = request.json
        lat = data.get('lat')
        lng = data.get('lng')

        """
        @FIXME: need to update with actual values of the destination
        """

        d_lat = 0.0
        d_lng = 0.0
        
        if not lat or not lng:
            return jsonify({"error": "Latitude and longitude required"}), 400
        
        # Import and use the AI model
        from ai_safety_model import safety_ai
        # Set the model's internal lat/long attributes and then predict

        safety_ai.lat = float(lat)
        safety_ai.long = float(lng)
        safety_ai.d_lat = d_lat
        safety_ai.d_long = d_lng
        result = safety_ai.predict_safety_score()
        
        return jsonify({
            "safety_score": result['safety_score'],
            "safety_level": safety_ai.get_safety_level(result['safety_score']),
            "confidence": result['confidence'],
            "location": {"lat": lat, "lng": lng},
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/ai/route-safety", methods=['POST'])
def analyze_route_safety():
    # Analyze safety of a complete route
    try:
        data = request.json
        route_coordinates = data.get('coordinates', [])
        
        if len(route_coordinates) < 2:
            return jsonify({"error": "At least 2 coordinates required"}), 400
        
        # Import and use the AI model
        from ai_safety_model import safety_ai
        analysis = safety_ai.calculate_route_safety(route_coordinates)
        
        return jsonify({
            "route_analysis": analysis,
            "coordinates_analyzed": len(route_coordinates),
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/ai/train-model", methods=['POST'])
def train_ai_model():
    # Retrain the AI model with new data
    try:
        from ai_safety_model import safety_ai
        accuracy = safety_ai.train_model()
        return jsonify({
            "message": "AI model trained successfully",
            "accuracy": accuracy,
            "is_trained": safety_ai.is_trained
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Health check route
@app.route("/api/health")
def health_check():
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "1.0.0"
    })

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5000)