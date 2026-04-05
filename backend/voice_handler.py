"""
voice_handler.py — Vosk Speech Recognition for Tryver Accessibility

SETUP INSTRUCTIONS:
╔══════════════════════════════════════════════════════════════════╗
║           VOSK SPEECH RECOGNITION SETUP INSTRUCTIONS            ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Vosk is FREE, offline, and has no API key or usage limits.     ║
║                                                                  ║
║  STEP 1 — Install Vosk Python package:                          ║
║    pip install vosk                                              ║
║    (add 'vosk' to requirements.txt)                              ║
║                                                                  ║
║  STEP 2 — Download a Vosk English model:                         ║
║    Option A (Small, ~40MB, faster, less accurate):               ║
║      URL: https://alphacephei.com/vosk/models/                   ║
║           vosk-model-small-en-us-0.15.zip                        ║
║                                                                  ║
║    Option B (Large, ~1.8GB, slower, more accurate):              ║
║      URL: https://alphacephei.com/vosk/models/                   ║
║           vosk-model-en-us-0.22.zip                              ║
║                                                                  ║
║    RECOMMENDED for this app: Option A (small model)              ║
║    Reason: wake word + short phrases only, speed matters more    ║
║                                                                  ║
║  STEP 3 — Extract and place model:                               ║
║    Unzip the downloaded file.                                     ║
║    Place the extracted folder at:                                 ║
║      backend/vosk-model/                                         ║
║    So that this path exists:                                      ║
║      backend/vosk-model/am/final.mdl                             ║
║                                                                  ║
║  STEP 4 — Verify:                                                 ║
║    Run: python -c "from vosk import Model; Model('vosk-model')"  ║
║    Should print: LOG (VoskAPI) ... model loaded                  ║
║                                                                  ║
║  NO API KEY NEEDED. NO INTERNET NEEDED FOR TRANSCRIPTION.        ║
║  All audio is processed locally on your machine.                 ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝

WHY VOSK:
- OpenAI Whisper API: costs money per minute, requires API key, sends audio to servers
- Google Speech-to-Text: requires Google account, billing setup, API key, sends audio offsite
- Mozilla DeepSpeech: discontinued, no longer maintained
- Ollama (LLMs): LLMs are not speech recognition models — they process text, not audio.
  Ollama could theoretically transcribe via multimodal models but none support real audio STT.
- Vosk: completely free, no API key, works offline, runs on CPU, 40MB model for English,
  Python package on PyPI, processes audio locally, LGPL licensed (commercial use OK),
  supports streaming recognition (partial results while speaking), very low latency.
- Web Speech API (browser-native): free but requires internet (sends to Google servers),
  not available in Firefox, unreliable in production, no control over backend processing.
  We use it ONLY for wake word detection ("Hi Tryver") because it's zero-latency for that
  single use case. All actual address/command transcription goes through Vosk.
"""

import os
import sys
import json
import struct
import logging
import threading
import time
import random
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Vosk availability detection ───────────────────────────────────────────────

VOSK_AVAILABLE = False
VOSK_MODEL_PATH = os.path.join(os.path.dirname(__file__), 'vosk-model')
VOSK_SETUP_MESSAGE = """
\033[1;33m╔══════════════════════════════════════════════════════════════════╗
║           VOSK SPEECH RECOGNITION SETUP INSTRUCTIONS            ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Vosk is FREE, offline, and has no API key or usage limits.     ║
║                                                                  ║
║  STEP 1 — Install Vosk Python package:                          ║
║    pip install vosk                                              ║
║    (add 'vosk' to requirements.txt)                              ║
║                                                                  ║
║  STEP 2 — Download a Vosk English model:                         ║
║    Option A (Small, ~40MB, faster, less accurate):               ║
║      URL: https://alphacephei.com/vosk/models/                   ║
║           vosk-model-small-en-us-0.15.zip                        ║
║                                                                  ║
║    Option B (Large, ~1.8GB, slower, more accurate):              ║
║      URL: https://alphacephei.com/vosk/models/                   ║
║           vosk-model-en-us-0.22.zip                              ║
║                                                                  ║
║    RECOMMENDED for this app: Option A (small model)              ║
║    Reason: wake word + short phrases only, speed matters more    ║
║                                                                  ║
║  STEP 3 — Extract and place model:                               ║
║    Unzip the downloaded file.                                     ║
║    Place the extracted folder at:                                 ║
║      backend/vosk-model/                                         ║
║    So that this path exists:                                      ║
║      backend/vosk-model/am/final.mdl                             ║
║                                                                  ║
║  STEP 4 — Verify:                                                 ║
║    Run: python -c "from vosk import Model; Model('vosk-model')"  ║
║    Should print: LOG (VoskAPI) ... model loaded                  ║
║                                                                  ║
║  NO API KEY NEEDED. NO INTERNET NEEDED FOR TRANSCRIPTION.        ║
║  All audio is processed locally on your machine.                 ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝\033[0m
"""

