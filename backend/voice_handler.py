"""
voice_handler.py — Faster-Whisper Speech Recognition for Tryver
OPTIMIZED FOR M1 MACBOOK PRO + ADVANCED ADDRESS RESOLUTION

Key improvements:
- No API timeouts (removed all timeout limits)
- Number hyphen removal (1-0-4 → 104)
- Fuzzy address matching
- Landmark resolution
- Full address normalization
"""

import os
import re
import time
import json
import logging
import threading
import random
from typing import Dict, List, Optional, Tuple
from difflib import SequenceMatcher
from functools import lru_cache
import numpy as np
import requests

logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

WHISPER_AVAILABLE = False
WHISPER_MODEL_NAME = os.getenv('WHISPER_MODEL', 'base.en')
WHISPER_COMPUTE_TYPE = os.getenv('WHISPER_COMPUTE_TYPE', 'int8')
WHISPER_CPU_THREADS = int(os.getenv('WHISPER_CPU_THREADS', '4'))
WHISPER_NUM_WORKERS = int(os.getenv('WHISPER_NUM_WORKERS', '1'))

# Try faster-whisper first
try:
    from faster_whisper import WhisperModel
    WHISPER_AVAILABLE = True
    WHISPER_BACKEND = "faster-whisper"
    logger.info("✓ faster-whisper imported (optimized for M1)")
except ImportError:
    try:
        import whisper
        WHISPER_AVAILABLE = True
        WHISPER_BACKEND = "openai-whisper"
        logger.warning("Using openai-whisper (slower)")
    except ImportError:
        logger.error("No whisper backend available")

TOMTOM_API_KEY = os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')

# ============================================================================
# ADVANCED ADDRESS CORRECTION DATABASE
# ============================================================================

_ADDRESS_CORRECTIONS: Dict[str, str] = {
    # Street types
    'stree': 'Street', 'stret': 'Street', 'st': 'Street',
    'avenew': 'Avenue', 'avenye': 'Avenue', 'avnue': 'Avenue', 'ave': 'Avenue',
    'blvd': 'Boulevard', 'boulvard': 'Boulevard', 'bulevard': 'Boulevard',
    'drive': 'Drive', 'dr': 'Drive', 'drv': 'Drive',
    'lane': 'Lane', 'ln': 'Lane', 'lne': 'Lane',
    'road': 'Road', 'rd': 'Road', 'rode': 'Road',
    'court': 'Court', 'ct': 'Court', 'crt': 'Court',
    'place': 'Place', 'pl': 'Place', 'plce': 'Place',
    'circle': 'Circle', 'cir': 'Circle', 'crcl': 'Circle',
    'parkway': 'Parkway', 'pkwy': 'Parkway', 'parkwy': 'Parkway',
    
    # Directionals
    'north': 'North', 'n': 'North', 'northbound': 'North',
    'south': 'South', 's': 'South', 'southbound': 'South',
    'east': 'East', 'e': 'East', 'eastbound': 'East',
    'west': 'West', 'w': 'West', 'westbound': 'West',
    
    # Common city corrections
    'pittsburgh': 'Pittsburgh', 'pitsburgh': 'Pittsburgh', 'pittsburg': 'Pittsburgh',
    'pitsburg': 'Pittsburgh', 'pitt': 'Pittsburgh',
    
    # State corrections
    'pennsylvania': 'PA', 'penn': 'PA', 'penna': 'PA', 'pa': 'PA',
    
    # Number words to digits
    'one': '1', 'oh': '0', 'zero': '0', 'two': '2', 'three': '3', 'four': '4', 
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10',
    'eleven': '11', 'twelve': '12', 'thirteen': '13', 'fourteen': '14',
    'fifteen': '15', 'sixteen': '16', 'seventeen': '17', 'eighteen': '18',
    'nineteen': '19', 'twenty': '20', 'thirty': '30', 'forty': '40',
    'fifty': '50', 'sixty': '60', 'seventy': '70', 'eighty': '80', 'ninety': '90',
}

