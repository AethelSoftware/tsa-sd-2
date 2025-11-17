import { useState, useRef, useEffect } from 'react';

export default function MapClone() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [mapStyle, setMapStyle] = useState('roadmap');
  const [routeFrom, setRouteFrom] = useState('Current Location');
  const [routeTo, setRouteTo] = useState('');
  const [disabilitySettings, setDisabilitySettings] = useState({
    blind: false,
    deaf: false,
    lowEnergy: false
  });

  const modalRef = useRef(null);

  // Close modal when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setIsSettingsOpen(false);
      }
    }

    if (isSettingsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSettingsOpen]);

  const handleDisabilityChange = (disability) => {
    setDisabilitySettings(prev => ({
      ...prev,
      [disability]: !prev[disability]
    }));
  };

  const calculateRoute = () => {
    if (routeTo) {
      alert(`Calculating route from ${routeFrom} to ${routeTo}`);
      // Route calculation logic would go here
    }
  };

  // Pittsburgh coordinates
  const pittsburghCoords = { lat: 40.4406, lng: -79.9959 };

  return (
    <div className="relative w-full h-screen bg-gray-100 overflow-hidden" role="application" aria-label="Google Maps Clone">
      {/* Settings Button */}
      <button 
        className="absolute top-4 right-4 z-50 bg-green-500 hover:bg-green-600 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
        onClick={() => setIsSettingsOpen(true)}
        aria-label="Open settings"
        aria-haspopup="dialog"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* Collapsible Sidebar */}
      <div className={`absolute top-0 left-0 z-40 h-full bg-white shadow-xl transition-all duration-300 ${
        isSidebarOpen ? 'w-80' : 'w-0'
      }`}>
        {isSidebarOpen && (
          <div className="p-6 h-full flex flex-col" role="complementary" aria-label="Route planner">
            {/* Sidebar Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-800">Route Planner</h2>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 rounded"
                aria-label="Close sidebar"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Route Inputs */}
            <div className="space-y-4 flex-1">
              <div>
                <label htmlFor="from-input" className="block text-sm font-medium text-gray-700 mb-2">From</label>
                <div className="relative">
                  <input
                    id="from-input"
                    type="text"
                    value={routeFrom}
                    onChange={(e) => setRouteFrom(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 pl-10 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors duration-200"
                    placeholder="Current location"
                    aria-required="true"
                  />
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2" aria-hidden="true">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="to-input" className="block text-sm font-medium text-gray-700 mb-2">To</label>
                <div className="relative">
                  <input
                    id="to-input"
                    type="text"
                    value={routeTo}
                    onChange={(e) => setRouteTo(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 pl-10 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors duration-200"
                    placeholder="Enter destination"
                    aria-required="true"
                  />
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2" aria-hidden="true">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Transportation Modes */}
              <div className="pt-4">
                <h3 className="block text-sm font-medium text-gray-700 mb-3">Transportation</h3>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Transportation options">
                  {[
                    { mode: 'walk', icon: '🚶', label: 'Walk' },
                    { mode: 'transit', icon: '🚌', label: 'Transit' },
                    { mode: 'wheelchair', icon: '♿', label: 'Accessible' },
                  ].map((transport) => (
                    <button
                      key={transport.mode}
                      className="flex flex-col items-center p-3 border border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      aria-label={`Select ${transport.label} mode`}
                    >
                      <span className="text-lg mb-1" aria-hidden="true">{transport.icon}</span>
                      <span className="text-xs text-gray-600">{transport.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Route Actions */}
              <div className="pt-6">
                <button
                  onClick={calculateRoute}
                  disabled={!routeTo}
                  className={`w-full py-3 px-4 rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                    routeTo 
                      ? 'bg-green-500 hover:bg-green-600 text-white focus:ring-green-500' 
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed focus:ring-gray-400'
                  }`}
                  aria-disabled={!routeTo}
                >
                  Calculate Route
                </button>
              </div>
            </div>

            {/* Recent Destinations */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Recent Destinations</h3>
              <div className="space-y-2" role="list" aria-label="Recent destinations">
                {['University of Pittsburgh', 'Carnegie Mellon', 'Downtown', 'Airport'].map((destination) => (
                  <button
                    key={destination}
                    onClick={() => setRouteTo(destination)}
                    className="w-full text-left p-2 text-sm text-gray-600 hover:bg-gray-100 rounded transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:bg-gray-100"
                    role="listitem"
                  >
                    {destination}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Google Maps Container */}
      <div className="w-full h-full relative">
        {/* Show sidebar toggle when collapsed */}
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-4 left-4 z-30 bg-green-500 hover:bg-green-600 text-white rounded-lg px-4 py-2 shadow-lg transition-all duration-200 flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            aria-label="Open route planner"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span>Show Route Planner</span>
          </button>
        )}

        {/* Google Maps Embed */}
        <iframe
          width="100%"
          height="100%"
          frameBorder="0"
          style={{ border: 0 }}
          src={`https://www.google.com/maps/embed/v1/view?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&center=40.4406,-79.9959&zoom=13&maptype=${mapStyle}`}
          allowFullScreen
          aria-label="Interactive map of Pittsburgh"
          title="Google Maps"
          loading="lazy"
        >
        </iframe>

        {/* Current Location Pin */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-20" aria-hidden="true">
          <div className="w-6 h-6 bg-green-500 rounded-full border-4 border-white shadow-lg animate-pulse"></div>
        </div>

        {/* Map Controls */}
        <div className="absolute top-4 right-20 z-40 flex flex-col gap-2">
          <button 
            className="bg-white hover:bg-gray-50 text-gray-700 rounded-lg w-10 h-10 flex items-center justify-center shadow-lg border border-gray-200 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="Zoom in"
          >
            <span className="text-lg font-semibold">+</span>
          </button>
          <button 
            className="bg-white hover:bg-gray-50 text-gray-700 rounded-lg w-10 h-10 flex items-center justify-center shadow-lg border border-gray-200 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="Zoom out"
          >
            <span className="text-lg font-semibold">-</span>
          </button>
        </div>

        {/* Compass */}
        <div className="absolute top-4 right-32 z-40 bg-white rounded-lg w-10 h-10 flex items-center justify-center shadow-lg border border-gray-200 font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500" 
             role="button" 
             aria-label="Reset map orientation to north">
          N
        </div>
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div 
            ref={modalRef}
            className="bg-white rounded-2xl shadow-2xl w-96 max-h-[80vh] overflow-hidden"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 id="settings-title" className="text-xl font-semibold text-gray-800">Accessibility Settings</h2>
              <button 
                className="text-gray-400 hover:text-gray-600 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 rounded"
                onClick={() => setIsSettingsOpen(false)}
                aria-label="Close settings"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Settings Options */}
            <div className="p-6 space-y-6 max-h-96 overflow-y-auto">
              {/* Disability Settings */}
              <div className="space-y-4">
                <h3 className="font-medium text-gray-700">Accessibility Features</h3>
                
                <div className="space-y-2">
                  {/* Vision Impaired */}
                  <label className="flex items-center justify-between cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all duration-200 focus-within:ring-2 focus-within:ring-green-500">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center" aria-hidden="true">
                        <span className="text-blue-600">👁️</span>
                      </div>
                      <div>
                        <div className="font-medium text-gray-800">Vision Impaired</div>
                        <div className="text-sm text-gray-600">High contrast, screen reader support</div>
                      </div>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={disabilitySettings.blind}
                      onChange={() => handleDisabilityChange('blind')}
                      className="rounded text-green-500 focus:ring-green-500 focus:ring-2"
                      aria-describedby="vision-description"
                    />
                  </label>

                  {/* Hearing Impaired */}
                  <label className="flex items-center justify-between cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all duration-200 focus-within:ring-2 focus-within:ring-green-500">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center" aria-hidden="true">
                        <span className="text-purple-600">👂</span>
                      </div>
                      <div>
                        <div className="font-medium text-gray-800">Hearing Impaired</div>
                        <div className="text-sm text-gray-600">Visual alerts, captions</div>
                      </div>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={disabilitySettings.deaf}
                      onChange={() => handleDisabilityChange('deaf')}
                      className="rounded text-green-500 focus:ring-green-500 focus:ring-2"
                      aria-describedby="hearing-description"
                    />
                  </label>

                  {/* Low Energy */}
                  <label className="flex items-center justify-between cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all duration-200 focus-within:ring-2 focus-within:ring-green-500">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center" aria-hidden="true">
                        <span className="text-green-600">⚡</span>
                      </div>
                      <div>
                        <div className="font-medium text-gray-800">Energy Efficient</div>
                        <div className="text-sm text-gray-600">Reduced animations, battery saver</div>
                      </div>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={disabilitySettings.lowEnergy}
                      onChange={() => handleDisabilityChange('lowEnergy')}
                      className="rounded text-green-500 focus:ring-green-500 focus:ring-2"
                      aria-describedby="energy-description"
                    />
                  </label>
                </div>
              </div>

              {/* Map Style */}
              <div className="space-y-3">
                <h3 className="font-medium text-gray-700">Map Style</h3>
                <div className="space-y-2" role="radiogroup" aria-label="Map style options">
                  {[
                    { value: 'roadmap', label: 'Standard' },
                    { value: 'satellite', label: 'Satellite' },
                    { value: 'terrain', label: 'Terrain' }
                  ].map((style) => (
                    <label key={style.value} className="flex items-center space-x-3 cursor-pointer p-2 rounded hover:bg-gray-50 transition-colors duration-200">
                      <input 
                        type="radio" 
                        name="mapStyle" 
                        value={style.value}
                        checked={mapStyle === style.value}
                        onChange={(e) => setMapStyle(e.target.value)}
                        className="text-green-500 focus:ring-green-500 focus:ring-2"
                        aria-checked={mapStyle === style.value}
                      />
                      <span className="text-gray-700">{style.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Route Preferences */}
              <div className="space-y-3">
                <h3 className="font-medium text-gray-700">Route Preferences</h3>
                <div className="space-y-2">
                  {['Avoid Stairs', 'Elevator Access', 'Wheelchair Accessible', 'Avoid Highways', 'Avoid Tolls'].map((preference) => (
                    <label key={preference} className="flex items-center justify-between cursor-pointer p-2 rounded hover:bg-gray-50 transition-colors duration-200">
                      <span className="text-gray-700">{preference}</span>
                      <input 
                        type="checkbox" 
                        className="rounded text-green-500 focus:ring-green-500 focus:ring-2" 
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-between p-6 border-t border-gray-200 bg-gray-50">
              <button 
                className="px-4 py-2 text-gray-700 hover:text-gray-900 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 rounded"
                onClick={() => {
                  setDisabilitySettings({ blind: false, deaf: false, lowEnergy: false });
                  setMapStyle('roadmap');
                }}
              >
                Reset All
              </button>
              <button 
                className="px-6 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                onClick={() => setIsSettingsOpen(false)}
              >
                Apply Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}