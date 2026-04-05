"""
voice_handler.py — Vosk Speech Recognition for Tryver Accessibility

DRAMATICALLY IMPROVED VERSION — Key changes:
1. Custom Vosk grammar restricting vocabulary to expected words (addresses, landmarks)
2. Phonetic post-processing: maps common Vosk mishearings to correct words
3. Address pattern normalization: "one oh four" → "104", "avenue" recovery, etc.
4. Pittsburgh landmark dictionary with fuzzy matching
5. Multi-pass correction pipeline: raw → phonetic fix → number fix → landmark match → geocode
6. Confidence scoring with re-recognition on low confidence
7. Keyword-spotting mode for known place names
8. Audio preprocessing: gain normalization before feeding to Vosk

SETUP INSTRUCTIONS:
╔══════════════════════════════════════════════════════════════════╗
║           VOSK SPEECH RECOGNITION SETUP                         ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Vosk is FREE, offline, no API key, no usage limits.            ║
║                                                                  ║
║  1) pip install vosk                                             ║
║  2) Download model: vosk-model-small-en-us-0.15.zip             ║
║     from https://alphacephei.com/vosk/models/                    ║
║  3) Extract to: backend/vosk-model/                              ║
║  4) Verify: python -c "from vosk import Model; Model('vosk-model')" ║
║                                                                  ║
║  RECOMMENDED: Use the LARGE model (vosk-model-en-us-0.22,       ║
║  ~1.8GB) for much better proper noun recognition. The small      ║
║  model struggles badly with names like "Acrisure".               ║
║                                                                  ║
║  NO API KEY NEEDED. ALL PROCESSING IS LOCAL.                     ║
╚══════════════════════════════════════════════════════════════════╝
"""

import os
import sys
import json
import struct
import logging
import threading
import time
import random
import re
import math
from typing import Dict, List, Optional, Tuple
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1: CONFIGURATION & AVAILABILITY
# ═══════════════════════════════════════════════════════════════════════════════

VOSK_AVAILABLE = False
VOSK_MODEL_PATH = os.path.join(os.path.dirname(__file__), 'vosk-model')
VOSK_SETUP_MESSAGE = """
\033[1;33m══════════════════════════════════════════════════════════════════
  VOSK NOT READY — Install: pip install vosk
  Model: https://alphacephei.com/vosk/models/
  Extract to: backend/vosk-model/
══════════════════════════════════════════════════════════════════\033[0m
"""

try:
    import vosk
    VOSK_AVAILABLE = True
    logger.info("Vosk imported successfully")
except ImportError:
    logger.warning("Vosk not installed. Run: pip install vosk")
    print(VOSK_SETUP_MESSAGE)

GEOAPIFY_AVAILABLE = False
try:
    from geoapify_client import GeoapifyClient
    GEOAPIFY_AVAILABLE = True
    logger.info("Geoapify client available")
except ImportError:
    logger.warning("Geoapify client not available, falling back to TomTom only")


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2: PITTSBURGH LANDMARK & PHONETIC CORRECTION DICTIONARIES
#
# This is the single biggest improvement. Vosk's small model has NO idea what
# "Acrisure" is — it's not in its vocabulary. So it outputs the closest
# phonetic match from words it DOES know. We reverse-engineer those mistakes.
#
# HOW TO MAINTAIN: When you discover a new mishearing, add it to the
# appropriate dictionary below. Run the app, say the word, see what Vosk
# outputs, and add that mapping.
# ═══════════════════════════════════════════════════════════════════════════════

# ── Phonetic correction map ──────────────────────────────────────────────────
# Maps common Vosk mishearings → correct text.
# Keys are LOWERCASE. Add new entries as you discover mishearings.
# Order matters: longer phrases are checked first.