# Landmark to physical address mapping
_LANDMARK_ADDRESSES: Dict[str, Dict[str, str]] = {
    "Acrisure Stadium": {
        "address": "100 Art Rooney Avenue",
        "city": "Pittsburgh", "state": "PA", "zip": "15212",
        "full": "100 Art Rooney Avenue, Pittsburgh, PA 15212"
    },
    "PNC Park": {
        "address": "115 Federal Street", "city": "Pittsburgh", "state": "PA",
        "zip": "15212", "full": "115 Federal Street, Pittsburgh, PA 15212"
    },
    "PPG Paints Arena": {
        "address": "1001 Fifth Avenue", "city": "Pittsburgh", "state": "PA",
        "zip": "15219", "full": "1001 Fifth Avenue, Pittsburgh, PA 15219"
    },
    "Highmark Stadium": {
        "address": "510 W Station Square Drive", "city": "Pittsburgh", "state": "PA",
        "zip": "15219", "full": "510 W Station Square Drive, Pittsburgh, PA 15219"
    },
    "Carnegie Mellon University": {
        "address": "5000 Forbes Avenue", "city": "Pittsburgh", "state": "PA",
        "zip": "15213", "full": "5000 Forbes Avenue, Pittsburgh, PA 15213"
    },
    "University of Pittsburgh": {
        "address": "4200 Fifth Avenue", "city": "Pittsburgh", "state": "PA",
        "zip": "15260", "full": "4200 Fifth Avenue, Pittsburgh, PA 15260"
    },
    "Duquesne University": {
        "address": "600 Forbes Avenue", "city": "Pittsburgh", "state": "PA",
        "zip": "15282", "full": "600 Forbes Avenue, Pittsburgh, PA 15282"
    },
    "Point State Park": {
        "address": "601 Commonwealth Place", "city": "Pittsburgh", "state": "PA",
        "zip": "15222", "full": "601 Commonwealth Place, Pittsburgh, PA 15222"
    },
    "Mt. Washington": {
        "address": "1 Grandview Avenue", "city": "Pittsburgh", "state": "PA",
        "zip": "15211", "full": "1 Grandview Avenue, Pittsburgh, PA 15211"
    },
    "Station Square": {
        "address": "125 W Station Square Drive", "city": "Pittsburgh", "state": "PA",
        "zip": "15219", "full": "125 W Station Square Drive, Pittsburgh, PA 15219"
    }
}

# ============================================================================
# NUMBER HYPHEN REMOVAL (FIX FOR 1-0-4 → 104)
# ============================================================================

def remove_number_hyphens(text: str) -> str:
    """
    Convert hyphenated number sequences like "1-0-4" to "104"
    This fixes Whisper's tendency to add hyphens between spoken digits.
    """
    if not text:
        return text
    
    # Remove hyphens between digits: "1-0-4" -> "104"
    text = re.sub(r'(\d)-(\d)', r'\1\2', text)
    
    # Handle multiple hyphens in a row: "1-0-4-5" -> "1045"
    text = re.sub(r'(\d)-(\d)-(\d)', r'\1\2\3', text)
    
    # Remove spaces between digits: "1 0 4" -> "104"
    text = re.sub(r'(\d)\s+(\d)', r'\1\2', text)
    
    return text

# ============================================================================
# ADVANCED ADDRESS NORMALIZATION
# ============================================================================

@lru_cache(maxsize=1000)
def normalize_address(text: str) -> str:
    """Normalize address text by fixing misspellings and standardizing format."""
    if not text:
        return ""
    
    text = text.lower().strip()
    
    # Apply address corrections
    for wrong, correct in _ADDRESS_CORRECTIONS.items():
        text = re.sub(rf'\b{wrong}\b', correct, text, flags=re.I)
    
    # Remove ordinal suffixes
    text = re.sub(r'(\d+)(st|nd|rd|th)\b', r'\1', text)
    
    # Add Pittsburgh, PA if missing
    if 'pittsburgh' not in text.lower() and 'pa' not in text.lower():
        if any(word in text.lower() for word in ['street', 'avenue', 'road', 'drive', 'lane']):
            text += ", Pittsburgh, PA"
    
    # Clean up
    text = re.sub(r'\s+', ' ', text).strip()
    
    # Capitalize properly
    words = text.split()
    result = []
    for word in words:
        if word.upper() in ['PA', 'USA']:
            result.append(word.upper())
        elif word.lower() in ['north', 'south', 'east', 'west']:
            result.append(word.capitalize())
        else:
            result.append(word.capitalize())
    
    return ' '.join(result)

