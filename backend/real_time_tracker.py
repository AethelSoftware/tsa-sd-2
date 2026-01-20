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
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Set
from dataclasses import dataclass, asdict
from enum import Enum
import numpy as np
from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import heapq

# Import safety model
try:
    from ai_safety_model import safety_ai, AdvancedSafetyRoutingAI
except ImportError:
    print("⚠️  AI Safety Model not found, running in simulation mode")
    safety_ai = None

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
    
    @property
    def coordinates(self) -> Tuple[float, float]:
        return (self.lat, self.lng)

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
            'walking_speed': self.walking_speed
        }

class RealTimeTracker:
    """Main tracking engine with WebSocket support"""
    
    def __init__(self, socketio: SocketIO, app: Flask):
        self.socketio = socketio
        self.app = app
        self.pedestrians: Dict[str, Pedestrian] = {}
        self.active_hazards: List[Hazard] = []
        self.route_cache: Dict[str, List[RouteSegment]] = {}
        self.safety_check_lock = threading.Lock()
        self.hazard_check_interval = 30  # Check for new hazards every 30 seconds
        
        # Initialize WebSocket event handlers
        self._setup_socket_handlers()
        
        # Start background tasks
        self._start_background_tasks()
    
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
                
                # Create positions
                start_pos = Position(lat=start_lat, lng=start_lng)
                dest_pos = Position(lat=dest_lat, lng=dest_lng)
                
                # Generate initial route
                route = self.generate_route(start_pos, dest_pos, accessibility_needs)
                
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
                    session_id=request.sid
                )
                
                # Add to tracking
                self.add_pedestrian(pedestrian)
                
                # Join room for private updates
                join_room(user_id)
                
                # Send initial route
                emit('route_updated', {
                    'route': [self._segment_to_dict(seg) for seg in route],
                    'user_id': user_id
                }, room=user_id)
                
                # Start position updates
                asyncio.create_task(self._send_position_updates(user_id))
                
                logger.info(f"Navigation started for {user_id}")
                
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
                        avoid_hazards=True
                    )
                    
                    pedestrian.route = new_route
                    pedestrian.current_segment_index = 0
                    pedestrian.state = PedestrianState.REROUTING
                    
                    emit('route_updated', {
                        'route': [self._segment_to_dict(seg) for seg in new_route],
                        'reason': reason,
                        'user_id': user_id
                    }, room=user_id)
                    
                    logger.info(f"Rerouted {user_id}: {reason}")
                    
            except Exception as e:
                logger.error(f"Error handling reroute: {e}")
    
    def _start_background_tasks(self):
        """Start background safety checking and hazard monitoring"""
        
        def safety_check_loop():
            """Continuous safety checking loop"""
            while True:
                time.sleep(SAFETY_CHECK_INTERVAL)
                try:
                    with self.safety_check_lock:
                        self._check_all_pedestrians_safety()
                except Exception as e:
                    logger.error(f"Safety check error: {e}")
        
        def hazard_monitoring_loop():
            """Monitor for expired hazards and fetch new ones"""
            while True:
                time.sleep(self.hazard_check_interval)
                try:
                    self._update_hazards()
                    self._fetch_external_hazards()
                except Exception as e:
                    logger.error(f"Hazard monitoring error: {e}")
        
        # Start threads
        safety_thread = threading.Thread(target=safety_check_loop, daemon=True)
        hazard_thread = threading.Thread(target=hazard_monitoring_loop, daemon=True)
        
        safety_thread.start()
        hazard_thread.start()
        
        logger.info("Background tasks started")
    
    def add_pedestrian(self, pedestrian: Pedestrian):
        """Add pedestrian to tracking system"""
        self.pedestrians[pedestrian.user_id] = pedestrian
        logger.info(f"Added pedestrian: {pedestrian.user_id}")
    
    def remove_pedestrian(self, user_id: str):
        """Remove pedestrian from tracking"""
        if user_id in self.pedestrians:
            del self.pedestrians[user_id]
            logger.info(f"Removed pedestrian: {user_id}")
    
    def add_hazard(self, hazard: Hazard):
        """Add hazard to system"""
        self.active_hazards.append(hazard)
        
        # Check if any pedestrians need rerouting
        affected = self._get_pedestrians_near_hazard(hazard)
        for user_id in affected:
            self._trigger_reroute_if_needed(user_id, hazard)
    
    def generate_route(self, start: Position, destination: Position, 
                      accessibility_needs: Set[str], avoid_hazards: bool = True) -> List[RouteSegment]:
        """Generate walking route with safety considerations"""
        
        cache_key = f"{start.lat},{start.lng}|{destination.lat},{destination.lng}|{','.join(sorted(accessibility_needs))}"
        
        if cache_key in self.route_cache and not avoid_hazards:
            return self.route_cache[cache_key]
        
        # In production, this would call Google Maps Directions API
        # For now, generate a synthetic route with intermediate points
        
        # Generate intermediate points (simplified path)
        num_segments = 10
        route_segments = []
        
        for i in range(num_segments):
            # Interpolate between start and destination
            t = i / num_segments
            t_next = (i + 1) / num_segments
            
            seg_start = Position(
                lat=start.lat + t * (destination.lat - start.lat),
                lng=start.lng + t * (destination.lng - start.lng)
            )
            
            seg_end = Position(
                lat=start.lat + t_next * (destination.lat - start.lat),
                lng=start.lng + t_next * (destination.lng - destination.lng)
            )
            
            # Calculate safety score for segment
            safety_score = self._calculate_segment_safety(seg_start, seg_end, accessibility_needs)
            
            # Check for hazards
            hazards_in_segment = []
            if avoid_hazards:
                hazards_in_segment = self._get_hazards_in_segment(seg_start, seg_end)
            
            # Generate instructions
            if i == 0:
                instructions = "Start walking"
            elif i == num_segments - 1:
                instructions = "Approaching destination"
            elif i % 3 == 0:
                instructions = "Continue straight"
            else:
                instructions = "Follow path"
            
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
        
        self.route_cache[cache_key] = route_segments
        return route_segments
    
    def _calculate_segment_safety(self, start: Position, end: Position, 
                                 accessibility_needs: Set[str]) -> float:
        """Calculate safety score for a route segment"""
        
        if safety_ai and safety_ai.is_trained:
            try:
                # Use midpoint of segment for safety prediction
                mid_lat = (start.lat + end.lat) / 2
                mid_lng = (start.lng + end.lng) / 2
                
                result = safety_ai.predict_safety_score(mid_lat, mid_lng)
                base_score = result['safety_score']
            except Exception as e:
                logger.error(f"Safety AI prediction failed: {e}")
                base_score = 0.7
        else:
            # Synthetic safety score
            current_hour = datetime.now().hour
            if 6 <= current_hour <= 18:
                base_score = np.random.uniform(0.6, 0.9)
            else:
                base_score = np.random.uniform(0.3, 0.7)
        
        # Adjust for accessibility needs
        accessibility_factor = 1.0
        if 'blind' in accessibility_needs:
            # Blind users need better lighting and consistent paths
            if current_hour < 6 or current_hour > 18:
                accessibility_factor *= 0.8
        if 'wheelchair' in accessibility_needs:
            # Wheelchair users need smooth surfaces
            accessibility_factor *= 0.9
        
        # Adjust for nearby hazards
        hazard_factor = 1.0
        segment_hazards = self._get_hazards_in_segment(start, end)
        for hazard in segment_hazards:
            hazard_factor *= (1 - hazard.severity * 0.3)
        
        final_score = base_score * accessibility_factor * hazard_factor
        return max(0.0, min(1.0, final_score))
    
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
    
    def _check_all_pedestrians_safety(self):
        """Check safety for all tracked pedestrians"""
        for user_id, pedestrian in self.pedestrians.items():
            try:
                if pedestrian.state not in [PedestrianState.WALKING, PedestrianState.REROUTING]:
                    continue
                
                current_segment = pedestrian.route[pedestrian.current_segment_index]
                
                # Check if safety has dropped
                if current_segment.safety_score < REROUTE_THRESHOLD:
                    logger.info(f"Low safety detected for {user_id}: {current_segment.safety_score}")
                    
                    # Trigger reroute
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
        """Trigger reroute if conditions are met"""
        if user_id not in self.pedestrians:
            return
        
        pedestrian = self.pedestrians[user_id]
        
        # Don't reroute if already rerouting or arrived
        if pedestrian.state in [PedestrianState.REROUTING, PedestrianState.ARRIVED]:
            return
        
        # Generate new route
        new_route = self.generate_route(
            pedestrian.current_position,
            pedestrian.destination,
            pedestrian.accessibility_needs,
            avoid_hazards=True
        )
        
        # Only reroute if new route is significantly safer
        current_safety = pedestrian.route[pedestrian.current_segment_index].safety_score
        new_safety = new_route[0].safety_score if new_route else 0
        
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
            # Audio alert with verbal description
            description = f"Rerouting due to {reason.replace('_', ' ')}"
            if hazard:
                description += f". Hazard: {hazard.description}"
            
            alert_data.update({
                'audio_alert': {
                    'message': description,
                    'type': 'warning',
                    'priority': 'high'
                },
                'haptic_pattern': 'triple_pulse'  # Specific pattern for rerouting
            })
        
        if 'deaf' in needs:
            # Visual alert with flashing
            alert_data.update({
                'visual_alert': {
                    'pattern': 'flash',
                    'color': '#ff9900',
                    'duration': 5000
                },
                'vibration_pattern': 'long_pulse'
            })
        
        # Send alert
        self.socketio.emit('accessibility_alert', alert_data, room=user_id)
    
    def _get_pedestrians_near_hazard(self, hazard: Hazard) -> List[str]:
        """Get pedestrians near a hazard"""
        affected = []
        
        for user_id, pedestrian in self.pedestrians.items():
            distance = self._calculate_distance(
                pedestrian.current_position.coordinates,
                hazard.position.coordinates
            )
            
            if distance < hazard.radius * 2:  # Double radius for warning zone
                affected.append(user_id)
        
        return affected
    
    def _update_hazards(self):
        """Remove expired hazards"""
        current_time = time.time()
        self.active_hazards = [
            h for h in self.active_hazards 
            if h.is_active(current_time)
        ]
    
    def _fetch_external_hazards(self):
        """Fetch hazards from external APIs"""
        try:
            # This would integrate with real APIs
            # For now, simulate occasional hazard reports
            
            if np.random.random() < 0.1:  # 10% chance of new hazard
                hazard_types = list(HazardType)
                hazard_type = np.random.choice(hazard_types)
                
                # Generate random position near tracked pedestrians
                if self.pedestrians:
                    random_user = np.random.choice(list(self.pedestrians.keys()))
                    pedestrian = self.pedestrians[random_user]
                    
                    # Offset from pedestrian position
                    offset_lat = np.random.uniform(-0.001, 0.001)
                    offset_lng = np.random.uniform(-0.001, 0.001)
                    
                    hazard = Hazard(
                        type=hazard_type,
                        position=Position(
                            lat=pedestrian.current_position.lat + offset_lat,
                            lng=pedestrian.current_position.lng + offset_lng
                        ),
                        radius=np.random.uniform(50, 200),
                        severity=np.random.uniform(0.3, 0.9),
                        description=f"Simulated {hazard_type.value} hazard"
                    )
                    
                    self.add_hazard(hazard)
                    
        except Exception as e:
            logger.error(f"Error fetching external hazards: {e}")
    
    async def _send_position_updates(self, user_id: str):
        """Send regular position updates to client"""
        while user_id in self.pedestrians:
            try:
                pedestrian = self.pedestrians[user_id]
                
                if pedestrian.state == PedestrianState.WALKING:
                    # Simulate movement along route
                    self._update_pedestrian_position(pedestrian)
                
                # Send update
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
        
        # Calculate progress along segment
        total_seg_distance = current_segment.distance
        distance_moved = pedestrian.walking_speed * UPDATE_INTERVAL
        
        # Update position along segment
        progress = min(1.0, distance_moved / total_seg_distance)
        
        new_lat = current_segment.start.lat + progress * (current_segment.end.lat - current_segment.start.lat)
        new_lng = current_segment.start.lng + progress * (current_segment.end.lng - current_segment.start.lng)
        
        pedestrian.current_position = Position(
            lat=new_lat,
            lng=new_lng,
            accuracy=5.0
        )
        
        # Move to next segment if completed
        if progress >= 1.0:
            pedestrian.current_segment_index += 1
            
            # Check if route completed
            if pedestrian.current_segment_index >= len(pedestrian.route):
                pedestrian.state = PedestrianState.ARRIVED
    
    @staticmethod
    def _calculate_distance(coord1: Tuple[float, float], coord2: Tuple[float, float]) -> float:
        """Calculate distance between two coordinates in meters using Haversine"""
        from math import radians, sin, cos, sqrt, atan2
        
        lat1, lon1 = coord1
        lat2, lon2 = coord2
        
        R = 6371000  # Earth radius in meters
        
        lat1_rad = radians(lat1)
        lat2_rad = radians(lat2)
        delta_lat = radians(lat2 - lat1)
        delta_lon = radians(lon2 - lon1)
        
        a = sin(delta_lat/2)**2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon/2)**2
        c = 2 * atan2(sqrt(a), sqrt(1-a))
        
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
        return jsonify({
            'active_pedestrians': len(tracker.pedestrians),
            'active_hazards': len(tracker.active_hazards),
            'update_interval': UPDATE_INTERVAL,
            'safety_check_interval': SAFETY_CHECK_INTERVAL,
            'reroute_threshold': REROUTE_THRESHOLD
        })
    
    @app.route('/api/tracking/pedestrians', methods=['GET'])
    def get_pedestrians():
        """Get all tracked pedestrians"""
        return jsonify({
            'pedestrians': {pid: ped.to_dict() for pid, ped in tracker.pedestrians.items()}
        })
    
    @app.route('/api/tracking/hazards', methods=['GET'])
    def get_hazards():
        """Get all active hazards"""
        return jsonify({
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
            
            route = tracker.generate_route(start, destination, accessibility_needs)
            
            return jsonify({
                'success': True,
                'route': [tracker._segment_to_dict(seg) for seg in route],
                'total_distance': sum(seg.distance for seg in route),
                'total_duration': sum(seg.duration for seg in route),
                'average_safety': np.mean([seg.safety_score for seg in route]) if route else 0
            })
            
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 400
    
    return app, socketio, tracker

# Global instances
app, socketio, tracker = create_tracking_app()

if __name__ == '__main__':
    logger.info("Starting Real-time Tracking Server...")
    socketio.run(app, host='127.0.0.1', port=5001, debug=True)