from datetime import datetime
import json
import math

class SessionState:

    def __init__(self, session_id):
        self.session_id = session_id
        self.creation_time = datetime.now()
        self.updated_time_stamp = None
        self.update_counter = 0
        self.lat = None
        self.lng = None
        self.route = None
        self.s_score = None
        self.prefs = None
        self.update_log = ""


    def update_location(self, lat, lng):
        self.lat = lat
        self.lng = lng
        self.update_counter += 1
        self.update_log += f"{self.update_counter}) Location is updated \n"

    def update_route(self, route):
        self.route = route
        self.update_counter += 1
        self.update_log += f"{self.update_counter}) Route is updated \n"

    def update_safety_score(self, score):
        self.s_score = score
        self.update_counter += 1
        self.update_log += f"{self.update_counter}) Safety Score is updated \n"

    def update_preferences(self, prefs):
        self.prefs = prefs
        self.update_counter += 1
        self.update_log += f"{self.update_counter}) Preferences are updated \n"

    def to_json(self):
        # Return each of the properties as a json object or py dictionary
        return json.dumps({
            "id":self.session_id,
            "lat":self.lat,
            "lng":self.lng,
            "route":self.route,
            "safety_score":self.s_score,
            "preferences":self.prefs,
            "update_log":self.update_log,
            "creation_time":self.creation_time,
            "updated_time_stamp":self.updated_time_stamp or None,
            "update_counter":self.update_counter
        })

    def touch(self):
        self.updated_time_stamp = datetime.now()
        self.update_counter += 1

    

class SessionManager:
    def __init__(self):
        self.sessions = dict() # Should use a dictionary instead

    def exists(self, session_id):
        if not session_id:
            return False
        session_ids = self.sessions.keys()
        return True if session_id in session_ids else False
    
    # Get the session based on the session id, but first check to see if it exists
    
    def get_session_state(self, session_id):
        if not self.exists(session_id):
            return None
        return self.sessions.get(session_id)
            
    def cleanup_sessions(self):
        self.sessions.clear()

    def create_session(self, session_id):
        # Instantiate a new session state obj with the session id
        new_session = SessionState(session_id)
        self.sessions.update({session_id:new_session})
    
    def remove_expired_sessions(self, threshold):
        # threshold: number of days (can be int or float)
        now = datetime.now()
        session_ids = list(self.sessions.keys())

        def age_in_days(s):
            ts = s.updated_time_stamp or s.creation_time
            if not ts:
                return math.inf
            return (now - ts).total_seconds() / 86400.0  # allow fractional days

        # keep sessions whose age in days is <= threshold
        acceptable_session_ids = []
        for s in session_ids:
            state = self.sessions.get(s)
            if(age_in_days(state) <= threshold):
                acceptable_session_ids.append(s)
        session_ids = acceptable_session_ids

        acceptable_sessions = dict()
        for key in self.sessions.keys():
            if key in session_ids:
                acceptable_sessions.update({key: self.sessions.get(key)})
        self.sessions = acceptable_sessions
    
    def update_session(self, session_id, route = None, score = None, prefs = None):
        session = self.get_session_state(session_id)
        if(route is not None):
            session.update_route(route)
        if(score is not None):
            session.update_safety_score(score)
        if(prefs is not None):
            session.update_preferences(prefs)

    

    
            
      

    