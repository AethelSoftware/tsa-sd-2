import { useState, useRef, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
  CircleMarker,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const TOMTOM_API_KEY = "pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM";

const destinationIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const hazardIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const mapTypes = {
  openstreetmap: {
    name: "Street",
    icon: "🗺️",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
  },
  tomtom: {
    name: "TomTom",
    icon: "📍",
    url: `https://{s}.api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}`,
    attribution: "© TomTom",
  },
  tomtomSatellite: {
    name: "Satellite",
    icon: "🛰️",
    url: `https://{s}.api.tomtom.com/map/1/tile/sat/main/{z}/{x}/{y}.jpg?key=${TOMTOM_API_KEY}`,
    attribution: "© TomTom",
  },
  tomtomNight: {
    name: "Night",
    icon: "🌙",
    url: `https://{s}.api.tomtom.com/map/1/tile/night/main/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}`,
    attribution: "© TomTom",
  },
};

function ChangeView({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap');

  * { box-sizing: border-box; }

  :root {
    --bg-deep: #080e1a;
    --bg-panel: rgba(10, 18, 35, 0.92);
    --bg-card: rgba(15, 25, 48, 0.85);
    --bg-input: rgba(255,255,255,0.05);
    --border: rgba(0, 212, 255, 0.12);
    --border-hover: rgba(0, 212, 255, 0.35);
    --cyan: #00d4ff;
    --cyan-dim: rgba(0, 212, 255, 0.15);
    --cyan-glow: rgba(0, 212, 255, 0.3);
    --green: #00e676;
    --green-dim: rgba(0, 230, 118, 0.12);
    --amber: #ffc107;
    --amber-dim: rgba(255, 193, 7, 0.12);
    --red: #ff5252;
    --red-dim: rgba(255, 82, 82, 0.12);
    --text-primary: #f0f6ff;
    --text-secondary: #7a9cc0;
    --text-muted: #3d5a7a;
    --font-display: 'Syne', sans-serif;
    --font-body: 'DM Sans', sans-serif;
  }

  .app-root {
    font-family: var(--font-body);
    background: var(--bg-deep);
    color: var(--text-primary);
  }

  /* HIGH CONTRAST */
  .hc { --bg-deep: #000; --bg-panel: #000; --bg-card: #111; --border: #ffff00; --border-hover: #ffff00; --cyan: #ffff00; --cyan-dim: rgba(255,255,0,0.15); --cyan-glow: rgba(255,255,0,0.3); --text-primary: #ffff00; --text-secondary: #ffff00; --text-muted: #cccc00; }

  /* SIDEBAR */
  .sidebar {
    position: absolute;
    top: 0; left: 0; bottom: 0;
    width: 360px;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
    backdrop-filter: blur(20px);
    z-index: 50;
    display: flex;
    flex-direction: column;
    transform: translateX(0);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
  }
  .sidebar.collapsed { transform: translateX(-100%); }

  .sidebar-header {
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .logo {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .logo-icon {
    width: 34px; height: 34px;
    background: linear-gradient(135deg, var(--cyan), #0080ff);
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
    box-shadow: 0 0 16px var(--cyan-glow);
  }

  .logo-sub {
    font-family: var(--font-body);
    font-size: 11px;
    font-weight: 400;
    color: var(--text-muted);
    margin-top: 1px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .sidebar-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  /* SECTION LABELS */
  .section-label {
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 10px;
  }

  /* INPUTS */
  .route-input-wrap {
    position: relative;
  }

  .route-input {
    width: 100%;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 13px 44px 13px 44px;
    color: var(--text-primary);
    font-family: var(--font-body);
    font-size: 14px;
    font-weight: 400;
    transition: border-color 0.2s, box-shadow 0.2s;
    outline: none;
  }
  .route-input::placeholder { color: var(--text-muted); }
  .route-input:focus {
    border-color: var(--cyan);
    box-shadow: 0 0 0 3px var(--cyan-dim);
  }

  .input-dot {
    position: absolute;
    left: 16px;
    top: 50%;
    transform: translateY(-50%);
    width: 10px; height: 10px;
    border-radius: 50%;
  }
  .dot-green { background: var(--green); box-shadow: 0 0 8px var(--green); animation: pulse-dot 2s infinite; }
  .dot-red { background: var(--red); box-shadow: 0 0 8px var(--red); }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: translateY(-50%) scale(1); }
    50% { opacity: 0.7; transform: translateY(-50%) scale(1.3); }
  }

  .input-action-btn {
    position: absolute;
    right: 10px;
    top: 50%; transform: translateY(-50%);
    background: var(--cyan-dim);
    border: 1px solid var(--border);
    border-radius: 8px;
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    transition: background 0.2s;
    color: var(--cyan);
    font-size: 13px;
  }
  .input-action-btn:hover { background: rgba(0, 212, 255, 0.25); }

  .route-connector {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 0;
  }
  .connector-line {
    width: 1px;
    height: 20px;
    background: linear-gradient(to bottom, var(--green), var(--red));
    margin-left: 20px;
    opacity: 0.4;
  }

  /* TRANSPORT TABS */
  .transport-tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .transport-tab {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: all 0.2s;
    color: var(--text-secondary);
    font-family: var(--font-body);
  }

  .transport-tab:hover {
    border-color: var(--border-hover);
    background: var(--cyan-dim);
  }

  .transport-tab.active {
    border-color: var(--cyan);
    background: var(--cyan-dim);
    color: var(--cyan);
    box-shadow: 0 0 16px var(--cyan-glow);
  }

  .transport-tab .tab-icon { font-size: 22px; }
  .transport-tab .tab-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }

  /* CALCULATE BUTTON */
  .calc-btn {
    width: 100%;
    padding: 15px;
    border-radius: 14px;
    background: linear-gradient(135deg, #0093ff, #00d4ff);
    border: none;
    color: #000;
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.3px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: 0 4px 20px rgba(0, 148, 255, 0.35);
  }
  .calc-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 28px rgba(0, 148, 255, 0.5);
  }
  .calc-btn:disabled {
    background: var(--bg-input);
    color: var(--text-muted);
    box-shadow: none;
    cursor: not-allowed;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 16px; height: 16px;
    border: 2px solid rgba(0,0,0,0.3);
    border-top-color: #000;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  /* PRESETS */
  .preset-list { display: flex; flex-direction: column; gap: 6px; }

  .preset-item {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
    width: 100%;
  }
  .preset-item:hover {
    border-color: var(--border-hover);
    background: var(--cyan-dim);
    transform: translateX(3px);
  }

  .preset-badge {
    width: 36px; height: 36px;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
  }

  .preset-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .preset-type {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }
  .preset-arrow {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 14px;
    transition: transform 0.2s;
  }
  .preset-item:hover .preset-arrow { transform: translateX(3px); color: var(--cyan); }

  /* ACCESSIBILITY TOGGLES */
  .a11y-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .a11y-toggle {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 11px 12px;
    display: flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
    transition: all 0.2s;
    width: 100%;
    text-align: left;
  }
  .a11y-toggle:hover { border-color: var(--border-hover); }
  .a11y-toggle.active {
    border-color: var(--cyan);
    background: var(--cyan-dim);
  }
  .a11y-toggle-icon { font-size: 16px; }
  .a11y-toggle-label { font-size: 12px; font-weight: 500; color: var(--text-secondary); flex: 1; line-height: 1.3; }
  .a11y-toggle.active .a11y-toggle-label { color: var(--cyan); }
  .a11y-check {
    width: 16px; height: 16px;
    border-radius: 4px;
    border: 1.5px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    font-size: 10px;
    transition: all 0.2s;
  }
  .a11y-toggle.active .a11y-check {
    background: var(--cyan);
    border-color: var(--cyan);
    color: #000;
  }

  /* TOP BAR */
  .top-bar {
    position: absolute;
    top: 16px;
    left: 376px;
    right: 16px;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 10px;
    pointer-events: none;
    transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .top-bar.sidebar-closed { left: 16px; }

  .top-bar > * { pointer-events: all; }

  .top-pill {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 50px;
    backdrop-filter: blur(20px);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    height: 44px;
  }

  .map-type-selector {
    display: flex;
    gap: 4px;
  }

  .map-type-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 50px;
    padding: 5px 12px;
    color: var(--text-secondary);
    font-family: var(--font-body);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .map-type-btn:hover { color: var(--text-primary); }
  .map-type-btn.active {
    background: var(--cyan-dim);
    border-color: var(--cyan);
    color: var(--cyan);
  }

  .divider-v {
    width: 1px;
    height: 20px;
    background: var(--border);
  }

  /* STATUS TOAST */
  .status-toast {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    z-index: 60;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    backdrop-filter: blur(20px);
    border-radius: 50px;
    padding: 10px 20px;
    font-size: 13px;
    font-weight: 500;
    color: var(--cyan);
    white-space: nowrap;
    opacity: 0;
    transition: all 0.3s;
    pointer-events: none;
    max-width: calc(100vw - 80px);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status-toast.visible {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  /* MAP CONTROLS */
  .map-controls {
    position: absolute;
    right: 16px;
    top: 72px;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ctrl-btn {
    width: 40px; height: 40px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    backdrop-filter: blur(20px);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 18px;
    font-weight: 300;
    transition: all 0.2s;
  }
  .ctrl-btn:hover {
    border-color: var(--border-hover);
    color: var(--cyan);
    background: var(--cyan-dim);
  }

  .zoom-level {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-align: center;
    letter-spacing: 0.5px;
    backdrop-filter: blur(20px);
  }

  /* SIDEBAR TOGGLE (when closed) */
  .sidebar-toggle-btn {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    backdrop-filter: blur(20px);
    padding: 10px 16px;
    color: var(--text-primary);
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 44px;
  }
  .sidebar-toggle-btn:hover {
    border-color: var(--border-hover);
    background: var(--cyan-dim);
    color: var(--cyan);
  }

  /* SETTINGS MODAL */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.75);
    backdrop-filter: blur(8px);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal {
    background: #0a1222;
    border: 1px solid var(--border);
    border-radius: 20px;
    width: 100%;
    max-width: 560px;
    max-height: 85vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 80px rgba(0,0,0,0.8);
  }

  .modal-header {
    padding: 24px 28px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }

  .modal-title {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 800;
    color: var(--text-primary);
  }
  .modal-sub {
    font-size: 13px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .modal-close {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    color: var(--text-secondary);
    transition: all 0.2s;
    font-size: 16px;
    flex-shrink: 0;
  }
  .modal-close:hover { border-color: var(--red); color: var(--red); background: var(--red-dim); }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 28px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .modal-section-title {
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 12px;
  }

  .modal-map-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .modal-map-opt {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 8px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    text-align: center;
  }
  .modal-map-opt:hover { border-color: var(--border-hover); }
  .modal-map-opt.active { border-color: var(--cyan); background: var(--cyan-dim); }
  .modal-map-opt .opt-icon { font-size: 22px; }
  .modal-map-opt .opt-name { font-size: 11px; font-weight: 600; color: var(--text-secondary); }
  .modal-map-opt.active .opt-name { color: var(--cyan); }

  .modal-footer {
    padding: 16px 28px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-shrink: 0;
  }

  .btn-ghost {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 9px 18px;
    color: var(--text-secondary);
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-ghost:hover { border-color: var(--border-hover); color: var(--text-primary); }

  .btn-primary {
    background: linear-gradient(135deg, #0093ff, #00d4ff);
    border: none;
    border-radius: 10px;
    padding: 9px 22px;
    color: #000;
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 4px 16px rgba(0, 148, 255, 0.3);
  }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 22px rgba(0, 148, 255, 0.45); }

  /* SETTINGS GEAR BTN */
  .settings-fab {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    backdrop-filter: blur(20px);
    width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    color: var(--text-secondary);
    transition: all 0.2s;
    font-size: 16px;
    flex-shrink: 0;
  }
  .settings-fab:hover { border-color: var(--border-hover); color: var(--cyan); background: var(--cyan-dim); }

  /* ROUTE INFO BANNER */
  .route-info-bar {
    position: absolute;
    bottom: 24px;
    right: 16px;
    z-index: 40;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    backdrop-filter: blur(20px);
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 16px;
    animation: slideUp 0.3s ease;
  }

  @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

  .route-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .route-stat-val {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 700;
    color: var(--cyan);
  }
  .route-stat-label {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }
  .route-stat-divider { width: 1px; height: 28px; background: var(--border); }

  /* AUTOCOMPLETE DROPDOWN */
  .autocomplete-wrap {
    position: relative;
  }

  .autocomplete-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0; right: 0;
    background: #0a1628;
    border: 1px solid var(--border-hover);
    border-radius: 14px;
    overflow: hidden;
    z-index: 200;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(0, 212, 255, 0.08);
    animation: dropIn 0.15s ease;
  }

  @keyframes dropIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .autocomplete-header {
    padding: 8px 14px 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .autocomplete-searching {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .mini-spinner {
    width: 12px; height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--cyan);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    flex-shrink: 0;
  }

  .suggestion-item {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 10px 14px;
    cursor: pointer;
    transition: background 0.12s;
    border: none;
    width: 100%;
    text-align: left;
    background: transparent;
    color: var(--text-primary);
  }
  .suggestion-item:hover, .suggestion-item.highlighted {
    background: var(--cyan-dim);
  }
  .suggestion-item:not(:last-child) {
    border-bottom: 1px solid rgba(0, 212, 255, 0.05);
  }

  .suggestion-icon {
    font-size: 16px;
    width: 28px; height: 28px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }

  .suggestion-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .suggestion-address {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }

  .suggestion-category {
    margin-left: auto;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--cyan);
    background: var(--cyan-dim);
    border: 1px solid rgba(0,212,255,0.2);
    border-radius: 4px;
    padding: 2px 6px;
    flex-shrink: 0;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* LEAFLET OVERRIDES */
  .leaflet-container { background: #060d1a !important; }
  .leaflet-tile-pane { filter: saturate(0.8) brightness(0.9); }
  .leaflet-popup-content-wrapper {
    background: var(--bg-panel) !important;
    backdrop-filter: blur(20px);
    border: 1px solid var(--border) !important;
    border-radius: 12px !important;
    color: var(--text-primary) !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
  }
  .leaflet-popup-tip { background: rgba(10, 18, 35, 0.92) !important; }

  /* SR-only */
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }

  /* SCROLLBAR */
  .sidebar-body::-webkit-scrollbar, .modal-body::-webkit-scrollbar { width: 4px; }
  .sidebar-body::-webkit-scrollbar-track, .modal-body::-webkit-scrollbar-track { background: transparent; }
  .sidebar-body::-webkit-scrollbar-thumb, .modal-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
`;

const presetDestinations = [
  { name: "University of Pittsburgh", type: "Education", icon: "🎓", badge: "bg-blue" },
  { name: "Carnegie Museum", type: "Museum & Culture", icon: "🏛️", badge: "bg-purple" },
  { name: "Accessible Transit Center", type: "Transport Hub", icon: "🚌", badge: "bg-green" },
  { name: "City Hospital", type: "Medical Center", icon: "🏥", badge: "bg-red" },
];

const a11yFeatures = [
  { key: "visionImpaired", icon: "👁️", label: "Vision Mode" },
  { key: "hearingImpaired", icon: "👂", label: "Hearing Mode" },
  { key: "highContrast", icon: "◑", label: "High Contrast" },
  { key: "largeText", icon: "🔍", label: "Large Text" },
  { key: "reducedMotion", icon: "⏸", label: "Reduce Motion" },
  { key: "lowEnergy", icon: "⚡", label: "Low Energy" },
];

export default function AccessibleMap() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [mapType, setMapType] = useState("openstreetmap");
  const [routeFrom, setRouteFrom] = useState("Current Location");
  const [routeTo, setRouteTo] = useState("");
  const [accessibilitySettings, setAccessibilitySettings] = useState({
    visionImpaired: false, hearingImpaired: false, lowEnergy: false,
    highContrast: false, largeText: false, screenReader: false, reducedMotion: false,
  });
  const [zoom, setZoom] = useState(13);
  const [currentLocation, setCurrentLocation] = useState([40.472, -79.94]);
  const [activeTransport, setActiveTransport] = useState("wheelchair");
  const [announcement, setAnnouncement] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [routePath, setRoutePath] = useState([]);
  const [destination, setDestination] = useState(null);
  const [hazards, setHazards] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);

  const modalRef = useRef(null);
  const announcementRef = useRef(null);
  const debounceRef = useRef(null);
  const destInputRef = useRef(null);
  const suggestionsRef = useRef(null);

  const announce = (msg) => {
    setAnnouncement(msg);
    setTimeout(() => setAnnouncement(""), 3500);
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        setIsSettingsOpen(false);
      }
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target) && e.target !== destInputRef.current) {
        setIsSuggestionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isSettingsOpen]);

  const searchPlaces = (query) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.length < 2) { setSuggestions([]); setIsSuggestionsOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const [lat, lng] = currentLocation;
        const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?key=${TOMTOM_API_KEY}&limit=6&lat=${lat}&lon=${lng}&radius=50000&language=en-US`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results) {
          const mapped = data.results.map((r) => ({
            id: r.id,
            name: r.poi?.name || r.address?.freeformAddress,
            address: r.address?.freeformAddress,
            type: r.type,
            category: r.poi?.categories?.[0] || null,
            lat: r.position?.lat,
            lng: r.position?.lon,
          })).filter((r) => r.name);
          setSuggestions(mapped);
          setIsSuggestionsOpen(mapped.length > 0);
          setActiveSuggestion(-1);
        }
      } catch { /* silently fail */ }
      finally { setSuggestionsLoading(false); }
    }, 280);
  };

  const selectSuggestion = (s) => {
    setRouteTo(s.address || s.name);
    setSuggestions([]);
    setIsSuggestionsOpen(false);
    setActiveSuggestion(-1);
    destInputRef.current?.blur();
    announce(`Destination set to ${s.name}`);
  };

  const handleDestKeyDown = (e) => {
    if (!isSuggestionsOpen) {
      if (e.key === "Enter") calculateRoute();
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveSuggestion((p) => Math.min(p + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveSuggestion((p) => Math.max(p - 1, -1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (activeSuggestion >= 0) selectSuggestion(suggestions[activeSuggestion]); else calculateRoute(); }
    else if (e.key === "Escape") { setIsSuggestionsOpen(false); setActiveSuggestion(-1); }
  };

  const getCategoryIcon = (cat) => {
    if (!cat) return "📍";
    const c = cat.toLowerCase();
    if (c.includes("hospital") || c.includes("medical") || c.includes("health")) return "🏥";
    if (c.includes("school") || c.includes("university") || c.includes("college")) return "🎓";
    if (c.includes("restaurant") || c.includes("food") || c.includes("cafe")) return "🍽️";
    if (c.includes("park") || c.includes("garden")) return "🌳";
    if (c.includes("transit") || c.includes("bus") || c.includes("train") || c.includes("station")) return "🚌";
    if (c.includes("museum") || c.includes("gallery")) return "🏛️";
    if (c.includes("shop") || c.includes("store") || c.includes("mall")) return "🛍️";
    if (c.includes("hotel") || c.includes("lodging")) return "🏨";
    if (c.includes("pharmacy") || c.includes("drug")) return "💊";
    return "📍";
  };

  const calculateRoute = async () => {
    if (!routeTo.trim()) { announce("Please enter a destination"); return; }
    setIsLoading(true);
    announce("Calculating your safe, accessible route…");
    try {
      const response = await fetch("http://localhost:5000/api/calculate-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_location: routeFrom,
          end_location: routeTo,
          accessibility_preferences: {
            elevator_access: true,
            wheelchair: activeTransport === "wheelchair",
            wellLitAreas: accessibilitySettings.visionImpaired,
            avoidStairs: true,
          },
        }),
      });
      if (!response.ok) throw new Error("Failed");
      const data = await response.json();
      if (data.success && data.route?.coordinates?.length >= 2) {
        const coords = data.route.coordinates.map((c) => [c.lat, c.lng]);
        setRoutePath(coords);
        setDestination(coords[coords.length - 1]);
        setRouteInfo({ distance: data.route.distance, duration: data.route.duration });
        announce(`Route found! ${data.route.distance} · ${data.route.duration}`);
      } else {
        announce("Couldn't calculate route. Try a different destination.");
      }
    } catch {
      announce("Connection error. Is the server running?");
    } finally {
      setIsLoading(false);
    }
  };

  const getLocation = () => {
    if (!navigator.geolocation) return;
    announce("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentLocation([pos.coords.latitude, pos.coords.longitude]);
        setRouteFrom("Current Location");
        announce("Location updated ✓");
      },
      () => announce("Couldn't get location. Using default.")
    );
  };

  const toggleA11y = (key) => {
    setAccessibilitySettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const hc = accessibilitySettings.highContrast;
  const lt = accessibilitySettings.largeText;

  return (
    <>
      <style>{styles}</style>
      <div
        className={`app-root relative w-full h-screen overflow-hidden${hc ? " hc" : ""}`}
        style={{ fontSize: lt ? "1.05rem" : "1rem" }}
        role="application"
        aria-label="AccessRoute — Accessible Navigation App"
      >
        {/* SR announcements */}
        <div ref={announcementRef} aria-live="assertive" aria-atomic="true" className="sr-only" role="status">
          {announcement}
        </div>

        {/* MAP */}
        <div className="absolute inset-0" style={{ zIndex: 0 }}>
          <MapContainer
            center={currentLocation}
            zoom={zoom}
            className="w-full h-full"
            style={{ filter: hc ? "contrast(1.5)" : "none" }}
            aria-label="Interactive accessible route map"
          >
            <ChangeView center={currentLocation} zoom={zoom} />
            <TileLayer attribution={mapTypes[mapType].attribution} url={mapTypes[mapType].url} />

            <CircleMarker
              center={currentLocation}
              radius={12}
              pathOptions={{ color: "#00d4ff", fillColor: "#00d4ff", fillOpacity: 0.35, weight: 2 }}
            >
              <Popup><div style={{ fontFamily: "DM Sans, sans-serif", padding: "4px" }}><strong>You are here</strong><br /><span style={{ color: "#7a9cc0", fontSize: "12px" }}>Current location</span></div></Popup>
            </CircleMarker>

            {destination && (
              <Marker position={destination} icon={destinationIcon}>
                <Popup><div style={{ fontFamily: "DM Sans, sans-serif", padding: "4px" }}><strong>Destination</strong><br /><span style={{ color: "#7a9cc0", fontSize: "12px" }}>{routeTo}</span></div></Popup>
              </Marker>
            )}

            {routePath.length >= 2 && (
              <Polyline
                positions={routePath}
                pathOptions={{
                  color: activeTransport === "wheelchair" ? "#00d4ff" : "#00e676",
                  weight: 5,
                  opacity: 0.9,
                  dashArray: activeTransport === "wheelchair" ? "12, 8" : undefined,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            )}

            {hazards.map((h, i) => (
              <Marker key={i} position={h.position} icon={hazardIcon}>
                <Popup><div style={{ fontFamily: "DM Sans, sans-serif", padding: "4px" }}><strong style={{ color: "#ffc107" }}>⚠ {h.type}</strong><br /><span style={{ fontSize: "12px" }}>{h.description}</span></div></Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* SIDEBAR */}
        <aside
          className={`sidebar${isSidebarOpen ? "" : " collapsed"}`}
          role="complementary"
          aria-label="Route planner"
        >
          {/* Header */}
          <div className="sidebar-header">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div className="logo">
                <div className="logo-icon">♿</div>
                <div>
                  <div>AccessRoute</div>
                  <div className="logo-sub">Safe · Accessible Navigation</div>
                </div>
              </div>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="modal-close"
                aria-label="Close sidebar"
                style={{ width: "30px", height: "30px" }}
              >✕</button>
            </div>
          </div>

          {/* Body */}
          <div className="sidebar-body">

            {/* Route Inputs */}
            <div>
              <div className="section-label">Your Route</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div className="route-input-wrap">
                  <span className="input-dot dot-green" aria-hidden="true" />
                  <input
                    type="text"
                    value={routeFrom}
                    onChange={(e) => setRouteFrom(e.target.value)}
                    className="route-input"
                    placeholder="Starting point"
                    aria-label="Starting location"
                  />
                  <button className="input-action-btn" onClick={getLocation} aria-label="Use GPS location">
                    📍
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "center", paddingLeft: "20px", gap: "8px" }}>
                  <div style={{ width: "1px", height: "16px", background: "linear-gradient(to bottom, #00e676, #ff5252)", opacity: 0.5 }} />
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>to</span>
                </div>

                <div className="autocomplete-wrap" role="combobox" aria-expanded={isSuggestionsOpen} aria-haspopup="listbox">
                  <div className="route-input-wrap">
                    <span className="input-dot dot-red" aria-hidden="true" />
                    <input
                      ref={destInputRef}
                      type="text"
                      value={routeTo}
                      onChange={(e) => { setRouteTo(e.target.value); searchPlaces(e.target.value); }}
                      className="route-input"
                      placeholder="Address, place or business…"
                      aria-label="Destination"
                      aria-autocomplete="list"
                      aria-controls="dest-suggestions"
                      aria-activedescendant={activeSuggestion >= 0 ? `suggestion-${activeSuggestion}` : undefined}
                      onKeyDown={handleDestKeyDown}
                      onFocus={() => suggestions.length > 0 && setIsSuggestionsOpen(true)}
                      autoComplete="off"
                    />
                    {(suggestionsLoading) && (
                      <div style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)" }}>
                        <div className="mini-spinner" aria-hidden="true" />
                      </div>
                    )}
                    {routeTo && !suggestionsLoading && (
                      <button
                        style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "6px", width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)", fontSize: "12px" }}
                        onClick={() => { setRouteTo(""); setSuggestions([]); setIsSuggestionsOpen(false); destInputRef.current?.focus(); }}
                        aria-label="Clear destination"
                        tabIndex={-1}
                      >✕</button>
                    )}
                  </div>

                  {isSuggestionsOpen && (
                    <div ref={suggestionsRef} className="autocomplete-dropdown" id="dest-suggestions" role="listbox" aria-label="Location suggestions">
                      <div className="autocomplete-header">
                        <span>📍</span> Suggestions
                      </div>
                      {suggestionsLoading && suggestions.length === 0 ? (
                        <div className="autocomplete-searching">
                          <div className="mini-spinner" aria-hidden="true" />
                          Searching…
                        </div>
                      ) : suggestions.map((s, i) => (
                        <button
                          key={s.id || i}
                          id={`suggestion-${i}`}
                          className={`suggestion-item${activeSuggestion === i ? " highlighted" : ""}`}
                          role="option"
                          aria-selected={activeSuggestion === i}
                          onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                          onMouseEnter={() => setActiveSuggestion(i)}
                        >
                          <div className="suggestion-icon" aria-hidden="true">{getCategoryIcon(s.category)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="suggestion-name">{s.name}</div>
                            {s.address && s.address !== s.name && (
                              <div className="suggestion-address">{s.address}</div>
                            )}
                          </div>
                          {s.category && (
                            <div className="suggestion-category">{s.category.split(" ")[0]}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Transport Mode */}
            <div>
              <div className="section-label">Travel Mode</div>
              <div className="transport-tabs" role="radiogroup" aria-label="Travel mode">
                {[
                  { mode: "walk", icon: "🚶", label: "Walk" },
                  { mode: "transit", icon: "🚌", label: "Transit" },
                  { mode: "wheelchair", icon: "♿", label: "Accessible" },
                ].map((t) => (
                  <button
                    key={t.mode}
                    className={`transport-tab${activeTransport === t.mode ? " active" : ""}`}
                    onClick={() => {
                      setActiveTransport(t.mode);
                      setRoutePath([]); setDestination(null); setRouteInfo(null);
                      announce(`${t.label} mode selected`);
                    }}
                    aria-pressed={activeTransport === t.mode}
                    aria-label={`${t.label} mode`}
                  >
                    <span className="tab-icon">{t.icon}</span>
                    <span className="tab-label">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Calculate */}
            <button
              className="calc-btn"
              onClick={calculateRoute}
              disabled={!routeTo.trim() || isLoading}
              aria-label="Calculate accessible route"
            >
              {isLoading ? (
                <><div className="spinner" aria-hidden="true" /> Calculating…</>
              ) : (
                <><span>🔍</span> Find Safe Route</>
              )}
            </button>

            {/* Accessibility Quick Toggles */}
            <div>
              <div className="section-label">Accessibility</div>
              <div className="a11y-grid">
                {a11yFeatures.map((f) => (
                  <button
                    key={f.key}
                    className={`a11y-toggle${accessibilitySettings[f.key] ? " active" : ""}`}
                    onClick={() => toggleA11y(f.key)}
                    aria-pressed={accessibilitySettings[f.key]}
                    aria-label={f.label}
                  >
                    <span className="a11y-toggle-icon">{f.icon}</span>
                    <span className="a11y-toggle-label">{f.label}</span>
                    <span className="a11y-check" aria-hidden="true">
                      {accessibilitySettings[f.key] ? "✓" : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Preset Destinations */}
            <div>
              <div className="section-label">Accessible Locations Nearby</div>
              <div className="preset-list">
                {presetDestinations.map((d) => (
                  <button
                    key={d.name}
                    className="preset-item"
                    onClick={() => { setRouteTo(d.name); announce(`Destination: ${d.name}`); }}
                    aria-label={`Set destination to ${d.name}, ${d.type}`}
                  >
                    <div className="preset-badge" style={{ background: "var(--cyan-dim)", border: "1px solid var(--border)" }}>
                      {d.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="preset-name">{d.name}</div>
                      <div className="preset-type">
                        <span style={{ color: "var(--green)", marginRight: "4px" }}>♿</span>
                        {d.type}
                      </div>
                    </div>
                    <span className="preset-arrow">›</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div>
              <div className="section-label">Map Legend</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                {[
                  { color: "#00d4ff", label: "Accessible Route", dash: true },
                  { color: "#00e676", label: "Walking Route", dash: false },
                  { color: "#ffc107", label: "Hazard / Construction", dot: true },
                  { color: "#ff5252", label: "Avoid Zone", dot: true },
                ].map((item) => (
                  <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {item.dot ? (
                      <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: item.color, flexShrink: 0, boxShadow: `0 0 6px ${item.color}` }} />
                    ) : (
                      <div style={{ width: "28px", height: "3px", background: item.dash ? `repeating-linear-gradient(90deg, ${item.color} 0, ${item.color} 6px, transparent 6px, transparent 10px)` : item.color, flexShrink: 0, borderRadius: "2px" }} />
                    )}
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </aside>

        {/* TOP BAR */}
        <div className={`top-bar${isSidebarOpen ? "" : " sidebar-closed"}`}>
          {!isSidebarOpen && (
            <button
              className="sidebar-toggle-btn"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open route planner"
            >
              ♿ Route Planner
            </button>
          )}

          <div className="top-pill">
            <div className="map-type-selector" role="radiogroup" aria-label="Map style">
              {Object.entries(mapTypes).map(([key, cfg]) => (
                <button
                  key={key}
                  className={`map-type-btn${mapType === key ? " active" : ""}`}
                  onClick={() => { setMapType(key); announce(`${cfg.name} map`); }}
                  aria-pressed={mapType === key}
                >
                  <span>{cfg.icon}</span> {cfg.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginLeft: "auto" }}>
            <button
              className="settings-fab"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Open accessibility settings"
            >
              ⚙
            </button>
          </div>
        </div>

        {/* MAP CONTROLS */}
        <div className="map-controls">
          <button
            className="ctrl-btn"
            onClick={() => setZoom((z) => { const n = Math.min(z + 1, 18); announce(`Zoom ${n}`); return n; })}
            aria-label="Zoom in"
          >+</button>
          <button
            className="ctrl-btn"
            onClick={() => setZoom((z) => { const n = Math.max(z - 1, 10); announce(`Zoom ${n}`); return n; })}
            aria-label="Zoom out"
          >−</button>
          <button
            className="ctrl-btn"
            onClick={getLocation}
            aria-label="Center on my location"
            style={{ fontSize: "14px" }}
          >⊙</button>
          <div className="zoom-level">{zoom}x</div>
        </div>

        {/* STATUS TOAST */}
        <div
          className={`status-toast${announcement ? " visible" : ""}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </div>

        {/* ROUTE INFO BAR */}
        {routeInfo && (
          <div className="route-info-bar" role="region" aria-label="Route information">
            <div className="route-stat">
              <div className="route-stat-val">{routeInfo.distance}</div>
              <div className="route-stat-label">Distance</div>
            </div>
            <div className="route-stat-divider" />
            <div className="route-stat">
              <div className="route-stat-val">{routeInfo.duration}</div>
              <div className="route-stat-label">Est. Time</div>
            </div>
            <div className="route-stat-divider" />
            <div className="route-stat">
              <div className="route-stat-val" style={{ color: "#00e676" }}>♿</div>
              <div className="route-stat-label">Accessible</div>
            </div>
            <button
              style={{ background: "var(--red-dim)", border: "1px solid rgba(255,82,82,0.25)", borderRadius: "8px", padding: "6px 10px", color: "#ff5252", fontSize: "11px", fontWeight: "600", cursor: "pointer", marginLeft: "4px" }}
              onClick={() => { setRoutePath([]); setDestination(null); setRouteInfo(null); }}
              aria-label="Clear route"
            >Clear</button>
          </div>
        )}

        {/* SETTINGS MODAL */}
        {isSettingsOpen && (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div ref={modalRef} className="modal">
              <div className="modal-header">
                <div>
                  <div className="modal-title" id="settings-title">⚙ Accessibility Center</div>
                  <div className="modal-sub">Customize your navigation experience</div>
                </div>
                <button className="modal-close" onClick={() => setIsSettingsOpen(false)} aria-label="Close settings">✕</button>
              </div>

              <div className="modal-body">
                <div>
                  <div className="modal-section-title">Map Style</div>
                  <div className="modal-map-grid">
                    {Object.entries(mapTypes).map(([key, cfg]) => (
                      <button
                        key={key}
                        className={`modal-map-opt${mapType === key ? " active" : ""}`}
                        onClick={() => { setMapType(key); announce(`${cfg.name} map selected`); }}
                        aria-pressed={mapType === key}
                      >
                        <span className="opt-icon">{cfg.icon}</span>
                        <span className="opt-name">{cfg.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="modal-section-title">Accessibility Features</div>
                  <div className="a11y-grid">
                    {a11yFeatures.map((f) => (
                      <button
                        key={f.key}
                        className={`a11y-toggle${accessibilitySettings[f.key] ? " active" : ""}`}
                        onClick={() => toggleA11y(f.key)}
                        aria-pressed={accessibilitySettings[f.key]}
                      >
                        <span className="a11y-toggle-icon">{f.icon}</span>
                        <span className="a11y-toggle-label">{f.label}</span>
                        <span className="a11y-check" aria-hidden="true">{accessibilitySettings[f.key] ? "✓" : ""}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="modal-section-title">Route Preferences</div>
                  <div className="a11y-grid">
                    {[
                      { key: "avoidStairs", icon: "🪜", label: "Avoid Stairs" },
                      { key: "elevatorAccess", icon: "🛗", label: "Elevator Access" },
                      { key: "avoidHighways", icon: "🛣️", label: "Avoid Highways" },
                      { key: "wellLit", icon: "💡", label: "Well-lit Areas" },
                      { key: "quietRoads", icon: "🤫", label: "Quiet Roads" },
                      { key: "avoidCrowds", icon: "👥", label: "Avoid Crowds" },
                    ].map((f) => (
                      <button
                        key={f.key}
                        className="a11y-toggle"
                        style={{ cursor: "pointer" }}
                        aria-label={f.label}
                      >
                        <span className="a11y-toggle-icon">{f.icon}</span>
                        <span className="a11y-toggle-label">{f.label}</span>
                        <span className="a11y-check" aria-hidden="true"></span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setAccessibilitySettings({ visionImpaired: false, hearingImpaired: false, lowEnergy: false, highContrast: false, largeText: false, screenReader: false, reducedMotion: false });
                    announce("Settings reset to defaults");
                  }}
                >Reset Defaults</button>
                <button
                  className="btn-primary"
                  onClick={() => { setIsSettingsOpen(false); announce("Settings applied"); }}
                >Apply Settings</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}