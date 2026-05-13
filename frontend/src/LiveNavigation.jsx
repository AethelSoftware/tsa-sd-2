import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  Navigation, 
  AlertTriangle, 
  Volume2, 
  Vibrate,
  Eye,
  Map,
  Compass,
  Shield,
  Zap,
  Bell,
  Radio,
  RefreshCw,
  User,
  Building
} from 'lucide-react';
import Walking3DView from './Walking3DView';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const TOMTOM_API_KEY = 'pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM';

const pedestrianIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const hazardIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const destinationIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const useAudioEngine = () => {
  const audioContextRef = useRef(null);
  
  const initAudio = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
  }, []);
  
  const playDirectionAudio = useCallback((direction, distance) => {
    initAudio();
    const directions = {
      'left': 'Turn left in',
      'right': 'Turn right in',
      'straight': 'Continue straight for',
      'arriving': 'Arriving at destination',
      'rerouting': 'Rerouting due to safety concern'
    };
    const message = `${directions[direction] || 'Continue'} ${distance ? `${Math.round(distance)} meters` : ''}`;
    speak(message, 'direction');
  }, [initAudio]);
  
  const playHazardAudio = useCallback((hazardType, distance) => {
    const hazards = {
      'crime': 'Crime reported ahead',
      'fire': 'Fire hazard nearby',
      'disaster': 'Emergency situation',
      'congestion': 'Heavy pedestrian traffic',
      'construction': 'Construction zone ahead',
      'poor_lighting': 'Poor lighting area',
      'accessibility': 'Accessibility issue detected'
    };
    const message = `${hazards[hazardType] || 'Hazard detected'} ${distance ? `, ${Math.round(distance)} meters ahead` : ' ahead'}`;
    speak(message, 'hazard', true);
  }, []);
  
  const speak = useCallback((text, type = 'info', urgent = false) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = urgent ? 1.0 : 0.8;
      
      if (urgent) {
        utterance.onstart = () => {
          document.documentElement.style.setProperty('--alert-pulse', 'pulse 0.5s infinite');
        };
        utterance.onend = () => {
          document.documentElement.style.setProperty('--alert-pulse', 'none');
        };
      }
      
      speechSynthesis.speak(utterance);
    }
  }, []);
  
  const playHaptic = useCallback((pattern) => {
    if ('vibrate' in navigator) {
      const patterns = {
        'left_turn': [100, 50, 100],
        'right_turn': [100, 50, 100, 50, 100],
        'hazard': [200, 100, 200, 100, 200],
        'reroute': [300, 100, 300],
        'arrival': [100, 100, 100, 100, 100]
      };
      navigator.vibrate(patterns[pattern] || [100]);
    }
  }, []);
  
  const playBeep = useCallback((frequency = 440, duration = 200) => {
    initAudio();
    const oscillator = audioContextRef.current.createOscillator();
    const gainNode = audioContextRef.current.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.3, audioContextRef.current.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + duration / 1000);
    oscillator.start();
    oscillator.stop(audioContextRef.current.currentTime + duration / 1000);
  }, [initAudio]);
  
  return {
    playDirectionAudio,
    playHazardAudio,
    speak,
    playHaptic,
    playBeep
  };
};