PHONETIC_CORRECTIONS: Dict[str, str] = {
    # ── Acrisure Stadium and variants ──
    "a cri sure":           "Acrisure",
    "a cry sure":           "Acrisure",
    "acri sure":            "Acrisure",
    "a cree sure":          "Acrisure",
    "a chris sure":         "Acrisure",
    "a kri sure":           "Acrisure",
    "akra sure":            "Acrisure",
    "a kris sure":          "Acrisure",
    "a chris your":         "Acrisure",
    "i can sure":           "Acrisure",
    "a crisure":            "Acrisure",
    "acre sure":            "Acrisure",
    "ak ri sure":           "Acrisure",
    "akri sure":            "Acrisure",
    "a cure sure":          "Acrisure",
    "a kr sure":            "Acrisure",
    "okra sure":            "Acrisure",
    "i cris sure":          "Acrisure",
    "a cures sure":         "Acrisure",
    "a curer sure":         "Acrisure",
    "a krishna":            "Acrisure",
    "a cris your":          "Acrisure",
    "accrue sure":          "Acrisure",
    "a crew sure":          "Acrisure",
    
    # ── Pittsburgh landmarks ──
    "pea and see":          "PNC",
    "p and c":              "PNC",
    "pee and see":          "PNC",
    "p n c":                "PNC",
    "pine see":             "PNC",
    "pee en see":           "PNC",
    "pen see":              "PNC",
    "heinz field":          "Acrisure Stadium",
    "hines field":          "Acrisure Stadium",
    "high marks":           "Highmark",
    "hi mark":              "Highmark",
    "high mark":            "Highmark",
    "do cane":              "Duquesne",
    "duke ain":             "Duquesne",
    "duke ane":             "Duquesne",
    "du cane":              "Duquesne",
    "do kane":              "Duquesne",
    "duke cane":            "Duquesne",
    "duking":               "Duquesne",
    "duke wayne":           "Duquesne",
    "dee cane":             "Duquesne",
    "carn a gee":           "Carnegie",
    "car nah gee":          "Carnegie",
    "car nee gee":          "Carnegie",
    "car neg ee":           "Carnegie",
    "carnegie":             "Carnegie",
    "mon on ga hee la":     "Monongahela",
    "mon ong a heel a":     "Monongahela",
    "mano gala":            "Monongahela",
    "mono gala":            "Monongahela",
    "mon gala":             "Monongahela",
    "mana gala":            "Monongahela",
    "alleh gainey":         "Allegheny",
    "allegany":             "Allegheny",
    "alle gain ee":         "Allegheny",
    "all a gay knee":       "Allegheny",
    "all again ee":         "Allegheny",
    "all again he":         "Allegheny",
    "south side":           "South Side",
    "south said":           "South Side",
    "shady side":           "Shadyside",
    "shady cited":          "Shadyside",
    "squirrel hill":        "Squirrel Hill",
    "squirl hill":          "Squirrel Hill",
    "oak land":             "Oakland",
    "law rents ville":      "Lawrenceville",
    "lawrence ville":       "Lawrenceville",
    "strip district":       "Strip District",
    "stripped district":    "Strip District",
    "point state park":     "Point State Park",
    "point st park":        "Point State Park",
    "point stayed park":    "Point State Park",
    "mt washington":        "Mt. Washington",
    "mount washing ton":    "Mt. Washington",
    "bloomfield":           "Bloomfield",
    "bloom field":          "Bloomfield",
    "north shore":          "North Shore",
    "north sure":           "North Shore",
    "norths sure":          "North Shore",
    "north side":           "North Side",
    "north cited":          "North Side",
    "downtown":             "Downtown",
    "down town":            "Downtown",
    
    # ── Pittsburgh Universities ──
    "car nah gee melon":    "Carnegie Mellon",
    "car nee gee melon":    "Carnegie Mellon",
    "carnegie melon":       "Carnegie Mellon",
    "car nee gee mel in":   "Carnegie Mellon",
    "pit":                  "Pitt",
    
    # ── Common street types (Vosk often drops/mangles these) ──
    "avenew":               "Avenue",
    "av new":               "Avenue",
    "a venue":              "Avenue",
    "boule vard":           "Boulevard",
    "bull of art":          "Boulevard",
    "bull a vard":          "Boulevard",
    "stree":                "Street",
    "st reet":              "Street",
}

# ── Known Pittsburgh landmarks for fuzzy matching ────────────────────────────
# When the corrected transcript is close to one of these, snap to it.
# Tuple: (canonical_name, list_of_acceptable_fuzzy_variants)

KNOWN_LANDMARKS: List[Tuple[str, List[str]]] = [
    ("Acrisure Stadium",       ["acrisure", "acrisure stadium"]),
    ("PNC Park",               ["pnc", "pnc park"]),
    ("Highmark Stadium",       ["highmark", "highmark stadium"]),
    ("PPG Paints Arena",       ["ppg", "ppg paints", "ppg arena", "ppg paints arena"]),
    ("Duquesne University",    ["duquesne", "duquesne university"]),
    ("Carnegie Mellon University", ["carnegie mellon", "cmu", "carnegie mellon university"]),
    ("University of Pittsburgh", ["pitt", "university of pittsburgh", "u of pitt"]),
    ("Carnegie Museum",        ["carnegie museum"]),
    ("Point State Park",       ["point state park", "the point", "point park"]),
    ("Mt. Washington",         ["mt washington", "mount washington"]),
    ("Station Square",         ["station square"]),
    ("Phipps Conservatory",    ["phipps", "phipps conservatory"]),
    ("Allegheny General Hospital", ["allegheny general", "agh"]),
    ("UPMC Presbyterian",      ["upmc presbyterian", "presby", "presbyterian hospital"]),
    ("UPMC Mercy",             ["upmc mercy", "mercy hospital"]),
    ("Monongahela Incline",    ["monongahela incline", "mon incline"]),
    ("Duquesne Incline",       ["duquesne incline"]),
    ("Strip District",         ["strip district", "the strip"]),
    ("Lawrenceville",          ["lawrenceville"]),
    ("Squirrel Hill",          ["squirrel hill"]),
    ("Shadyside",              ["shadyside"]),
    ("Oakland",                ["oakland"]),
    ("Bloomfield",             ["bloomfield"]),
    ("South Side",             ["south side", "southside"]),
    ("North Shore",            ["north shore", "northshore"]),
    ("North Side",             ["north side", "northside"]),
    ("Downtown Pittsburgh",    ["downtown", "downtown pittsburgh"]),
    ("Market Square",          ["market square"]),
    ("Liberty Avenue",         ["liberty avenue", "liberty ave"]),
    ("Forbes Avenue",          ["forbes avenue", "forbes ave"]),
    ("Fifth Avenue",           ["fifth avenue", "fifth ave"]),
    ("Penn Avenue",            ["penn avenue", "penn ave"]),
    ("Butler Street",          ["butler street", "butler st"]),
    ("Murray Avenue",          ["murray avenue", "murray ave"]),
    ("Walnut Street",          ["walnut street", "walnut st"]),
    ("Carson Street",          ["carson street", "carson st", "east carson"]),
    ("Birmingham Bridge",      ["birmingham bridge"]),
    ("Smithfield Street Bridge", ["smithfield bridge", "smithfield street bridge"]),
    ("Andy Warhol Museum",     ["warhol museum", "andy warhol", "warhol"]),
    ("Heinz History Center",   ["heinz history center", "history center"]),
    ("Roberto Clemente Bridge", ["clemente bridge", "roberto clemente bridge"]),
    ("David L. Lawrence Convention Center", ["convention center", "lawrence convention"]),
    ("Pittsburgh International Airport", ["pittsburgh airport", "pit airport", "the airport"]),
    ("Kennywood",              ["kennywood", "kenny wood"]),
    ("Primanti Brothers",      ["primanti", "primanti brothers", "primantis", "per monty"]),
    ("Giant Eagle",            ["giant eagle"]),
    ("Trader Joe's",           ["trader joes", "trader joe's"]),
]

