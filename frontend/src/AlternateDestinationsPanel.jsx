import React, { useState, useCallback } from "react";
import {
  MapPin,
  X,
  Shield,
  ArrowRight,
  Navigation,
  ChevronRight,
  Check,
  AlertTriangle,
} from "lucide-react";


const PANEL_CSS = `
/* ═══ ALT-PANEL SHELL ═══ */
.altp {
  position: absolute;
  left: calc(var(--rail-w, 64px) + 14px);
  bottom: 90px;
  width: 380px;
  max-width: calc(100vw - var(--rail-w, 64px) - 28px);
  max-height: calc(100vh - 200px);
  background: var(--surface);
  border: 1px solid rgba(232,168,112,0.25);
  border-radius: 20px;
  backdrop-filter: blur(28px);
  box-shadow: var(--sh-lg);
  z-index: 52;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: altp-in 0.28s cubic-bezier(.4,0,.2,1);
  font-family: var(--ff-b);
}
@keyframes altp-in {
  from { opacity: 0; transform: translateY(16px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* ── Header ── */
.altp-hd {
  padding: 14px 16px 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255,123,107,0.06) 0%, transparent 100%);
  flex-shrink: 0;
}
.altp-hd-icon {
  width: 36px; height: 36px;
  border-radius: 10px;
  background: var(--red-dim);
  border: 1px solid rgba(255,123,107,0.3);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  color: var(--red);
}
.altp-hd-body { flex: 1; min-width: 0; }
.altp-hd-title {
  font-family: var(--ff-d);
  font-size: 14px;
  font-weight: 700;
  color: var(--txt);
  line-height: 1.3;
}
.altp-hd-sub {
  font-size: 11px;
  color: var(--txt2);
  margin-top: 2px;
  line-height: 1.35;
}
.altp-hd-close {
  width: 30px; height: 30px;
  background: var(--inset);
  border: 1px solid var(--border);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  color: var(--txt3);
  transition: all 0.15s;
  flex-shrink: 0;
}
.altp-hd-close:hover {
  color: var(--red);
  border-color: rgba(255,123,107,0.35);
  background: var(--red-dim);
}

/* ── Scroll body ── */
.altp-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.altp-body::-webkit-scrollbar { width: 4px; }
.altp-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

/* ── Section label ── */
.altp-sec {
  padding: 10px 16px 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}
.altp-sec::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

/* ═══ ROUTE ROW ═══ */
.altp-route {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  min-height: 52px;
  cursor: pointer;
  transition: background 0.14s, border-color 0.14s;
  border-left: 3px solid transparent;
  border-bottom: 1px solid rgba(255,255,255,0.025);
  background: transparent;
  border-right: none;
  border-top: none;
  width: 100%;
  text-align: left;
  font-family: var(--ff-b);
  color: var(--txt);
}
.altp-route:last-child { border-bottom: none; }
.altp-route:hover, .altp-route.hovered {
  background: var(--wood-dim);
}
.altp-route-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 6px currentColor;
}
.altp-route-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.altp-route-name {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.altp-route-meta {
  font-size: 11px;
  color: var(--txt3);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.altp-route-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  letter-spacing: 0.2px;
}
.altp-route-badge.safe {
  background: var(--green-dim);
  color: var(--green);
  border: 1px solid rgba(140,214,156,0.3);
}
.altp-route-badge.warn {
  background: rgba(255,179,71,0.1);
  color: var(--amber);
  border: 1px solid rgba(255,179,71,0.25);
}
.altp-route-arrow {
  color: var(--txt3);
  flex-shrink: 0;
  transition: transform 0.15s, color 0.15s;
}
.altp-route:hover .altp-route-arrow,
.altp-route.hovered .altp-route-arrow {
  transform: translateX(2px);
}

/* ═══ DESTINATION CARD ═══ */
.altp-dest {
  margin: 4px 14px 8px;
  padding: 14px;
  background: var(--inset);
  border: 1px solid var(--border);
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.18s;
  position: relative;
}
.altp-dest::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  border-radius: 14px 14px 0 0;
  opacity: 0;
  transition: opacity 0.18s;
}
.altp-dest:hover, .altp-dest.hovered {
  border-color: var(--alt-accent, var(--wood));
  background: rgba(255,255,255,0.04);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
}
.altp-dest:hover::before, .altp-dest.hovered::before { opacity: 1; }

.altp-dest-top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;
}
.altp-dest-diamond {
  width: 28px; height: 28px;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  font-size: 12px;
}
.altp-dest-detail { flex: 1; min-width: 0; }
.altp-dest-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--txt);
  line-height: 1.35;
  margin-bottom: 3px;
}
.altp-dest-stats {
  font-size: 11px;
  color: var(--txt2);
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  line-height: 1.5;
}
.altp-dest-cat {
  display: inline-block;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--inset);
  border: 1px solid var(--border);
  color: var(--txt3);
}
.altp-dest-btn {
  width: 100%;
  margin-top: 12px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: transparent;
  font-family: var(--ff-b);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s;
}
.altp-dest-btn:hover {
  background: rgba(255,255,255,0.04);
  transform: translateY(-1px);
}

/* ═══ FOOTER ═══ */
.altp-ft {
  padding: 10px 14px 14px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.altp-ft-btn {
  width: 100%;
  padding: 11px;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  color: var(--txt3);
  font-family: var(--ff-b);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.altp-ft-btn:hover {
  background: var(--inset);
  border-color: var(--border);
  color: var(--txt2);
}

/* ── Loading skeleton ── */
.altp-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
  font-size: 12px;
  color: var(--txt2);
}

/* ═══ MOBILE ═══ */
@media (max-width: 639px) {
  .altp {
    left: calc(var(--rail-w, 52px) + 8px);
    width: calc(100vw - var(--rail-w, 52px) - 16px);
    bottom: 80px;
    max-height: 55vh;
    border-radius: 16px;
  }
  .altp-dest { margin: 4px 10px 8px; }
  .altp-route { padding: 10px 12px; }
}

/* ── Focus ── */
.altp-route:focus-visible,
.altp-dest:focus-visible,
.altp-dest-btn:focus-visible,
.altp-ft-btn:focus-visible,
.altp-hd-close:focus-visible {
  outline: 2px solid var(--wood);
  outline-offset: 2px;
}
`;

