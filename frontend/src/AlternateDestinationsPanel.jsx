import React from "react";
import { MapPin, X, AlertTriangle, Shield, ArrowRight, Bus, Footprints, Navigation } from "lucide-react";

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
  alternateRoutes = [],
  onSelectAlternateRoute = () => {},
  onHoverAlternateRoute = () => {},
}) => {
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

  const routeCount = alternateRoutes.length;
  const destCount = alternateDestinations.length;

  return (
    <div className="alt-dest-panel">
      <div className="alt-dest-header">
        <div className="alt-dest-header-icon">
          <Shield size={16} />
        </div>
        <div className="alt-dest-header-text">
          <div className="alt-dest-title">Hazard Detected — Safer Options</div>
          <div className="alt-dest-subtitle">
            {routeCount > 0 && destCount > 0
              ? `${routeCount} safer route(s) · ${destCount} alternate destination(s)`
              : routeCount > 0
              ? `${routeCount} safer route(s) to same destination`
              : `1 alternate destination nearby`}
          </div>
        </div>
        <button className="alt-dest-close" onClick={onDismiss}>
          <X size={14} />
        </button>
      </div>

      {/* Section A: Safer Routes to Same Destination */}
      {alternateRoutes.length > 0 && (
        <div style={{ padding: "8px 0" }}>
          <div className="comp-section-label" style={{ padding: "0 14px", marginBottom: "6px", color: "#818cf8" }}>
            <Navigation size={12} /> ▶ SAFER ROUTES TO {originalDestinationName.slice(0, 20)}...
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {alternateRoutes.map((route, idx) => {
              const isHovered = hoveredAlternate === idx;
              return (
                <div
                  key={route.id}
                  className="alt-route-row"
                  style={{ borderLeftColor: isHovered ? route.color : 'transparent', backgroundColor: isHovered ? 'var(--wood-dim)' : 'transparent' }}
                  onMouseEnter={() => onHoverAlternateRoute(idx)}
                  onMouseLeave={() => onHoverAlternateRoute(null)}
                  onClick={() => onSelectAlternateRoute(route)}
                >
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: route.color, flexShrink: 0 }} />
                  <div className="alt-route-row-label" style={{ color: route.color }}>{route.label}</div>
                  <div className="alt-route-row-stats">{route.distance} · {route.duration}</div>
                  <div style={{ fontSize: '10px', color: route.hazardCount === 0 ? 'var(--green)' : 'var(--amber)' }}>
                    {route.hazardCount === 0 ? '✓ No hazards' : `⚠ ${route.hazardCount}`}
                  </div>
                  <button className="alt-route-compare-btn" style={{ color: route.color, borderColor: route.color }}>Compare →</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section B: Alternate Destination */}
      {alternateDestinations.length > 0 && (
        <div style={{ padding: "8px 0 8px 0" }}>
          <div className="comp-section-label" style={{ padding: "0 14px", marginBottom: "6px", color: "#c084fc" }}>
            <MapPin size={12} /> ◆ ALTERNATE DESTINATION NEARBY
          </div>
          {alternateDestinations.slice(0, 1).map((alt, idx) => {
            const isHovered = hoveredAlternate === idx;
            const color = "#c084fc";
            return (
              <div
                key={alt.id}
                className="alt-dest-card-wide"
                style={{ borderColor: isHovered ? color : 'var(--border)' }}
                onMouseEnter={() => onHoverAlternate(idx)}
                onMouseLeave={() => onHoverAlternate(null)}
                onClick={() => onSelectAlternate(alt)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <span style={{ fontSize: "14px", color }}>◆</span>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--txt)" }}>{alt.name}</div>
                </div>
                <div style={{ fontSize: "11px", color: "var(--txt2)", marginBottom: "8px" }}>
                  {alt.routeDistance} · {alt.routeDuration} · {alt.hazardCount === 0 ? "✓ Hazard-free route" : `⚠ ${alt.hazardCount} hazard(s)`}
                </div>
                <div style={{ marginBottom: "12px" }}>
                  <span style={{ fontSize: "9px", background: "var(--inset)", padding: "2px 8px", borderRadius: "12px", color: "var(--txt2)" }}>
                    {alt.category}
                  </span>
                </div>
                <button className="alt-route-compare-btn" style={{ color: color, borderColor: color, width: "100%", padding: "8px" }}>Compare & Accept →</button>
              </div>
            );
          })}
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