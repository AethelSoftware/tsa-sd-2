"""
Real-time pedestrian tracking system with WebSocket communication
and safety-aware rerouting.
"""
import os
import asyncio
import json
import logging
import threading
import time
import math
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Set
from dataclasses import dataclass, asdict
from enum import Enum
import numpy as np
from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
UPDATE_INTERVAL = 1.0  # Update every second
SAFETY_CHECK_INTERVAL = 5.0  # Check safety every 5 seconds
REROUTE_THRESHOLD = 0.3  # Reroute if safety drops below 30%
MAX_REROUTE_DISTANCE = 500  # Maximum detour in meters
MIN_WALKING_SPEED = 0.5  # m/s
MAX_WALKING_SPEED = 1.8  # m/s

CATEGORY_TAGS = ["amenity", "shop", "tourism", "leisure", "office", "building"]  # Descending priority ranking

# API Configuration from .env
TOMTOM_API_KEY = os.getenv('TOMTOM_API_KEY', 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM')
OVER_PASS_URL = os.getenv('OVERPASS_URL', 'https://overpass-api.de/api/interpreter')
OPENWEATHER_API_KEY = os.getenv('OPENWEATHER_API_KEY', '8e59367abbea0731a2c8181b25b16276')
CENSUS_API_KEY = os.getenv('CENSUS_API_KEY', '8e494334b61e6634a487d6432e5992b96c8559e7')
GOOGLE_MAPS_API_KEY = os.getenv('GOOGLE_MAPS_API_KEY')


class PedestrianState(Enum):
    """Pedestrian movement states"""
    WALKING = "walking"
    STOPPED = "stopped"
    PAUSED = "paused"
    REROUTING = "rerouting"
    EMERGENCY = "emergency"
    ARRIVED = "arrived"


class HazardType(Enum):
    """Types of hazards detected"""
    CRIME = "crime"
    FIRE = "fire"
    DISASTER = "disaster"
    CONGESTION = "congestion"
    CONSTRUCTION = "construction"
    POOR_LIGHTING = "poor_lighting"
    ACCESSIBILITY = "accessibility"


@dataclass
class Position:
    """GPS position with timestamp"""
    lat: float
    lng: float
    accuracy: float = 5.0  # meters
    timestamp: float = None
    altitude: Optional[float] = None

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = time.time()
        
        # CRITICAL FIX: Validate coordinates
        if self.lat is None or self.lng is None:
            raise ValueError(f"Invalid coordinates: lat={self.lat}, lng={self.lng}")
        
        # Ensure coordinates are floats
        try:
            self.lat = float(self.lat)
            self.lng = float(self.lng)
        except (TypeError, ValueError) as e:
            raise ValueError(f"Cannot convert coordinates to float: lat={self.lat}, lng={self.lng}") from e

    @property
    def coordinates(self) -> Tuple[float, float]:
        return (self.lat, self.lng)
    
    def to_dict(self) -> Dict:
        """Safe serialization to dictionary"""
        return {
            'lat': float(self.lat) if self.lat is not None else None,
            'lng': float(self.lng) if self.lng is not None else None,
            'accuracy': float(self.accuracy),
            'timestamp': float(self.timestamp) if self.timestamp else None,
            'altitude': float(self.altitude) if self.altitude else None
        }

@dataclass
class Hazard:
    """Hazard/obstacle information"""
    type: HazardType
    position: Position
    radius: float  # meters
    severity: float  # 0-1
    description: str
    timestamp: float = None

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = time.time()

    def is_active(self, current_time: float = None) -> bool:
        """Check if hazard is still active"""
        if current_time is None:
            current_time = time.time()
        # Most hazards expire after 30 minutes
        return (current_time - self.timestamp) < 1800


@dataclass
class RouteSegment:
    """Segment of a walking route"""
    start: Position
    end: Position
    safety_score: float
    distance: float  # meters
    duration: float  # seconds
    instructions: str
    hazards: List[Hazard] = None
    accessibility_features: List[str] = None

    def __post_init__(self):
        if self.hazards is None:
            self.hazards = []
        if self.accessibility_features is None:
            self.accessibility_features = []

    @property
    def is_safe(self) -> bool:
        return self.safety_score >= REROUTE_THRESHOLD


@dataclass
class Pedestrian:
    """Pedestrian user model"""
    user_id: str
    current_position: Position
    destination: Position
    state: PedestrianState
    route: List[RouteSegment]
    current_segment_index: int
    walking_speed: float = 1.4  # m/s (5 km/h)
    accessibility_needs: Set[str] = None
    emergency_contacts: List[str] = None
    session_id: str = None
    travel_mode: str = 'pedestrian'  # 'pedestrian', 'transit'

    def __post_init__(self):
        if self.accessibility_needs is None:
            self.accessibility_needs = set()
        if self.emergency_contacts is None:
            self.emergency_contacts = []

    @property
    def remaining_distance(self) -> float:
        """Calculate remaining distance in meters"""
        if not self.route or self.current_segment_index >= len(self.route):
            return 0
        return sum(seg.distance for seg in self.route[self.current_segment_index:])

    @property
    def estimated_arrival(self) -> float:
        """Estimated arrival time in seconds"""
        return self.remaining_distance / self.walking_speed

    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {
            'user_id': self.user_id,
            'position': asdict(self.current_position),
            'destination': asdict(self.destination),
            'state': self.state.value,
            'remaining_distance': self.remaining_distance,
            'estimated_arrival': self.estimated_arrival,
            'accessibility_needs': list(self.accessibility_needs),
            'current_segment_index': self.current_segment_index,
            'walking_speed': self.walking_speed,
            'travel_mode': self.travel_mode
        }


class RealTimeTracker:
    """Main tracking engine with WebSocket support"""

    def __init__(self, socketio: SocketIO, app: Flask):
        if socketio is None:
            raise ValueError("socketio instance cannot be None")
        self.socketio = socketio
        self.app = app
        self.pedestrians: Dict[str, Pedestrian] = {}
        self.active_hazards: List[Hazard] = []
        self.route_cache: Dict[str, List[RouteSegment]] = {}
        self.safety_check_lock = threading.Lock()
        self.hazard_check_interval = 30  # Check for new hazards every 30 seconds

        # API clients
        self.tomtom_api_key = TOMTOM_API_KEY
        self.overpass_url = OVER_PASS_URL
        self.openweather_api_key = OPENWEATHER_API_KEY
        self.census_api_key = CENSUS_API_KEY
        self.google_maps_api_key = GOOGLE_MAPS_API_KEY

        # Lazy loading of safety AI
        self._safety_ai = None

        # Initialize WebSocket event handlers
        self._setup_socket_handlers()

        # Start background tasks
        self._start_background_tasks()

        logger.info("RealTimeTracker initialized with real API keys")

    @property
    def safety_ai(self):
        """Lazy load safety AI"""
        if self._safety_ai is None:
            try:
                from ai_safety_model import get_safety_ai
                self._safety_ai = get_safety_ai()
                logger.info("Safety AI loaded for tracker")
            except ImportError as e:
                logger.warning(f"Could not load safety AI: {e}")
                self._safety_ai = None
        return self._safety_ai

    def _setup_socket_handlers(self):
        """Setup WebSocket event handlers"""

        @self.socketio.on('connect')
        def handle_connect():
            logger.info(f"Client connected: {request.sid}")
            emit('connected', {'message': 'Connected to tracking server'})

        @self.socketio.on('disconnect')
        def handle_disconnect():
            user_id = None
            for pid, ped in self.pedestrians.items():
                if ped.session_id == request.sid:
                    user_id = pid
                    break

            if user_id:
                self.remove_pedestrian(user_id)
                logger.info(f"Client disconnected and removed: {user_id}")
            else:
                logger.info(f"Client disconnected: {request.sid}")

        @self.socketio.on('start_navigation')
        def handle_start_navigation(data: Dict):
            """Start navigation for a pedestrian"""
            try:
                user_id = data.get('user_id', request.sid)
                start_lat = float(data['start_lat'])
                start_lng = float(data['start_lng'])
                dest_lat = float(data['dest_lat'])
                dest_lng = float(data['dest_lng'])

                accessibility_needs = set(data.get('accessibility_needs', []))
                walking_speed = float(data.get('walking_speed', 1.4))
                travel_mode = data.get('travel_mode', 'pedestrian')

                # Create positions
                start_pos = Position(lat=start_lat, lng=start_lng)
                dest_pos = Position(lat=dest_lat, lng=dest_lng)

                # Generate initial route based on travel mode
                route = self.generate_route(start_pos, dest_pos, accessibility_needs, travel_mode=travel_mode)

                # Create pedestrian
                pedestrian = Pedestrian(
                    user_id=user_id,
                    current_position=start_pos,
                    destination=dest_pos,
                    state=PedestrianState.WALKING,
                    route=route,
                    current_segment_index=0,
                    walking_speed=walking_speed,
                    accessibility_needs=accessibility_needs,
                    session_id=request.sid,
                    travel_mode=travel_mode
                )

                # Add to tracking
                self.add_pedestrian(pedestrian)

                # Join room for private updates
                join_room(user_id)

                # Send initial route
                emit('route_updated', {
                    'route': [self._segment_to_dict(seg) for seg in route],
                    'user_id': user_id,
                    'total_safety': self._weighted_safety_score(route),
                    'total_distance': sum(seg.distance for seg in route),
                    'total_duration': sum(seg.duration for seg in route),
                    'travel_mode': travel_mode
                }, room=user_id)

                # Start position updates
                asyncio.create_task(self._send_position_updates(user_id))

                logger.info(f"Navigation started for {user_id} with mode {travel_mode}")

            except Exception as e:
                logger.error(f"Error starting navigation: {e}")
                emit('error', {'message': str(e)})

        @self.socketio.on('update_position')
        def handle_position_update(data: Dict):
            """Update pedestrian position"""
            try:
                user_id = data['user_id']
                lat = float(data['lat'])
                lng = float(data['lng'])
                accuracy = float(data.get('accuracy', 5.0))

                if user_id in self.pedestrians:
                    pedestrian = self.pedestrians[user_id]
                    new_pos = Position(lat=lat, lng=lng, accuracy=accuracy)

                    # Update position
                    pedestrian.current_position = new_pos

                    # Check if near destination
                    distance_to_dest = self._calculate_distance(
                        new_pos.coordinates,
                        pedestrian.destination.coordinates
                    )

                    if distance_to_dest < 20:  # Within 20 meters
                        pedestrian.state = PedestrianState.ARRIVED
                        emit('arrived', {
                            'user_id': user_id,
                            'position': asdict(new_pos)
                        }, room=user_id)

                    # Broadcast position to all clients (for shared tracking)
                    emit('position_update', {
                        'user_id': user_id,
                        'position': asdict(new_pos),
                        'state': pedestrian.state.value,
                        'timestamp': new_pos.timestamp
                    }, broadcast=True)

            except Exception as e:
                logger.error(f"Error updating position: {e}")

        @self.socketio.on('report_hazard')
        def handle_hazard_report(data: Dict):
            """Report a hazard from pedestrian"""
            try:
                hazard_type = HazardType(data['type'])
                lat = float(data['lat'])
                lng = float(data['lng'])
                radius = float(data.get('radius', 50))
                severity = float(data.get('severity', 0.5))
                description = data.get('description', '')

                position = Position(lat=lat, lng=lng)
                hazard = Hazard(
                    type=hazard_type,
                    position=position,
                    radius=radius,
                    severity=severity,
                    description=description
                )

                self.add_hazard(hazard)

                # Notify all pedestrians in area
                affected_users = self._get_pedestrians_near_hazard(hazard)
                for user_id in affected_users:
                    emit('hazard_alert', {
                        'hazard': self._hazard_to_dict(hazard),
                        'recommendation': self._get_hazard_recommendation(hazard)
                    }, room=user_id)

                logger.info(f"Hazard reported: {hazard_type} at ({lat}, {lng})")

            except Exception as e:
                logger.error(f"Error reporting hazard: {e}")

        @self.socketio.on('request_reroute')
        def handle_reroute_request(data: Dict):
            """Handle manual reroute request"""
            try:
                user_id = data['user_id']
                reason = data.get('reason', 'user_requested')

                if user_id in self.pedestrians:
                    pedestrian = self.pedestrians[user_id]

                    # Generate new route from current position
                    new_route = self.generate_route(
                        pedestrian.current_position,
                        pedestrian.destination,
                        pedestrian.accessibility_needs,
                        avoid_hazards=True,
                        travel_mode=pedestrian.travel_mode
                    )

                    pedestrian.route = new_route
                    pedestrian.current_segment_index = 0
                    pedestrian.state = PedestrianState.REROUTING

                    emit('route_updated', {
                        'route': [self._segment_to_dict(seg) for seg in new_route],
                        'reason': reason,
                        'user_id': user_id,
                        'total_safety': self._weighted_safety_score(new_route)
                    }, room=user_id)

                    logger.info(f"Rerouted {user_id}: {reason}")

            except Exception as e:
                logger.error(f"Error handling reroute: {e}")

        @self.socketio.on('choose_alternative')
        def handle_choose_alternative(data: Dict):
            """Handle user choosing an alternative destination"""
            try:
                user_id = data['user_id']
                alternative_index = data.get('alternative_index', 0)

                if user_id in self.pedestrians:
                    pedestrian = self.pedestrians[user_id]
                    cat_info = self._determine_destination_category(user_id)

                    if cat_info and cat_info[0] != "unknown":
                        category, value = cat_info
                        alternatives = self._find_alternate_destinations(
                            user_id, category, value,
                            pedestrian.route[pedestrian.current_segment_index].safety_score,
                            pedestrian.current_position.lat,
                            pedestrian.current_position.lng,
                            number_of_destinations=5,
                            radius=500
                        )

                        if alternatives and alternative_index < len(alternatives):
                            selected = alternatives[alternative_index]
                            pedestrian.destination = selected["destination"]
                            pedestrian.route = selected["route_segments"]
                            pedestrian.current_segment_index = 0
                            pedestrian.state = PedestrianState.REROUTING

                            emit('route_updated', {
                                'route': [self._segment_to_dict(seg) for seg in selected["route_segments"]],
                                'reason': 'user_selected_alternative',
                                'user_id': user_id,
                                'new_destination': {
                                    'lat': selected["destination"].lat,
                                    'lng': selected["destination"].lng,
                                    'name': selected["name"]
                                }
                            }, room=user_id)

                            logger.info(f"User {user_id} chose alternative: {selected['name']}")

            except Exception as e:
                logger.error(f"Error handling alternative selection: {e}")

    def check_route_obstructions(self, route_coords: List[Tuple[float, float]]) -> Dict:
        """Check if a route has any obstructions (construction, hazards, etc.)"""
        obstructions = {
            'construction_zones': [],
            'hazards': [],
            'total_blocked_segments': 0,
            'has_obstruction': False
        }

        if not route_coords or len(route_coords) < 2:
            return obstructions

        # Sample points along the route (every few points, max 20 samples)
        step = max(1, len(route_coords) // 20)
        sample_points = route_coords[::step]

        # --- Check construction zones via Google routing if available ---
        try:
            from google_routing import GoogleMapsRouter
            router = GoogleMapsRouter()

            for point in sample_points:
                lat, lng = point[0], point[1]

                # Skip invalid coordinates
                if lat is None or lng is None:
                    continue

                try:
                    zones = router.get_construction_zones(float(lat), float(lng), radius=100)
                    if zones:
                        for zone in zones:
                            z_lat = zone.get('lat')
                            z_lng = zone.get('lng')

                            # Skip zones with missing coordinates
                            if z_lat is None or z_lng is None:
                                logger.debug(f"Skipping construction zone with missing coords: {zone}")
                                continue

                            obstructions['construction_zones'].append(zone)
                            obstructions['has_obstruction'] = True
                            obstructions['total_blocked_segments'] += 1
                except Exception as e:
                    logger.warning(f"Error checking construction zone at ({lat}, {lng}): {e}")
                    continue

        except ImportError:
            logger.warning("GoogleMapsRouter not available for obstruction checking")
        except Exception as e:
            logger.error(f"Error checking construction zones: {e}")

        # --- Check against active hazards ---
        try:
            for hazard in self.active_hazards:
                if not hazard.is_active():
                    continue

                # Validate hazard position
                h_pos = getattr(hazard, 'position', None)
                if h_pos is None:
                    continue

                h_lat = getattr(h_pos, 'lat', None)
                h_lng = getattr(h_pos, 'lng', None)
                if h_lat is None or h_lng is None:
                    continue

                h_radius = getattr(hazard, 'radius', 50)

                # Check if hazard is near any route point
                for point in route_coords:
                    p_lat, p_lng = point[0], point[1]

                    # Skip invalid route points
                    if p_lat is None or p_lng is None:
                        continue

                    try:
                        distance = self._calculate_distance(
                            (float(p_lat), float(p_lng)),
                            (float(h_lat), float(h_lng))
                        )
                        if distance < h_radius:
                            obstructions['hazards'].append({
                                'type': hazard.type.value if hasattr(hazard.type, 'value') else str(hazard.type),
                                'description': getattr(hazard, 'description', 'Unknown hazard'),
                                'severity': getattr(hazard, 'severity', 0.5),
                                'location': {'lat': h_lat, 'lng': h_lng}
                            })
                            obstructions['has_obstruction'] = True
                            break
                    except (TypeError, ValueError) as e:
                        logger.debug(f"Distance calc error for hazard at ({h_lat}, {h_lng}): {e}")
                        continue

        except Exception as e:
            logger.error(f"Error checking hazards: {e}")

        # --- Deduplicate construction zones ---
        if obstructions['construction_zones']:
            seen = set()
            unique_zones = []
            for zone in obstructions['construction_zones']:
                z_lat = zone.get('lat', 0)
                z_lng = zone.get('lng', 0)
                if z_lat is None:
                    z_lat = 0
                if z_lng is None:
                    z_lng = 0
                key = f"{z_lat:.6f},{z_lng:.6f}"
                if key not in seen:
                    seen.add(key)
                    unique_zones.append(zone)
            obstructions['construction_zones'] = unique_zones
            obstructions['total_blocked_segments'] = len(unique_zones)

        return obstructions

    def get_route_alternatives_with_transit(self, start: Position, destination: Position,
                                        accessibility_needs: Set[str],
                                        obstruction_zones: List[Dict] = None) -> List[Dict]:
        """Get multiple route alternatives including different transit options"""
        alternatives = []

        try:
            from google_routing import GoogleMapsRouter
            router = GoogleMapsRouter()

            # Try to get transit routes
            if router.api_key:
                routes = router.get_transit_route(
                    start.lat, start.lng,
                    destination.lat, destination.lng,
                    alternatives=True,
                    obstruction_zones=obstruction_zones
                )

                if routes:
                    for i, route in enumerate(routes[:3]):  # Limit to top 3
                        waypoints = route.get('waypoints', [])
                        if waypoints and len(waypoints) >= 2:
                            route_segments = self._create_segments_from_waypoints(
                                waypoints, accessibility_needs
                            )

                            # Check for obstructions
                            obstructions = self.check_route_obstructions(waypoints)
                            obstruction_count = len(obstructions.get('construction_zones', [])) + \
                                            len(obstructions.get('hazards', []))

                            alternatives.append({
                                'index': i,
                                'type': 'transit',
                                'transit_lines': route.get('transit_lines', []),
                                'total_duration_seconds': route['total_duration_seconds'],
                                'total_duration_minutes': route['total_duration_seconds'] / 60,
                                'total_distance_meters': route['total_distance_meters'],
                                'walking_time_minutes': route.get('total_walking_time', 0) / 60,
                                'transit_time_minutes': route.get('total_transit_time', 0) / 60,
                                'transit_steps': route.get('transit_steps', []),
                                'walking_steps': route.get('walking_steps', []),
                                'waypoints': waypoints,
                                'route_segments': route_segments,
                                'safety_score': self._weighted_safety_score(route_segments) if route_segments else 0.7,
                                'construction_warnings': route.get('construction_warnings', []),
                                'has_obstruction': obstruction_count > 0,
                                'obstruction_count': obstruction_count
                            })

            # Also try pedestrian routes
            pedestrian_route = self.generate_route_with_tomtom(start, destination, accessibility_needs)
            if pedestrian_route:
                ped_waypoints = [(seg.start.lat, seg.start.lng) for seg in pedestrian_route]
                ped_waypoints.append((pedestrian_route[-1].end.lat, pedestrian_route[-1].end.lng))
                ped_obstructions = self.check_route_obstructions(ped_waypoints)
                obstruction_count = len(ped_obstructions.get('construction_zones', [])) + \
                                len(ped_obstructions.get('hazards', []))

                alternatives.append({
                    'index': len(alternatives),
                    'type': 'pedestrian',
                    'total_duration_seconds': sum(seg.duration for seg in pedestrian_route),
                    'total_duration_minutes': sum(seg.duration for seg in pedestrian_route) / 60,
                    'total_distance_meters': sum(seg.distance for seg in pedestrian_route),
                    'waypoints': ped_waypoints,
                    'route_segments': pedestrian_route,
                    'safety_score': self._weighted_safety_score(pedestrian_route),
                    'construction_warnings': ped_obstructions.get('construction_zones', []),
                    'has_obstruction': obstruction_count > 0,
                    'obstruction_count': obstruction_count
                })

            # Sort by obstruction count first (fewer obstructions better), then duration
            alternatives.sort(key=lambda x: (x.get('obstruction_count', 0), x['total_duration_seconds']))

        except ImportError as e:
            logger.warning(f"Could not import GoogleMapsRouter: {e}")
        except Exception as e:
            logger.error(f"Error getting route alternatives: {e}")

        return alternatives

    def _create_segments_from_waypoints(self, waypoints: List[Tuple[float, float]],
                                        accessibility_needs: Set[str]) -> List[RouteSegment]:
        """Create route segments from waypoints"""
        segments = []

        try:
            for i in range(len(waypoints) - 1):
                seg_start = Position(lat=waypoints[i][0], lng=waypoints[i][1])
                seg_end = Position(lat=waypoints[i+1][0], lng=waypoints[i+1][1])

                distance = self._calculate_distance(seg_start.coordinates, seg_end.coordinates)
                duration = distance / 1.4  # walking speed for segments
                safety_score = self._calculate_segment_safety_weighted(seg_start, seg_end, accessibility_needs)

                segment = RouteSegment(
                    start=seg_start,
                    end=seg_end,
                    safety_score=safety_score,
                    distance=distance,
                    duration=duration,
                    instructions="Continue on route",
                    hazards=self._get_hazards_in_segment(seg_start, seg_end),
                    accessibility_features=self._get_accessibility_features(seg_start, seg_end, accessibility_needs)
                )
                segments.append(segment)
        except Exception as e:
            logger.error(f"Error creating segments from waypoints: {e}")

        return segments

    def generate_route(self, start: Position, destination: Position,
                      accessibility_needs: Set[str], avoid_hazards: bool = True,
                      travel_mode: str = 'pedestrian') -> List[RouteSegment]:
        """Generate route with specified travel mode"""
        if travel_mode == 'transit':
            return self.generate_transit_route(start, destination, accessibility_needs)
        else:
            return self.generate_route_with_tomtom(start, destination, accessibility_needs, avoid_hazards)

    def generate_transit_route(self, start: Position, destination: Position,
                               accessibility_needs: Set[str]) -> List[RouteSegment]:
        """Generate transit route using Google Maps Directions API"""
        try:
            if not self.google_maps_api_key:
                logger.warning("Google Maps API key not set for transit routing")
                return self.generate_route_with_tomtom(start, destination, accessibility_needs)

            # Import Google Maps router
            from google_routing import GoogleMapsRouter
            router = GoogleMapsRouter(self.google_maps_api_key)
            routes = router.get_transit_route(start.lat, start.lng, destination.lat, destination.lng)

            if not routes:
                logger.warning("No transit routes found, falling back to pedestrian")
                return self.generate_route_with_tomtom(start, destination, accessibility_needs)

            # Use the first route (or best route based on criteria)
            route_data = routes[0]
            return self._parse_google_transit_route(route_data, start, destination, accessibility_needs)

        except Exception as e:
            logger.error(f"Error generating transit route: {e}")
            return self.generate_route_with_tomtom(start, destination, accessibility_needs)

    def _parse_google_transit_route(self, route_data: Dict, start: Position,
                                    destination: Position, accessibility_needs: Set[str]) -> List[RouteSegment]:
        """Parse Google Maps transit route into RouteSegment objects"""
        route_segments = []

        # Get waypoints (full path)
        waypoints = route_data.get('waypoints', [])
        if not waypoints:
            return self._generate_synthetic_route(start, destination, accessibility_needs, avoid_hazards=True)

        # Get transit steps for detailed instructions
        transit_steps = route_data.get('transit_steps', [])

        # Create segments from waypoints
        for i in range(len(waypoints) - 1):
            seg_start = Position(lat=waypoints[i][0], lng=waypoints[i][1])
            seg_end = Position(lat=waypoints[i+1][0], lng=waypoints[i+1][1])

            distance = self._calculate_distance(seg_start.coordinates, seg_end.coordinates)

            # Estimate duration based on travel mode in this segment
            # For simplicity, use walking speed for all segments
            # In a more sophisticated version, we'd match to transit step durations
            duration = distance / 1.4

            safety_score = self._calculate_segment_safety_weighted(seg_start, seg_end, accessibility_needs)

            # Find matching transit step instruction
            instruction = "Continue"
            for step in transit_steps:
                if 'instruction' in step:
                    instruction = step['instruction']
                    break

            segment = RouteSegment(
                start=seg_start,
                end=seg_end,
                safety_score=safety_score,
                distance=distance,
                duration=duration,
                instructions=instruction,
                hazards=self._get_hazards_in_segment(seg_start, seg_end),
                accessibility_features=self._get_accessibility_features(seg_start, seg_end, accessibility_needs)
            )
            route_segments.append(segment)

        return route_segments

    def generate_route_with_tomtom(self, start: Position, destination: Position,
                                   accessibility_needs: Set[str], avoid_hazards: bool = True) -> List[RouteSegment]:
        """Generate route using TomTom API with real road network"""
        try:
            # Try to use TomTom API first
            if self.tomtom_api_key:
                url = f"https://api.tomtom.com/routing/1/calculateRoute/{start.lat},{start.lng}:{destination.lat},{destination.lng}/json"
                params = {
                    'key': self.tomtom_api_key,
                    'travelMode': 'pedestrian',
                    'routeType': 'fastest',
                    'instructionsType': 'text',
                    'language': 'en-US',
                    'routeRepresentation': 'polyline',
                    'computeTravelTimeFor': 'all'
                }

                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                data = response.json()

                if 'routes' in data and data['routes']:
                    route = data['routes'][0]
                    return self._parse_tomtom_route(route, start, destination, accessibility_needs, avoid_hazards)

            # Fallback to synthetic route if TomTom fails
            logger.warning("TomTom API failed, using synthetic route")
            return self._generate_synthetic_route(start, destination, accessibility_needs, avoid_hazards)

        except Exception as e:
            logger.error(f"Error generating route with TomTom: {e}")
            return self._generate_synthetic_route(start, destination, accessibility_needs, avoid_hazards)

    def _parse_tomtom_route(self, route_data: Dict, start: Position, destination: Position,
                           accessibility_needs: Set[str], avoid_hazards: bool) -> List[RouteSegment]:
        """Parse TomTom route response into RouteSegment objects"""
        route_segments = []

        try:
            legs = route_data.get('legs', [])
            if not legs:
                return self._generate_synthetic_route(start, destination, accessibility_needs, avoid_hazards)

            leg = legs[0]
            points = leg.get('points', [])

            # Extract route points
            route_points = []
            for point in points:
                if 'latitude' in point and 'longitude' in point:
                    route_points.append(Position(lat=point['latitude'], lng=point['longitude']))

            if len(route_points) < 2:
                return self._generate_synthetic_route(start, destination, accessibility_needs, avoid_hazards)

            # Create segments from points
            for i in range(len(route_points) - 1):
                seg_start = route_points[i]
                seg_end = route_points[i + 1]

                # Calculate segment details
                distance = self._calculate_distance(seg_start.coordinates, seg_end.coordinates)
                duration = distance / 1.4  # Average walking speed

                # Calculate safety score for segment
                safety_score = self._calculate_segment_safety_weighted(seg_start, seg_end, accessibility_needs)

                # Get hazards in segment
                hazards_in_segment = []
                if avoid_hazards:
                    hazards_in_segment = self._get_hazards_in_segment(seg_start, seg_end)

                # Get instructions if available
                instruction = "Continue straight"
                if 'guidance' in leg and 'instructions' in leg['guidance'] and i < len(leg['guidance']['instructions']):
                    instr = leg['guidance']['instructions'][i]
                    instruction = instr.get('message', 'Continue straight')

                segment = RouteSegment(
                    start=seg_start,
                    end=seg_end,
                    safety_score=safety_score,
                    distance=distance,
                    duration=duration,
                    instructions=instruction,
                    hazards=hazards_in_segment,
                    accessibility_features=self._get_accessibility_features(seg_start, seg_end, accessibility_needs)
                )

                route_segments.append(segment)

        except Exception as e:
            logger.error(f"Error parsing TomTom route: {e}")
            return self._generate_synthetic_route(start, destination, accessibility_needs, avoid_hazards)

        return route_segments if route_segments else self._generate_synthetic_route(start, destination, accessibility_needs, avoid_hazards)

    def _generate_synthetic_route(self, start: Position, destination: Position,
                                  accessibility_needs: Set[str], avoid_hazards: bool) -> List[RouteSegment]:
        """Generate synthetic route when API is unavailable"""
        num_segments = 10
        route_segments = []

        for i in range(num_segments):
            t = i / num_segments
            t_next = (i + 1) / num_segments

            seg_start = Position(
                lat=start.lat + t * (destination.lat - start.lat),
                lng=start.lng + t * (destination.lng - start.lng)
            )

            seg_end = Position(
                lat=start.lat + t_next * (destination.lat - start.lat),
                lng=start.lng + t_next * (destination.lng - start.lng)
            )

            safety_score = self._calculate_segment_safety_weighted(seg_start, seg_end, accessibility_needs)

            hazards_in_segment = []
            if avoid_hazards:
                hazards_in_segment = self._get_hazards_in_segment(seg_start, seg_end)

            if i == 0:
                instructions = "Start walking"
            elif i == num_segments - 1:
                instructions = "Approaching destination"
            else:
                instructions = "Continue straight"

            segment = RouteSegment(
                start=seg_start,
                end=seg_end,
                safety_score=safety_score,
                distance=self._calculate_distance(seg_start.coordinates, seg_end.coordinates),
                duration=self._calculate_distance(seg_start.coordinates, seg_end.coordinates) / 1.4,
                instructions=instructions,
                hazards=hazards_in_segment,
                accessibility_features=self._get_accessibility_features(seg_start, seg_end, accessibility_needs)
            )

            route_segments.append(segment)

        return route_segments

    def _weighted_safety_score(self, segments: List[RouteSegment]) -> float:
        """Calculate weighted safety score for a list of route segments using distance weights"""
        if not segments:
            return 0.0
        scores = np.array([seg.safety_score for seg in segments])
        distances = np.array([seg.distance for seg in segments])
        total_dist = distances.sum()
        if total_dist == 0:
            return float(np.mean(scores))
        weighted_sum = np.sum(scores * distances)
        return float(weighted_sum / total_dist)

    def _calculate_segment_safety_weighted(self, start: Position, end: Position,
                                          accessibility_needs: Set[str], max_iterations: int = 30) -> float:
        """Calculate safety score for a route segment using weighted average along the path"""
        if self.safety_ai and self.safety_ai.is_trained:
            try:
                delta_lat = end.lat - start.lat
                delta_lng = end.lng - start.lng
                steps = max_iterations
                step_lat = delta_lat / steps
                step_lng = delta_lng / steps
                scores = []
                distances = []

                for i in range(steps + 1):
                    lat = start.lat + i * step_lat
                    lng = start.lng + i * step_lng
                    score = self.safety_ai.predict_safety_score(lat, lng)['safety_score']
                    scores.append(score)

                    # Distance from previous point
                    if i == 0:
                        distances.append(0)
                    else:
                        prev_lat = start.lat + (i - 1) * step_lat
                        prev_lng = start.lng + (i - 1) * step_lng
                        dist = self._calculate_distance((lat, lng), (prev_lat, prev_lng))
                        distances.append(dist)

                # Use trapezoidal rule to integrate score * ds
                total = 0.0
                total_dist = 0.0
                for i in range(1, steps + 1):
                    seg_dist = distances[i]
                    total_dist += seg_dist
                    # trapezoid: (score[i-1] + score[i])/2 * seg_dist
                    total += ((scores[i-1] + scores[i]) / 2) * seg_dist

                if total_dist == 0:
                    base_score = np.mean(scores)
                else:
                    base_score = total / total_dist

            except Exception as e:
                logger.error(f"Safety AI prediction failed: {e}")
                base_score = 0.7
        else:
            # Use real-time data from OpenWeather if available
            try:
                weather_data = self._get_real_weather_data(start.lat, start.lng)
                crime_data = self._get_real_crime_data(start.lat, start.lng)
                time_data = self._get_time_based_factors()

                # Combine real data sources
                base_score = (weather_data.get('safety_score', 0.7) * 0.3 +
                             crime_data.get('crime_index', 0.7) * 0.4 +
                             time_data.get('time_score', 0.7) * 0.3)
            except Exception as e:
                logger.warning(f"Could not fetch real data: {e}")
                # Fallback to time-based synthetic score
                current_hour = datetime.now().hour
                if 6 <= current_hour <= 18:
                    base_score = np.random.uniform(0.6, 0.9)
                else:
                    base_score = np.random.uniform(0.3, 0.7)

        # Adjust for accessibility needs
        accessibility_factor = 1.0
        if 'blind' in accessibility_needs:
            current_hour = datetime.now().hour
            if current_hour < 6 or current_hour > 18:
                accessibility_factor *= 0.8
        if 'wheelchair' in accessibility_needs:
            accessibility_factor *= 0.9

        # Adjust for nearby hazards
        hazard_factor = 1.0
        segment_hazards = self._get_hazards_in_segment(start, end)
        for hazard in segment_hazards:
            hazard_factor *= (1 - hazard.severity * 0.3)

        final_score = base_score * accessibility_factor * hazard_factor
        return max(0.0, min(1.0, final_score))

    def _get_real_weather_data(self, lat: float, lng: float) -> Dict:
        """Get real weather data from OpenWeatherMap"""
        try:
            if self.openweather_api_key:
                url = "https://api.openweathermap.org/data/2.5/weather"
                params = {
                    'lat': lat,
                    'lon': lng,
                    'appid': self.openweather_api_key,
                    'units': 'metric'
                }
                response = requests.get(url, params=params, timeout=5)
                response.raise_for_status()
                data = response.json()

                # Calculate safety score based on weather
                weather_main = data.get('weather', [{}])[0].get('main', '').lower()
                temp = data.get('main', {}).get('temp', 20)
                wind_speed = data.get('wind', {}).get('speed', 0)

                safety_score = 0.8
                if any(cond in weather_main for cond in ['thunderstorm', 'tornado']):
                    safety_score = 0.2
                elif any(cond in weather_main for cond in ['snow', 'sleet']):
                    safety_score = 0.4
                elif 'rain' in weather_main:
                    safety_score = 0.6
                elif temp < 0 or temp > 35:
                    safety_score *= 0.8
                elif wind_speed > 10:
                    safety_score *= 0.9

                return {'safety_score': safety_score, 'temperature': temp, 'condition': weather_main}
        except Exception as e:
            logger.warning(f"Could not fetch weather data: {e}")

        return {'safety_score': 0.7}

    def _get_real_crime_data(self, lat: float, lng: float) -> Dict:
        """Get real crime data from WPRDC (Pittsburgh area)"""
        try:
            # WPRDC API for Pittsburgh crime data
            url = "https://data.wprdc.org/api/3/action/datastore_search"
            params = {
                'resource_id': '1797ead8-8262-41cc-9099-cbc8a161924b',
                'limit': 10,
                'filters': json.dumps({
                    'LAT': {'$gte': lat - 0.01, '$lte': lat + 0.01},
                    'LON': {'$gte': lng - 0.01, '$lte': lng + 0.01}
                })
            }
            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()

            if data.get('success'):
                incidents = data['result'].get('records', [])
                crime_count = len(incidents)
                # Lower crime index means safer (0-1, 1 is safest)
                crime_index = max(0.1, 1.0 - (crime_count * 0.05))
                return {'crime_index': crime_index, 'incident_count': crime_count}
        except Exception as e:
            logger.warning(f"Could not fetch crime data: {e}")

        return {'crime_index': 0.7}

    def _get_time_based_factors(self) -> Dict:
        """Calculate time-based safety factors"""
        now = datetime.now()
        hour = now.hour
        day_of_week = now.weekday()

        # Time of day factor
        if 6 <= hour <= 18:
            time_factor = 0.9
        elif 19 <= hour <= 21:
            time_factor = 0.7
        else:
            time_factor = 0.4

        # Day of week factor
        day_factor = 0.8 if day_of_week < 5 else 0.7

        # Seasonal factor
        month = now.month
        if month in [12, 1, 2]:
            season_factor = 0.6
        elif month in [6, 7, 8]:
            season_factor = 0.9
        else:
            season_factor = 0.8

        time_score = (time_factor * 0.5 + day_factor * 0.3 + season_factor * 0.2)
        return {'time_score': time_score, 'hour': hour, 'is_weekend': day_of_week >= 5}

    def _get_hazards_in_segment(self, start: Position, end: Position) -> List[Hazard]:
        """Get hazards affecting a route segment"""
        hazards = []

        for hazard in self.active_hazards:
            if not hazard.is_active():
                continue

            # Check if hazard is near segment (simplified)
            seg_mid_lat = (start.lat + end.lat) / 2
            seg_mid_lng = (start.lng + end.lng) / 2

            distance = self._calculate_distance(
                (seg_mid_lat, seg_mid_lng),
                hazard.position.coordinates
            )

            if distance < hazard.radius * 1.5:  # Buffer zone
                hazards.append(hazard)

        return hazards

    def _get_accessibility_features(self, start: Position, end: Position,
                                   needs: Set[str]) -> List[str]:
        """Get accessibility features for segment"""
        features = []

        if 'blind' in needs:
            features.extend(['tactile_paving', 'audible_signals', 'consistent_width'])

        if 'wheelchair' in needs:
            features.extend(['smooth_surface', 'ramps', 'wide_path'])

        if 'deaf' in needs:
            features.extend(['visual_signals', 'clear_sightlines'])

        return features

    def _determine_destination_category(self, user_id: str) -> Optional[Tuple[str, str]]:
        """Determine the category of the destination using Overpass API"""
        if user_id not in self.pedestrians:
            return None
        pedestrian = self.pedestrians[user_id]
        dest_lat = pedestrian.destination.lat
        dest_lng = pedestrian.destination.lng

        query = f"""
        [out:json];
        (
            node(around:10, {dest_lat}, {dest_lng});
            way(around:10, {dest_lat}, {dest_lng});
            relation(around:10, {dest_lat}, {dest_lng});
        );
        out tags center;
        """
        try:
            res = requests.get(self.overpass_url, params={"data": query}, timeout=10)
            res.raise_for_status()
            data = res.json()
            elements = [el.get("tags", {}) for el in data["elements"]]
            # Find first element with relevant category
            for tags in elements:
                for tag in CATEGORY_TAGS:
                    if tag in tags:
                        return (tag, tags[tag])
            # If none, return unknown
            return ("unknown", None)
        except Exception as e:
            logger.error(f"Error determining destination category: {e}")
            return None

    def _find_alternate_destinations(self, user_id: str, original_category: str, category_value: str,
                                      current_safety: float, lat: float, lng: float, number_of_destinations: int,
                                      radius: int = 500) -> List[Dict]:
        """Find alternate destinations of the same category within radius meters using Overpass API"""
        if user_id not in self.pedestrians:
            return []

        pedestrian = self.pedestrians[user_id]
        # Query Overpass for places with the same category/value
        query = f"""
        [out:json];
        (
            node["{original_category}"="{category_value}"](around:{radius}, {lat}, {lng});
            way["{original_category}"="{category_value}"](around:{radius}, {lat}, {lng});
            relation["{original_category}"="{category_value}"](around:{radius}, {lat}, {lng});
        );
        out center;
        """
        try:
            res = requests.get(self.overpass_url, params={"data": query}, timeout=10)
            res.raise_for_status()
            data = res.json()
            candidates = []

            for el in data["elements"]:
                # Get coordinates
                if "lat" in el and "lon" in el:
                    dest_lat = el["lat"]
                    dest_lng = el["lon"]
                elif "center" in el:
                    dest_lat = el["center"]["lat"]
                    dest_lng = el["center"]["lon"]
                else:
                    continue

                # Skip if too close to original destination
                distance_to_original = self._calculate_distance((lat, lng), (dest_lat, dest_lng))
                if distance_to_original < 50:
                    continue

                # Create candidate destination
                candidate_dest = Position(lat=dest_lat, lng=dest_lng)

                # Generate route to candidate
                route = self.generate_route(
                    pedestrian.current_position,
                    candidate_dest,
                    pedestrian.accessibility_needs,
                    avoid_hazards=True,
                    travel_mode=pedestrian.travel_mode
                )
                if not route:
                    continue

                # Compute weighted safety for this route
                route_safety = self._weighted_safety_score(route)
                total_distance = sum(seg.distance for seg in route)
                total_duration = sum(seg.duration for seg in route)

                # If safety is better than current route, consider it
                if route_safety > current_safety or current_safety < REROUTE_THRESHOLD:
                    # Get name from tags
                    name = el.get("tags", {}).get("name", f"{original_category}:{category_value}")

                    candidates.append({
                        "destination": candidate_dest,
                        "safety_score": route_safety,
                        "distance_meters": total_distance,
                        "duration_seconds": total_duration,
                        "route_segments": route,
                        "category": original_category,
                        "category_value": category_value,
                        "name": name,
                        "score_gain": route_safety - current_safety
                    })

            # Sort by safety score descending, then by distance ascending
            candidates.sort(key=lambda x: (-x["safety_score"], x["distance_meters"]))
            return candidates[:number_of_destinations]  # top no. of destinations (parameter)
        except Exception as e:
            logger.error(f"Error finding alternate destinations: {e}")
            return []

    def _check_all_pedestrians_safety(self):
        """Check safety for all tracked pedestrians"""
        for user_id, pedestrian in self.pedestrians.items():
            try:
                if pedestrian.state not in [PedestrianState.WALKING, PedestrianState.REROUTING]:
                    continue

                if pedestrian.current_segment_index < len(pedestrian.route):
                    current_segment = pedestrian.route[pedestrian.current_segment_index]

                    # Check if safety has dropped
                    if current_segment.safety_score < REROUTE_THRESHOLD:
                        logger.info(f"Low safety detected for {user_id}: {current_segment.safety_score}")
                        self._trigger_reroute_if_needed(user_id, reason="low_safety")

                    # Check for new hazards in upcoming segments
                    upcoming_segments = pedestrian.route[pedestrian.current_segment_index:]
                    for i, segment in enumerate(upcoming_segments):
                        if segment.hazards and i < 3:  # Hazards in next 3 segments
                            self._trigger_reroute_if_needed(user_id, reason="hazard_ahead")
                            break

            except Exception as e:
                logger.error(f"Error checking safety for {user_id}: {e}")

    def _trigger_reroute_if_needed(self, user_id: str, hazard: Hazard = None, reason: str = None):
        """Trigger reroute if conditions are met, with alternative destination support"""
        if user_id not in self.pedestrians:
            return

        pedestrian = self.pedestrians[user_id]

        # Don't reroute if already rerouting or arrived
        if pedestrian.state in [PedestrianState.REROUTING, PedestrianState.ARRIVED]:
            return

        # First, try to generate a safer route to the same destination
        new_route = self.generate_route(
            pedestrian.current_position,
            pedestrian.destination,
            pedestrian.accessibility_needs,
            avoid_hazards=True,
            travel_mode=pedestrian.travel_mode
        )

        current_safety = pedestrian.route[pedestrian.current_segment_index].safety_score if pedestrian.route else 0
        new_safety = self._weighted_safety_score(new_route) if new_route else 0

        # If new route is significantly safer, use it
        if new_safety > current_safety + 0.1 or current_safety < REROUTE_THRESHOLD:
            pedestrian.route = new_route
            pedestrian.current_segment_index = 0
            pedestrian.state = PedestrianState.REROUTING

            # Notify via WebSocket
            reason = reason or (hazard.type.value if hazard else "safety_concern")

            self.socketio.emit('reroute_triggered', {
                'user_id': user_id,
                'new_route': [self._segment_to_dict(seg) for seg in new_route],
                'reason': reason,
                'hazard': self._hazard_to_dict(hazard) if hazard else None,
                'timestamp': time.time()
            }, room=user_id)

            # Provide accessibility-specific alerts
            self._send_accessibility_alerts(user_id, reason, hazard)

            logger.info(f"Rerouted {user_id} due to {reason}")
            return

        # If new route is not much safer, consider alternative destinations
        cat_info = self._determine_destination_category(user_id)
        if cat_info and cat_info[0] != "unknown":
            category, value = cat_info
            lat = pedestrian.current_position.lat
            lng = pedestrian.current_position.lng
            alternatives = self._find_alternate_destinations(
                user_id, category, value, current_safety, lat, lng, number_of_destinations=5, radius=500
            )
            if alternatives:
                best = alternatives[0]
                pedestrian.destination = best["destination"]
                pedestrian.route = best["route_segments"]
                pedestrian.current_segment_index = 0
                pedestrian.state = PedestrianState.REROUTING

                self.socketio.emit('alternative_destination', {
                    'user_id': user_id,
                    'new_destination': {
                        'lat': best["destination"].lat,
                        'lng': best["destination"].lng,
                        'name': best["name"],
                        'category': best["category"],
                        'value': best["category_value"]
                    },
                    'new_route': [self._segment_to_dict(seg) for seg in best["route_segments"]],
                    'safety_score': best["safety_score"],
                    'distance_meters': best["distance_meters"],
                    'duration_seconds': best["duration_seconds"],
                    'reason': "alternative_destination",
                    'hazard': self._hazard_to_dict(hazard) if hazard else None,
                    'alternatives': [{
                        'name': alt["name"],
                        'safety_score': alt["safety_score"],
                        'distance_meters': alt["distance_meters"],
                        'duration_seconds': alt["duration_seconds"]
                    } for alt in alternatives[1:4]],
                    'timestamp': time.time()
                }, room=user_id)

                self._send_accessibility_alerts(user_id, "alternative_destination", hazard)
                logger.info(f"Rerouted {user_id} to alternative destination: {best['name']}")
                return

        # If no alternative, just warn
        logger.info(f"No better route or alternative found for {user_id}")
        self.socketio.emit('reroute_unavailable', {
            'user_id': user_id,
            'current_safety': current_safety,
            'reason': reason,
            'timestamp': time.time()
        }, room=user_id)

    def _get_relevant_category(self, tags: dict) -> Tuple[str, Optional[str]]:
        """Get the most relevant category from tags based on priority order"""
        for tag in CATEGORY_TAGS:
            if tag in tags:
                return (tag, tags[tag])
        return ("unknown", None)

    def _send_accessibility_alerts(self, user_id: str, reason: str, hazard: Hazard = None):
        """Send accessibility-appropriate alerts"""
        if user_id not in self.pedestrians:
            return

        pedestrian = self.pedestrians[user_id]
        needs = pedestrian.accessibility_needs

        alert_data = {
            'user_id': user_id,
            'reason': reason,
            'timestamp': time.time(),
            'hazard': self._hazard_to_dict(hazard) if hazard else None
        }

        if 'blind' in needs:
            description = f"Rerouting due to {reason.replace('_', ' ')}"
            if hazard:
                description += f". Hazard: {hazard.description}"

            alert_data.update({
                'audio_alert': {
                    'message': description,
                    'type': 'warning',
                    'priority': 'high'
                },
                'haptic_pattern': 'triple_pulse'
            })

        if 'deaf' in needs:
            alert_data.update({
                'visual_alert': {
                    'pattern': 'flash',
                    'color': '#ff9900',
                    'duration': 5000
                },
                'vibration_pattern': 'long_pulse'
            })

        self.socketio.emit('accessibility_alert', alert_data, room=user_id)

    def _get_pedestrians_near_hazard(self, hazard: Hazard) -> List[str]:
        """Get pedestrians near a hazard"""
        affected = []

        for user_id, pedestrian in self.pedestrians.items():
            distance = self._calculate_distance(
                pedestrian.current_position.coordinates,
                hazard.position.coordinates
            )

            if distance < hazard.radius * 2:
                affected.append(user_id)

        return affected

    def _update_hazards(self):
        """Remove expired hazards and fetch new ones from APIs"""
        current_time = time.time()
        self.active_hazards = [
            h for h in self.active_hazards
            if h.is_active(current_time)
        ]

        # Fetch hazards from real APIs periodically
        self._fetch_crime_hazards()
        self._fetch_weather_hazards()

    def _fetch_crime_hazards(self):
        """Fetch real crime data from WPRDC API"""
        try:
            for user_id, pedestrian in self.pedestrians.items():
                lat = pedestrian.current_position.lat
                lng = pedestrian.current_position.lng

                url = "https://data.wprdc.org/api/3/action/datastore_search"
                params = {
                    'resource_id': '1797ead8-8262-41cc-9099-cbc8a161924b',
                    'limit': 5,
                    'filters': json.dumps({
                        'LAT': {'$gte': lat - 0.01, '$lte': lat + 0.01},
                        'LON': {'$gte': lng - 0.01, '$lte': lng + 0.01}
                    })
                }
                response = requests.get(url, params=params, timeout=5)
                response.raise_for_status()
                data = response.json()

                if data.get('success'):
                    records = data['result'].get('records', [])
                    for record in records:
                        try:
                            crime_lat = float(record.get('LAT', 0))
                            crime_lng = float(record.get('LON', 0))
                            if crime_lat == 0 or crime_lng == 0:
                                continue

                            offense = record.get('OFFENSES', '').lower()
                            if any(word in offense for word in ['assault', 'robbery', 'burglary']):
                                severity = 0.8
                                radius = 200
                            elif any(word in offense for word in ['theft', 'larceny']):
                                severity = 0.5
                                radius = 150
                            else:
                                continue

                            hazard = Hazard(
                                type=HazardType.CRIME,
                                position=Position(lat=crime_lat, lng=crime_lng),
                                radius=radius,
                                severity=severity,
                                description=f"Crime incident: {record.get('OFFENSES', 'Unknown')}",
                                timestamp=time.time()
                            )
                            self.add_hazard(hazard)
                        except Exception as e:
                            continue
        except Exception as e:
            logger.warning(f"Error fetching crime hazards: {e}")

    def _fetch_weather_hazards(self):
        """Fetch weather alerts from OpenWeatherMap"""
        try:
            if self.openweather_api_key:
                for user_id, pedestrian in self.pedestrians.items():
                    lat = pedestrian.current_position.lat
                    lng = pedestrian.current_position.lng

                    url = "https://api.openweathermap.org/data/2.5/weather"
                    params = {
                        'lat': lat,
                        'lon': lng,
                        'appid': self.openweather_api_key,
                        'units': 'metric'
                    }
                    response = requests.get(url, params=params, timeout=5)
                    response.raise_for_status()
                    data = response.json()

                    weather_main = data.get('weather', [{}])[0].get('main', '').lower()
                    if 'thunderstorm' in weather_main or 'tornado' in weather_main:
                        hazard = Hazard(
                            type=HazardType.DISASTER,
                            position=Position(lat=lat, lng=lng),
                            radius=1000,
                            severity=0.9,
                            description=f"Severe weather: {weather_main}",
                            timestamp=time.time()
                        )
                        self.add_hazard(hazard)
        except Exception as e:
            logger.warning(f"Error fetching weather hazards: {e}")

    async def _send_position_updates(self, user_id: str):
        """Send regular position updates to client"""
        while user_id in self.pedestrians:
            try:
                pedestrian = self.pedestrians[user_id]

                if pedestrian.state == PedestrianState.WALKING:
                    self._update_pedestrian_position(pedestrian)

                self.socketio.emit('position_update', {
                    'user_id': user_id,
                    'position': asdict(pedestrian.current_position),
                    'state': pedestrian.state.value,
                    'remaining_distance': pedestrian.remaining_distance,
                    'estimated_arrival': pedestrian.estimated_arrival
                }, room=user_id)

                await asyncio.sleep(UPDATE_INTERVAL)

            except Exception as e:
                logger.error(f"Error sending position updates for {user_id}: {e}")
                break

    def _update_pedestrian_position(self, pedestrian: Pedestrian):
        """Update pedestrian position along route"""
        if not pedestrian.route or pedestrian.current_segment_index >= len(pedestrian.route):
            return

        current_segment = pedestrian.route[pedestrian.current_segment_index]

        total_seg_distance = current_segment.distance
        distance_moved = pedestrian.walking_speed * UPDATE_INTERVAL

        progress = min(1.0, distance_moved / total_seg_distance)

        new_lat = current_segment.start.lat + progress * (current_segment.end.lat - current_segment.start.lat)
        new_lng = current_segment.start.lng + progress * (current_segment.end.lng - current_segment.start.lng)

        pedestrian.current_position = Position(
            lat=new_lat,
            lng=new_lng,
            accuracy=5.0
        )

        if progress >= 1.0:
            pedestrian.current_segment_index += 1

            if pedestrian.current_segment_index >= len(pedestrian.route):
                pedestrian.state = PedestrianState.ARRIVED

    @staticmethod
    def _calculate_distance(coord1: Tuple[float, float], coord2: Tuple[float, float]) -> float:
        """Calculate distance between two coordinates in meters using Haversine"""
        lat1, lon1 = coord1
        lat2, lon2 = coord2

        R = 6371000  # Earth radius in meters

        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        delta_lat = math.radians(lat2 - lat1)
        delta_lon = math.radians(lon2 - lon1)

        a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

        return R * c

    @staticmethod
    def _segment_to_dict(segment: RouteSegment) -> Dict:
        """Convert route segment to dictionary"""
        return {
            'start': asdict(segment.start),
            'end': asdict(segment.end),
            'safety_score': segment.safety_score,
            'distance': segment.distance,
            'duration': segment.duration,
            'instructions': segment.instructions,
            'hazards': [RealTimeTracker._hazard_to_dict(h) for h in segment.hazards],
            'accessibility_features': segment.accessibility_features,
            'is_safe': segment.is_safe
        }

    @staticmethod
    def _hazard_to_dict(hazard: Hazard) -> Dict:
        """Convert hazard to dictionary"""
        return {
            'type': hazard.type.value,
            'position': asdict(hazard.position),
            'radius': hazard.radius,
            'severity': hazard.severity,
            'description': hazard.description,
            'timestamp': hazard.timestamp
        }

    @staticmethod
    def _get_hazard_recommendation(hazard: Hazard) -> str:
        """Get recommendation for dealing with hazard"""
        recommendations = {
            HazardType.CRIME: "Avoid area, use well-lit alternative route",
            HazardType.FIRE: "Stay clear, emergency services responding",
            HazardType.DISASTER: "Follow emergency evacuation routes",
            HazardType.CONGESTION: "Expect delays, consider parallel streets",
            HazardType.CONSTRUCTION: "Use accessible detour, watch for barriers",
            HazardType.POOR_LIGHTING: "Use flashlight, stay on main paths",
            HazardType.ACCESSIBILITY: "Accessibility feature unavailable, find alternative"
        }
        return recommendations.get(hazard.type, "Proceed with caution")

    def _start_background_tasks(self):
        """Start background tasks for safety monitoring and hazard updates"""
        def safety_monitor():
            while True:
                with self.safety_check_lock:
                    self._check_all_pedestrians_safety()
                time.sleep(SAFETY_CHECK_INTERVAL)

        def hazard_updater():
            while True:
                self._update_hazards()
                time.sleep(self.hazard_check_interval)

        # Start threads
        threading.Thread(target=safety_monitor, daemon=True).start()
        threading.Thread(target=hazard_updater, daemon=True).start()

    def add_pedestrian(self, pedestrian: Pedestrian):
        """Add pedestrian to tracking"""
        self.pedestrians[pedestrian.user_id] = pedestrian

    def remove_pedestrian(self, user_id: str):
        """Remove pedestrian from tracking"""
        if user_id in self.pedestrians:
            del self.pedestrians[user_id]

    def add_hazard(self, hazard: Hazard):
        """Add hazard to active list"""
        # Avoid duplicates
        for existing in self.active_hazards:
            if (existing.type == hazard.type and
                abs(existing.position.lat - hazard.position.lat) < 0.0001 and
                abs(existing.position.lng - hazard.position.lng) < 0.0001):
                return
        self.active_hazards.append(hazard)


# Flask app initialization
def create_tracking_app():
    """Create Flask app with WebSocket support"""
    app = Flask(__name__)
    app.config['SECRET_KEY'] = os.environ.get('SESSION_SECRET', 'dev-secret-key')

    CORS(app, resources={r"/*": {"origins": "http://localhost:3000"}}, supports_credentials=True)

    socketio = SocketIO(app, cors_allowed_origins="http://localhost:3000", async_mode='threading')

    # Initialize tracker
    tracker = RealTimeTracker(socketio, app)

    # Add HTTP endpoints
    @app.route('/api/tracking/status', methods=['GET'])
    def tracking_status():
        """Get tracking system status"""
        return json.dumps({
            'active_pedestrians': len(tracker.pedestrians),
            'active_hazards': len(tracker.active_hazards),
            'update_interval': UPDATE_INTERVAL,
            'safety_check_interval': SAFETY_CHECK_INTERVAL,
            'reroute_threshold': REROUTE_THRESHOLD,
            'tomtom_available': bool(tracker.tomtom_api_key),
            'weather_available': bool(tracker.openweather_api_key),
            'google_maps_available': bool(tracker.google_maps_api_key)
        })

    @app.route('/api/tracking/pedestrians', methods=['GET'])
    def get_pedestrians():
        """Get all tracked pedestrians"""
        return json.dumps({
            'pedestrians': {pid: ped.to_dict() for pid, ped in tracker.pedestrians.items()}
        })

    @app.route('/api/tracking/hazards', methods=['GET'])
    def get_hazards():
        """Get all active hazards"""
        return json.dumps({
            'hazards': [tracker._hazard_to_dict(h) for h in tracker.active_hazards]
        })

    @app.route('/api/tracking/route', methods=['POST'])
    def calculate_route():
        """Calculate route between two points"""
        data = request.json

        try:
            start = Position(
                lat=float(data['start_lat']),
                lng=float(data['start_lng'])
            )
            destination = Position(
                lat=float(data['dest_lat']),
                lng=float(data['dest_lng'])
            )
            accessibility_needs = set(data.get('accessibility_needs', []))
            travel_mode = data.get('travel_mode', 'pedestrian')

            route = tracker.generate_route(start, destination, accessibility_needs, travel_mode=travel_mode)

            return json.dumps({
                'success': True,
                'route': [tracker._segment_to_dict(seg) for seg in route],
                'total_distance': sum(seg.distance for seg in route),
                'total_duration': sum(seg.duration for seg in route),
                'average_safety': tracker._weighted_safety_score(route) if route else 0,
                'travel_mode': travel_mode
            })

        except Exception as e:
            return json.dumps({
                'success': False,
                'error': str(e)
            }), 400

    return app, socketio, tracker


# Global instances (only created when this module is run directly)
if __name__ == '__main__':
    logger.info("Starting Real-time Tracking Server with Real APIs...")
    app, socketio, tracker = create_tracking_app()
    socketio.run(app, host='127.0.0.1', port=5001, debug=True)