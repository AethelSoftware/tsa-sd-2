from flask import Flask, jsonify, redirect, session, url_for, request
from flask_cors import CORS
from flask_pymongo import PyMongo
from authlib.integrations.flask_client import OAuth
import datetime
import os
from bson import ObjectId

app = Flask(__name__)
app.config["MONGO_URI"] = "mongodb+srv://jshah26:tsasd2026@tsa-sd-2026.h9qb1rd.mongodb.net/TRYVER"
app.secret_key = os.environ.get("SESSION_SECRET") or "dev-secret-key-123"

# Instantiate the DB and OAuth authorization with our flask app. 
mongo = PyMongo(app)
oauth = OAuth(app)

# Correct Google OAuth configuration
google = oauth.register(
    name='google',
    client_id=os.environ.get("GOOGLE_CLIENT_ID"),
    client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
    access_token_url='https://accounts.google.com/o/oauth2/token',
    authorize_url='https://accounts.google.com/o/oauth2/auth',
    api_base_url='https://www.googleapis.com/oauth2/v1/',
    userinfo_endpoint='https://openidconnect.googleapis.com/v1/userinfo',
    client_kwargs={
        'scope': 'openid email profile',
        'token_endpoint_auth_method': 'client_secret_post'
    },
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration'
)

CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}}, supports_credentials=True)

@app.route("/api/hello")
def hello():
    return jsonify({"message": "Hello from Flask!"})

# --- OAuth ---
@app.route("/api/auth/login")
def login():
    try:
        redirect_uri = url_for('auth_callback', _external=True)
        print(f"Redirect URI: {redirect_uri}")  # Debug
        return google.authorize_redirect(redirect_uri)
    except Exception as e:
        return jsonify({"error": f"OAuth setup failed: {str(e)}"}), 500

@app.route("/api/auth/callback")
def auth_callback():
    try:
        # Get the token
        token = google.authorize_access_token()
        print(f"Token received: {token}")  # Debug
        
        # Get user info using the token
        resp = google.get('userinfo', token=token)
        user_info = resp.json()
        print(f"User info: {user_info}")  # Debug
        
        if user_info and 'email' in user_info:
            # Store user in session
            session['user'] = user_info
            
            # Save/update user in database
            user_data = {
                'google_id': user_info['sub'],
                'email': user_info['email'],
                'name': user_info.get('name', ''),
                'picture': user_info.get('picture', ''),
                'last_login': datetime.datetime.utcnow(), 
                'preferences': {
                    'emergency_contacts': [],
                    'routines': [],
                    'accessibility_needs': ['blind']
                }
            }
            
            # Upsert user data
            mongo.db.User_Accounts.update_one(
                {'google_id': user_info['sub']},
                {'$set': user_data},
                upsert=True
            )
            
            return redirect(os.environ.get('FRONTEND_URL') or 'http://localhost:3000/dashboard')
        else:
            return jsonify({"error": "Failed to get user info from Google"}), 400
            
    except Exception as e:
        print(f"OAuth error: {str(e)}")  # Debug
        return jsonify({"error": f"Authentication failed: {str(e)}"}), 400
    
@app.route("/api/auth/logout")
def logout():
    # Logout user
    session.pop('user', None)
    return jsonify({"message": "Logged out successfully"})

@app.route("/api/auth/user")
def get_user():
    # Get user current info - FIXED: session.get('user')
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

# Email/Password Signup Route
@app.route("/api/auth/signup", methods=['POST'])
def email_signup():
    try:
        data = request.json
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')
        
        # Check if user already exists
        existing_user = mongo.db.User_Accounts.find_one({'email': email})
        if existing_user:
            return jsonify({"error": "User already exists"}), 400
        
        # Create new user (in production, hash the password!)
        user_data = {
            'email': email,
            'name': name,
            'password': password,  # In production, use proper hashing!
            'created_at': datetime.datetime.utcnow(),
            'last_login': datetime.datetime.utcnow(),
            'preferences': {
                'emergency_contacts': [],
                'routines': [],
                'accessibility_needs': ['blind']  # Default
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
        
        # Find user (in production, verify hashed password!)
        user = mongo.db.User_Accounts.find_one({'email': email, 'password': password})
        if not user:
            return jsonify({"error": "Invalid credentials"}), 401
        
        # Update last login
        mongo.db.User_Accounts.update_one(
            {'_id': user['_id']},
            {'$set': {'last_login': datetime.datetime.utcnow()}}
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
    # get or update user preferences
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

if __name__ == "__main__":
    app.run(debug=True)