try:
    import vosk
    VOSK_AVAILABLE = True
    logger.info("Vosk imported successfully")
except ImportError:
    logger.warning("Vosk not installed. Run: pip install vosk")
    print(VOSK_SETUP_MESSAGE)

# ── Model loading ─────────────────────────────────────────────────────────────

_vosk_model = None
_model_lock = threading.Lock()
_recognizer_locks: Dict[str, threading.Lock] = {}

def get_vosk_model():
    """
    Lazy-load the Vosk model singleton.
    Thread-safe. Returns None if Vosk not available or model not found.
    """
    global _vosk_model
    if _vosk_model is not None:
        return _vosk_model
    
    with _model_lock:
        if _vosk_model is not None:
            return _vosk_model
        
        if not VOSK_AVAILABLE:
            return None
        
        # Try multiple possible model paths
        possible_paths = [
            VOSK_MODEL_PATH,
            os.path.join(os.path.dirname(__file__), 'vosk-model-small-en-us-0.15'),
            os.path.join(os.path.dirname(__file__), 'vosk-model-en-us-0.22'),
        ]
        
        model_path = None
        for path in possible_paths:
            if os.path.exists(path):
                final_mdl = os.path.join(path, 'am', 'final.mdl')
                if os.path.exists(final_mdl):
                    model_path = path
                    break
        
        if model_path is None:
            logger.error(f"Vosk model not found. Tried: {possible_paths}")
            print(VOSK_SETUP_MESSAGE)
            return None
        
        try:
            logger.info(f"Loading Vosk model from {model_path} (this takes a few seconds)...")
            vosk.SetLogLevel(-1)  # Suppress Vosk's verbose Kaldi logging
            _vosk_model = vosk.Model(model_path)
            logger.info("Vosk model loaded successfully")
            return _vosk_model
        except Exception as e:
            logger.error(f"Failed to load Vosk model: {e}")
            print(VOSK_SETUP_MESSAGE)
            return None

# ── Session management ───────────────────────────────────────────────────────

_voice_sessions: Dict[str, Dict] = {}
_sessions_lock = threading.Lock()

def create_voice_session(socket_id: str) -> Optional[str]:
    """Create a new Vosk recognition session for a socket connection."""
    model = get_vosk_model()
    if model is None:
        return None
    
    session_id = f"vs-{int(time.time())}-{random.randint(1000, 9999)}"
    
    try:
        recognizer = vosk.KaldiRecognizer(model, 16000)
        recognizer.SetWords(True)   # Enable word-level timing (optional)
        
        with _sessions_lock:
            _voice_sessions[session_id] = {
                'recognizer': recognizer,
                'created_at': time.time(),
                'last_activity': time.time(),
                'accumulated_transcript': '',
                'socket_id': socket_id,
                'is_recording': False,
                'chunk_count': 0,
            }
            _recognizer_locks[session_id] = threading.Lock()
        
        return session_id
    except Exception as e:
        logger.error(f"Failed to create voice session: {e}")
        return None

def destroy_voice_session(session_id: str):
    """Clean up session and free KaldiRecognizer memory."""
    with _sessions_lock:
        session = _voice_sessions.pop(session_id, None)
        recognizer_lock = _recognizer_locks.pop(session_id, None)
    
    if session:
        # Mark recognizer as invalid
        session['recognizer'] = None
        logger.info(f"Voice session {session_id} destroyed")

def cleanup_stale_sessions():
    """Remove sessions inactive for more than 30 minutes."""
    cutoff = time.time() - 1800
    with _sessions_lock:
        stale = [sid for sid, s in _voice_sessions.items() if s['last_activity'] < cutoff]
    for sid in stale:
        destroy_voice_session(sid)
        logger.info(f"Cleaned up stale session {sid}")