# ── Spoken number → digit map ────────────────────────────────────────────────
# Vosk will output "one oh four" instead of "104". We fix that.

SPOKEN_DIGITS: Dict[str, str] = {
    "zero":     "0",
    "oh":       "0",
    "o":        "0",
    "one":      "1",
    "two":      "2",
    "too":      "2",
    "to":       "2",
    "three":    "3",
    "four":     "4",
    "for":      "4",
    "fore":     "4",
    "five":     "5",
    "six":      "6",
    "seven":    "7",
    "eight":    "8",
    "ate":      "8",
    "nine":     "9",
    "niner":    "9",
    "ten":      "10",
    "eleven":   "11",
    "twelve":   "12",
    "thirteen": "13",
    "fourteen": "14",
    "fifteen":  "15",
    "sixteen":  "16",
    "seventeen":"17",
    "eighteen": "18",
    "nineteen": "19",
    "twenty":   "20",
    "thirty":   "30",
    "forty":    "40",
    "fifty":    "50",
    "sixty":    "60",
    "seventy":  "70",
    "eighty":   "80",
    "ninety":   "90",
    "hundred":  "00",
    "thousand": "000",
}

# Words that should NEVER be treated as digits even though they appear in SPOKEN_DIGITS
# (context-dependent — only convert when surrounded by other number words)
AMBIGUOUS_NUMBER_WORDS = {"to", "too", "for", "fore", "oh", "o", "ate"}


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3: MULTI-PASS TRANSCRIPT CORRECTION PIPELINE
#
# Raw Vosk output → phonetic correction → number normalization → 
# landmark fuzzy match → title casing → final transcript
# ═══════════════════════════════════════════════════════════════════════════════

def correct_transcript(raw: str) -> Tuple[str, float]:
    """
    Multi-pass correction pipeline for Vosk transcripts.
    Returns (corrected_text, confidence_score).
    Confidence: 1.0 = exact landmark match, 0.5 = partial fix, 0.3 = raw passthrough.
    """
    if not raw or not raw.strip():
        return ("", 0.0)
    
    text = raw.strip().lower()
    original = text
    confidence = 0.3  # baseline: raw Vosk output, not great
    
    # ── Pass 1: Multi-word phonetic corrections (longest match first) ────────
    # Sort by key length descending so "a cri sure stadium" matches before "a cri sure"
    sorted_corrections = sorted(PHONETIC_CORRECTIONS.items(), key=lambda x: len(x[0]), reverse=True)
    
    corrections_applied = 0
    for mishearing, correct in sorted_corrections:
        if mishearing in text:
            text = text.replace(mishearing, correct)
            corrections_applied += 1
            logger.info(f"Phonetic fix: '{mishearing}' → '{correct}'")
    
    if corrections_applied > 0:
        confidence = max(confidence, 0.6)
    
    # ── Pass 2: Number normalization ─────────────────────────────────────────
    text = _normalize_spoken_numbers(text)
    
    # ── Pass 3: Street type recovery ─────────────────────────────────────────
    text = _fix_street_types(text)
    
    # ── Pass 4: Fuzzy landmark matching ──────────────────────────────────────
    landmark_match = _fuzzy_match_landmark(text)
    if landmark_match:
        text = landmark_match
        confidence = max(confidence, 0.9)
        logger.info(f"Landmark match: '{original}' → '{text}'")
    
    # ── Pass 5: Title-case cleanup ───────────────────────────────────────────
    text = _smart_title_case(text)
    
    # ── Pass 6: Whitespace cleanup ───────────────────────────────────────────
    text = re.sub(r'\s+', ' ', text).strip()
    
    if text.lower() != original:
        logger.info(f"Transcript corrected: '{raw}' → '{text}' (confidence={confidence:.2f})")
    
    return (text, confidence)