def calculate_address_similarity(addr1: str, addr2: str) -> float:
    """Calculate similarity between two addresses."""
    if not addr1 or not addr2:
        return 0.0
    
    norm1 = normalize_address(addr1)
    norm2 = normalize_address(addr2)
    
    if norm1 == norm2:
        return 1.0
    
    # Simple ratio for speed
    return SequenceMatcher(None, norm1, norm2).ratio()

# ============================================================================
# LANDMARK RESOLUTION
# ============================================================================

def resolve_landmark_to_address(landmark_name: str) -> Optional[Dict[str, str]]:
    """Convert a landmark name to a physical address."""
    landmark_lower = landmark_name.lower().strip()
    
    # Direct lookup
    for landmark, details in _LANDMARK_ADDRESSES.items():
        if landmark.lower() == landmark_lower:
            return details
    
    # Fuzzy match
    best_match = None
    best_score = 0.0
    
    for landmark, details in _LANDMARK_ADDRESSES.items():
        score = calculate_address_similarity(landmark_name, landmark)
        if score > best_score and score > 0.6:
            best_score = score
            best_match = details
    
    return best_match

# ============================================================================
# TOMTOM SEARCH (NO TIMEOUTS)
# ============================================================================

def search_address_autocomplete(query: str, limit: int = 5) -> List[Dict]:
    """Search for addresses using TomTom autocomplete (no timeout)."""
    if not query or len(query) < 3:
        return []
    
    try:
        url = f"https://api.tomtom.com/search/2/search/{requests.utils.quote(query)}.json"
        params = {
            'key': TOMTOM_API_KEY,
            'limit': limit,
            'countrySet': 'US',
            'lat': 40.4406,
            'lon': -79.9959,
            'radius': 50000,
            'language': 'en-US',
            'typeahead': True
        }
        
        # NO TIMEOUT HERE - removed completely
        resp = requests.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        
        results = []
        for result in data.get('results', [])[:limit]:
            address_info = {
                'full_address': result.get('address', {}).get('freeformAddress', ''),
                'street_number': result.get('address', {}).get('streetNumber', ''),
                'street_name': result.get('address', {}).get('streetName', ''),
                'municipality': result.get('address', {}).get('municipality', ''),
                'postal_code': result.get('address', {}).get('postalCode', ''),
                'lat': float(result['position']['lat']),
                'lng': float(result['position']['lon']),
                'confidence': result.get('score', 0.5)
            }
            results.append(address_info)
        
        return results
    
    except Exception as e:
        logger.error(f"Autocomplete search failed for '{query}': {e}")
        return []

def fuzzy_search_address(query: str, limit: int = 5) -> List[Dict]:
    """Fuzzy search for addresses with multiple strategies."""
    if not query:
        return []
    
    results = []
    
    # Strategy 1: Check if it's a known landmark
    landmark_addr = resolve_landmark_to_address(query)
    if landmark_addr:
        results.append({
            'full_address': landmark_addr['full'],
            'street_number': landmark_addr['address'].split()[0] if landmark_addr['address'] else '',
            'street_name': ' '.join(landmark_addr['address'].split()[1:]) if landmark_addr['address'] else '',
            'municipality': landmark_addr['city'],
            'postal_code': landmark_addr['zip'],
            'lat': None,
            'lng': None,
            'confidence': 0.95,
            'source': 'landmark'
        })
    
    # Strategy 2: TomTom autocomplete
    autocomplete_results = search_address_autocomplete(query, limit)
    results.extend(autocomplete_results)
    
    # Remove duplicates
    seen = set()
    unique_results = []
    for r in results:
        addr_key = r.get('full_address', '')
        if addr_key and addr_key not in seen:
            seen.add(addr_key)
            unique_results.append(r)
    
    return unique_results[:limit]

# ============================================================================
# GEOCODING (NO TIMEOUTS)
# ============================================================================

_geocode_cache: Dict[str, Tuple[float, float, str, float]] = {}
_geocode_cache_lock = threading.Lock()
_GEOCODE_CACHE_TTL = 3600

