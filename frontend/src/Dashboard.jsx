import { useState, useRef, useEffect } from 'react';

export default function AccessibleMap() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [mapStyle, setMapStyle] = useState('roadmap');
  const [routeFrom, setRouteFrom] = useState('Current Location');
  const [routeTo, setRouteTo] = useState('');
  const [accessibilitySettings, setAccessibilitySettings] = useState({
    visionImpaired: false,
    hearingImpaired: false,
    lowEnergy: false,
    highContrast: false,
    largeText: false,
    screenReader: false,
    reducedMotion: false
  });
  const [zoom, setZoom] = useState(13);
  const [currentLocation, setCurrentLocation] = useState({ lat: 40.472, lng: -79.94 });
  const [activeTransport, setActiveTransport] = useState('wheelchair');
  const [announcement, setAnnouncement] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const modalRef = useRef(null);
  const mapContainerRef = useRef(null);
  const settingsButtonRef = useRef(null);
  const announcementRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (announcementRef.current && announcement) {
      announcementRef.current.textContent = announcement;
      const timer = setTimeout(() => setAnnouncement(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [announcement]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setIsSettingsOpen(false);
      }
      if (isSearchOpen && searchInputRef.current && !searchInputRef.current.contains(event.target)) {
        setIsSearchOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isSettingsOpen, isSearchOpen]);

  useEffect(() => {
    const mapContainer = mapContainerRef.current;
    if (!mapContainer) return;

    const handleWheel = (e) => {
      if (accessibilitySettings.visionImpaired || accessibilitySettings.reducedMotion) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      setZoom(prev => Math.min(Math.max(10, prev + delta), 18));
    };

    mapContainer.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      mapContainer.removeEventListener('wheel', handleWheel);
    };
  }, [accessibilitySettings.visionImpaired, accessibilitySettings.reducedMotion]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (isSettingsOpen) {
          setIsSettingsOpen(false);
          settingsButtonRef.current?.focus();
          setAnnouncement('Settings dialog closed');
        }
        if (isSearchOpen) {
          setIsSearchOpen(false);
        }
      }
      
      if (isSettingsOpen && e.key === 'Tab') {
        const focusableElements = modalRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements && focusableElements.length > 0) {
          const firstElement = focusableElements[0];
          const lastElement = focusableElements[focusableElements.length - 1];

          if (e.shiftKey) {
            if (document.activeElement === firstElement) {
              lastElement.focus();
              e.preventDefault();
            }
          } else {
            if (document.activeElement === lastElement) {
              firstElement.focus();
              e.preventDefault();
            }
          }
        }
      }

      if (e.altKey) {
        switch(e.key) {
          case '1':
            e.preventDefault();
            setIsSidebarOpen(prev => !prev);
            setAnnouncement('Route planner sidebar toggled');
            break;
          case '2':
            e.preventDefault();
            setIsSettingsOpen(true);
            setAnnouncement('Accessibility settings opened');
            break;
          case '3':
            e.preventDefault();
            setIsSearchOpen(true);
            searchInputRef.current?.focus();
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, isSearchOpen]);

  const handleAccessibilityChange = (setting) => {
    const newValue = !accessibilitySettings[setting];
    setAccessibilitySettings(prev => ({
      ...prev,
      [setting]: newValue
    }));
    setAnnouncement(`${setting.replace(/([A-Z])/g, ' $1').toLowerCase()} ${newValue ? 'enabled' : 'disabled'}`);
  };

  const calculateRoute = () => {
    if (routeTo) {
      const activeFeatures = Object.keys(accessibilitySettings)
        .filter(key => accessibilitySettings[key])
        .map(key => key.replace(/([A-Z])/g, ' $1').toLowerCase())
        .join(', ');
      
      setAnnouncement(`Calculating accessible ${activeTransport} route from ${routeFrom} to ${routeTo}. Accessibility features: ${activeFeatures || 'none'}`);
      
      setTimeout(() => {
        setAnnouncement(`Route calculated successfully. ${activeTransport === 'wheelchair' ? 'Wheelchair accessible route found with elevator access and ramp availability.' : 'Standard route calculated.'}`);
      }, 1500);
    }
  };

  const handleZoomIn = () => {
    setZoom(prev => {
      const newZoom = Math.min(prev + 1, 18);
      setAnnouncement(`Zoom level ${newZoom}`);
      return newZoom;
    });
  };

  const handleZoomOut = () => {
    setZoom(prev => {
      const newZoom = Math.max(prev - 1, 10);
      setAnnouncement(`Zoom level ${newZoom}`);
      return newZoom;
    });
  };

  const getLocation = () => {
    if (navigator.geolocation) {
      setAnnouncement('Getting your current location');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
          setRouteFrom('Current Location');
          setAnnouncement('Current location updated successfully');
        },
        (error) => {
          setAnnouncement('Unable to get current location. Using default location.');
        }
      );
    }
  };

  const handleTransportChange = (mode) => {
    setActiveTransport(mode);
    const modeNames = {
      walk: 'walking',
      transit: 'public transit',
      wheelchair: 'wheelchair accessible'
    };
    setAnnouncement(`Transportation mode set to ${modeNames[mode]}`);
  };

  return (
    <div
      className={`relative w-full h-screen ${
        accessibilitySettings.highContrast ? 'bg-black text-yellow-300' : 'bg-slate-900 text-slate-100'
      } overflow-hidden font-sans antialiased`}
      role="application" 
      aria-label="Accessible Map Application"
      style={{ 
        fontSize: accessibilitySettings.largeText ? '1.125rem' : '1rem',
        lineHeight: accessibilitySettings.largeText ? '1.75' : '1.5'
      }}
    >

      <div 
        ref={announcementRef}
        aria-live="assertive" 
        aria-atomic="true" 
        className="sr-only"
        role="status"
      >
        {announcement}
      </div>

      <div className="sr-only" aria-label="Keyboard shortcuts">
        Press Alt + 1 to toggle sidebar, Alt + 2 for settings, Alt + 3 for search
      </div>

      <header className={`absolute top-0 left-0 right-0 z-50 ${
        accessibilitySettings.highContrast ? 'bg-gray-900 border-yellow-300' : 'bg-slate-800 border-slate-600'
      } border-b p-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className={`${
              accessibilitySettings.largeText ? 'text-3xl' : 'text-2xl'
            } font-bold`}>
              Try<span className="text-blue-400">ver</span>
            </h1>
            <div className="hidden md:flex items-center space-x-2 text-sm">
              <span className={`px-2 py-1 rounded-full ${
                accessibilitySettings.highContrast ? 'bg-yellow-500 text-black' : 'bg-blue-600 text-white'
              } text-xs`}>
                ♿ Fully Accessible
              </span>
              <span className={accessibilitySettings.highContrast ? 'text-yellow-300' : 'text-slate-400'}>Built for everyone</span>
            </div>
          </div>
        </div>
            </header>
                
            <div className="flex items-center space-x-3 p-4">
              <button
                ref={settingsButtonRef}
                onClick={() => {
                  setIsSearchOpen(true);
                  setTimeout(() => searchInputRef.current?.focus(), 100);
                }}
                aria-label="Open search"
                className={`p-2 rounded-lg ${
                  accessibilitySettings.highContrast ? 'bg-gray-900 hover:bg-gray-800' : 'bg-slate-800 hover:bg-slate-700'
                } ${
                  accessibilitySettings.reducedMotion ? '' : 'transition-all duration-300'
                }`}
              >
                🔍
              </button>
      
              <div className={`relative ${isSearchOpen ? 'block' : 'hidden'} w-full md:w-1/3`}>
                <label htmlFor="search" className="sr-only">Search</label>
                <input
                  id="search"
                  ref={searchInputRef}
                  type="text"
                  value={routeTo}
                  onChange={(e) => setRouteTo(e.target.value)}
                  placeholder="Enter destination"
                  className={`w-full p-2 rounded-md ${
                    accessibilitySettings.highContrast ? 'bg-black text-yellow-300 border-yellow-300' : 'bg-slate-700 text-slate-100 border-slate-600'
                  }`}
                  aria-label="Search destination"
                />
              </div>
      
              <div className="ml-auto flex items-center space-x-2">
                <button
                  onClick={handleZoomOut}
                  aria-label="Zoom out"
                  className="p-2 rounded bg-slate-800 hover:bg-slate-700"
                >−</button>
                <div aria-hidden className="px-2">{zoom}</div>
                <button
                  onClick={handleZoomIn}
                  aria-label="Zoom in"
                  className="p-2 rounded bg-slate-800 hover:bg-slate-700"
                >+</button>
              </div>
            </div>
      
            <main className="flex h-[calc(100vh-72px)] pt-4">
              {isSidebarOpen && (
                <aside className="w-80 p-4 border-r border-slate-700 bg-slate-800" aria-label="Route planner sidebar">
                  <h2 className="font-semibold mb-2">Route Planner</h2>
      
                  <div className="mb-2">
                    <label className="block text-sm">From</label>
                    <input
                      type="text"
                      value={routeFrom}
                      onChange={(e) => setRouteFrom(e.target.value)}
                      className="w-full p-2 rounded bg-slate-700"
                      aria-label="Route from"
                    />
                  </div>
      
                  <div className="mb-2">
                    <label className="block text-sm">To</label>
                    <input
                      type="text"
                      value={routeTo}
                      onChange={(e) => setRouteTo(e.target.value)}
                      className="w-full p-2 rounded bg-slate-700"
                      aria-label="Route to"
                    />
                  </div>
      
                  <div className="mb-2">
                    <span className="block text-sm mb-1">Transport</span>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleTransportChange('walk')}
                        className={`p-2 rounded ${activeTransport === 'walk' ? 'bg-blue-600' : 'bg-slate-700'}`}
                      >
                        Walk
                      </button>
                      <button
                        onClick={() => handleTransportChange('transit')}
                        className={`p-2 rounded ${activeTransport === 'transit' ? 'bg-blue-600' : 'bg-slate-700'}`}
                      >
                        Transit
                      </button>
                      <button
                        onClick={() => handleTransportChange('wheelchair')}
                        className={`p-2 rounded ${activeTransport === 'wheelchair' ? 'bg-blue-600' : 'bg-slate-700'}`}
                      >
                        Wheelchair
                      </button>
                    </div>
                  </div>
      
                  <div className="flex space-x-2">
                    <button
                      onClick={calculateRoute}
                      className="p-2 rounded bg-green-600"
                      aria-label="Calculate route"
                    >
                      Calculate
                    </button>
                    <button
                      onClick={getLocation}
                      className="p-2 rounded bg-slate-700"
                      aria-label="Use current location"
                    >
                      Use my location
                    </button>
                  </div>
                </aside>
              )}
      
              <section className="flex-1 relative" aria-label="Map area">
                <div
                  ref={mapContainerRef}
                  className="absolute inset-0 bg-slate-900"
                  role="region"
                  aria-label="Interactive map"
                >
                  {/* Placeholder map area; integrate a real map library here */}
                  <div className="flex h-full items-center justify-center text-slate-400">
                    Map placeholder — zoom {zoom}, center {currentLocation.lat.toFixed(3)}, {currentLocation.lng.toFixed(3)}
                  </div>
                </div>
      
                <div className="absolute top-6 right-6 flex flex-col space-y-2">
                  <button
                    onClick={() => { setIsSidebarOpen(prev => !prev); setAnnouncement('Route planner sidebar toggled'); }}
                    aria-pressed={isSidebarOpen}
                    aria-label="Toggle sidebar"
                    className="p-2 rounded bg-slate-800"
                  >
                    ☰
                  </button>
      
                  <button
                    onClick={() => { setIsSettingsOpen(true); setTimeout(() => modalRef.current?.focus(), 100); }}
                    aria-label="Open accessibility settings"
                    className="p-2 rounded bg-slate-800"
                  >
                    ⚙️
                  </button>
                </div>
              </section>
            </main>
      
            {isSettingsOpen && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Accessibility settings"
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                onClick={(e) => { if (e.target === e.currentTarget) setIsSettingsOpen(false); }}
              >
                <div
                  ref={modalRef}
                  tabIndex={-1}
                  className={`w-full max-w-md p-6 rounded ${accessibilitySettings.highContrast ? 'bg-black text-yellow-300' : 'bg-slate-800 text-slate-100'}`}
                >
                  <h3 className="text-lg font-semibold mb-4">Accessibility Settings</h3>
      
                  <div className="grid gap-2">
                    {Object.keys(accessibilitySettings).map((key) => (
                      <label key={key} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={accessibilitySettings[key]}
                          onChange={() => handleAccessibilityChange(key)}
                          aria-checked={accessibilitySettings[key]}
                        />
                        <span>{key.replace(/([A-Z])/g, ' $1')}</span>
                      </label>
                    ))}
                  </div>
      
                  <div className="mt-4 flex justify-end space-x-2">
                    <button
                      onClick={() => setIsSettingsOpen(false)}
                      className="p-2 rounded bg-slate-700"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
      
          </div>
        );
      }
            