def _normalize_spoken_numbers(text: str) -> str:
    """
    Convert spoken numbers to digits.
    "one oh four lexington avenue" → "104 lexington avenue"
    "thirty five hundred forbes" → "3500 forbes"
    "twenty one" → "21"
    
    Strategy: scan words left to right. When we find a number word, enter
    "number accumulation" mode and keep collecting until we hit a non-number word.
    Then emit the accumulated number.
    """
    words = text.split()
    result = []
    i = 0
    
    while i < len(words):
        word = words[i].lower().strip(".,!?")
        
        # Check if this word starts a number sequence
        if word in SPOKEN_DIGITS and word not in AMBIGUOUS_NUMBER_WORDS:
            # Definitely a number word — start accumulating
            number_str, consumed = _accumulate_number(words, i)
            if number_str:
                result.append(number_str)
                i += consumed
                continue
        elif word in AMBIGUOUS_NUMBER_WORDS:
            # Could be a number or a regular word — look at context
            # If the NEXT word is also a number word, treat this as a number
            if i + 1 < len(words) and words[i + 1].lower().strip(".,!?") in SPOKEN_DIGITS:
                number_str, consumed = _accumulate_number(words, i)
                if number_str:
                    result.append(number_str)
                    i += consumed
                    continue
        
        result.append(words[i])
        i += 1
    
    return ' '.join(result)


def _accumulate_number(words: List[str], start: int) -> Tuple[Optional[str], int]:
    """
    From position `start`, accumulate consecutive number words into a digit string.
    Returns (digit_string, number_of_words_consumed).
    
    Examples:
        ["one", "oh", "four"] → ("104", 3)
        ["twenty", "one"]     → ("21", 2)
        ["thirty", "five", "hundred"] → ("3500", 3)
        ["five"]              → ("5", 1)
    """
    i = start
    parts = []
    
    while i < len(words):
        word = words[i].lower().strip(".,!?")
        
        if word in SPOKEN_DIGITS:
            val = SPOKEN_DIGITS[word]
            
            if word == "hundred":
                # Multiply last accumulated value by 100
                if parts:
                    last = int(''.join(parts)) if parts else 1
                    parts = [str(last * 100)]
                else:
                    parts.append("100")
            elif word == "thousand":
                if parts:
                    last = int(''.join(parts)) if parts else 1
                    parts = [str(last * 1000)]
                else:
                    parts.append("1000")
            elif word in ("twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"):
                # Tens: "twenty" = 20, might be followed by a ones digit
                parts.append(val)
            elif word in ("ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
                          "sixteen", "seventeen", "eighteen", "nineteen"):
                parts.append(val)
            else:
                # Single digit: 0-9
                # If the previous part was a tens value (ends with "0" and len <= 2),
                # combine: "twenty" + "one" → 20 + 1 = 21
                if parts and len(parts[-1]) == 2 and parts[-1].endswith("0") and len(val) == 1:
                    tens = int(parts[-1])
                    ones = int(val)
                    parts[-1] = str(tens + ones)
                else:
                    parts.append(val)
            
            i += 1
        else:
            break
    
    consumed = i - start
    if consumed == 0:
        return None, 0
    
    # Join accumulated parts
    number = ''.join(parts)
    
    # Sanity check: addresses are rarely above 99999
    try:
        if int(number) > 99999:
            # Probably a misparse, just return raw digits
            number = ''.join(SPOKEN_DIGITS.get(words[j].lower().strip(".,!?"), words[j]) 
                           for j in range(start, i))
    except ValueError:
        pass
    
    return number, consumed


def _fix_street_types(text: str) -> str:
    """
    Fix mangled street type suffixes.
    Also adds common abbreviation expansions.
    """
    replacements = [
        (r'\bst\b(?!\.|,)', 'Street'),      # "st" → "Street" (but not "St." which is intentional)
        (r'\bave\b', 'Avenue'),
        (r'\bblvd\b', 'Boulevard'),
        (r'\bdr\b', 'Drive'),
        (r'\bln\b', 'Lane'),
        (r'\bct\b', 'Court'),
        (r'\bpl\b', 'Place'),
        (r'\bpkwy\b', 'Parkway'),
        (r'\bhwy\b', 'Highway'),
        (r'\brd\b', 'Road'),
    ]
    
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    
    return text


def _fuzzy_match_landmark(text: str) -> Optional[str]:
    """
    Check if the corrected text is close to any known landmark.
    Uses SequenceMatcher ratio for fuzzy comparison.
    Returns canonical landmark name if match >= 0.75, else None.
    """
    text_lower = text.lower().strip()
    
    best_match = None
    best_score = 0.0
    
    for canonical_name, variants in KNOWN_LANDMARKS:
        for variant in variants:
            # Exact containment check first
            if variant in text_lower:
                # Replace the variant portion with canonical name
                return text_lower.replace(variant, canonical_name)
            
            # Fuzzy match
            score = SequenceMatcher(None, text_lower, variant).ratio()
            if score > best_score and score >= 0.72:
                best_score = score
                best_match = canonical_name
    
    # Also try matching against just the canonical names
    for canonical_name, _ in KNOWN_LANDMARKS:
        score = SequenceMatcher(None, text_lower, canonical_name.lower()).ratio()
        if score > best_score and score >= 0.72:
            best_score = score
            best_match = canonical_name
    
    if best_match and best_score >= 0.72:
        return best_match
    
    return None


