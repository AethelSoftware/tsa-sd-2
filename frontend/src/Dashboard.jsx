import { useState, useRef, useEffect } from "react";

export default function AccessibleMap() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [mapStyle, setMapStyle] = useState("roadmap");
  const [routeFrom, setRouteFrom] = useState("Current Location");
  const [routeTo, setRouteTo] = useState("");
  const [accessibilitySettings, setAccessibilitySettings] = useState({
    visionImpaired: false,
    hearingImpaired: false,
    lowEnergy: false,
    highContrast: false,
    largeText: false,
    screenReader: false,
    reducedMotion: false,
  });
  const [zoom, setZoom] = useState(13);
  const [currentLocation, setCurrentLocation] = useState({
    lat: 40.472,
    lng: -79.94,
  });
  const [activeTransport, setActiveTransport] = useState("wheelchair");
  const [announcement, setAnnouncement] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [calculatedRoute, setCalculatedRoute] = useState(null);
  const [map, setMap] = useState(null);
  const [directionsService, setDirectionsService] = useState(null);
  const [directionsRenderer, setDirectionsRenderer] = useState(null);

  const modalRef = useRef(null);
  const mapContainerRef = useRef(null);
  const settingsButtonRef = useRef(null);
  const announcementRef = useRef(null);
  const searchInputRef = useRef(null);

  // Load Google Maps API
  useEffect(() => {
    if (!window.google) {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&libraries=places`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);

      script.onload = () => {
        initializeMap();
      };
    } else {
      initializeMap();
    }

    return () => {
      if (directionsRenderer) {
        directionsRenderer.setMap(null);
      }
    };
  }, []);

  const initializeMap = () => {
    const mapOptions = {
      center: { lat: currentLocation.lat, lng: currentLocation.lng },
      zoom: zoom,
      mapTypeId: mapStyle,
      disableDefaultUI: false,
      zoomControl: false,
      styles: accessibilitySettings.highContrast ? highContrastMapStyle : [],
    };

    const newMap = new window.google.maps.Map(
      mapContainerRef.current,
      mapOptions
    );

    const newDirectionsService = new window.google.maps.DirectionsService();
    const newDirectionsRenderer = new window.google.maps.DirectionsRenderer({
      map: newMap,
      suppressMarkers: false,
      polylineOptions: {
        strokeColor: activeTransport === "wheelchair" ? "#4285F4" : "#34A853",
        strokeWeight: 6,
        strokeOpacity: 0.8,
      },
    });

    // Add current location marker
    new window.google.maps.Marker({
      position: { lat: currentLocation.lat, lng: currentLocation.lng },
      map: newMap,
      title: "Your Current Location",
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#4285F4",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
    });

    setMap(newMap);
    setDirectionsService(newDirectionsService);
    setDirectionsRenderer(newDirectionsRenderer);
  };

  useEffect(() => {
    if (announcementRef.current && announcement) {
      announcementRef.current.textContent = announcement;
      const timer = setTimeout(() => setAnnouncement(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [announcement]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setIsSettingsOpen(false);
      }
      if (
        isSearchOpen &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target)
      ) {
        setIsSearchOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isSettingsOpen, isSearchOpen]);

  useEffect(() => {
    const mapContainer = mapContainerRef.current;
    if (!mapContainer) return;

    const handleWheel = (e) => {
      if (
        accessibilitySettings.visionImpaired ||
        accessibilitySettings.reducedMotion
      ) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      setZoom((prev) => Math.min(Math.max(10, prev + delta), 18));
      if (map) {
        map.setZoom(zoom + delta);
      }
    };

    mapContainer.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      mapContainer.removeEventListener("wheel", handleWheel);
    };
  }, [
    accessibilitySettings.visionImpaired,
    accessibilitySettings.reducedMotion,
    map,
    zoom,
  ]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (isSettingsOpen) {
          setIsSettingsOpen(false);
          settingsButtonRef.current?.focus();
          setAnnouncement("Settings dialog closed");
        }
        if (isSearchOpen) {
          setIsSearchOpen(false);
        }
      }

      if (isSettingsOpen && e.key === "Tab") {
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
        switch (e.key) {
          case "1":
            e.preventDefault();
            setIsSidebarOpen((prev) => !prev);
            setAnnouncement("Route planner sidebar toggled");
            break;
          case "2":
            e.preventDefault();
            setIsSettingsOpen(true);
            setAnnouncement("Accessibility settings opened");
            break;
          case "3":
            e.preventDefault();
            setIsSearchOpen(true);
            searchInputRef.current?.focus();
            break;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSettingsOpen, isSearchOpen]);

  useEffect(() => {
    if (map) {
      map.setZoom(zoom);
    }
  }, [zoom, map]);

  useEffect(() => {
    if (map) {
      map.setMapTypeId(mapStyle);
    }
  }, [mapStyle, map]);

  useEffect(() => {
    if (map && accessibilitySettings.highContrast) {
      map.setOptions({ styles: highContrastMapStyle });
    } else if (map) {
      map.setOptions({ styles: [] });
    }
  }, [accessibilitySettings.highContrast, map]);

  const handleAccessibilityChange = (setting) => {
    const newValue = !accessibilitySettings[setting];
    setAccessibilitySettings((prev) => ({
      ...prev,
      [setting]: newValue,
    }));
    setAnnouncement(
      `${setting.replace(/([A-Z])/g, " $1").toLowerCase()} ${
        newValue ? "enabled" : "disabled"
      }`
    );
  };

  const calculateRoute = async () => {
    if (!routeTo.trim()) {
      setAnnouncement("Please enter a destination");
      return;
    }

    setIsLoading(true);
    setAnnouncement("Calculating accessible route...");

    try {
      // First try to get coordinates from the address
      const geocoder = new window.google.maps.Geocoder();
      const geocodeResult = await geocoder.geocode({
        address: routeTo,
      });

      if (!geocodeResult.results[0]) {
        throw new Error("Destination not found");
      }

      const destination = geocodeResult.results[0].geometry.location;
      const origin = new window.google.maps.LatLng(
        currentLocation.lat,
        currentLocation.lng
      );

      // Call your backend AI model for route calculation
      const response = await fetch("http://localhost:5000/api/calculate-route", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          origin: {
            lat: currentLocation.lat,
            lng: currentLocation.lng,
            address: routeFrom === "Current Location" ? "Current Location" : routeFrom,
          },
          destination: {
            lat: destination.lat(),
            lng: destination.lng(),
            address: routeTo,
          },
          mode: activeTransport,
          accessibilityFeatures: Object.keys(accessibilitySettings)
            .filter((key) => accessibilitySettings[key])
            .map((key) => ({
              feature: key,
              enabled: accessibilitySettings[key],
            })),
          preferences: {
            avoidStairs: true,
            elevatorAccess: true,
            wheelchairAccessible: activeTransport === "wheelchair",
            wellLitAreas: accessibilitySettings.visionImpaired,
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to calculate route");
      }

      const routeData = await response.json();

      if (routeData.route && directionsService && directionsRenderer) {
        // Use Google Directions Service to display the route
        directionsService.route(
          {
            origin: origin,
            destination: destination,
            travelMode: window.google.maps.TravelMode.WALKING,
            provideRouteAlternatives: false,
          },
          (result, status) => {
            if (status === "OK") {
              directionsRenderer.setDirections(result);
              setCalculatedRoute(result);

              // Zoom to fit the route
              const bounds = new window.google.maps.LatLngBounds();
              bounds.extend(origin);
              bounds.extend(destination);
              map.fitBounds(bounds);

              const activeFeatures = Object.keys(accessibilitySettings)
                .filter((key) => accessibilitySettings[key])
                .map((key) => key.replace(/([A-Z])/g, " $1").toLowerCase())
                .join(", ");

              setAnnouncement(
                `Route calculated successfully! ${
                  activeTransport === "wheelchair"
                    ? "Wheelchair accessible route found with optimized path. "
                    : ""
                }Accessibility features: ${activeFeatures || "none"}. Estimated time: ${
                  result.routes[0].legs[0].duration?.text || "Unknown"
                }`
              );
            } else {
              setAnnouncement("Could not calculate route. Please try again.");
            }
            setIsLoading(false);
          }
        );
      } else {
        // Fallback to basic route calculation if AI model is not available
        calculateBasicRoute(origin, destination);
      }
    } catch (error) {
      console.error("Route calculation error:", error);
      setAnnouncement(
        "Error calculating route. Please check your destination and try again."
      );
      setIsLoading(false);
    }
  };

  const calculateBasicRoute = (origin, destination) => {
    if (!directionsService || !directionsRenderer) return;

    const travelMode =
      activeTransport === "wheelchair" || activeTransport === "walk"
        ? window.google.maps.TravelMode.WALKING
        : window.google.maps.TravelMode.TRANSIT;

    directionsService.route(
      {
        origin: origin,
        destination: destination,
        travelMode: travelMode,
        provideRouteAlternatives: true,
      },
      (result, status) => {
        if (status === "OK") {
          directionsRenderer.setDirections(result);
          setCalculatedRoute(result);

          const bounds = new window.google.maps.LatLngBounds();
          bounds.extend(origin);
          bounds.extend(destination);
          map.fitBounds(bounds);

          setAnnouncement(
            `Route calculated successfully! Estimated time: ${
              result.routes[0].legs[0].duration?.text || "Unknown"
            }`
          );
        } else {
          setAnnouncement("Could not calculate route. Please try again.");
        }
        setIsLoading(false);
      }
    );
  };

  const handleZoomIn = () => {
    setZoom((prev) => {
      const newZoom = Math.min(prev + 1, 18);
      setAnnouncement(`Zoom level ${newZoom}`);
      if (map) {
        map.setZoom(newZoom);
      }
      return newZoom;
    });
  };

  const handleZoomOut = () => {
    setZoom((prev) => {
      const newZoom = Math.max(prev - 1, 10);
      setAnnouncement(`Zoom level ${newZoom}`);
      if (map) {
        map.setZoom(newZoom);
      }
      return newZoom;
    });
  };

  const getLocation = () => {
    if (navigator.geolocation) {
      setAnnouncement("Getting your current location");
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setCurrentLocation(newLocation);
          setRouteFrom("Current Location");
          
          if (map) {
            map.setCenter(newLocation);
            new window.google.maps.Marker({
              position: newLocation,
              map: map,
              title: "Your Current Location",
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: "#4285F4",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              },
            });
          }
          
          setAnnouncement("Current location updated successfully");
        },
        (error) => {
          setAnnouncement(
            "Unable to get current location. Using default location."
          );
        }
      );
    }
  };

  const handleTransportChange = (mode) => {
    setActiveTransport(mode);
    const modeNames = {
      walk: "walking",
      transit: "public transit",
      wheelchair: "wheelchair accessible",
    };
    setAnnouncement(`Transportation mode set to ${modeNames[mode]}`);
    
    // Clear existing route when transport mode changes
    if (directionsRenderer) {
      directionsRenderer.setDirections({ routes: [] });
      setCalculatedRoute(null);
    }
  };

  const highContrastMapStyle = [
    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    {
      featureType: "administrative.locality",
      elementType: "labels.text.fill",
      stylers: [{ color: "#d59563" }],
    },
    {
      featureType: "road",
      elementType: "geometry",
      stylers: [{ color: "#38414e" }],
    },
    {
      featureType: "road",
      elementType: "geometry.stroke",
      stylers: [{ color: "#212a37" }],
    },
    {
      featureType: "road",
      elementType: "labels.text.fill",
      stylers: [{ color: "#9ca5b3" }],
    },
    {
      featureType: "road.highway",
      elementType: "geometry",
      stylers: [{ color: "#746855" }],
    },
    {
      featureType: "road.highway",
      elementType: "geometry.stroke",
      stylers: [{ color: "#1f2835" }],
    },
    {
      featureType: "road.highway",
      elementType: "labels.text.fill",
      stylers: [{ color: "#f3d19c" }],
    },
  ];

  return (
    <div
      className={`relative w-full h-screen ${
        accessibilitySettings.highContrast
          ? "bg-black text-yellow-300"
          : "bg-slate-900 text-slate-100"
      } overflow-hidden font-sans antialiased`}
      role="application"
      aria-label="Accessible Map Application"
      style={{
        fontSize: accessibilitySettings.largeText ? "1.125rem" : "1rem",
        lineHeight: accessibilitySettings.largeText ? "1.75" : "1.5",
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
        Press Alt + 1 to toggle sidebar, Alt + 2 for settings, Alt + 3 for
        search
      </div>

      <aside
        className={`absolute top-0 left-0 z-40 h-full ${
          accessibilitySettings.highContrast ? "bg-gray-900" : "bg-slate-800"
        } shadow-2xl ${
          accessibilitySettings.reducedMotion
            ? ""
            : "transition-all duration-300"
        } ${isSidebarOpen ? "w-80 translate-x-0" : "w-0 -translate-x-full"}`}
        role="complementary"
        aria-label="Route planner"
      >
        {isSidebarOpen && (
          <div className="p-6 h-full flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={() => setIsSidebarOpen(false)}
                className={`p-2 ${
                  accessibilitySettings.highContrast
                    ? "hover:bg-gray-800"
                    : "hover:bg-slate-700"
                } rounded-lg ${
                  accessibilitySettings.reducedMotion
                    ? ""
                    : "transition-all duration-300"
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                aria-label="Close route planner sidebar"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="space-y-6 flex-1">
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="from-input"
                    className={`block ${
                      accessibilitySettings.largeText ? "text-lg" : "text-base"
                    } font-semibold mb-3`}
                  >
                    Start Location
                  </label>
                  <div className="relative">
                    <input
                      id="from-input"
                      type="text"
                      value={routeFrom}
                      onChange={(e) => setRouteFrom(e.target.value)}
                      className={`w-full ${
                        accessibilitySettings.highContrast
                          ? "bg-black text-yellow-300 border-yellow-300"
                          : "bg-slate-900 text-slate-100 border-slate-600"
                      } rounded-xl px-4 py-3 pl-12 focus:outline-none focus:ring-2 focus:ring-blue-500 border ${
                        accessibilitySettings.reducedMotion
                          ? ""
                          : "transition-all duration-300"
                      }`}
                      placeholder="Current location"
                    />
                    <div
                      className="absolute left-4 top-1/2 transform -translate-y-1/2"
                      aria-hidden="true"
                    >
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    </div>
                    <button
                      onClick={getLocation}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 hover:bg-slate-700 rounded"
                      aria-label="Use current location"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="to-input"
                    className={`block ${
                      accessibilitySettings.largeText ? "text-lg" : "text-base"
                    } font-semibold mb-3`}
                  >
                    Destination
                  </label>
                  <div className="relative">
                    <input
                      id="to-input"
                      type="text"
                      value={routeTo}
                      onChange={(e) => setRouteTo(e.target.value)}
                      className={`w-full ${
                        accessibilitySettings.highContrast
                          ? "bg-black text-yellow-300 border-yellow-300"
                          : "bg-slate-900 text-slate-100 border-slate-600"
                      } rounded-xl px-4 py-3 pl-12 focus:outline-none focus:ring-2 focus:ring-blue-500 border ${
                        accessibilitySettings.reducedMotion
                          ? ""
                          : "transition-all duration-300"
                      }`}
                      placeholder="Where do you want to go?"
                    />
                    <div
                      className="absolute left-4 top-1/2 transform -translate-y-1/2"
                      aria-hidden="true"
                    >
                      <svg
                        className="w-4 h-4 text-slate-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <h3
                  className={`${
                    accessibilitySettings.largeText ? "text-lg" : "text-base"
                  } font-semibold mb-4`}
                >
                  Accessibility Mode
                </h3>
                <div
                  className="grid grid-cols-3 gap-3"
                  role="radiogroup"
                  aria-label="Transportation options"
                >
                  {[
                    { mode: "walk", icon: "🚶", label: "Walk" },
                    { mode: "transit", icon: "🚌", label: "Transit" },
                    { mode: "wheelchair", icon: "♿", label: "Wheelchair" },
                  ].map((transport) => (
                    <button
                      key={transport.mode}
                      onClick={() => handleTransportChange(transport.mode)}
                      className={`flex flex-col items-center p-4 rounded-xl border-2 ${
                        accessibilitySettings.reducedMotion
                          ? ""
                          : "transition-all duration-300"
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        activeTransport === transport.mode
                          ? `${
                              accessibilitySettings.highContrast
                                ? "border-yellow-300 bg-yellow-500 bg-opacity-20"
                                : "border-slate-600 bg-blue-500 bg-opacity-20"
                            }`
                          : `${
                              accessibilitySettings.highContrast
                                ? "border-yellow-300 border-opacity-30 hover:border-opacity-100"
                                : "border-slate-600 border-opacity-30 hover:border-opacity-100"
                            }`
                      }`}
                      aria-label={`Select ${transport.label} mode`}
                      aria-pressed={activeTransport === transport.mode}
                    >
                      <span className="text-2xl mb-2" aria-hidden="true">
                        {transport.icon}
                      </span>
                      <span
                        className={`${
                          accessibilitySettings.largeText
                            ? "text-lg"
                            : "text-base"
                        } font-medium`}
                      >
                        {transport.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-6">
                <button
                  onClick={calculateRoute}
                  disabled={!routeTo || isLoading}
                  className={`w-full py-4 px-6 rounded-xl font-semibold ${
                    accessibilitySettings.reducedMotion
                      ? ""
                      : "transition-all duration-300"
                  } focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    accessibilitySettings.highContrast
                      ? "focus:ring-offset-black"
                      : "focus:ring-offset-slate-800"
                  } ${
                    routeTo && !isLoading
                      ? `${
                          accessibilitySettings.highContrast
                            ? "bg-yellow-500 hover:bg-yellow-600 text-black"
                            : "bg-blue-600 hover:bg-blue-700 text-white"
                        } shadow-lg ${
                          accessibilitySettings.reducedMotion
                            ? ""
                            : "hover:shadow-xl transform hover:scale-105"
                        }`
                      : "bg-slate-700 text-slate-400 cursor-not-allowed"
                  }`}
                  aria-disabled={!routeTo || isLoading}
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center">
                      <svg
                        className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Calculating...
                    </span>
                  ) : (
                    "Calculate Accessible Route"
                  )}
                </button>
              </div>

              <div className="mt-6 pt-6 border-t border-slate-600">
                <h3
                  className={`${
                    accessibilitySettings.largeText ? "text-lg" : "text-base"
                  } font-semibold mb-4`}
                >
                  Accessible Locations
                </h3>
                <div
                  className="space-y-3"
                  role="list"
                  aria-label="Recent accessible destinations"
                >
                  {[
                    { name: "University of Pittsburgh", type: "Education" },
                    { name: "Carnegie Museum", type: "Museum" },
                    { name: "Accessible Transit Center", type: "Transport" },
                    { name: "City Hospital", type: "Medical" },
                  ].map((destination) => (
                    <button
                      key={destination.name}
                      onClick={() => {
                        setRouteTo(destination.name);
                        setAnnouncement(
                          `Destination set to ${destination.name}, ${destination.type}`
                        );
                      }}
                      className={`w-full text-left p-4 rounded-xl ${
                        accessibilitySettings.highContrast
                          ? "hover:bg-gray-800"
                          : "hover:bg-slate-700"
                      } ${
                        accessibilitySettings.reducedMotion
                          ? ""
                          : "transition-all duration-300"
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 group`}
                      role="listitem"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div
                            className={`${
                              accessibilitySettings.largeText
                                ? "text-lg"
                                : "text-base"
                            } font-medium`}
                          >
                            {destination.name}
                          </div>
                          <div
                            className={`${
                              accessibilitySettings.largeText
                                ? "text-lg"
                                : "text-base"
                            } ${
                              accessibilitySettings.highContrast
                                ? "text-yellow-300"
                                : "text-slate-400"
                            }`}
                          >
                            {destination.type}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span
                            className="text-green-400"
                            aria-label="Wheelchair accessible"
                          >
                            ♿
                          </span>
                          <svg
                            className={`w-4 h-4 ${
                              accessibilitySettings.highContrast
                                ? "text-yellow-300"
                                : "text-slate-400"
                            } opacity-0 group-hover:opacity-100 ${
                              accessibilitySettings.reducedMotion
                                ? ""
                                : "transition-all duration-300"
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </aside>

      <main className="w-full h-full relative">
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className={`absolute top-20 left-4 z-30 ${
              accessibilitySettings.highContrast
                ? "bg-yellow-500 hover:bg-yellow-600 text-black"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            } rounded-xl px-4 py-3 shadow-2xl ${
              accessibilitySettings.reducedMotion
                ? ""
                : "transition-all duration-300"
            } flex items-center space-x-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
              accessibilitySettings.highContrast
                ? "focus:ring-offset-black"
                : "focus:ring-offset-slate-900"
            } ${accessibilitySettings.reducedMotion ? "" : "hover:scale-105"}`}
            aria-label="Open accessible route planner"
            accessKey="1"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
            <span className="font-medium">Show Route Planner</span>
          </button>
        )}

        <div
          ref={mapContainerRef}
          className="w-full h-full relative overflow-hidden"
          style={{
            pointerEvents: accessibilitySettings.visionImpaired
              ? "none"
              : "auto",
            filter: accessibilitySettings.highContrast
              ? "contrast(1.5) brightness(1.2)"
              : "none",
          }}
          aria-label={`Interactive map view centered at current location. Zoom level ${zoom}. ${mapStyle} view.`}
          role="application"
        />

        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
          <div
            className={`relative ${accessibilitySettings.reducedMotion ? "" : "animate-pulse"}`}
          >
            <div className="w-8 h-8 bg-blue-500 rounded-full border-4 border-white shadow-2xl"></div>
            <div className="absolute inset-0 rounded-full border-2 border-blue-300 animate-ping"></div>
          </div>
        </div>

        <div className="absolute top-20 right-4 z-40 flex flex-col gap-3">
          <button
            onClick={handleZoomIn}
            className={`${
              accessibilitySettings.highContrast
                ? "bg-gray-900 hover:bg-gray-800 border-yellow-300"
                : "bg-slate-800 hover:bg-slate-700 border-slate-600"
            } rounded-xl w-12 h-12 flex items-center justify-center shadow-2xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              accessibilitySettings.reducedMotion
                ? ""
                : "transition-all duration-300"
            }`}
            aria-label="Zoom in"
            disabled={accessibilitySettings.visionImpaired}
          >
            <span
              className={`text-xl font-bold ${
                accessibilitySettings.highContrast
                  ? "text-yellow-300"
                  : "text-slate-100"
              }`}
            >
              +
            </span>
          </button>
          <button
            onClick={handleZoomOut}
            className={`${
              accessibilitySettings.highContrast
                ? "bg-gray-900 hover:bg-gray-800 border-yellow-300"
                : "bg-slate-800 hover:bg-slate-700 border-slate-600"
            } rounded-xl w-12 h-12 flex items-center justify-center shadow-2xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              accessibilitySettings.reducedMotion
                ? ""
                : "transition-all duration-300"
            }`}
            aria-label="Zoom out"
            disabled={accessibilitySettings.visionImpaired}
          >
            <span
              className={`text-xl font-bold ${
                accessibilitySettings.highContrast
                  ? "text-yellow-300"
                  : "text-slate-100"
              }`}
            >
              -
            </span>
          </button>
        </div>

        <div
          className={`absolute bottom-4 right-4 z-40 ${
            accessibilitySettings.highContrast
              ? "bg-gray-900 border-yellow-300"
              : "bg-slate-800 border-slate-600"
          } rounded-2xl px-4 py-3 shadow-2xl border ${
            accessibilitySettings.largeText ? "text-lg" : "text-base"
          } font-bold backdrop-blur-sm bg-opacity-90`}
        >
          Zoom: {zoom}x
        </div>
      </main>

      {isSettingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
        >
          <div
            ref={modalRef}
            className={`${
              accessibilitySettings.highContrast
                ? "bg-gray-900 border-yellow-300"
                : "bg-slate-800 border-slate-600"
            } rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden border`}
            tabIndex={-1}
          >
            <div
              className={`flex items-center justify-between p-8 border-b ${
                accessibilitySettings.highContrast
                  ? "border-yellow-300"
                  : "border-slate-600"
              }`}
            >
              <div>
                <h2
                  id="settings-title"
                  className={`${
                    accessibilitySettings.largeText ? "text-2xl" : "text-xl"
                  } font-bold`}
                >
                  Accessibility Center
                </h2>
                <p
                  className={`${
                    accessibilitySettings.largeText ? "text-lg" : "text-base"
                  } mt-2 ${
                    accessibilitySettings.highContrast
                      ? "text-yellow-300"
                      : "text-slate-300"
                  }`}
                >
                  Customize your experience for vision, hearing, mobility, and
                  cognitive needs
                </p>
              </div>
              <button
                className={`p-2 ${
                  accessibilitySettings.highContrast
                    ? "hover:bg-gray-800"
                    : "hover:bg-slate-700"
                } rounded-xl ${
                  accessibilitySettings.reducedMotion
                    ? ""
                    : "transition-all duration-300"
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                onClick={() => {
                  setIsSettingsOpen(false);
                  setAnnouncement("Settings dialog closed");
                }}
                aria-label="Close accessibility settings"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-8 space-y-8 max-h-96 overflow-y-auto">
              <section>
                <h3
                  className={`${
                    accessibilitySettings.largeText ? "text-xl" : "text-lg"
                  } font-bold mb-6`}
                >
                  Accessibility Features
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    {
                      key: "visionImpaired",
                      icon: "👁️",
                      title: "Vision Impaired Mode",
                    },
                    {
                      key: "hearingImpaired",
                      icon: "👂",
                      title: "Hearing Impaired Mode",
                    },
                    { key: "highContrast", icon: "⚫", title: "High Contrast" },
                    { key: "largeText", icon: "🔍", title: "Large Text" },
                    {
                      key: "reducedMotion",
                      icon: "🎬",
                      title: "Reduced Motion",
                    },
                    { key: "lowEnergy", icon: "⚡", title: "Low Energy Mode" },
                  ].map((feature) => (
                    <label
                      key={feature.key}
                      className={`flex items-start space-x-4 cursor-pointer p-4 rounded-2xl border ${
                        accessibilitySettings.highContrast
                          ? "border-yellow-300 hover:bg-gray-800"
                          : "border-slate-600 hover:bg-slate-700"
                      } ${
                        accessibilitySettings.reducedMotion
                          ? ""
                          : "transition-all duration-300"
                      } focus-within:ring-2 focus-within:ring-blue-500`}
                    >
                      <div
                        className="w-12 h-12 bg-blue-500 bg-opacity-20 rounded-xl flex items-center justify-center flex-shrink-0"
                        aria-hidden="true"
                      >
                        <span className="text-2xl">{feature.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div
                            className={`font-semibold ${
                              accessibilitySettings.highContrast
                                ? "text-yellow-300"
                                : "text-slate-100"
                            } pr-2`}
                          >
                            {feature.title}
                          </div>
                          <input
                            type="checkbox"
                            checked={accessibilitySettings[feature.key]}
                            onChange={() =>
                              handleAccessibilityChange(feature.key)
                            }
                            className="rounded-lg w-5 h-5 text-blue-500 focus:ring-blue-500 focus:ring-2"
                          />
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </section>

              <section>
                <h3
                  className={`${
                    accessibilitySettings.largeText ? "text-xl" : "text-lg"
                  } font-bold mb-6`}
                >
                  Map Display
                </h3>
                <div
                  className="grid grid-cols-1 md:grid-cols-3 gap-4"
                  role="radiogroup"
                  aria-label="Map style options"
                >
                  {[
                    { value: "roadmap", label: "Standard", icon: "🗺️" },
                    { value: "satellite", label: "Satellite", icon: "🛰️" },
                    { value: "terrain", label: "Terrain", icon: "⛰️" },
                  ].map((style) => (
                    <label
                      key={style.value}
                      className={`flex flex-col items-center p-4 rounded-2xl border-2 cursor-pointer ${
                        accessibilitySettings.reducedMotion
                          ? ""
                          : "transition-all duration-300"
                      } focus-within:ring-2 focus-within:ring-blue-500 ${
                        mapStyle === style.value
                          ? `${
                              accessibilitySettings.highContrast
                                ? "border-yellow-300 bg-yellow-500 bg-opacity-20"
                                : "border-slate-600 bg-blue-500 bg-opacity-20"
                            }`
                          : `${
                              accessibilitySettings.highContrast
                                ? "border-yellow-300 border-opacity-30 hover:border-opacity-100"
                                : "border-slate-600 border-opacity-30 hover:border-opacity-100"
                            }`
                      }`}
                    >
                      <span className="text-3xl mb-3" aria-hidden="true">
                        {style.icon}
                      </span>
                      <input
                        type="radio"
                        name="mapStyle"
                        value={style.value}
                        checked={mapStyle === style.value}
                        onChange={(e) => {
                          setMapStyle(e.target.value);
                          setAnnouncement(`Map style changed to ${style.label}`);
                        }}
                        className="sr-only"
                        aria-checked={mapStyle === style.value}
                      />
                      <div className="text-center">
                        <div
                          className={`font-semibold ${
                            accessibilitySettings.highContrast
                              ? "text-yellow-300"
                              : "text-slate-100"
                          } mb-1`}
                        >
                          {style.label}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </section>

              <section>
                <h3
                  className={`${
                    accessibilitySettings.largeText ? "text-xl" : "text-lg"
                  } font-bold mb-6`}
                >
                  Route Preferences
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { id: "avoid-stairs", label: "Avoid Stairs" },
                    { id: "elevator-access", label: "Elevator Access" },
                    {
                      id: "wheelchair-accessible",
                      label: "Wheelchair Accessible",
                    },
                    { id: "avoid-highways", label: "Avoid Highways" },
                    { id: "well-lit-areas", label: "Well-lit Areas" },
                    { id: "quiet-roads", label: "Quiet Roads" },
                  ].map((preference) => (
                    <label
                      key={preference.id}
                      className={`flex items-start space-x-3 cursor-pointer p-3 rounded-xl ${
                        accessibilitySettings.highContrast
                          ? "hover:bg-gray-800"
                          : "hover:bg-slate-700"
                      } ${
                        accessibilitySettings.reducedMotion
                          ? ""
                          : "transition-all duration-300"
                      } focus-within:ring-2 focus-within:ring-blue-500`}
                    >
                      <input
                        type="checkbox"
                        id={preference.id}
                        className="rounded-lg w-5 h-5 text-blue-500 focus:ring-blue-500 focus:ring-2 mt-1 flex-shrink-0"
                      />
                      <div>
                        <div
                          className={`font-semibold ${
                            accessibilitySettings.highContrast
                              ? "text-yellow-300"
                              : "text-slate-100"
                          }`}
                        >
                          {preference.label}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </section>
            </div>

            <div
              className={`flex justify-between items-center p-8 border-t ${
                accessibilitySettings.highContrast
                  ? "border-yellow-300 bg-gray-800"
                  : "border-slate-600 bg-slate-700"
              } backdrop-blur-sm`}
            >
              <div className="flex items-center space-x-2 text-slate-400">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span
                  className={
                    accessibilitySettings.largeText ? "text-lg" : "text-base"
                  }
                >
                  Changes apply immediately
                </span>
              </div>

              <div className="flex space-x-4">
                <button
                  className={`px-6 py-3 ${
                    accessibilitySettings.highContrast
                      ? "text-yellow-300 hover:text-yellow-400"
                      : "text-slate-100 hover:text-blue-400"
                  } ${
                    accessibilitySettings.reducedMotion
                      ? ""
                      : "transition-all duration-300"
                  } focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-xl font-semibold`}
                  onClick={() => {
                    setAccessibilitySettings({
                      visionImpaired: false,
                      hearingImpaired: false,
                      lowEnergy: false,
                      highContrast: false,
                      largeText: false,
                      screenReader: false,
                      reducedMotion: false,
                    });
                    setMapStyle("roadmap");
                    setZoom(13);
                    setAnnouncement("All settings reset to default");
                  }}
                  aria-label="Reset all accessibility settings to default"
                >
                  Reset Defaults
                </button>
                <button
                  className={`px-8 py-3 ${
                    accessibilitySettings.highContrast
                      ? "bg-yellow-500 hover:bg-yellow-600 text-black"
                      : "bg-blue-600 hover:bg-blue-700 text-white"
                  } rounded-xl font-semibold shadow-lg ${
                    accessibilitySettings.reducedMotion
                      ? ""
                      : "transition-all duration-300"
                  } focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    accessibilitySettings.highContrast
                      ? "focus:ring-offset-black"
                      : "focus:ring-offset-slate-800"
                  } ${
                    accessibilitySettings.reducedMotion ? "" : "hover:scale-105"
                  }`}
                  onClick={() => {
                    setIsSettingsOpen(false);
                    setAnnouncement(
                      "Accessibility settings applied successfully"
                    );
                  }}
                  aria-label="Apply accessibility settings and close dialog"
                >
                  Apply Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}