# ── Audio processing functions ───────────────────────────────────────────────

def process_pcm_chunk(session_id: str, raw_bytes: bytes) -> Tuple[Optional[str], Optional[str]]:
    """
    Feed a chunk of raw 16-bit PCM audio (16kHz, mono, little-endian) to Vosk.
    Returns (partial_transcript, final_transcript).
    """
    with _sessions_lock:
        session = _voice_sessions.get(session_id)
    if not session:
        return None, None
    
    recognizer_lock = _recognizer_locks.get(session_id)
    if recognizer_lock is None:
        return None, None
    
    with recognizer_lock:
        session['last_activity'] = time.time()
        session['chunk_count'] += 1
        recognizer = session['recognizer']
        
        if recognizer is None:
            return None, None
        
        try:
            is_complete = recognizer.AcceptWaveform(raw_bytes)
            
            if is_complete:
                result_json = recognizer.Result()
                result = json.loads(result_json)
                final_text = result.get('text', '').strip()
                session['accumulated_transcript'] = ''
                if final_text:
                    return None, final_text
                return None, None
            else:
                partial_json = recognizer.PartialResult()
                partial = json.loads(partial_json)
                partial_text = partial.get('partial', '').strip()
                return partial_text if partial_text else None, None
        
        except Exception as e:
            logger.error(f"Error processing PCM chunk in session {session_id}: {e}")
            return None, None

def force_final_result(session_id: str) -> Optional[str]:
    """Force Vosk to return whatever it has recognized so far."""
    with _sessions_lock:
        session = _voice_sessions.get(session_id)
    if not session:
        return None
    
    recognizer_lock = _recognizer_locks.get(session_id)
    if recognizer_lock is None:
        return None
    
    with recognizer_lock:
        recognizer = session['recognizer']
        if recognizer is None:
            return None
        
        try:
            final_json = recognizer.FinalResult()
            result = json.loads(final_json)
            final_text = result.get('text', '').strip()
            return final_text if final_text else None
        except Exception as e:
            logger.error(f"Error getting final Vosk result for session {session_id}: {e}")
            return None

def validate_audio_chunk(raw_bytes: bytes) -> bool:
    """
    Validate that incoming bytes look like 16-bit PCM audio.
    - Must be non-empty
    - Must have even length (16-bit = 2 bytes per sample)
    - Must not be pure silence (all zeros beyond a threshold)
    - Should represent at least 10ms of audio (10ms * 16000Hz * 2bytes = 320 bytes)
    """
    if not raw_bytes:
        return False
    if len(raw_bytes) < 320:
        return False
    if len(raw_bytes) % 2 != 0:
        return False
    
    # Check for pure silence (all-zero bytes)
    try:
        samples = struct.unpack(f'<{len(raw_bytes)//2}h', raw_bytes)
        max_amplitude = max(abs(s) for s in samples)
        if max_amplitude < 50:  # Near silence threshold (out of 32767 max)
            return False
    except struct.error:
        return False
    
    return True

def convert_browser_audio_to_pcm(audio_data) -> Optional[bytes]:
    """Convert incoming audio data from Socket.IO message to raw PCM bytes."""
    if isinstance(audio_data, bytes):
        return audio_data
    elif isinstance(audio_data, bytearray):
        return bytes(audio_data)
    elif isinstance(audio_data, list):
        try:
            return bytes(audio_data)
        except Exception:
            return None
    elif hasattr(audio_data, 'read'):
        return audio_data.read()
    else:
        logger.warning(f"Unknown audio_data type: {type(audio_data)}")
        return None

# ── Geocoding helper (TomTom) ────────────────────────────────────────────────

TOMTOM_API_KEY = os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')