function ChangeView({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

const LiveNavigation = () => {
  const [route, setRoute] = useState([
    [40.4406, -79.9959],
    [40.4408, -79.9965],
    [40.4412, -79.9972],
    [40.4416, -80.0099],
  ]);
  const [userPosition, setUserPosition] = useState([40.4406, -79.9959]);
  const [destination, setDestination] = useState([40.4416, -80.0099]);
  const [hazards, setHazards] = useState([]);
  const [pedestrians, setPedestrians] = useState([]);
  const [navigationState, setNavigationState] = useState('idle');
  const [accessibilitySettings, setAccessibilitySettings] = useState({
    audioGuidance: true,
    hapticFeedback: true,
    visualAlerts: true,
    highContrast: false,
    largeText: false,
    screenReader: true,
    reducedMotion: false
  });
  const [activeHazards, setActiveHazards] = useState([]);
  const [socket, setSocket] = useState(null);
  const [userId, setUserId] = useState(`user_${Date.now()}`);
  const [routeSafety, setRouteSafety] = useState(0.8);
  const [remainingDistance, setRemainingDistance] = useState(0);
  const [estimatedTime, setEstimatedTime] = useState(0);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [mapType, setMapType] = useState('openstreetmap');
  
  const audioEngine = useAudioEngine();
  const mapRef = useRef();
  const socketRef = useRef();
  
  const mapTypes = {
    openstreetmap: {
      name: 'OpenStreetMap',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors'
    },
    tomtom: {
      name: 'TomTom',
      url: `https://{s}.api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}`,
      attribution: '© TomTom'
    },
    tomtomSatellite: {
      name: 'TomTom Satellite',
      url: `https://{s}.api.tomtom.com/map/1/tile/sat/main/{z}/{x}/{y}.jpg?key=${TOMTOM_API_KEY}`,
      attribution: '© TomTom'
    }
  };
  
  useEffect(() => {
    if (route.length < 2) return;
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % route.length;
      setUserPosition(route[idx]);
      setNavigationState('walking');
      setRemainingDistance((route.length - idx) * 80);
      setEstimatedTime((route.length - idx) * 60);
    }, 2000);
    return () => clearInterval(interval);
  }, [route]);
  
  useEffect(() => {
    const newSocket = io('http://localhost:5001');
    socketRef.current = newSocket;
    setSocket(newSocket);
    
    newSocket.on('connect', () => {
      console.log('Connected to tracking server');
      
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const pos = [position.coords.latitude, position.coords.longitude];
            setUserPosition(pos);
            
            newSocket.emit('start_navigation', {
              user_id: userId,
              start_lat: pos[0],
              start_lng: pos[1],
              dest_lat: destination[0],
              dest_lng: destination[1],
              accessibility_needs: ['blind', 'deaf'],
              walking_speed: 1.4
            });
          },
          (error) => {
            console.error('Geolocation error:', error);
            audioEngine.speak('Unable to get current location. Using default location.');
          }
        );
      }
    });
    
    newSocket.on('position_update', (data) => {
      if (data.user_id === userId) {
        setUserPosition([data.position.lat, data.position.lng]);
        setNavigationState(data.state);
        setRemainingDistance(data.remaining_distance || 0);
        setEstimatedTime(data.estimated_arrival || 0);
        
        if (accessibilitySettings.audioGuidance && data.state === 'walking') {
          audioEngine.playDirectionAudio('straight', data.remaining_distance);
        }
      }
      
      setPedestrians(prev => {
        const others = prev.filter(p => p.id !== data.user_id);
        return [...others, {
          id: data.user_id,
          position: [data.position.lat, data.position.lng],
          state: data.state,
          isUser: data.user_id === userId
        }];
      });
    });
    
    newSocket.on('hazard_alert', (data) => {
      setActiveHazards(prev => [...prev, data.hazard]);
      
      if (accessibilitySettings.audioGuidance) {
        audioEngine.playHazardAudio(data.hazard.type, 50);
      }
      
      if (accessibilitySettings.hapticFeedback) {
        audioEngine.playHaptic('hazard');
      }
      
      if (accessibilitySettings.visualAlerts) {
        document.documentElement.style.setProperty('--hazard-alert', 'flash 1s 3');
      }
    });
    
    newSocket.on('reroute_triggered', (data) => {
      if (data.user_id === userId) {
        setNavigationState('rerouting');
        audioEngine.speak(`Rerouting due to ${data.reason.replace('_', ' ')}`);
        audioEngine.playHaptic('reroute');
        
        if (data.new_route) {
          const newRouteCoords = data.new_route.map(segment => [
            segment.start.lat,
            segment.start.lng
          ]);
          setRoute(newRouteCoords);
        }
      }
    });
    
    newSocket.on('arrived', (data) => {
      if (data.user_id === userId) {
        setNavigationState('arrived');
        audioEngine.speak('You have arrived at your destination');
        audioEngine.playHaptic('arrival');
        audioEngine.playBeep(523, 500);
      }
    });
    
    newSocket.on('accessibility_alert', (data) => {
      if (data.user_id === userId) {
        if (data.audio_alert && accessibilitySettings.audioGuidance) {
          audioEngine.speak(data.audio_alert.message, 'alert', true);
        }
        
        if (data.visual_alert && accessibilitySettings.visualAlerts) {
          const alertDiv = document.createElement('div');
          alertDiv.className = 'fixed inset-0 z-50 flex items-center justify-center';
          alertDiv.innerHTML = `
            <div class="bg-orange-500 text-white p-6 rounded-xl shadow-2xl animate-pulse">
              <div class="text-2xl font-bold">⚠️ ${data.reason.replace('_', ' ')}</div>
              <div class="mt-2">${data.hazard?.description || 'Safety concern detected'}</div>
            </div>
          `;
          document.body.appendChild(alertDiv);
          
          setTimeout(() => {
            document.body.removeChild(alertDiv);
          }, 5000);
        }
      }
    });
    
    return () => {
      newSocket.disconnect();
    };
  }, [userId, destination, audioEngine, accessibilitySettings]);
  
  useEffect(() => {
    if (navigationState === 'walking' && socket) {
      const interval = setInterval(() => {
        if (route.length > 0) {
          const currentIndex = route.findIndex(coord => 
            Math.abs(coord[0] - userPosition[0]) < 0.0001 &&
            Math.abs(coord[1] - userPosition[1]) < 0.0001
          );
          
          if (currentIndex < route.length - 1) {
            const nextCoord = route[currentIndex + 1];
            setUserPosition(nextCoord);
            
            socket.emit('update_position', {
              user_id: userId,
              lat: nextCoord[0],
              lng: nextCoord[1],
              accuracy: 5.0
            });
          }
        }
      }, 3000);
      
      return () => clearInterval(interval);
    }
  }, [navigationState, socket, userId, userPosition, route]);
  
  useEffect(() => {
    const calculateSafety = async () => {
      try {
        const response = await fetch('http://localhost:5000/api/model/route', {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            route: route.map(coord => ({ lat: coord[0], lng: coord[1] }))
          })
        });
        
        const data = await response.json();
        if (data.success) {
          setRouteSafety(data.analysis.overall_safety);
        }
      } catch (error) {
        console.error('Error calculating route safety:', error);
      }
    };
    
    if (route.length > 1) {
      calculateSafety();
    }
  }, [route]);
  
  const triggerEmergency = useCallback(() => {
    setEmergencyMode(true);
    audioEngine.speak('Emergency mode activated. Notifying emergency contacts.', 'emergency', true);
    
    if (accessibilitySettings.visualAlerts) {
      const flashInterval = setInterval(() => {
        document.body.style.backgroundColor = 
          document.body.style.backgroundColor === 'red' ? '' : 'red';
      }, 500);
      
      setTimeout(() => {
        clearInterval(flashInterval);
        document.body.style.backgroundColor = '';
      }, 5000);
    }
    
    if (socket) {
      socket.emit('emergency_alert', {
        user_id: userId,
        position: { lat: userPosition[0], lng: userPosition[1] },
        timestamp: Date.now()
      });
    }
  }, [socket, userId, userPosition, audioEngine, accessibilitySettings.visualAlerts]);
  
  const toggleAccessibilitySetting = useCallback((setting) => {
    setAccessibilitySettings(prev => ({
      ...prev,
      [setting]: !prev[setting]
    }));
    
    audioEngine.speak(`${setting.replace(/([A-Z])/g, ' $1').toLowerCase()} ${!accessibilitySettings[setting] ? 'enabled' : 'disabled'}`);
  }, [accessibilitySettings, audioEngine]);
  
  const reportHazard = useCallback((type, position) => {
    if (socket) {
      socket.emit('report_hazard', {
        type,
        lat: position[0],
        lng: position[1],
        radius: 100,
        severity: 0.7,
        description: `User-reported ${type} hazard`
      });
      
      audioEngine.speak(`Thank you for reporting the ${type} hazard`);
    }
  }, [socket, audioEngine]);
  
  const requestReroute = useCallback((reason) => {
    if (socket) {
      socket.emit('request_reroute', {
        user_id: userId,
        reason
      });
    }
  }, [socket, userId]);
  
  return (
    <div className={`min-h-screen ${accessibilitySettings.highContrast ? 'bg-black text-yellow-300' : 'bg-gradient-to-br from-slate-900 to-gray-900 text-slate-100'}`}>
      <div className="fixed inset-0 pointer-events-none z-50">
        {accessibilitySettings.visualAlerts && emergencyMode && (
          <div className="absolute inset-0 bg-red-500 opacity-20 animate-pulse"></div>
        )}
      </div>
      
      <div className="container mx-auto p-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 p-4 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10">
          <div className="flex items-center space-x-4">
            <div className="p-2 bg-blue-500/20 rounded-xl">
              <Navigation className="h-8 w-8 text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Tryver Live Navigation</h1>
              <p className="text-slate-400">Real-time pedestrian safety routing</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3 mt-4 md:mt-0">
            <div className={`px-3 py-1 rounded-full ${navigationState === 'walking' ? 'bg-green-500/20 text-green-400' : navigationState === 'rerouting' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>
              <span className="font-medium capitalize">{navigationState}</span>
            </div>
            <button
              onClick={() => triggerEmergency()}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold flex items-center space-x-2 transition-colors"
            >
              <AlertTriangle className="h-4 w-4" />
              <span>SOS</span>
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                <User className="h-5 w-5 mr-2" />
                Your Journey
              </h2>
              
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-slate-400">Remaining Distance</span>
                  <span className="font-bold">{Math.round(remainingDistance)} meters</span>
                </div>
                
                <div className="flex justify-between">
                  <span className="text-slate-400">Estimated Time</span>
                  <span className="font-bold">{Math.round(estimatedTime / 60)} minutes</span>
                </div>
                
                <div className="flex justify-between">
                  <span className="text-slate-400">Route Safety</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${routeSafety > 0.7 ? 'bg-green-500' : routeSafety > 0.4 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${routeSafety * 100}%` }}
                      ></div>
                    </div>
                    <span className="font-bold">{Math.round(routeSafety * 100)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between">
                  <span className="text-slate-400">Active Hazards</span>
                  <span className="font-bold text-red-400">{activeHazards.length}</span>
                </div>
              </div>
            </div>
            
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                <Eye className="h-5 w-5 mr-2" />
                Accessibility Settings
              </h2>
              
              <div className="space-y-3">
                {[
                  { key: 'audioGuidance', icon: Volume2, label: 'Audio Guidance' },
                  { key: 'hapticFeedback', icon: Vibrate, label: 'Haptic Feedback' },
                  { key: 'visualAlerts', icon: Bell, label: 'Visual Alerts' },
                  { key: 'highContrast', icon: Zap, label: 'High Contrast' },
                  { key: 'largeText', icon: User, label: 'Large Text' },
                  { key: 'screenReader', icon: Radio, label: 'Screen Reader' }
                ].map((setting) => (
                  <label
                    key={setting.key}
                    className="flex items-center justify-between cursor-pointer p-3 hover:bg-white/5 rounded-xl transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <setting.icon className="h-5 w-5 text-slate-400" />
                      <span className={accessibilitySettings.largeText ? 'text-lg' : ''}>
                        {setting.label}
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={accessibilitySettings[setting.key]}
                      onChange={() => toggleAccessibilitySetting(setting.key)}
                      className="rounded-lg w-5 h-5 text-blue-500 focus:ring-blue-500 focus:ring-2"
                    />
                  </label>
                ))}
              </div>
            </div>
            
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                <Zap className="h-5 w-5 mr-2" />
                Quick Actions
              </h2>
              
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => requestReroute('safer_route')}
                  className="p-3 bg-blue-500/20 hover:bg-blue-500/30 rounded-xl border border-blue-500/30 flex flex-col items-center justify-center space-y-2 transition-colors"
                >
                  <RefreshCw className="h-5 w-5 text-blue-400" />
                  <span className="text-sm font-medium">Safer Route</span>
                </button>
                
                <button
                  onClick={() => reportHazard('construction', userPosition)}
                  className="p-3 bg-yellow-500/20 hover:bg-yellow-500/30 rounded-xl border border-yellow-500/30 flex flex-col items-center justify-center space-y-2 transition-colors"
                >
                  <AlertTriangle className="h-5 w-5 text-yellow-400" />
                  <span className="text-sm font-medium">Report Hazard</span>
                </button>
                
                <button
                  onClick={() => audioEngine.speak('Testing audio guidance system')}
                  className="p-3 bg-green-500/20 hover:bg-green-500/30 rounded-xl border border-green-500/30 flex flex-col items-center justify-center space-y-2 transition-colors"
                >
                  <Volume2 className="h-5 w-5 text-green-400" />
                  <span className="text-sm font-medium">Test Audio</span>
                </button>
                
                <button
                  onClick={() => audioEngine.playHaptic('left_turn')}
                  className="p-3 bg-purple-500/20 hover:bg-purple-500/30 rounded-xl border border-purple-500/30 flex flex-col items-center justify-center space-y-2 transition-colors"
                >
                  <Vibrate className="h-5 w-5 text-purple-400" />
                  <span className="text-sm font-medium">Test Haptic</span>
                </button>
              </div>
            </div>
          </div>
          
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-black rounded-2xl overflow-hidden border border-white/10"
                 style={{ height: '400px', position: 'relative' }}>
              <Walking3DView
                route={route}
                hazards={activeHazards}
                userPosition={userPosition}
                navigationState={navigationState}
                routeSafety={routeSafety}
                remainingDistance={remainingDistance}
                estimatedTime={estimatedTime}
                style={{ width: '100%', height: '100%' }}
              />
              
              <div className="absolute top-4 right-4 flex space-x-2">
                <button 
                  onClick={() => setMapType('openstreetmap')}
                  className={`p-2 ${mapType === 'openstreetmap' ? 'bg-blue-500/50' : 'bg-black/50'} backdrop-blur-sm rounded-lg hover:bg-black/70 transition-colors`}
                >
                  <Map className="h-5 w-5" />
                </button>
                <button 
                  onClick={() => setMapType('tomtom')}
                  className={`p-2 ${mapType === 'tomtom' ? 'bg-blue-500/50' : 'bg-black/50'} backdrop-blur-sm rounded-lg hover:bg-black/70 transition-colors`}
                >
                  <Compass className="h-5 w-5" />
                </button>
                <button 
                  onClick={() => setMapType('tomtomSatellite')}
                  className={`p-2 ${mapType === 'tomtomSatellite' ? 'bg-blue-500/50' : 'bg-black/50'} backdrop-blur-sm rounded-lg hover:bg-black/70 transition-colors`}
                >
                  <Building className="h-5 w-5" />
                </button>
              </div>
            </div>
            
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4" style={{ height: '400px' }}>
              <MapContainer
                center={userPosition}
                zoom={17}
                style={{ height: '100%', width: '100%', borderRadius: '12px' }}
                ref={mapRef}
              >
                <ChangeView center={userPosition} zoom={17} />
                <TileLayer
                  attribution={mapTypes[mapType].attribution}
                  url={mapTypes[mapType].url}
                />
                
                {route.length > 0 && (
                  <Polyline
                    positions={route}
                    color={routeSafety > 0.7 ? '#10b981' : routeSafety > 0.4 ? '#f59e0b' : '#ef4444'}
                    weight={4}
                    opacity={0.8}
                  />
                )}
                
                <Marker position={userPosition} icon={pedestrianIcon}>
                  <Popup>
                    <div className="p-2">
                      <div className="font-bold">You are here</div>
                      <div className="text-sm text-slate-600">
                        Safety: {Math.round(routeSafety * 100)}%
                      </div>
                    </div>
                  </Popup>
                </Marker>
                
                <Marker position={destination} icon={destinationIcon}>
                  <Popup>
                    <div className="p-2">
                      <div className="font-bold">Destination</div>
                      <div className="text-sm text-slate-600">
                        {Math.round(remainingDistance)} meters remaining
                      </div>
                    </div>
                  </Popup>
                </Marker>
                
                {activeHazards.map((hazard, index) => (
                  <Marker
                    key={index}
                    position={[hazard.position.lat, hazard.position.lng]}
                    icon={hazardIcon}
                  >
                    <Popup>
                      <div className="p-2">
                        <div className="font-bold text-red-600 capitalize">
                          {hazard.type.replace('_', ' ')} Hazard
                        </div>
                        <div className="text-sm text-slate-600">
                          Severity: {Math.round(hazard.severity * 100)}%
                        </div>
                        <div className="text-sm mt-1">{hazard.description}</div>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </div>
        </div>
        
        {activeHazards.length > 0 && (
          <div className="mt-6 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 text-red-400" />
              Active Hazards Near You
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {activeHazards.slice(0, 3).map((hazard, index) => (
                <div
                  key={index}
                  className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                      <span className="font-semibold capitalize">
                        {hazard.type.replace('_', ' ')}
                      </span>
                    </div>
                    <span className="text-sm text-red-400">
                      {Math.round(hazard.severity * 100)}% severity
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 mb-3">{hazard.description}</p>
                  <button
                    onClick={() => requestReroute(`avoid_${hazard.type}`)}
                    className="text-sm text-red-400 hover:text-red-300 font-medium"
                  >
                    Avoid this area →
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="fixed bottom-4 right-4 z-50 space-y-3">
          {accessibilitySettings.audioGuidance && navigationState === 'walking' && (
            <div className="bg-blue-500/20 backdrop-blur-sm border border-blue-500/30 rounded-xl p-3 animate-pulse">
              <div className="flex items-center space-x-2">
                <Volume2 className="h-4 w-4 text-blue-400" />
                <span className="text-sm font-medium">Audio guidance active</span>
              </div>
            </div>
          )}
          
          {emergencyMode && (
            <div className="bg-red-500/20 backdrop-blur-sm border border-red-500/30 rounded-xl p-3 animate-pulse">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                <span className="text-sm font-medium">EMERGENCY MODE ACTIVE</span>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <style jsx global>{`
        :root {
          --alert-pulse: none;
          --hazard-alert: none;
        }
        
        body {
          font-size: ${accessibilitySettings.largeText ? '1.125rem' : '1rem'};
          line-height: ${accessibilitySettings.largeText ? '1.75' : '1.5'};
        }
        
        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        @keyframes flash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
};

export default LiveNavigation;