let cssInjected = false;
function injectCSS() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-altp", "");
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

/* ═══════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════ */
const AlternateDestinationsPanel = ({
  alternateDestinations = [],
  loading = false,
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
  injectCSS();

  const routeCount = alternateRoutes.length;
  const destCount = alternateDestinations.length;

  if (loading && destCount === 0 && routeCount === 0) {
    return (
      <div className="altp">
        <div className="altp-loading">
          <div className="spn2" />
          Finding safer options…
        </div>
      </div>
    );
  }

  if (destCount === 0 && routeCount === 0) return null;

  const subtitle =
    routeCount > 0 && destCount > 0
      ? `${routeCount} safer path${routeCount > 1 ? "s" : ""} + ${destCount} alternate destination`
      : routeCount > 0
        ? `${routeCount} safer path${routeCount > 1 ? "s" : ""} to ${originalDestinationName || "destination"}`
        : `${destCount} alternate destination nearby`;

  const truncName = (name, len = 22) =>
    name && name.length > len ? name.slice(0, len) + "…" : name;

  return (
    <div className="altp" role="region" aria-label="Safer route options">
      <div className="altp-hd">
        <div className="altp-hd-icon">
          <Shield size={16} />
        </div>
        <div className="altp-hd-body">
          <div className="altp-hd-title">Safer Options Available</div>
          <div className="altp-hd-sub">{subtitle}</div>
        </div>
        <button
          className="altp-hd-close"
          onClick={onDismiss}
          aria-label="Dismiss safer options"
        >
          <X size={14} />
        </button>
      </div>

      <div className="altp-body">
        {routeCount > 0 && (
          <>
            <div className="altp-sec" style={{ color: "#818cf8" }}>
              <Navigation size={10} />
              Safer routes
            </div>
            {alternateRoutes.map((route, idx) => {
              const isHovered = hoveredAlternate === `route-${idx}`;
              const safe = route.hazardCount === 0;
              return (
                <button
                  key={route.id}
                  className={`altp-route${isHovered ? " hovered" : ""}`}
                  style={{ borderLeftColor: route.color }}
                  onMouseEnter={() => onHoverAlternateRoute(idx)}
                  onMouseLeave={() => onHoverAlternateRoute(null)}
                  onClick={() => onSelectAlternateRoute(route)}
                  aria-label={`${route.label}: ${route.distance}, ${route.duration}`}
                >
                  <div
                    className="altp-route-dot"
                    style={{ background: route.color, color: route.color }}
                  />
                  <div className="altp-route-info">
                    <div
                      className="altp-route-name"
                      style={{ color: route.color }}
                    >
                      {route.label}
                    </div>
                    <div className="altp-route-meta">
                      <span>{route.distance}</span>
                      <span>·</span>
                      <span>{route.duration}</span>
                      <span
                        className={`altp-route-badge ${safe ? "safe" : "warn"}`}
                      >
                        {safe ? (
                          <>
                            <Check size={9} /> Clear
                          </>
                        ) : (
                          <>
                            <AlertTriangle size={9} /> {route.hazardCount}
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="altp-route-arrow" />
                </button>
              );
            })}
          </>
        )}

        {destCount > 0 && (
          <>
            <div className="altp-sec" style={{ color: "#c084fc" }}>
              <MapPin size={10} />
              Alternate destination
            </div>
            {alternateDestinations.slice(0, 2).map((alt, idx) => {
              const isHovered = hoveredAlternate === idx;
              const color = "#c084fc";
              const safe = alt.hazardCount === 0;

              return (
                <div
                  key={alt.id || idx}
                  className={`altp-dest${isHovered ? " hovered" : ""}`}
                  style={{
                    "--alt-accent": color,
                    borderColor: isHovered ? color : undefined,
                  }}
                  onMouseEnter={() => onHoverAlternate(idx)}
                  onMouseLeave={() => onHoverAlternate(null)}
                  onClick={() => onSelectAlternate(alt)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Alternate: ${alt.name}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectAlternate(alt);
                    }
                  }}
                >
                  <div
                    className="altp-dest::before"
                    style={{ background: color }}
                  />
                  <div className="altp-dest-top">
                    <div
                      className="altp-dest-diamond"
                      style={{
                        background: `${color}18`,
                        border: `1px solid ${color}40`,
                        color,
                      }}
                    >
                      <MapPin size={13} />
                    </div>
                    <div className="altp-dest-detail">
                      <div className="altp-dest-name">{alt.name}</div>
                      <div className="altp-dest-stats">
                        <span>{alt.routeDistance}</span>
                        <span>·</span>
                        <span>{alt.routeDuration}</span>
                        <span>·</span>
                        <span
                          className={`altp-route-badge ${safe ? "safe" : "warn"}`}
                        >
                          {safe ? (
                            <>
                              <Check size={9} /> Hazard-free
                            </>
                          ) : (
                            <>
                              <AlertTriangle size={9} /> {alt.hazardCount}{" "}
                              hazard{alt.hazardCount !== 1 ? "s" : ""}
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {alt.category && (
                    <div style={{ marginBottom: 4 }}>
                      <span className="altp-dest-cat">{alt.category}</span>
                    </div>
                  )}

                  <button
                    className="altp-dest-btn"
                    style={{ color, borderColor: `${color}50` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAlternate(alt);
                    }}
                  >
                    Compare & Accept
                    <ChevronRight size={13} />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="altp-ft">
        <button className="altp-ft-btn" onClick={onDismiss}>
          Keep original route
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
};

export default React.memo(AlternateDestinationsPanel);