def _geocode_address(address: str) -> Optional[Tuple[float, float, str]]:
    """
    Geocode an address string using TomTom Search API.
    Returns (lat, lng, formatted_address) or None on failure.
    """
    if not address or len(address.strip()) < 2:
        return None
    
    try:
        import requests as http_requests
        url = f"https://api.tomtom.com/search/2/geocode/{http_requests.utils.quote(address)}.json"
        params = {
            'key': TOMTOM_API_KEY,
            'limit': 1,
            'countrySet': 'US',
            'lat': 40.4406,
            'lon': -79.9959,
            'radius': 50000,
            'language': 'en-US',
        }
        resp = http_requests.get(url, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        
        results = data.get('results', [])
        if not results:
            logger.warning(f"TomTom geocoding found no results for: {address}")
            return None
        
        position = results[0]['position']
        formatted = results[0].get('address', {}).get('freeformAddress', address)
        
        return float(position['lat']), float(position['lon']), formatted
    
    except Exception as e:
        logger.error(f"TomTom geocoding failed for '{address}': {e}")
        return None

# ── Voice route storage ──────────────────────────────────────────────────────

_voice_routes: Dict[str, Dict] = {}
_routes_lock = threading.Lock()

def _store_voice_route(route_id: str, data: Dict):
    with _routes_lock:
        _voice_routes[route_id] = data
        # Cleanup routes older than 2 hours
        cutoff = time.time() - 7200
        expired = [rid for rid, r in _voice_routes.items() 
                  if r.get('created_at', 0) < cutoff]
        for rid in expired:
            del _voice_routes[rid]

def _get_voice_route(route_id: str) -> Optional[Dict]:
    with _routes_lock:
        route = _voice_routes.get(route_id)
    if route is None:
        return None
    if time.time() - route.get('created_at', 0) > 7200:
        with _routes_lock:
            _voice_routes.pop(route_id, None)
        return None
    return route

# ── Background cleanup loop ──────────────────────────────────────────────────

def _cleanup_loop():
    """Background thread that cleans up stale sessions every 5 minutes."""
    while True:
        time.sleep(300)
        try:
            cleanup_stale_sessions()
        except Exception as e:
            logger.error(f"Error in voice cleanup loop: {e}")

# ── Socket.IO handlers registration ──────────────────────────────────────────

def init_voice_handler(app, socketio):
    """
    Register all voice-related Socket.IO handlers and HTTP endpoints.
    Call this from app.py after creating the socketio instance.
    """
    # Start background cleanup thread
    cleanup_thread = threading.Thread(target=_cleanup_loop, daemon=True)
    cleanup_thread.start()
    
    @socketio.on('voice_start_session')
    def handle_voice_start_session(data):
        from flask_socketio import emit
        from flask import request as flask_request
        
        sid = flask_request.sid
        
        if not VOSK_AVAILABLE:
            emit('voice_error', {
                'error': 'Vosk speech recognition is not installed. Run: pip install vosk',
                'code': 'VOSK_NOT_INSTALLED',
                'setup_url': 'https://alphacephei.com/vosk/install'
            })
            return
        
        model = get_vosk_model()
        if model is None:
            emit('voice_error', {
                'error': 'Vosk model not found. Please download and place the model in backend/vosk-model/',
                'code': 'MODEL_NOT_FOUND',
                'setup_url': 'https://alphacephei.com/vosk/models'
            })
            return
        
        session_id = create_voice_session(sid)
        if session_id is None:
            emit('voice_error', {
                'error': 'Failed to create recognition session',
                'code': 'SESSION_CREATE_FAILED'
            })
            return
        
        emit('voice_session_created', {
            'session_id': session_id,
            'model_path': VOSK_MODEL_PATH,
            'sample_rate': 16000
        })
        logger.info(f"Voice session created: {session_id} for socket {sid}")
    
    @socketio.on('voice_audio_chunk')
    def handle_voice_audio_chunk(data):
        from flask_socketio import emit
        from flask import request as flask_request
        
        session_id = data.get('session_id')
        audio_data = data.get('audio_data')
        is_final = data.get('is_final', False)
        
        if not session_id:
            emit('voice_error', {'error': 'Missing session_id', 'code': 'NO_SESSION'})
            return
        
        raw_bytes = convert_browser_audio_to_pcm(audio_data)
        if raw_bytes is None:
            emit('voice_error', {'error': 'Invalid audio data format', 'code': 'INVALID_AUDIO'})
            return
        
        if is_final:
            # Process last chunk if it has data
            if raw_bytes and validate_audio_chunk(raw_bytes):
                process_pcm_chunk(session_id, raw_bytes)
            final_transcript = force_final_result(session_id)
            emit('voice_final_result', {
                'transcript': final_transcript or '',
                'session_id': session_id,
                'is_forced': True
            })
            return
        
        if not validate_audio_chunk(raw_bytes):
            return  # silent chunk, ignore
        
        partial, final = process_pcm_chunk(session_id, raw_bytes)
        
        if final is not None:
            emit('voice_final_result', {
                'transcript': final,
                'session_id': session_id,
                'is_forced': False
            })
        elif partial is not None and partial != '':
            emit('voice_partial_result', {
                'transcript': partial,
                'session_id': session_id
            })
    
    @socketio.on('voice_stop_recording')
    def handle_voice_stop_recording(data):
        from flask_socketio import emit
        
        session_id = data.get('session_id')
        if not session_id:
            return
        
        final_transcript = force_final_result(session_id)
        emit('voice_final_result', {
            'transcript': final_transcript or '',
            'session_id': session_id,
            'is_forced': True,
            'triggered_by': 'stop_recording'
        })
    
    @socketio.on('voice_destroy_session')
    def handle_voice_destroy_session(data):
        session_id = data.get('session_id')
        if session_id:
            destroy_voice_session(session_id)
    
    @socketio.on('disconnect')
    def handle_voice_disconnect():
        from flask import request as flask_request
        sid = flask_request.sid
        
        with _sessions_lock:
            orphaned = [sid_key for sid_key, s in _voice_sessions.items() 
                       if s.get('socket_id') == sid]
        
        for session_id in orphaned:
            destroy_voice_session(session_id)
            logger.info(f"Cleaned up session {session_id} after socket {sid} disconnected")
    
    # ── HTTP endpoints ──────────────────────────────────────────────────────
    
    @app.route('/api/voice/status', methods=['GET'])
    def voice_status():
        from flask import jsonify
        
        model = get_vosk_model() if VOSK_AVAILABLE else None
        
        return jsonify({
            'vosk_installed': VOSK_AVAILABLE,
            'model_loaded': model is not None,
            'model_path': VOSK_MODEL_PATH,
            'model_exists': os.path.exists(VOSK_MODEL_PATH),
            'active_sessions': len(_voice_sessions),
            'setup_instructions': VOSK_SETUP_MESSAGE if not (VOSK_AVAILABLE and model) else None,
        })
    
    @app.route('/api/voice-route', methods=['POST'])
    def voice_route():
        from flask import request as flask_request, jsonify
        import requests as http_requests
        
        data = flask_request.json or {}
        start_raw = data.get('start', '').strip()
        destination_raw = data.get('destination', '').strip()
        mode_raw = data.get('mode', 'walk').strip()
        user_lat = float(data.get('user_lat', 40.4406))
        user_lng = float(data.get('user_lng', -79.9959))
        
        if not start_raw or not destination_raw:
            return jsonify({'success': False, 'error': 'Missing start or destination'}), 400
        
        # Step 1: Geocode start address
        start_is_current = any(phrase in start_raw.lower() for phrase in 
                               ['current location', 'here', 'my location', 'current', 'where i am'])
        
        if start_is_current:
            start_lat = user_lat
            start_lng = user_lng
            start_address = "Your Current Location"
        else:
            geocoded_start = _geocode_address(start_raw)
            if geocoded_start is None:
                return jsonify({
                    'success': False,
                    'error': f'Could not find location: {start_raw}',
                    'code': 'GEOCODE_FAILED_START'
                }), 422
            start_lat, start_lng, start_address = geocoded_start
        
        # Step 2: Geocode destination
        geocoded_dest = _geocode_address(destination_raw)
        if geocoded_dest is None:
            return jsonify({
                'success': False,
                'error': f'Could not find location: {destination_raw}',
                'code': 'GEOCODE_FAILED_DEST'
            }), 422
        dest_lat, dest_lng, dest_address = geocoded_dest
        
        # Step 3: Map mode string
        mode_map = {
            'walk': 'pedestrian',
            'walking': 'pedestrian',
            'wheelchair': 'pedestrian',
            'accessible': 'pedestrian',
            'transit': 'transit',
            'bus': 'transit',
        }
        travel_mode = mode_map.get(mode_raw.lower(), 'pedestrian')
        accessibility_needs = ['wheelchair'] if mode_raw.lower() in ['wheelchair', 'accessible', 'roll'] else []
        
        # Step 4: Route using existing infrastructure (import from app.py at runtime)
        route_result = None
        provider_used = None
        
        try:
            # Import here to avoid circular import at module level
            from app import tomtom_router, transit_router, google_router, extract_all_coords_from_steps, build_display_steps
            
            if travel_mode == 'transit' and transit_router:
                from datetime import datetime
                routes = transit_router.find_route(
                    start_lat, start_lng, dest_lat, dest_lng,
                    datetime.now(),
                    max_walk_distance=800,
                    max_transfers=4,
                    time_window_minutes=120,
                    num_alternatives=1
                )
                if routes:
                    primary = routes[0]
                    all_coords = extract_all_coords_from_steps(primary['steps'])
                    route_result = {
                        'points': [[c['lat'], c['lng']] for c in all_coords],
                        'distance_meters': primary['total_distance_meters'],
                        'duration_seconds': primary['total_time_seconds'],
                        'instructions': build_display_steps(primary['steps']),
                        'provider': 'gtfs_transit'
                    }
                    provider_used = 'GTFS Transit'
            
            if route_result is None and tomtom_router:
                route_result = tomtom_router.calculate_route(
                    start_lat, start_lng, dest_lat, dest_lng,
                    travel_mode='pedestrian',
                    accessibility_needs=accessibility_needs if accessibility_needs else None
                )
                if route_result:
                    provider_used = route_result.get('provider', 'osrm/tomtom')
        
        except Exception as e:
            logger.error(f"Routing failed in voice_route: {e}", exc_info=True)
            return jsonify({'success': False, 'error': f'Routing error: {str(e)}'}), 500
        
        if not route_result:
            return jsonify({'success': False, 'error': 'No route found between those locations'}), 404
        
        # Step 5: Safety scoring
        from app import get_safety_ai_instance
        safety_ai = get_safety_ai_instance()
        route_coords_list = [{'lat': p[0], 'lng': p[1]} for p in route_result.get('points', [])]
        
        if safety_ai and safety_ai.is_trained and route_coords_list:
            try:
                safety_result = safety_ai.calculate_route_safety(route_coords_list)
                safety_dict = {
                    'overall_safety': safety_result.get('overall_safety', 0.8),
                    'risk_level': safety_result.get('risk_level', 'low'),
                    'recommendations': safety_result.get('recommendations', [])
                }
            except Exception:
                safety_dict = {'overall_safety': 0.8, 'risk_level': 'low', 'recommendations': []}
        else:
            safety_dict = {'overall_safety': 0.8, 'risk_level': 'low', 'recommendations': []}
        
        # Step 6: Format response
        distance_m = route_result.get('distance_meters', 0)
        duration_s = route_result.get('duration_seconds', 0)
        
        distance_str = f"{distance_m/1000:.1f} km" if distance_m >= 1000 else f"{int(distance_m)} m"
        if duration_s < 60:
            duration_str = f"{int(duration_s)} seconds"
        elif duration_s < 3600:
            duration_str = f"{int(duration_s/60)} minutes"
        else:
            hours = int(duration_s / 3600)
            mins = int((duration_s % 3600) / 60)
            duration_str = f"{hours} hour{'s' if hours > 1 else ''} and {mins} minutes"
        
        # Shorter route ID for better TTS
        route_id = f"VR-{int(time.time()) % 10000}-{random.randint(100, 999)}"
        
        # Store route for later retrieval
        _store_voice_route(route_id, {
            'route_id': route_id,
            'start_address': start_address,
            'end_address': dest_address,
            'distance': distance_str,
            'duration': duration_str,
            'steps': route_result.get('instructions', []),
            'route_coords': route_result.get('points', []),
            'safety': safety_dict,
            'travel_mode': travel_mode,
            'provider': provider_used,
            'created_at': time.time(),
        })
        
        return jsonify({
            'success': True,
            'route_id': route_id,
            'start_address': start_address,
            'end_address': dest_address,
            'distance': distance_str,
            'duration': duration_str,
            'steps': route_result.get('instructions', []),
            'route_coords': route_result.get('points', []),
            'safety': safety_dict,
            'travel_mode': travel_mode,
            'provider': provider_used,
        })
    
    @app.route('/api/voice-route/<route_id>', methods=['GET'])
    def get_voice_route(route_id):
        from flask import jsonify
        route = _get_voice_route(route_id)
        if route is None:
            return jsonify({'success': False, 'error': 'Route not found or expired'}), 404
        return jsonify({'success': True, **route})
    
    logger.info("Voice handler initialized successfully")
    return app