def geocode_address(address: str, bias_lat: float = 40.4406, bias_lng: float = -79.9959) -> Optional[Tuple[float, float, str]]:
    """Geocode an address to coordinates (no timeout)."""
    if not address or len(address.strip()) < 3:
        return None
    
    normalized = normalize_address(address)
    cache_key = f"{normalized}:{bias_lat:.2f}:{bias_lng:.2f}"
    
    # Check cache
    with _geocode_cache_lock:
        if cache_key in _geocode_cache:
            lat, lng, formatted, timestamp = _geocode_cache[cache_key]
            if time.time() - timestamp < _GEOCODE_CACHE_TTL:
                return lat, lng, formatted
    
    try:
        url = f"https://api.tomtom.com/search/2/geocode/{requests.utils.quote(normalized)}.json"
        params = {
            'key': TOMTOM_API_KEY,
            'limit': 1,
            'countrySet': 'US',
            'lat': bias_lat,
            'lon': bias_lng,
            'radius': 50000,
            'language': 'en-US'
        }
        
        # NO TIMEOUT HERE - removed completely
        resp = requests.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        results = data.get('results', [])
        
        if not results:
            return None
        
        pos = results[0]['position']
        lat = float(pos['lat'])
        lng = float(pos['lon'])
        formatted = results[0].get('address', {}).get('freeformAddress', normalized)
        
        with _geocode_cache_lock:
            _geocode_cache[cache_key] = (lat, lng, formatted, time.time())
        
        logger.info(f"Geocoded '{address}' → ({lat:.6f}, {lng:.6f})")
        return lat, lng, formatted
    
    except Exception as e:
        logger.error(f"Geocoding failed for '{address}': {e}")
        return None

# ============================================================================
# ENHANCED CORRECTION FOR ADDRESSES
# ============================================================================

_correction_cache: Dict[str, Tuple[str, float, float]] = {}
_correction_cache_lock = threading.Lock()
_CORRECTION_CACHE_TTL = 300

def correct_transcript(raw: str, context: str = "address") -> Tuple[str, float]:
    """Enhanced correction pipeline with number hyphen removal."""
    if not raw or not raw.strip():
        return "", 0.0
    
    # Check cache
    cache_key = f"{raw}:{context}"
    with _correction_cache_lock:
        if cache_key in _correction_cache:
            corrected, conf, timestamp = _correction_cache[cache_key]
            if time.time() - timestamp < _CORRECTION_CACHE_TTL:
                return corrected, conf
    
    text = raw.strip()
    confidence = 0.85
    
    # CRITICAL: Remove hyphens from numbers FIRST (1-0-4 → 104)
    text = remove_number_hyphens(text)
    
    # Context-specific handling
    if context == "address":
        # Check for current location
        if detect_current_location_intent(text):
            return "current location", 0.95
        
        # Try to resolve as landmark
        landmark = resolve_landmark_to_address(text)
        if landmark:
            return landmark['full'], 0.95
        
        # Try fuzzy search
        search_results = fuzzy_search_address(text, limit=1)
        if search_results:
            best = search_results[0]
            if best.get('confidence', 0) > 0.6:
                return best['full_address'], best['confidence']
        
        # Normalize address
        normalized = normalize_address(text)
        if normalized != text:
            confidence += 0.05
        
        return normalized, min(confidence, 0.95)
    
    elif context == "mode":
        mode, conf = detect_travel_mode_intent(text)
        if mode:
            mode_map = {"walk": "walking", "transit": "transit", "wheelchair": "wheelchair"}
            return mode_map.get(mode, mode), max(confidence, conf)
    
    elif context == "confirm":
        result, conf = detect_confirmation_intent(text)
        if result is not None:
            return "yes" if result else "no", max(confidence, conf)
    
    # Cache result
    with _correction_cache_lock:
        _correction_cache[cache_key] = (text, confidence, time.time())
    
    return text, confidence

# ============================================================================
# INTENT DETECTION
# ============================================================================

_RE_CURRENT_LOCATION = re.compile(r'\b(current|my|use|gps)\s+(location|locate|gps)\b|\b(here|right here|i\'m here)\b', re.I)
_RE_WALK_MODE = re.compile(r'\b(walk|walking|foot|pedestrian)\b', re.I)
_RE_TRANSIT_MODE = re.compile(r'\b(transit|bus|train|subway|trolley)\b', re.I)
_RE_WHEELCHAIR_MODE = re.compile(r'\b(wheelchair|wheel chair|accessible|handicap|ada)\b', re.I)
_RE_YES = re.compile(r'\b(yes|yeah|yep|correct|right|sure|okay|ok|confirm)\b', re.I)
_RE_NO = re.compile(r'\b(no|nope|wrong|incorrect|start over|restart)\b', re.I)

