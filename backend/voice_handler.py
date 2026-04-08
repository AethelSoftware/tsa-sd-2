"""
voice_handler.py — Whisper Speech Recognition for Tryver Accessibility

VERSION 4 — WHISPER + INTENT DETECTION

Replaces Vosk with OpenAI Whisper (local, offline, free).
Whisper transcribes MUCH more accurately than Vosk, especially for:
  - Proper nouns: "Acrisure Stadium", "Duquesne University"
  - Addresses: "502 Third Street"
  - Numbers: "five oh two" → "502"

The correction pipeline (intent detection, phonetic matching, landmark
matching) is kept as a safety net but fires much less often.

AUDIO FLOW:
  Browser records full utterance → sends as binary blob via Socket.IO
  → Backend saves to temp WAV → Whisper transcribes → correction pipeline
  → returns transcript

SETUP:
  pip install openai-whisper torch
  First run downloads ~150MB model to ~/.cache/whisper/ (needs internet once)
  After that, fully offline.
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
import wave
import tempfile
import io
from typing import Dict, List, Optional, Tuple, Set
from difflib import SequenceMatcher
from cachetools import TTLCache
from dataclasses import dataclass
import numpy as np

logger = logging.getLogger(__name__)

SCALE_WORDS = {
    "hundred": 100,
    "thousand": 1000,
}

TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90
}

UNITS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9
}

TEENS = {
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19
}

NUMBER_WORDS = set(UNITS) | set(TENS) | set(TEENS) | set(SCALE_WORDS)

@dataclass
class Confidence:
    base: float
    boosts: float = 0.0

    def add_boost(self, value: float):
        self.boosts += value

    def final(self) -> float:
        return min(0.98, self.base + self.boosts)

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1: CONFIGURATION & AVAILABILITY
# ═══════════════════════════════════════════════════════════════════════════════

WHISPER_AVAILABLE = False
WHISPER_MODEL_NAME = os.getenv('WHISPER_MODEL', 'base.en')
WHISPER_SETUP_MESSAGE = """
\033[1;33m══════════════════════════════════════════════════════════════════
  WHISPER NOT READY — Install:
    pip install openai-whisper torch
  Then pre-download the model (needs internet once):
    python -c "import whisper; whisper.load_model('base.en')"
══════════════════════════════════════════════════════════════════\033[0m
"""

try:
    import faster_whisper
    WHISPER_AVAILABLE = True
    logger.info("Whisper imported successfully")
except ImportError:
    logger.warning("Whisper not installed. Run: pip install openai-whisper torch")
    print(WHISPER_SETUP_MESSAGE)

# Keep Vosk as optional fallback
VOSK_AVAILABLE = False
try:
    import vosk
    VOSK_AVAILABLE = True
    logger.info("Vosk also available as fallback")
except ImportError:
    pass

GEOAPIFY_AVAILABLE = False
try:
    from geoapify_client import GeoapifyClient
    GEOAPIFY_AVAILABLE = True
    logger.info("Geoapify client available")
except ImportError:
    logger.warning("Geoapify client not available, falling back to TomTom only")


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2: PHONETIC FINGERPRINTING
# ═══════════════════════════════════════════════════════════════════════════════

def phonetic_fingerprint(text: str) -> str:
    if not text:
        return ""
    text = text.lower().strip()
    text = re.sub(r'[^a-z\s]', '', text)
    text = re.sub(r'\s+', '', text)
    if not text:
        return ""
    mappings = [
        ('ph', 'f'), ('gh', 'g'), ('ck', 'k'), ('sh', 'x'),
        ('th', 't'), ('wh', 'w'), ('qu', 'kw'),
        ('tion', 'xn'), ('sion', 'xn'),
    ]
    for old, new in mappings:
        text = text.replace(old, new)
    char_map = {
        'b': 'B', 'f': 'F', 'p': 'P', 'v': 'F',
        'c': 'K', 'g': 'K', 'j': 'J', 'k': 'K', 'q': 'K',
        's': 'S', 'x': 'S', 'z': 'S',
        'd': 'T', 't': 'T',
        'l': 'L', 'm': 'M', 'n': 'N', 'r': 'R',
        'w': 'W', 'y': 'Y', 'h': '',
    }
    result = [text[0].upper()]
    prev = result[0]
    for ch in text[1:]:
        if ch in 'aeiou':
            prev = ''
            continue
        mapped = char_map.get(ch, ch.upper())
        if mapped and mapped != prev:
            result.append(mapped)
            prev = mapped
    return ''.join(result)[:8]


def phonetic_similarity(text1: str, text2: str) -> float:
    fp1 = phonetic_fingerprint(text1)
    fp2 = phonetic_fingerprint(text2)
    if not fp1 or not fp2:
        return 0.0
    if fp1 == fp2:
        return 1.0
    return SequenceMatcher(None, fp1, fp2).ratio()


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3: INTENT DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def detect_current_location_intent(transcript: str) -> Tuple[bool, float]:
    t = transcript.lower().strip()
    words = set(t.split())
    exact_phrases = [
        "current location", "my current location", "use current location",
        "use my current location", "my location", "use my location",
        "here", "right here", "i'm here", "where i am", "where i'm at",
        "use gps", "gps location", "gps",
    ]
    for phrase in exact_phrases:
        if phrase in t:
            return True, 1.0
    location_words = {"location", "locations", "locate", "located"}
    signal_words = {"current", "my", "this", "here", "use", "its", "it's",
                    "is", "the", "currant", "karen", "her", "a", "i"}
    has_location = bool(words & location_words)
    has_signal = bool(words & signal_words)
    if has_location and has_signal:
        return True, 0.85
    if has_location and len(words) <= 3:
        return True, 0.75
    fp_current = phonetic_fingerprint("current location")
    fp_transcript = phonetic_fingerprint(t)
    phon_sim = SequenceMatcher(None, fp_current, fp_transcript).ratio()
    if phon_sim >= 0.7:
        return True, 0.8
    here_variants = {"here", "hear", "her", "heer", "ear"}
    if words and len(words) <= 2 and (words & here_variants):
        return True, 0.9
    current_variants = {"current", "currant", "curren", "karen", "curr"}
    if words & current_variants and len(words) <= 3:
        return True, 0.7
    return False, 0.0


def detect_travel_mode_intent(transcript: str) -> Tuple[Optional[str], float]:
    t = transcript.lower().strip()
    walk_signals = {"walk", "walking", "walked", "walks", "foot", "feet",
                    "on foot", "pedestrian"}
    if any(w in t for w in walk_signals):
        return "walk", 0.95
    transit_signals = {"transit", "bus", "buses", "public", "train",
                       "subway", "trolley", "t line"}
    if any(w in t for w in transit_signals):
        return "transit", 0.95
    wheelchair_signals = {"wheelchair", "wheel chair", "accessible",
                          "accessibility", "handicap", "handicapped",
                          "ada", "roll", "rolling"}
    if any(w in t for w in wheelchair_signals):
        return "wheelchair", 0.95
    if phonetic_similarity(t, "walking") >= 0.7:
        return "walk", 0.7
    if phonetic_similarity(t, "transit") >= 0.7:
        return "transit", 0.7
    if phonetic_similarity(t, "wheelchair") >= 0.7:
        return "wheelchair", 0.7
    return None, 0.0


def detect_confirmation_intent(transcript: str) -> Tuple[Optional[bool], float]:
    t = transcript.lower().strip()
    words = set(t.split())
    yes_words = {"yes", "yeah", "yep", "yup", "correct", "right", "sure",
                 "okay", "ok", "confirm", "confirmed", "affirmative",
                 "absolutely", "definitely", "uh huh", "mhm", "ya", "ye"}
    no_words = {"no", "nope", "nah", "wrong", "incorrect", "not right",
                "start over", "restart", "different", "change", "redo",
                "try again", "no way"}
    for phrase in ["that's right", "that's correct", "start over", "try again"]:
        if phrase in t:
            return phrase in {"that's right", "that's correct"}, 0.95
    has_yes = bool(words & yes_words)
    has_no = bool(words & no_words)
    if has_yes and not has_no:
        return True, 0.9
    if has_no and not has_yes:
        return False, 0.9
    if has_yes and has_no:
        for word in reversed(t.split()):
            if word in yes_words:
                return True, 0.5
            if word in no_words:
                return False, 0.5
    return None, 0.0


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4: PITTSBURGH LANDMARK & PHONETIC CORRECTION DICTIONARIES
# ═══════════════════════════════════════════════════════════════════════════════

PHONETIC_CORRECTIONS: Dict[str, str] = {
    "a cri sure": "Acrisure", "a cry sure": "Acrisure",
    "acri sure": "Acrisure", "a cree sure": "Acrisure",
    "a chris sure": "Acrisure", "a kri sure": "Acrisure",
    "akra sure": "Acrisure", "a kris sure": "Acrisure",
    "a chris your": "Acrisure", "i can sure": "Acrisure",
    "a crisure": "Acrisure", "acre sure": "Acrisure",
    "ak ri sure": "Acrisure", "akri sure": "Acrisure",
    "a cure sure": "Acrisure", "okra sure": "Acrisure",
    "i cris sure": "Acrisure", "a krishna": "Acrisure",
    "a cris your": "Acrisure", "accrue sure": "Acrisure",
    "a crew sure": "Acrisure",
    "pea and see": "PNC", "p and c": "PNC",
    "pee and see": "PNC", "p n c": "PNC",
    "pine see": "PNC", "pee en see": "PNC", "pen see": "PNC",
    "heinz field": "Acrisure Stadium", "hines field": "Acrisure Stadium",
    "high marks": "Highmark", "hi mark": "Highmark",
    "high mark": "Highmark",
    "do cane": "Duquesne", "duke ain": "Duquesne",
    "duke ane": "Duquesne", "du cane": "Duquesne",
    "do kane": "Duquesne", "duke cane": "Duquesne",
    "duking": "Duquesne", "duke wayne": "Duquesne",
    "dee cane": "Duquesne",
    "carn a gee": "Carnegie", "car nah gee": "Carnegie",
    "car nee gee": "Carnegie", "car neg ee": "Carnegie",
    "mon on ga hee la": "Monongahela", "mon ong a heel a": "Monongahela",
    "mano gala": "Monongahela", "mono gala": "Monongahela",
    "mon gala": "Monongahela", "mana gala": "Monongahela",
    "alleh gainey": "Allegheny", "allegany": "Allegheny",
    "alle gain ee": "Allegheny", "all a gay knee": "Allegheny",
    "all again ee": "Allegheny", "all again he": "Allegheny",
    "south said": "South Side", "shady cited": "Shadyside",
    "squirl hill": "Squirrel Hill", "oak land": "Oakland",
    "law rents ville": "Lawrenceville", "lawrence ville": "Lawrenceville",
    "stripped district": "Strip District",
    "point stayed park": "Point State Park",
    "mount washing ton": "Mt. Washington",
    "bloom field": "Bloomfield", "north sure": "North Shore",
    "norths sure": "North Shore", "north cited": "North Side",
    "down town": "Downtown",
    "car nah gee melon": "Carnegie Mellon",
    "car nee gee melon": "Carnegie Mellon",
    "carnegie melon": "Carnegie Mellon",
    "car nee gee mel in": "Carnegie Mellon",
    "avenew": "Avenue", "av new": "Avenue", "a venue": "Avenue",
    "boule vard": "Boulevard", "bull of art": "Boulevard",
    "bull a vard": "Boulevard", "stree": "Street", "st reet": "Street",
}

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

SPOKEN_DIGITS: Dict[str, str] = {
    "zero": "0", "oh": "0", "o": "0",
    "one": "1", "two": "2", "too": "2", "to": "2",
    "three": "3", "four": "4", "for": "4", "fore": "4",
    "five": "5", "six": "6", "seven": "7",
    "eight": "8", "ate": "8", "nine": "9", "niner": "9",
    "ten": "10", "eleven": "11", "twelve": "12",
    "thirteen": "13", "fourteen": "14", "fifteen": "15",
    "sixteen": "16", "seventeen": "17", "eighteen": "18",
    "nineteen": "19", "twenty": "20", "thirty": "30",
    "forty": "40", "fifty": "50", "sixty": "60",
    "seventy": "70", "eighty": "80", "ninety": "90",
    "hundred": "00", "thousand": "000",
}

AMBIGUOUS_NUMBER_WORDS = {"to", "too", "for", "fore", "oh", "o", "ate"}


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5: MULTI-STRATEGY LANDMARK MATCHING
# ═══════════════════════════════════════════════════════════════════════════════

def match_landmark(text: str) -> Tuple[Optional[str], float]:
    if not text or len(text.strip()) < 2:
        return None, 0.0
    text_lower = text.lower().strip()
    text_words = set(text_lower.split())
    text_phonetic = phonetic_fingerprint(text_lower)
    best_match = None
    best_score = 0.0
    for canonical_name, variants in KNOWN_LANDMARKS:
        all_targets = [canonical_name.lower()] + [v.lower() for v in variants]
        for target in all_targets:
            score = 0.0
            target_words = set(target.split())
            target_phonetic = phonetic_fingerprint(target)
            if target in text_lower or text_lower in target:
                score = max(score, 0.95)
            if target_words and text_words:
                intersection = text_words & target_words
                union = text_words | target_words
                jaccard = len(intersection) / len(union) if union else 0
                target_coverage = len(intersection) / len(target_words) if target_words else 0
                word_score = (jaccard * 0.4 + target_coverage * 0.6)
                score = max(score, word_score)
            char_sim = SequenceMatcher(None, text_lower, target).ratio()
            score = max(score, char_sim)
            if text_phonetic and target_phonetic:
                phon_sim = SequenceMatcher(None, text_phonetic, target_phonetic).ratio()
                score = max(score, phon_sim * 0.95)
            if score > best_score:
                best_score = score
                best_match = canonical_name
    if best_match and best_score >= 0.65:
        return best_match, best_score
    return None, 0.0


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6: TRANSCRIPT CORRECTION PIPELINE
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_number_sequence(words: List[str], start: int) -> Tuple[Optional[str], int]:
    total = 0
    current = 0
    i = start

    while i < len(words):
        w = words[i].lower().strip(".,!?")

        if w not in NUMBER_WORDS:
            break

        if w in UNITS:
            current += UNITS[w]

        elif w in TEENS:
            current += TEENS[w]

        elif w in TENS:
            current += TENS[w]

        elif w == "hundred":
            if current == 0:
                current = 1
            current *= 100

        elif w == "thousand":
            if current == 0:
                current = 1
            total += current * 1000
            current = 0

        i += 1

    final_value = total + current
    if i == start:
        return None, 0

    return str(final_value), i - start

def correct_transcript(raw: str, context: str = "address") -> Tuple[str, float]:
    if not raw or not raw.strip():
        return ("", 0.0)
    text = raw.strip().lower()
    original = text
    conf = Confidence(base=0.7)  # Higher base confidence with Whisper

    # Context-specific intent detection
    if context == "address":
        is_current, current_conf = detect_current_location_intent(text)
        if is_current and current_conf >= 0.7:
            logger.info(f"Intent: '{raw}' → 'current location' (conf={current_conf:.2f})")
            return ("current location", current_conf)
    elif context == "mode":
        mode, mode_conf = detect_travel_mode_intent(text)
        if mode and mode_conf >= 0.7:
            mode_labels = {"walk": "walking", "transit": "transit",
                           "wheelchair": "wheelchair"}
            return (mode_labels.get(mode, mode), mode_conf)
    elif context == "confirm":
        is_yes, conf_conf = detect_confirmation_intent(text)
        if is_yes is not None and conf_conf >= 0.5:
            return ("yes" if is_yes else "no", conf_conf)

    # Pass 1: Direct phonetic corrections
    sorted_corrections = sorted(
        PHONETIC_CORRECTIONS.items(), key=lambda x: len(x[0]), reverse=True
    )
    for mishearing, correct in sorted_corrections:
        if mishearing in text:
            text = text.replace(mishearing, correct)
            conf.add_boost(0.08)

    # Pass 2: Number normalization
    text = _normalize_spoken_numbers(text)

    # Pass 3: Street type recovery
    text = _fix_street_types(text)

    # Pass 4: Landmark matching
    landmark, landmark_score = match_landmark(text)
    if landmark and landmark_score >= 0.65:
        text = landmark
        conf.add_boost(landmark_score * 0.2)

    # Pass 5: Title-case cleanup
    text = _smart_title_case(text)

    # Pass 6: Whitespace cleanup
    text = re.sub(r'\s+', ' ', text).strip()

    if text.lower() != original:
        logger.info(f"Corrected: '{raw}' → '{text}' (confidence={conf.final():.2f})")

    return (text, conf.final())


def _normalize_spoken_numbers(text: str) -> str:
    words = text.split()
    result = []

    i = 0
    while i < len(words):
        w = words[i].lower().strip(".,!?")

        if w in NUMBER_WORDS:
            num, consumed = _parse_number_sequence(words, i)
            if num:
                result.append(num)
                i += consumed
                continue

        result.append(words[i])
        i += 1

    return " '.join(result)'"


# def _accumulate_number(words: List[str], start: int) -> Tuple[Optional[str], int]:
#     i = start
#     parts = []
#     total = 0
#     current = 0
#     while i < len(words):
#         word = words[i].lower().strip(".,!?")
#         if word in SPOKEN_DIGITS:
#             val = SPOKEN_DIGITS[word]
#             if word == "hundred":
#                 if parts:
#                     last = int(''.join(parts)) if parts else 1
#                     parts = [str(last * 100)]
#                 else:
#                     parts.append("100")
#             elif word == "thousand":
#                 if parts:
#                     last = int(''.join(parts)) if parts else 1
#                     parts = [str(last * 1000)]
#                 else:
#                     parts.append("1000")
#             elif word in ("twenty", "thirty", "forty", "fifty", "sixty",
#                           "seventy", "eighty", "ninety"):
#                 parts.append(val)
#             elif word in ("ten", "eleven", "twelve", "thirteen", "fourteen",
#                           "fifteen", "sixteen", "seventeen", "eighteen",
#                           "nineteen"):
#                 parts.append(val)
#             else:
#                 if (parts and len(parts[-1]) == 2 and
#                     parts[-1].endswith("0") and len(val) == 1):
#                     tens = int(parts[-1])
#                     ones = int(val)
#                     parts[-1] = str(tens + ones)
#                 else:
#                     parts.append(val)
#             i += 1
#         else:
#             break
#     consumed = i - start
#     if consumed == 0:
#         return None, 0
#     number = ''.join(parts)
#     try:
#         if int(number) > 99999:
#             number = ''.join(
#                 SPOKEN_DIGITS.get(words[j].lower().strip(".,!?"), words[j])
#                 for j in range(start, i)
#             )
#     except ValueError:
#         pass
#     return number, consumed


def _fix_street_types(text: str) -> str:
    replacements = [
        (r'\bst\b(?!\.|,)', 'Street'), (r'\bave\b', 'Avenue'),
        (r'\bblvd\b', 'Boulevard'), (r'\bdr\b', 'Drive'),
        (r'\bln\b', 'Lane'), (r'\bct\b', 'Court'),
        (r'\bpl\b', 'Place'), (r'\bpkwy\b', 'Parkway'),
        (r'\bhwy\b', 'Highway'), (r'\brd\b', 'Road'),
    ]
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text


def _smart_title_case(text: str) -> str:
    uppercase_words = {"PNC", "PPG", "UPMC", "CMU", "AGH", "GTFS", "USA", "US"}
    lowercase_words = {"of", "the", "and", "in", "at", "to", "for", "on",
                       "by", "a", "an"}
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
# SECTION 7: WHISPER MODEL LOADING
# ═══════════════════════════════════════════════════════════════════════════════

_whisper_model = None
_model_lock = threading.Lock()


def get_whisper_model():
    """Lazy-load Whisper model singleton. Thread-safe."""
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    with _model_lock:
        if _whisper_model is not None:
            return _whisper_model
        if not WHISPER_AVAILABLE:
            return None
        try:
            logger.info(f"Loading Whisper model '{WHISPER_MODEL_NAME}'...")
            _whisper_model = WhisperModel(WHISPER_MODEL_NAME, device="cuda", compute_type="float16")
            logger.info(f"Whisper model '{WHISPER_MODEL_NAME}' loaded successfully")
            return _whisper_model
        except Exception as e:
            logger.error(f"Failed to load Whisper model: {e}")
            return None


def transcribe_audio_bytes(audio_bytes: bytes, context: str = "address") -> Tuple[str, float]:
    """
    Transcribe raw 16-bit 16kHz mono PCM audio bytes using Whisper.
    Returns (corrected_text, confidence).
    """
    model = get_whisper_model()
    if model is None:
        return ("", 0.0)

    # Write PCM bytes to a temporary WAV file
    # tmp_path = None
    try:
        # with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        #     tmp_path = tmp.name
        #     with wave.open(tmp, 'wb') as wf:
        #         wf.setnchannels(1)
        #         wf.setsampwidth(2)  # 16-bit
        #         wf.setframerate(16000)
        #         wf.writeframes(audio_bytes)

        # # Transcribe with Whisper
        # result = model.transcribe(
        #     tmp_path,
        #     language='en',
        #     fp16=False,  # CPU-safe
        #     condition_on_previous_text=False,
        #     no_speech_threshold=0.5,
        # )

        # raw_text = result.get('text', '').strip()
        # if not raw_text:
        #     return ("", 0.0)

        # logger.info(f"Whisper raw: '{raw_text}'")

        # # Run through correction pipeline
        # corrected, confidence = correct_transcript(raw_text, context=context)
        # return (corrected, confidence)
        # Convert PCM bytes → numpy float32 array
        audio = np.frombuffer(audio_bytes, np.int16).astype(np.float32) / 32768.0

        # Run transcription
        segments, info = model.transcribe(
            audio,
            language="en",
            beam_size=1,                 # 🔥 faster decoding
            condition_on_previous_text=False,
            vad_filter=True              # 🔥 removes silence automatically
        )

        raw_text = "".join(segment.text for segment in segments).strip()

        if not raw_text:
            return ("", 0.0)

        logger.info(f"Whisper raw: '{raw_text}'")

        corrected, confidence = correct_transcript(raw_text, context=context)
        return (corrected, confidence)

    except Exception as e:
        logger.error(f"Whisper transcription failed: {e}")
        return ("", 0.0)
    # finally:
    #     if tmp_path and os.path.exists(tmp_path):
    #         try:
    #             os.unlink(tmp_path)
    #         except:
    #             pass


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 8: SESSION MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

_voice_sessions: Dict[str, Dict] = {}
_sessions_lock = threading.Lock()


def create_voice_session(socket_id: str) -> Optional[str]:
    """Create a new voice session."""
    if not WHISPER_AVAILABLE:
        return None
    # Pre-load model on first session
    model = get_whisper_model()
    if model is None:
        return None

    session_id = f"vs-{int(time.time())}-{random.randint(1000, 9999)}"
    with _sessions_lock:
        _voice_sessions[session_id] = {
            'created_at': time.time(),
            'last_activity': time.time(),
            'socket_id': socket_id,
            'audio_buffer': bytearray(),
            'correction_context': 'address',
            'final_results': [],
        }
    logger.info(f"Voice session created: {session_id}")
    return session_id


def set_session_context(session_id: str, context: str):
    with _sessions_lock:
        session = _voice_sessions.get(session_id)
        if session:
            session['correction_context'] = context


def destroy_voice_session(session_id: str):
    with _sessions_lock:
        session = _voice_sessions.pop(session_id, None)
    if session:
        logger.info(f"Voice session {session_id} destroyed")


def cleanup_stale_sessions():
    cutoff = time.time() - 1800
    with _sessions_lock:
        stale = [sid for sid, s in list(_voice_sessions.items())
                 if s['last_activity'] < cutoff]
    for sid in stale:
        destroy_voice_session(sid)


def append_audio(session_id: str, audio_bytes: bytes):
    """Append PCM audio chunk to session buffer."""
    with _sessions_lock:
        session = _voice_sessions.get(session_id)
        if session:
            session['audio_buffer'].extend(audio_bytes)
            session['last_activity'] = time.time()


def finalize_audio(session_id: str) -> Tuple[str, float]:
    """Transcribe accumulated audio buffer and clear it."""
    with _sessions_lock:
        session = _voice_sessions.get(session_id)
        if not session:
            return ("", 0.0)
        audio_bytes = bytes(session['audio_buffer'])
        context = session.get('correction_context', 'address')
        session['audio_buffer'] = bytearray()

    if len(audio_bytes) < 3200:  # Less than 0.1s of audio
        return ("", 0.0)

    corrected, confidence = transcribe_audio_bytes(audio_bytes, context=context)

    if corrected:
        with _sessions_lock:
            session = _voice_sessions.get(session_id)
            if session:
                session['final_results'].append({
                    'corrected': corrected,
                    'confidence': confidence,
                    'context': context,
                    'timestamp': time.time(),
                })

    return (corrected, confidence)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 9: AUDIO UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

def convert_browser_audio_to_pcm(audio_data) -> Optional[bytes]:
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


def validate_audio_chunk(raw_bytes: bytes) -> bool:
    if not raw_bytes or len(raw_bytes) < 320 or len(raw_bytes) % 2 != 0:
        return False
    try:
        # sample only first N bytes (fast heuristic)
        step = 20  # skip samples
        samples = struct.iter_unpack('<h', raw_bytes[::step])

        for i, (s,) in enumerate(samples):
            if abs(s) >= 50:
                return True
            if i > 200:  # limit work
                break

        return False
    except struct.error:
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 10: GEOCODING
# ═══════════════════════════════════════════════════════════════════════════════

TOMTOM_API_KEY = os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')


def fmt_dist(meters):
    if not meters:
        return ""
    if meters >= 1000:
        return f"{meters/1000:.1f} km"
    return f"{meters:.0f} m"


def fmt_duration(seconds):
    if not seconds:
        return ""
    if seconds < 60:
        return f"{seconds:.0f} sec"
    elif seconds < 3600:
        return f"{seconds/60:.0f} min"
    else:
        hours = int(seconds / 3600)
        minutes = int((seconds % 3600) / 60)
        return f"{hours}h {minutes}m"


def _geocode_address(address: str, use_bias: bool = True,
                     bias_lat: float = 40.4406,
                     bias_lng: float = -79.9959) -> Optional[Tuple[float, float, str, float]]:
    if not address or len(address.strip()) < 2:
        return None
    landmark, _ = match_landmark(address)
    if landmark:
        address = f"{landmark}, Pittsburgh, PA"
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
                    return (best['lat'], best['lng'],
                            best['address'] or best['name'],
                            best.get('score', 0.8))
        except Exception as e:
            logger.warning(f"Geoapify geocoding failed: {e}")
    try:
        import requests as http_requests
        url = (f"https://api.tomtom.com/search/2/geocode/"
               f"{http_requests.utils.quote(address)}.json")
        params = {
            'key': TOMTOM_API_KEY, 'limit': 1, 'countrySet': 'US',
            'lat': bias_lat, 'lon': bias_lng, 'radius': 50000,
            'language': 'en-US',
        }
        resp = http_requests.get(url, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        results = data.get('results', [])
        if not results:
            return None
        position = results[0]['position']
        formatted = results[0].get('address', {}).get('freeformAddress', address)
        return (float(position['lat']), float(position['lon']),
                formatted, results[0].get('score', 0.5))
    except Exception as e:
        logger.error(f"TomTom geocoding failed for '{address}': {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 11: VOICE ROUTE STORAGE
# ═══════════════════════════════════════════════════════════════════════════════

_voice_routes = TTLCache(maxsize=5000, ttl=7200)
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
        now = time.time()

        with _routes_lock:
            route = _voice_routes.get(route_id)

            if route is None:
                return None

            if now - route.get('created_at', 0) > 7200:
                _voice_routes.pop(route_id, None)
                return None

            return route


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 12: BACKGROUND CLEANUP
# ═══════════════════════════════════════════════════════════════════════════════

def _cleanup_loop():
    while True:
        time.sleep(300)
        try:
            cleanup_stale_sessions()
        except Exception as e:
            logger.error(f"Error in cleanup loop: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 13: SOCKET.IO & HTTP ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

def init_voice_handler(app, socketio):
    """Register all voice-related Socket.IO handlers and HTTP endpoints."""
    cleanup_thread = threading.Thread(target=_cleanup_loop, daemon=True)
    cleanup_thread.start()

    # ── Socket.IO handlers ───────────────────────────────────────────────────

    @socketio.on('voice_start_session')
    def handle_voice_start_session(data):
        from flask_socketio import emit
        from flask import request as flask_request
        sid = flask_request.sid

        if not WHISPER_AVAILABLE:
            emit('voice_error', {
                'error': 'Whisper not installed. Run: pip install openai-whisper torch',
                'code': 'WHISPER_NOT_INSTALLED'})
            return
        model = get_whisper_model()
        if model is None:
            emit('voice_error', {
                'error': 'Whisper model failed to load',
                'code': 'MODEL_LOAD_FAILED'})
            return
        session_id = create_voice_session(sid)
        if session_id is None:
            emit('voice_error', {
                'error': 'Failed to create session',
                'code': 'SESSION_CREATE_FAILED'})
            return
        emit('voice_session_created', {
            'session_id': session_id,
            'engine': 'whisper',
            'model': WHISPER_MODEL_NAME,
            'sample_rate': 16000,
        })
        logger.info(f"Session created: {session_id} for socket {sid}")

    @socketio.on('voice_set_context')
    def handle_voice_set_context(data):
        session_id = data.get('session_id')
        context = data.get('context', 'address')
        if session_id:
            set_session_context(session_id, context)

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
            return

        # Accumulate audio in session buffer
        if raw_bytes and validate_audio_chunk(raw_bytes):
            append_audio(session_id, raw_bytes)

        # If this is the final chunk, transcribe everything
        if is_final:
            transcript, confidence = finalize_audio(session_id)
            emit('voice_final_result', {
                'transcript': transcript,
                'raw_transcript': transcript,
                'confidence': confidence,
                'session_id': session_id,
                'is_forced': True,
                'engine': 'whisper',
            })

    @socketio.on('voice_stop_recording')
    def handle_voice_stop_recording(data):
        from flask_socketio import emit
        session_id = data.get('session_id')
        if not session_id:
            return
        transcript, confidence = finalize_audio(session_id)
        emit('voice_final_result', {
            'transcript': transcript,
            'raw_transcript': transcript,
            'confidence': confidence,
            'session_id': session_id,
            'is_forced': True,
            'triggered_by': 'stop_recording',
            'engine': 'whisper',
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
            orphaned = [sk for sk, s in _voice_sessions.items()
                        if s.get('socket_id') == sid]
        for session_id in orphaned:
            destroy_voice_session(session_id)

    # ── HTTP endpoints ───────────────────────────────────────────────────────

    @app.route('/api/voice/status', methods=['GET'])
    def voice_status():
        from flask import jsonify
        model = get_whisper_model() if WHISPER_AVAILABLE else None
        return jsonify({
            'vosk_installed': True,  # Compat flag for frontend
            'model_loaded': model is not None,
            'engine': 'whisper',
            'model_name': WHISPER_MODEL_NAME,
            'whisper_available': WHISPER_AVAILABLE,
            'active_sessions': len(_voice_sessions),
            'correction_dictionary_size': len(PHONETIC_CORRECTIONS),
            'known_landmarks': len(KNOWN_LANDMARKS),
        })

    @app.route('/api/voice/test-correction', methods=['POST'])
    def test_correction():
        from flask import request as flask_request, jsonify
        data = flask_request.json or {}
        raw_text = data.get('text', '')
        context = data.get('context', 'address')
        corrected, confidence = correct_transcript(raw_text, context=context)
        is_current, current_conf = detect_current_location_intent(raw_text)
        landmark, landmark_score = match_landmark(raw_text)
        mode, mode_conf = detect_travel_mode_intent(raw_text)
        return jsonify({
            'raw': raw_text, 'context': context,
            'corrected': corrected, 'confidence': confidence,
            'debug': {
                'current_location_intent': {'detected': is_current, 'confidence': current_conf},
                'landmark_match': {'name': landmark, 'score': landmark_score},
                'mode_intent': {'mode': mode, 'confidence': mode_conf},
                'phonetic_fingerprint': phonetic_fingerprint(raw_text),
            }
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

        start_corrected, start_conf = correct_transcript(start_raw, context="address")
        dest_corrected, dest_conf = correct_transcript(destination_raw, context="address")

        is_current, _ = detect_current_location_intent(start_raw)
        if not is_current:
            is_current, _ = detect_current_location_intent(start_corrected)

        if is_current:
            start_lat, start_lng = user_lat, user_lng
            start_address = "Your Current Location"
        else:
            geocoded_start = _geocode_address(start_corrected, use_bias=True,
                                               bias_lat=user_lat, bias_lng=user_lng)
            if geocoded_start is None:
                return jsonify({
                    'success': False, 'error': f'Could not find: {start_corrected}',
                    'original_input': start_raw, 'corrected_input': start_corrected,
                    'code': 'GEOCODE_FAILED_START'
                }), 422
            start_lat, start_lng, start_address, _ = geocoded_start

        geocoded_dest = _geocode_address(dest_corrected, use_bias=True,
                                          bias_lat=user_lat, bias_lng=user_lng)
        if geocoded_dest is None:
            return jsonify({
                'success': False, 'error': f'Could not find: {dest_corrected}',
                'original_input': destination_raw, 'corrected_input': dest_corrected,
                'code': 'GEOCODE_FAILED_DEST'
            }), 422
        dest_lat, dest_lng, dest_address, _ = geocoded_dest

        mode_map = {
            'walk': 'pedestrian', 'walking': 'pedestrian',
            'wheelchair': 'pedestrian', 'accessible': 'pedestrian',
            'transit': 'transit', 'bus': 'transit',
        }
        travel_mode = mode_map.get(mode_raw.lower(), 'pedestrian')
        accessibility_needs = (
            ['wheelchair']
            if mode_raw.lower() in ['wheelchair', 'accessible', 'roll']
            else []
        )

        route_result = None
        provider_used = None
        try:
            from app import (tomtom_router, transit_router, google_router,
                             extract_all_coords_from_steps, build_display_steps)
            if travel_mode == 'transit' and transit_router:
                from datetime import datetime
                routes = transit_router.find_route(
                    start_lat, start_lng, dest_lat, dest_lng,
                    datetime.now(), max_walk_distance=800,
                    max_transfers=4, time_window_minutes=120,
                    num_alternatives=1)
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
                    accessibility_needs=accessibility_needs or None)
                if route_result:
                    provider_used = route_result.get('provider', 'osrm/tomtom')
        except Exception as e:
            logger.error(f"Routing failed: {e}", exc_info=True)
            return jsonify({'success': False, 'error': f'Routing error: {str(e)}'}), 500

        if not route_result:
            return jsonify({'success': False, 'error': 'No route found'}), 404

        if not route_result.get('instructions'):
            points = route_result.get('points', [])
            if points and len(points) > 1:
                route_result['instructions'] = [
                    {'instruction': f"Head towards {dest_address}",
                     'distance_meters': route_result.get('distance_meters', 0),
                     'duration_seconds': route_result.get('duration_seconds', 0),
                     'travel_mode': 'WALKING',
                     'distance': fmt_dist(route_result.get('distance_meters', 0)),
                     'duration': fmt_duration(route_result.get('duration_seconds', 0))},
                    {'instruction': f"Arrive at {dest_address}",
                     'distance_meters': 0, 'duration_seconds': 0,
                     'travel_mode': 'ARRIVE',
                     'distance': '0 m', 'duration': '0 sec'}
                ]
            else:
                route_result['instructions'] = []

        from app import get_safety_ai_instance
        safety_ai = get_safety_ai_instance()
        route_coords_list = [{'lat': p[0], 'lng': p[1]}
                             for p in route_result.get('points', [])]
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
            'start_address': start_address, 'end_address': dest_address,
            'distance': distance_str, 'duration': duration_str,
            'steps': route_result.get('instructions', []),
            'route_coords': route_result.get('points', []),
            'safety': safety_dict, 'travel_mode': travel_mode,
            'provider': provider_used, 'created_at': time.time(),
            'voice_corrections': {
                'start_raw': start_raw, 'start_corrected': start_corrected,
                'dest_raw': destination_raw, 'dest_corrected': dest_corrected,
            }
        })

        return jsonify({
            'success': True, 'route_id': route_id,
            'start_address': start_address, 'end_address': dest_address,
            'distance': distance_str, 'duration': duration_str,
            'steps': route_result.get('instructions', []),
            'route_coords': route_result.get('points', []),
            'safety': safety_dict, 'travel_mode': travel_mode,
            'provider': provider_used,
        })

    @app.route('/api/voice-route/<route_id>', methods=['GET'])
    def get_voice_route(route_id):
        from flask import jsonify
        route = _get_voice_route(route_id)
        if route is None:
            return jsonify({'success': False, 'error': 'Route not found or expired'}), 404
        return jsonify({'success': True, **route})

    logger.info(
        f"Voice handler v4 initialized — Whisper '{WHISPER_MODEL_NAME}' + "
        f"intent detection + phonetic fingerprinting "
        f"({len(PHONETIC_CORRECTIONS)} rules, {len(KNOWN_LANDMARKS)} landmarks)")
    return app