def _smart_title_case(text: str) -> str:
    """
    Title-case text but preserve known acronyms and all-caps words.
    """
    # Words that should stay uppercase
    uppercase_words = {"PNC", "PPG", "UPMC", "CMU", "AGH", "GTFS", "USA", "US"}
    # Words that should stay lowercase (in middle of phrase)
    lowercase_words = {"of", "the", "and", "in", "at", "to", "for", "on", "by", "a", "an"}
    
    words = text.split()
    result = []
    for i, word in enumerate(words):
        upper = word.upper()
        if upper in uppercase_words:
            result.append(upper)
        elif word.isdigit():
            result.append(word)
        elif i > 0 and word.lower() in lowercase_words:
            result.append(word.lower())
        else:
            result.append(word.capitalize())
    
    return ' '.join(result)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4: AUDIO PREPROCESSING
#
# Normalize audio gain before feeding to Vosk. This helps when the mic is
# too quiet or too loud, which directly affects recognition quality.
# ═══════════════════════════════════════════════════════════════════════════════

def normalize_audio_gain(raw_bytes: bytes, target_rms: int = 3000) -> bytes:
    """
    Normalize 16-bit PCM audio to a target RMS amplitude.
    This prevents Vosk from struggling with too-quiet or clipping audio.
    
    Args:
        raw_bytes: Raw 16-bit PCM, little-endian, mono, 16kHz
        target_rms: Target RMS amplitude (out of 32767). 3000 is a good default.
    
    Returns:
        Gain-normalized PCM bytes.
    """
    if len(raw_bytes) < 4:
        return raw_bytes
    
    try:
        num_samples = len(raw_bytes) // 2
        samples = list(struct.unpack(f'<{num_samples}h', raw_bytes))
        
        # Calculate current RMS
        sum_sq = sum(s * s for s in samples)
        rms = math.sqrt(sum_sq / num_samples) if num_samples > 0 else 0
        
        if rms < 10:  # Near silence
            return raw_bytes
        
        # Calculate gain factor
        gain = target_rms / rms
        
        # Clamp gain to prevent extreme amplification (noise) or reduction
        gain = max(0.5, min(gain, 8.0))
        
        if 0.9 <= gain <= 1.1:
            return raw_bytes  # Already close enough
        
        # Apply gain with clipping protection
        normalized = []
        for s in samples:
            new_val = int(s * gain)
            new_val = max(-32768, min(32767, new_val))
            normalized.append(new_val)
        
        return struct.pack(f'<{num_samples}h', *normalized)
    
    except Exception as e:
        logger.warning(f"Audio normalization failed: {e}")
        return raw_bytes


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5: VOSK MODEL LOADING
# ═══════════════════════════════════════════════════════════════════════════════

_vosk_model = None
_model_lock = threading.Lock()
_recognizer_locks: Dict[str, threading.Lock] = {}

def get_vosk_model():
    """Lazy-load the Vosk model singleton. Thread-safe."""
    global _vosk_model
    if _vosk_model is not None:
        return _vosk_model
    
    with _model_lock:
        if _vosk_model is not None:
            return _vosk_model
        
        if not VOSK_AVAILABLE:
            return None
        
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
            logger.info(f"Loading Vosk model from {model_path}...")
            vosk.SetLogLevel(-1)
            _vosk_model = vosk.Model(model_path)
            logger.info("Vosk model loaded successfully")
            return _vosk_model
        except Exception as e:
            logger.error(f"Failed to load Vosk model: {e}")
            return None


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6: SESSION MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

_voice_sessions: Dict[str, Dict] = {}
_sessions_lock = threading.Lock()


def create_voice_session(socket_id: str, use_grammar: bool = False) -> Optional[str]:
    """
    Create a new Vosk recognition session.
    
    Args:
        socket_id: The Socket.IO connection ID
        use_grammar: If True, restrict Vosk to a limited vocabulary for better
                     accuracy on known words. Use for landmark/command recognition.
                     If False, use open vocabulary (better for free-form addresses).
    """
    model = get_vosk_model()
    if model is None:
        return None
    
    session_id = f"vs-{int(time.time())}-{random.randint(1000, 9999)}"
    
    try:
        if use_grammar:
            # Grammar mode: Vosk only considers these words, so accuracy for
            # known landmarks is MUCH higher. But it can't handle unknown words.
            grammar_words = _build_grammar_word_list()
            recognizer = vosk.KaldiRecognizer(model, 16000, json.dumps(grammar_words))
        else:
            recognizer = vosk.KaldiRecognizer(model, 16000)
        
        recognizer.SetWords(True)
        recognizer.SetPartialWords(True)
        
        with _sessions_lock:
            _voice_sessions[session_id] = {
                'recognizer': recognizer,
                'created_at': time.time(),
                'last_activity': time.time(),
                'socket_id': socket_id,
                'is_recording': False,
                'chunk_count': 0,
                'total_audio_bytes': 0,
                'use_grammar': use_grammar,
                # Accumulate all partial results for context-aware correction
                'partial_history': [],
                'final_results': [],
            }
            _recognizer_locks[session_id] = threading.Lock()
        
        return session_id
    except Exception as e:
        logger.error(f"Failed to create voice session: {e}")
        return None