def detect_current_location_intent(transcript: str) -> bool:
    if not transcript:
        return False
    return bool(_RE_CURRENT_LOCATION.search(transcript))

def detect_travel_mode_intent(transcript: str) -> Tuple[Optional[str], float]:
    if not transcript:
        return None, 0.0
    if _RE_WALK_MODE.search(transcript):
        return "walk", 0.95
    if _RE_TRANSIT_MODE.search(transcript):
        return "transit", 0.95
    if _RE_WHEELCHAIR_MODE.search(transcript):
        return "wheelchair", 0.95
    return None, 0.0

def detect_confirmation_intent(transcript: str) -> Tuple[Optional[bool], float]:
    if not transcript:
        return None, 0.0
    if _RE_YES.search(transcript):
        return True, 0.9
    if _RE_NO.search(transcript):
        return False, 0.9
    return None, 0.0

# ============================================================================
# WHISPER MODEL (M1 Optimized)
# ============================================================================

_whisper_model = None
_model_lock = threading.Lock()

def get_whisper_model():
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    
    with _model_lock:
        if _whisper_model is not None:
            return _whisper_model
        
        if not WHISPER_AVAILABLE:
            return None
        
        try:
            logger.info(f"Loading {WHISPER_BACKEND} model '{WHISPER_MODEL_NAME}'...")
            start_time = time.time()
            
            if WHISPER_BACKEND == "faster-whisper":
                _whisper_model = WhisperModel(
                    WHISPER_MODEL_NAME,
                    device="cpu",
                    compute_type=WHISPER_COMPUTE_TYPE,
                    cpu_threads=WHISPER_CPU_THREADS,
                    num_workers=WHISPER_NUM_WORKERS
                )
            else:
                import whisper
                _whisper_model = whisper.load_model(WHISPER_MODEL_NAME)
            
            logger.info(f"Model loaded in {time.time() - start_time:.2f}s")
            return _whisper_model
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return None

def transcribe_audio_bytes(audio_bytes: bytes, context: str = "address") -> Tuple[str, float]:
    """Transcribe PCM audio and remove number hyphens."""
    if len(audio_bytes) < 3200:
        return "", 0.0
    
    model = get_whisper_model()
    if model is None:
        return "", 0.0
    
    try:
        audio_int16 = np.frombuffer(audio_bytes, dtype=np.int16)
        audio_float32 = audio_int16.astype(np.float32) / 32768.0
        
        if WHISPER_BACKEND == "faster-whisper":
            segments, _ = model.transcribe(
                audio_float32,
                language="en",
                beam_size=1,
                best_of=1,
                vad_filter=False,
                vad_parameters=dict(min_silence_duration_ms=300)
            )
            raw_text = "".join(seg.text for seg in segments).strip()
            
            # CRITICAL: Remove hyphens from numbers (1-0-4 → 104)
            raw_text = remove_number_hyphens(raw_text)
        else:
            result = model.transcribe(audio_float32, language="en", fp16=False)
            raw_text = result.get("text", "").strip()
        
        if not raw_text:
            return "", 0.0
        
        logger.info(f"Whisper raw: '{raw_text}'")
        return correct_transcript(raw_text, context=context)
    
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        return "", 0.0

# ============================================================================
# SESSION MANAGEMENT
# ============================================================================

class VoiceSession:
    __slots__ = ('session_id', 'socket_id', 'audio_buffer', 'context', 'created_at', 'last_activity')
    def __init__(self, session_id: str, socket_id: str):
        self.session_id = session_id
        self.socket_id = socket_id
        self.audio_buffer = bytearray()
        self.context = "address"
        self.created_at = time.time()
        self.last_activity = time.time()

_voice_sessions: Dict[str, VoiceSession] = {}
_sessions_lock = threading.Lock()

def create_voice_session(socket_id: str) -> Optional[str]:
    if not WHISPER_AVAILABLE:
        return None
    if get_whisper_model() is None:
        return None
    
    session_id = f"vs-{int(time.time())}-{random.randint(1000, 9999)}"
    with _sessions_lock:
        _voice_sessions[session_id] = VoiceSession(session_id, socket_id)
    
    logger.info(f"Voice session created: {session_id}")
    return session_id

def destroy_voice_session(session_id: str):
    with _sessions_lock:
        if session_id in _voice_sessions:
            del _voice_sessions[session_id]

