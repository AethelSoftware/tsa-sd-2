import React, { useState, useEffect } from "react";
import { MapPin, X, AlertTriangle, Shield, ArrowRight, Bus, Footprints, Navigation } from "lucide-react";

const ALT_DEST_COLORS = [
  { line: '#7c9ff5', label: 'Blue' },
  { line: '#f5c56e', label: 'Amber' },
  { line: '#a8e6a3', label: 'Mint' },
  { line: '#d4a0f5', label: 'Purple' },
];

const AlternateDestinationsPanel = ({
  alternateDestinations = [],
  loading = false,
  triggerReason = null,
  routeHazardSummary = null,
  hoveredAlternate = null,
  selectedAlternate = null,
  showComparison = false,
  originalDestinationName = "",
  originalRouteDistance = "",
  originalRouteDuration = "",
  originalRouteSteps = [],
  onHoverAlternate = () => {},
  onSelectAlternate = () => {},
  onAcceptAlternate = () => {},
  onDismiss = () => {},
  onCloseComparison = () => {},
  isMobile = false,
  // NEW props for alternate routes
  alternateRoutes = [],
  onSelectAlternateRoute = () => {},
  onHoverAlternateRoute = () => {},
}) => {
  const [showAltRoutes, setShowAltRoutes] = useState(true);
  const [showAltDests, setShowAltDests] = useState(true);

  if (loading && alternateDestinations.length === 0 && alternateRoutes.length === 0) {
    return (
      <div className="alt-dest-panel">
        <div className="alt-loading-row">
          <div className="spn2" />
          <span>Finding safer options...</span>
        </div>
      </div>
    );
  }

  if (alternateDestinations.length === 0 && alternateRoutes.length === 0) return null;

  return (
    <div className="alt-dest-panel">
      <div className="alt-dest-header">
        <div className="alt-dest-header-icon">
          <Shield size={16} />
        </div>
        <div className="alt-dest-header-text">
          <div className="alt-dest-title">Hazard Detected — Safer Options Available</div>
          <div className="alt-dest-subtitle">
            {triggerReason === "destination_in_hazard" 
              ? "Destination is in a hazard zone" 
              : "Route passes through hazards"}
          </div>
        </div>
        <button className="alt-dest-close" onClick={onDismiss}>
          <X size={14} />
        </button>
      </div>

      {/* Section A: Safer Routes to Same Destination */}
      {alternateRoutes.length > 0 && (
        <div style={{ padding: "8px 0 0 0" }}>
          <div className="comp-section-label" style={{ padding: "0 14px", marginBottom: "6px" }}>
            <Navigation size={12} /> Safer Routes to Same Destination
          </div>
          <div className="alt-dest-scroll">
            {alternateRoutes.map((route, idx) => {
              const isHovered = hoveredAlternate === idx; // reuse hover index for both? We'll use separate hover for routes later
              const color = route.color || ALT_DEST_COLORS[idx % ALT_DEST_COLORS.length].line;
              return (
                <div
                  key={route.id}
                  className={`alt-card ${isHovered ? "hovered" : ""}`}
                  style={{ "--alt-color": color }}
                  onMouseEnter={() => onHoverAlternateRoute(idx)}
                  onMouseLeave={() => onHoverAlternateRoute(null)}
                  onClick={() => onSelectAlternateRoute(route)}
                >
                  <div className="alt-card-badge">
                    <div className="alt-card-dot" style={{ background: color }} />
                    <span>{route.label}</span>
                  </div>
                  <div className="alt-card-name">Same destination</div>
                  <div className="alt-card-stat">
                    <span>{route.distance}</span> · <span>{route.duration}</span>
                  </div>
                  <div className={`alt-card-stat ${route.hazardCount === 0 ? "safe" : "warn"}`}>
                    {route.hazardCount === 0 ? "✓ No hazards" : `⚠ ${route.hazardCount} hazard(s)`}
                  </div>
                  <div className="alt-card-compare-btn">Compare →</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section B: Alternate Destinations */}
      {alternateDestinations.length > 0 && (
        <div style={{ padding: "8px 0 8px 0" }}>
          <div className="comp-section-label" style={{ padding: "0 14px", marginBottom: "6px" }}>
            <MapPin size={12} /> Alternate Destinations Nearby
          </div>
          <div className="alt-dest-scroll">
            {alternateDestinations.map((alt, idx) => {
              const isHovered = hoveredAlternate === idx;
              const isSelected = selectedAlternate?.id === alt.id;
              const color = ALT_DEST_COLORS[idx % ALT_DEST_COLORS.length].line;
              return (
                <div
                  key={alt.id}
                  className={`alt-card ${isHovered ? "hovered" : ""}`}
                  style={{ "--alt-color": color }}
                  onMouseEnter={() => onHoverAlternate(idx)}
                  onMouseLeave={() => onHoverAlternate(null)}
                  onClick={() => onSelectAlternate(alt)}
                >
                  <div className="alt-card-badge">
                    <div className="alt-card-dot" style={{ background: color }} />
                    <span>Alternative</span>
                  </div>
                  <div className="alt-card-name">{alt.name.length > 25 ? alt.name.slice(0,25)+"…" : alt.name}</div>
                  <div className="alt-card-stat">
                    <span>{alt.routeDistance}</span> · <span>{alt.routeDuration}</span>
                  </div>
                  <div className={`alt-card-stat ${alt.hazardCount === 0 ? "safe" : "warn"}`}>
                    {alt.hazardCount === 0 ? "✓ Safe route" : `⚠ ${alt.hazardCount} hazard(s)`}
                  </div>
                  <div className="alt-card-compare-btn">Compare →</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="alt-dest-footer">
        <button className="alt-dest-continue-btn" onClick={onDismiss}>
          Continue with Original Route <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
};

export default AlternateDestinationsPanel;