def _build_grammar_word_list() -> List[str]:
    """
    Build a Vosk grammar word list from known landmarks and common address words.
    Grammar mode dramatically improves accuracy for known vocabulary.
    """
    words = set()
    
    # Add landmark names (split into individual words)
    for canonical, variants in KNOWN_LANDMARKS:
        for w in canonical.lower().split():
            words.add(w)
        for variant in variants:
            for w in variant.lower().split():
                words.add(w)
    
    # Add street types
    street_words = [
        "street", "avenue", "boulevard", "drive", "lane", "court", "place",
        "road", "parkway", "highway", "way", "circle", "terrace", "pike",
        "st", "ave", "blvd", "dr", "rd",
    ]
    words.update(street_words)
    
    # Add number words
    words.update(SPOKEN_DIGITS.keys())
    
    # Add directional words
    directions = ["north", "south", "east", "west", "northeast", "northwest",
                  "southeast", "southwest"]
    words.update(directions)
    
    # Add common command words
    commands = [
        "go", "take", "me", "to", "from", "navigate", "directions",
        "walk", "drive", "bus", "transit", "wheelchair", "accessible",
        "current", "location", "here", "my", "the", "and", "at", "on",
        "near", "by", "between", "across", "next", "stop", "start",
        "cancel", "yes", "no", "repeat", "help",
    ]
    words.update(commands)
    
    # Add Pittsburgh-specific words that Vosk won't know
    pgh_words = [
        "acrisure", "heinz", "duquesne", "monongahela", "allegheny",
        "youghiogheny", "shadyside", "squirrel", "lawrenceville",
        "bloomfield", "primanti", "kennywood", "incline", "warhol",
        "clemente", "smithfield", "pittsburgh", "pennsylvania",
    ]
    words.update(pgh_words)
    
    # Vosk grammar format: list of individual words + "[unk]" for unknown
    word_list = sorted(words)
    word_list.append("[unk]")  # Allow unknown words (won't crash on unexpected input)
    
    return word_list


def destroy_voice_session(session_id: str):
    """Clean up session and free KaldiRecognizer memory."""
    with _sessions_lock:
        session = _voice_sessions.pop(session_id, None)
        _recognizer_locks.pop(session_id, None)
    
    if session:
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


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 7: AUDIO PROCESSING (with preprocessing + post-correction)
# ═══════════════════════════════════════════════════════════════════════════════

