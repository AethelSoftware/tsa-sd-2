from flask import Flask, jsonify, redirect, session, url_for
from flask_cors import CORS
from flask_pymongo import PyMongo
from flask import g
from dotenv import load_dotenv
from bson import ObjectId
from authlib.integrations.flask_client import OAuth
import datetime
import os
import requests as request
app = Flask(__name__)
app.config["MONGO_URI"] = "mongodb+srv://jshah26:tsasd2026@tsa-sd-2026.h9qb1rd.mongodb.net/TRYVER"

load_dotenv()

app.secret_key = os.environ.get("SESSION_SECRET") or "dev-secret-key-123"  # Required for sessions

# Instantiate the DB and OAuth authorization with our flask app. 
mongo = PyMongo(app)
oauth = OAuth(app)


CORS(app, resources={r"/api/*": {"origins": "*"}})  # allow all origins for /api/*

google = oauth.register(name="google",
                        authorize_url = "https://accounts.google.com/o/oauth2/v2/auth",
                        access_token_url = "https://oauth2.googleapis.com/token",
                        client_id = os.environ.get("GOOGLE_CLIENT_ID"),
                        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET"),
                        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
                        userinfo_endpoint = "https://openidconnect.googleapis.com/v1/userinfo",
                        client_kwargs = {"scope":"openid email profile"})

@app.route("/api/hello")
def hello():
    return jsonify({"message": "Hello from Flask!"})

# --- OAuth ---
@app.route("/api/auth/login")
def login():
    # Initial OAuth Login
    # redirect_uri = url_for('auth_callback', _external=True)
    return google.authorize_redirect(os.environ.get("GOOGLE_REDIRECT_URI"))
    

@app.route("/api/auth/callback")
def auth_callback():
    # OAuth callback handler
    try:
        token = google.authorize_access_token()
        user_info = token.get('userinfo')
        
        if user_info:
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
                    'accessibility_needs': []
                }
            }
            
            # Upsert user data
            mongo.db.User_Accounts.update_one(
                {'google_id': user_info['sub']},
                {'$set': user_data},
                upsert=True
            )
            
            return redirect(os.environ.get('FRONTEND_URL') or 'http://localhost:3000')
        else:
            return jsonify({"error": "Failed to get user info"}), 400
            
    except Exception as e:
        return jsonify({"error": str(e)}), 400 
    
@app.route("/api/auth/logout")
def logout():
    # Logout user
    session.pop('user', None)
    return jsonify({"message": "Logged out successfully"})

@app.route("/api/auth/user")
def get_user():
    # Get user current info
    user = session.get()
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

# Emergency and/or routine management
@app.route("/api/user/preferences", methods = ["GET", "PUT"])
def manage_preferences():
    # get or update user preferences
    user = session.get('user')
    if not user:
        return jsonify({"error" : "Not authenticated"}), 401
    
    if request.method == "GET":
        db_user = mongo.db.User_Accounts.find_one({'google_id' : user['sub']})
        return jsonify(db_user.get('preferences', {}))
    elif request.method == "PUT":
        preferences = request.json
        mongo.db.User_Accounts.update_one(
            {'google_id': user['sub']},
            {'$set': {'preferences': preferences}}
        )
        return jsonify({"message" : "Preferences updated successfully"})

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



# @app.before_request
# def load_user():
#    g.user = session.get("user") 
"""
@app.route("/profile")
def profile():
    if not g.user:
        return redirect(url_for("/login"))
    else:
        return f"Hello, there {g.user["name"]}"
"""


if __name__ == "__main__":
    app.run(debug=True)