def append_audio(session_id: str, audio_bytes: bytes):
    with _sessions_lock:
        session = _voice_sessions.get(session_id)
        if session:
            session.audio_buffer.extend(audio_bytes)
            session.last_activity = time.time()

def finalize_audio(session_id: str) -> Tuple[str, float]:
    with _sessions_lock:
        session = _voice_sessions.get(session_id)
        if not session or not session.audio_buffer:
            return "", 0.0
        audio_bytes = bytes(session.audio_buffer)
        context = session.context
        session.audio_buffer = bytearray()
    
    return transcribe_audio_bytes(audio_bytes, context=context)

def set_session_context(session_id: str, context: str):
    with _sessions_lock:
        session = _voice_sessions.get(session_id)
        if session:
            session.context = context

def cleanup_stale_sessions():
    now = time.time()
    with _sessions_lock:
        stale = [sid for sid, s in _voice_sessions.items() 
                 if now - s.last_activity > 1800]
    for sid in stale:
        destroy_voice_session(sid)

# ============================================================================
# SOCKET.IO HANDLERS
# ============================================================================

def init_voice_handler(app, socketio):
    """Register voice handlers with Socket.IO."""
    
    def cleanup_loop():
        while True:
            time.sleep(300)
            cleanup_stale_sessions()
    
    threading.Thread(target=cleanup_loop, daemon=True).start()
    
    @socketio.on('voice_start_session')
    def handle_start(data):
        from flask_socketio import emit
        from flask import request
        sid = request.sid
        
        if not WHISPER_AVAILABLE:
            emit('voice_error', {'error': 'Whisper not installed'})
            return
        
        session_id = create_voice_session(sid)
        if not session_id:
            emit('voice_error', {'error': 'Model not loaded'})
            return
        
        emit('voice_session_created', {
            'session_id': session_id,
            'engine': WHISPER_BACKEND,
            'model': WHISPER_MODEL_NAME,
            'sample_rate': 16000
        })
    
    @socketio.on('voice_set_context')
    def handle_context(data):
        session_id = data.get('session_id')
        context = data.get('context', 'address')
        if session_id:
            set_session_context(session_id, context)
    
    @socketio.on('voice_audio_chunk')
    def handle_chunk(data):
        session_id = data.get('session_id')
        audio_data = data.get('audio_data')
        
        if not session_id or not audio_data:
            return
        
        if isinstance(audio_data, dict):
            return
        
        if isinstance(audio_data, (bytes, bytearray)):
            append_audio(session_id, bytes(audio_data))
        elif isinstance(audio_data, list):
            try:
                append_audio(session_id, bytes(audio_data))
            except:
                pass
    
    @socketio.on('voice_stop_recording')
    def handle_stop(data):
        from flask_socketio import emit
        session_id = data.get('session_id')
        if not session_id:
            return
        
        transcript, confidence = finalize_audio(session_id)
        emit('voice_final_result', {
            'transcript': transcript,
            'confidence': confidence,
            'session_id': session_id,
            'engine': WHISPER_BACKEND
        })
    
    @socketio.on('voice_destroy_session')
    def handle_destroy(data):
        session_id = data.get('session_id')
        if session_id:
            destroy_voice_session(session_id)
    
    @socketio.on('disconnect')
    def handle_disconnect():
        from flask import request
        sid = request.sid
        with _sessions_lock:
            to_delete = [s for s, sess in _voice_sessions.items() if sess.socket_id == sid]
        for session_id in to_delete:
            destroy_voice_session(session_id)
    
    @app.route('/api/voice/status', methods=['GET'])
    def voice_status():
        from flask import jsonify
        model = get_whisper_model()
        return jsonify({
            'vosk_installed': WHISPER_AVAILABLE,
            'model_loaded': model is not None,
            'engine': WHISPER_BACKEND if WHISPER_AVAILABLE else None,
            'model_name': WHISPER_MODEL_NAME,
            'active_sessions': len(_voice_sessions)
        })
    
    @app.route('/api/voice/search', methods=['POST'])
    def voice_search():
        from flask import request, jsonify
        data = request.json or {}
        query = data.get('query', '')
        limit = data.get('limit', 5)
        
        if not query:
            return jsonify({'results': []})
        
        results = fuzzy_search_address(query, limit)
        return jsonify({'results': results})
    
    logger.info(f"Voice handler initialized with address resolution + number hyphen fix")
    return app