def process_pcm_chunk(session_id: str, raw_bytes: bytes) -> Tuple[Optional[str], Optional[str]]:
    """
    Feed a chunk of raw 16-bit PCM audio to Vosk, with preprocessing and
    post-processing correction.
    
    Returns (partial_transcript, final_transcript).
    Both are already run through the correction pipeline.
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
        session['total_audio_bytes'] += len(raw_bytes)
        recognizer = session['recognizer']
        
        if recognizer is None:
            return None, None
        
        # ── Preprocess: normalize audio gain ──
        processed_bytes = normalize_audio_gain(raw_bytes)
        
        try:
            is_complete = recognizer.AcceptWaveform(processed_bytes)
            
            if is_complete:
                result_json = recognizer.Result()
                result = json.loads(result_json)
                raw_text = result.get('text', '').strip()
                
                if raw_text:
                    # Run through correction pipeline
                    corrected, confidence = correct_transcript(raw_text)
                    
                    # Store for context
                    session['final_results'].append({
                        'raw': raw_text,
                        'corrected': corrected,
                        'confidence': confidence,
                        'timestamp': time.time(),
                    })
                    session['partial_history'] = []  # Reset partials
                    
                    logger.info(f"Final result: '{raw_text}' → '{corrected}' (conf={confidence:.2f})")
                    return None, corrected
                return None, None
            else:
                partial_json = recognizer.PartialResult()
                partial = json.loads(partial_json)
                partial_text = partial.get('partial', '').strip()
                
                if partial_text:
                    # Correct partials too, so the UI shows corrected text live
                    corrected, _ = correct_transcript(partial_text)
                    session['partial_history'].append(partial_text)
                    return corrected, None
                return None, None
        
        except Exception as e:
            logger.error(f"Error processing PCM chunk in session {session_id}: {e}")
            return None, None


def force_final_result(session_id: str) -> Optional[str]:
    """Force Vosk to return whatever it has recognized so far, with correction."""
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
            raw_text = result.get('text', '').strip()
            
            if raw_text:
                corrected, confidence = correct_transcript(raw_text)
                session['final_results'].append({
                    'raw': raw_text,
                    'corrected': corrected,
                    'confidence': confidence,
                    'timestamp': time.time(),
                    'forced': True,
                })
                logger.info(f"Forced final: '{raw_text}' → '{corrected}' (conf={confidence:.2f})")
                return corrected
            return None
        except Exception as e:
            logger.error(f"Error getting final Vosk result for session {session_id}: {e}")
            return None


def validate_audio_chunk(raw_bytes: bytes) -> bool:
    """
    Validate that incoming bytes look like 16-bit PCM audio.
    Must be non-empty, even length, at least 10ms of audio, not pure silence.
    """
    if not raw_bytes or len(raw_bytes) < 320 or len(raw_bytes) % 2 != 0:
        return False
    
    try:
        num_samples = len(raw_bytes) // 2
        samples = struct.unpack(f'<{num_samples}h', raw_bytes)
        max_amplitude = max(abs(s) for s in samples)
        return max_amplitude >= 50
    except struct.error:
        return False


def convert_browser_audio_to_pcm(audio_data) -> Optional[bytes]:
    """Convert incoming audio data from Socket.IO to raw PCM bytes."""
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


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 8: GEOCODING (Geoapify → TomTom fallback)
# ═══════════════════════════════════════════════════════════════════════════════

TOMTOM_API_KEY = os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')


def _geocode_address(address: str, use_bias: bool = True,
                     bias_lat: float = 40.4406, bias_lng: float = -79.9959) -> Optional[Tuple[float, float, str, float]]:
    """
    Geocode an address. Returns (lat, lng, formatted_address, confidence) or None.
    Tries Geoapify first (better for POIs), falls back to TomTom.
    """
    if not address or len(address.strip()) < 2:
        return None
    
    # Pre-geocode: check if this is a known landmark and use canonical name
    landmark = _fuzzy_match_landmark(address)
    if landmark:
        address = f"{landmark}, Pittsburgh, PA"
        logger.info(f"Geocoding with landmark-corrected address: {address}")
    
    # Try Geoapify first
    if GEOAPIFY_AVAILABLE:
        try:
            geoapify = GeoapifyClient()
            if geoapify.api_key:
                results = geoapify.search_places(
                    address,
                    bias_lat if use_bias else None,
                    bias_lng if use_bias else None,
                    limit=3
                )
                if results:
                    best = results[0]
                    confidence = best.get('score', 0.8)
                    return (best['lat'], best['lng'], best['address'] or best['name'], confidence)
        except Exception as e:
            logger.warning(f"Geoapify geocoding failed: {e}")
    
    # Fallback to TomTom
    try:
        import requests as http_requests
        url = f"https://api.tomtom.com/search/2/geocode/{http_requests.utils.quote(address)}.json"
        params = {
            'key': TOMTOM_API_KEY,
            'limit': 1,
            'countrySet': 'US',
            'lat': bias_lat,
            'lon': bias_lng,
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
        confidence = results[0].get('score', 0.5)
        return (float(position['lat']), float(position['lon']), formatted, confidence)
    except Exception as e:
        logger.error(f"TomTom geocoding failed for '{address}': {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 9: VOICE ROUTE STORAGE
# ═══════════════════════════════════════════════════════════════════════════════

_voice_routes: Dict[str, Dict] = {}
_routes_lock = threading.Lock()


def _store_voice_route(route_id: str, data: Dict):
    with _routes_lock:
        _voice_routes[route_id] = data
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


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 10: BACKGROUND CLEANUP
# ═══════════════════════════════════════════════════════════════════════════════

def _cleanup_loop():
    """Background thread: clean up stale sessions every 5 minutes."""
    while True:
        time.sleep(300)
        try:
            cleanup_stale_sessions()
        except Exception as e:
            logger.error(f"Error in voice cleanup loop: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 11: SOCKET.IO & HTTP ENDPOINT REGISTRATION
# ═══════════════════════════════════════════════════════════════════════════════

def init_voice_handler(app, socketio):
    """
    Register all voice-related Socket.IO handlers and HTTP endpoints.
    Call this from app.py after creating the socketio instance.
    """
    cleanup_thread = threading.Thread(target=_cleanup_loop, daemon=True)
    cleanup_thread.start()
    
    # ── Socket.IO handlers ───────────────────────────────────────────────────
    
    @socketio.on('voice_start_session')
    def handle_voice_start_session(data):
        from flask_socketio import emit
        from flask import request as flask_request
        
        sid = flask_request.sid
        use_grammar = data.get('use_grammar', False)
        
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
                'error': 'Vosk model not found. Download and place in backend/vosk-model/',
                'code': 'MODEL_NOT_FOUND',
                'setup_url': 'https://alphacephei.com/vosk/models'
            })
            return
        
        session_id = create_voice_session(sid, use_grammar=use_grammar)
        if session_id is None:
            emit('voice_error', {
                'error': 'Failed to create recognition session',
                'code': 'SESSION_CREATE_FAILED'
            })
            return
        
        emit('voice_session_created', {
            'session_id': session_id,
            'model_path': VOSK_MODEL_PATH,
            'sample_rate': 16000,
            'grammar_mode': use_grammar,
        })
        logger.info(f"Voice session created: {session_id} (grammar={use_grammar}) for socket {sid}")
    
    @socketio.on('voice_audio_chunk')
    def handle_voice_audio_chunk(data):
        from flask_socketio import emit
        
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
            if raw_bytes and validate_audio_chunk(raw_bytes):
                process_pcm_chunk(session_id, raw_bytes)
            final_transcript = force_final_result(session_id)
            
            # Include raw + corrected for debugging
            with _sessions_lock:
                session = _voice_sessions.get(session_id)
            last_raw = None
            if session and session.get('final_results'):
                last_entry = session['final_results'][-1]
                last_raw = last_entry.get('raw')
            
            emit('voice_final_result', {
                'transcript': final_transcript or '',
                'raw_transcript': last_raw,
                'session_id': session_id,
                'is_forced': True
            })
            return
        
        if not validate_audio_chunk(raw_bytes):
            return
        
        partial, final = process_pcm_chunk(session_id, raw_bytes)
        
        if final is not None:
            with _sessions_lock:
                session = _voice_sessions.get(session_id)
            last_raw = None
            if session and session.get('final_results'):
                last_raw = session['final_results'][-1].get('raw')
            
            emit('voice_final_result', {
                'transcript': final,
                'raw_transcript': last_raw,
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
        
        with _sessions_lock:
            session = _voice_sessions.get(session_id)
        last_raw = None
        if session and session.get('final_results'):
            last_raw = session['final_results'][-1].get('raw')
        
        emit('voice_final_result', {
            'transcript': final_transcript or '',
            'raw_transcript': last_raw,
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
    
    # ── HTTP endpoints ───────────────────────────────────────────────────────
    
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
            'correction_dictionary_size': len(PHONETIC_CORRECTIONS),
            'known_landmarks': len(KNOWN_LANDMARKS),
            'setup_instructions': VOSK_SETUP_MESSAGE if not (VOSK_AVAILABLE and model) else None,
        })
    
    @app.route('/api/voice/test-correction', methods=['POST'])
    def test_correction():
        """
        Debug endpoint: test the correction pipeline without audio.
        POST {"text": "a cri sure stadium"} → {"corrected": "Acrisure Stadium", ...}
        """
        from flask import request as flask_request, jsonify
        
        data = flask_request.json or {}
        raw_text = data.get('text', '')
        corrected, confidence = correct_transcript(raw_text)
        
        return jsonify({
            'raw': raw_text,
            'corrected': corrected,
            'confidence': confidence,
            'landmark_match': _fuzzy_match_landmark(raw_text),
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
        
        # ── Apply correction pipeline to spoken addresses before geocoding ───
        start_corrected, start_conf = correct_transcript(start_raw)
        dest_corrected, dest_conf = correct_transcript(destination_raw)
        
        logger.info(f"Voice route: start '{start_raw}' → '{start_corrected}' (conf={start_conf:.2f})")
        logger.info(f"Voice route: dest  '{destination_raw}' → '{dest_corrected}' (conf={dest_conf:.2f})")
        
        # Use corrected versions for geocoding
        start_for_geocode = start_corrected
        dest_for_geocode = dest_corrected
        
        # Step 1: Geocode start
        start_is_current = any(phrase in start_raw.lower() for phrase in
                               ['current location', 'here', 'my location', 'current', 'where i am'])
        
        if start_is_current:
            start_lat = user_lat
            start_lng = user_lng
            start_address = "Your Current Location"
        else:
            geocoded_start = _geocode_address(start_for_geocode, use_bias=True,
                                               bias_lat=user_lat, bias_lng=user_lng)
            if geocoded_start is None:
                return jsonify({
                    'success': False,
                    'error': f'Could not find location: {start_for_geocode}',
                    'original_input': start_raw,
                    'corrected_input': start_for_geocode,
                    'code': 'GEOCODE_FAILED_START'
                }), 422
            start_lat, start_lng, start_address, _ = geocoded_start
        
        # Step 2: Geocode destination
        geocoded_dest = _geocode_address(dest_for_geocode, use_bias=True,
                                          bias_lat=user_lat, bias_lng=user_lng)
        if geocoded_dest is None:
            return jsonify({
                'success': False,
                'error': f'Could not find location: {dest_for_geocode}',
                'original_input': destination_raw,
                'corrected_input': dest_for_geocode,
                'code': 'GEOCODE_FAILED_DEST'
            }), 422
        dest_lat, dest_lng, dest_address, _ = geocoded_dest
        
        # Step 3: Map mode
        mode_map = {
            'walk': 'pedestrian', 'walking': 'pedestrian',
            'wheelchair': 'pedestrian', 'accessible': 'pedestrian',
            'transit': 'transit', 'bus': 'transit',
        }
        travel_mode = mode_map.get(mode_raw.lower(), 'pedestrian')
        accessibility_needs = ['wheelchair'] if mode_raw.lower() in ['wheelchair', 'accessible', 'roll'] else []
        
        # Step 4: Route
        route_result = None
        provider_used = None
        
        try:
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
        
        # Ensure instructions exist
        if not route_result.get('instructions'):
            points = route_result.get('points', [])
            if points and len(points) > 1:
                route_result['instructions'] = [
                    {
                        'instruction': f"Head towards {dest_address}",
                        'distance_meters': route_result.get('distance_meters', 0),
                        'duration_seconds': route_result.get('duration_seconds', 0),
                        'travel_mode': 'WALKING',
                        'distance': fmt_dist(route_result.get('distance_meters', 0)),
                        'duration': fmt_duration(route_result.get('duration_seconds', 0))
                    },
                    {
                        'instruction': f"Arrive at {dest_address}",
                        'distance_meters': 0, 'duration_seconds': 0,
                        'travel_mode': 'ARRIVE',
                        'distance': '0 m', 'duration': '0 sec'
                    }
                ]
            else:
                route_result['instructions'] = []
        
        # Step 5: Safety scoring
        from app import get_safety_ai_instance, fmt_dist, fmt_duration
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
        
        route_id = f"VR-{int(time.time()) % 10000}-{random.randint(100, 999)}"
        
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
            # Include correction info for debugging
            'voice_corrections': {
                'start_raw': start_raw,
                'start_corrected': start_corrected,
                'dest_raw': destination_raw,
                'dest_corrected': dest_corrected,
            }
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
    
    logger.info("Voice handler initialized with correction pipeline "
                f"({len(PHONETIC_CORRECTIONS)} phonetic rules, "
                f"{len(KNOWN_LANDMARKS)} landmarks)")
    return app