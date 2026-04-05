// Dashboard.jsx
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  lazy,
  Suspense,
} from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
  CircleMarker,
  Circle,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Bookmark,
  Clock,
  Settings,
  Crosshair,
  Search,
  ChevronDown,
  ChevronUp,
  X,
  Accessibility,
  Bus,
  PersonStanding,
  Layers,
  Plus,
  Minus,
  Eye,
  Ear,
  Contrast,
  ZoomIn,
  Zap,
  Wind,
  MapPin,
  Navigation,
  Navigation2,
  TreePine,
  Building2,
  Stethoscope,
  GraduationCap,
  ShoppingBag,
  Waves,
  Coffee,
  ChevronRight,
  Route,
  LocateFixed,
  Construction,
  TriangleAlert,
  CarFront,
  Siren,
  Flame,
  ShieldAlert,
  Play,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  CornerDownLeft,
  CornerDownRight,
  CircleDot,
  Flag,
  Footprints,
  List,
  Mic,
} from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import VoiceAccessibilityModal from "./VoiceAccessibilityModal";
// Lazy load 3D view to reduce initial bundle size
const Walking3DView = lazy(() => import("./Walking3DView"));

// Add this after your imports, before the component
const throttle = (fn, delay) => {
  let lastCall = 0;
  return (...args) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn(...args);
    }
  };
};

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

// ─── coordinate helpers ───────────────────────────────────────────────────────

function isValidCoordinatePair(lat, lng) {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (isNaN(numLat) || isNaN(numLng)) return false;
  if (!isFinite(numLat) || !isFinite(numLng)) return false;
  if (numLat < -90 || numLat > 90) return false;
  if (numLng < -180 || numLng > 180) return false;
  return true;
}

function isValidLatLngArray(arr) {
  if (!Array.isArray(arr) || arr.length !== 2) return false;
  const [lat, lng] = arr;
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (isNaN(numLat) || isNaN(numLng)) return false;
  if (!isFinite(numLat) || !isFinite(numLng)) return false;
  if (numLat < -90 || numLat > 90) return false;
  if (numLng < -180 || numLng > 180) return false;
  return true;
}

function getValidCoordinates(obj) {
  const lat =
    obj?.lat ?? obj?.latitude ?? obj?.position?.lat ?? obj?.coords?.lat ?? null;
  const lng =
    obj?.lng ??
    obj?.longitude ??
    obj?.lon ??
    obj?.position?.lng ??
    obj?.coords?.lng ??
    null;
  if (isValidCoordinatePair(lat, lng)) {
    return { lat: Number(lat), lng: Number(lng) };
  }
  return null;
}

// ─── icon / styling helpers ───────────────────────────────────────────────────

function makeLucideIcon(IconComponent, color, borderColor, size = 30) {
  const innerSize = Math.max(12, size * 0.55);
  const svg = renderToStaticMarkup(
    <IconComponent size={innerSize} color={color} strokeWidth={2.2} />,
  );
  const html = `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;background:rgba(16,8,3,0.92);border:${Math.max(1, size / 20)}px solid ${borderColor};border-radius:${Math.max(6, size / 4)}px;box-shadow:0 2px 8px rgba(0,0,0,0.45);backdrop-filter:blur(4px);cursor:pointer;">${svg}</div>`;
  return L.divIcon({
    className: "custom-marker-icon",
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

// ─── distance helpers ─────────────────────────────────────────────────────────

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointToSegmentDistanceMeters(point, segStart, segEnd) {
  const [pLng, pLat] = point,
    [s1Lng, s1Lat] = segStart,
    [s2Lng, s2Lat] = segEnd;
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(s1Lat),
    λ1 = toRad(s1Lng),
    φ2 = toRad(s2Lat),
    λ2 = toRad(s2Lng),
    φp = toRad(pLat),
    λp = toRad(pLng);
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  const δ13 = Math.acos(
    clamp(
      Math.sin(φ1) * Math.sin(φp) +
        Math.cos(φ1) * Math.cos(φp) * Math.cos(λp - λ1),
    ),
  );
  const δ23 = Math.acos(
    clamp(
      Math.sin(φ2) * Math.sin(φp) +
        Math.cos(φ2) * Math.cos(φp) * Math.cos(λp - λ2),
    ),
  );
  const δ12 = Math.acos(
    clamp(
      Math.sin(φ1) * Math.sin(φ2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1),
    ),
  );
  if (δ13 > δ12 + 1e-10 && δ23 > δ12 + 1e-10)
    return Math.min(
      haversineDistance(s1Lat, s1Lng, pLat, pLng),
      haversineDistance(s2Lat, s2Lng, pLat, pLng),
    );
  const θ12 = Math.acos(
    clamp(
      (Math.sin(φ2) - Math.sin(φ1) * Math.cos(δ12)) /
        (Math.cos(φ1) * Math.sin(δ12)),
    ),
  );
  const θ13 = Math.acos(
    clamp(
      (Math.sin(φp) - Math.sin(φ1) * Math.cos(δ13)) /
        (Math.cos(φ1) * Math.sin(δ13)),
    ),
  );
  const δxt = Math.asin(clamp(Math.sin(δ13) * Math.sin(θ13 - θ12)));
  const distance = Math.abs(δxt) * 6371000;
  return isNaN(distance)
    ? Math.min(
        haversineDistance(s1Lat, s1Lng, pLat, pLng),
        haversineDistance(s2Lat, s2Lng, pLat, pLng),
      )
    : distance;
}

// ─── directions helpers ───────────────────────────────────────────────────────

/** Pick a turn icon from the instruction text */
function getStepIcon(instruction = "", travelMode = "") {
  const txt = instruction.toLowerCase();
  if (travelMode === "TRANSIT" || travelMode === "BUS") return Bus;
  if (
    txt.includes("board") ||
    txt.includes("take transit") ||
    txt.includes("take bus")
  )
    return Bus;
  if (txt.includes("walk")) return Footprints;
  if (txt.includes("turn left")) return CornerUpLeft;
  if (txt.includes("turn right")) return CornerUpRight;
  if (txt.includes("sharp left")) return CornerDownLeft;
  if (txt.includes("sharp right")) return CornerDownRight;
  if (txt.includes("keep left") || txt.includes("bear left")) return ArrowLeft;
  if (txt.includes("keep right") || txt.includes("bear right"))
    return ArrowRight;
  if (txt.includes("u-turn")) return Navigation2;
  if (txt.includes("arrive") || txt.includes("destination")) return Flag;
  if (txt.includes("depart") || txt.includes("head") || txt.includes("start"))
    return CircleDot;
  return ArrowUp;
}

/** Strip HTML tags from TomTom instruction strings */
function stripHtml(str = "") {
  return str
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Format meters → "0.3 km" or "250 m" */
function fmtDist(meters) {
  if (!meters) return "";
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

// ─── map type config ──────────────────────────────────────────────────────────

const mapTypes = {
  openstreetmap: {
    name: "Street",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
  },
  tomtom: {
    name: "TomTom",
    url: `https://{s}.api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}`,
    attribution: "© TomTom",
  },
  satellite: {
    name: "Satellite",
    url: `https://{s}.api.tomtom.com/map/1/tile/sat/main/{z}/{x}/{y}.jpg?key=${TOMTOM_API_KEY}`,
    attribution: "© TomTom",
  },
};

const ChangeView = React.memo(({ center, zoom, routeBounds }) => {
  const map = useMap();
  useEffect(() => {
    if (routeBounds && routeBounds.length >= 2) {
      map.fitBounds(L.latLngBounds(routeBounds), {
        padding: [80, 80],
        maxZoom: 16,
      });
    } else {
      map.setView(center, zoom);
    }
  }, [center, zoom, map, routeBounds]);
  return null;
});

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --rail-w: 64px; --panel-w: 310px;
    --bg: #110a04; --surface: rgba(28,17,8,0.97); --card: rgba(42,26,12,0.98); --inset: rgba(255,255,255,0.035);
    --border: rgba(180,120,60,0.16); --border2: rgba(200,140,70,0.38);
    --wood: #e8a870; --wood-lt: #ffc89c; --wood-g: linear-gradient(135deg,#c06c30,#e89c60);
    --wood-dim: rgba(232,168,112,0.18); --wood-glow: rgba(232,168,112,0.3);
    --green: #8cd69c; --green-dim: rgba(140,214,156,0.15); --amber: #ffb347;
    --red: #ff7b6b; --red-dim: rgba(255,123,107,0.15);
    --blue: #4fc3f7; --blue-dim: rgba(79,195,247,0.15);
    --txt: #ffffff; --txt2: #e0c8b0; --txt3: #b09878;
    --ff-d: 'Playfair Display',Georgia,serif; --ff-b: 'DM Sans',system-ui,sans-serif;
    --sh: 0 6px 28px rgba(0,0,0,0.55),0 2px 8px rgba(0,0,0,0.3);
    --sh-lg: 0 18px 56px rgba(0,0,0,0.72),0 4px 18px rgba(0,0,0,0.4);
    --sh-w: 0 4px 20px rgba(232,168,112,0.25);
  }
  @keyframes slideDown { from{opacity:0;transform:translateY(-20px)} to{opacity:1;transform:translateY(0)} }
  @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
  @keyframes pulse-overlay { 0%,100%{opacity:0.45} 50%{opacity:0.65} }
  @keyframes dash-flow { to{stroke-dashoffset:-16} }
  .obstruction-overlay { animation: pulse-overlay 2s ease-in-out infinite; }
  .obstruction-border { animation: dash-flow 0.5s linear infinite; stroke-dashoffset:0; }
  .root { font-family:var(--ff-b);background:var(--bg);color:var(--txt);width:100vw;height:100vh;overflow:hidden;position:relative; }
  .map-wrap { position:absolute;inset:0;z-index:0; }
  .leaflet-container { background:#0e0804 !important; }
  .leaflet-tile-pane { filter:saturate(.7) brightness(.82) sepia(.08); }
  .leaflet-popup-content-wrapper { background:var(--card) !important;border:1px solid var(--border2) !important;border-radius:12px !important;color:var(--txt) !important;box-shadow:var(--sh) !important;font-family:var(--ff-b) !important; }
  .leaflet-popup-tip { background:rgba(42,26,12,.98) !important; }
  .leaflet-control-zoom { display:none !important; }
  .leaflet-control-attribution { display:none; }
  .rail { position:absolute;left:0;top:0;bottom:0;width:var(--rail-w);background:var(--surface);border-right:1px solid var(--border);backdrop-filter:blur(28px);z-index:60;display:flex;flex-direction:column;align-items:center;padding:14px 0 18px;gap:3px; }
  .r-logo { width:38px;height:38px;background:var(--wood-g);border-radius:11px;display:flex;align-items:center;justify-content:center;margin-bottom:14px;flex-shrink:0;box-shadow:var(--sh-w),0 0 16px var(--wood-glow);color:#fff8f0; }
  .r-btn { width:44px;height:44px;border-radius:11px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;background:transparent;border:1px solid transparent;cursor:pointer;color:var(--txt3);transition:all .18s;position:relative; }
  .r-btn:hover { background:var(--wood-dim);border-color:var(--border);color:var(--txt2); }
  .r-btn.on { background:var(--wood-dim);border-color:var(--border2);color:var(--wood); }
  .r-lbl { font-size:9px;font-weight:600;letter-spacing:.3px;color:inherit;font-family:var(--ff-b); }
  .r-sep { width:26px;height:1px;background:var(--border);margin:5px 0;flex-shrink:0; }
  .r-space { flex:1; }
  .r-btn[data-tip]::after { content:attr(data-tip);position:absolute;left:calc(100% + 11px);top:50%;transform:translateY(-50%);background:var(--card);border:1px solid var(--border2);border-radius:8px;padding:5px 12px;font-family:var(--ff-b);font-size:12px;font-weight:500;color:var(--txt);white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s;z-index:999;box-shadow:var(--sh); }
  .r-btn[data-tip]:hover::after { opacity:1; }
  .panel { position:absolute;left:var(--rail-w);top:0;bottom:0;width:var(--panel-w);background:var(--surface);border-right:1px solid var(--border);backdrop-filter:blur(28px);z-index:55;display:flex;flex-direction:column;transform:translateX(-100%);transition:transform .28s cubic-bezier(.4,0,.2,1);box-shadow:var(--sh-lg); }
  .panel.open { transform:translateX(0); }
  .p-head { padding:20px 18px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0; }
  .p-title { font-family:var(--ff-d);font-size:17px;font-weight:700;color:var(--txt);letter-spacing:.2px; }
  .p-close { background:var(--inset);border:1px solid var(--border);border-radius:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--txt2);transition:all .15s; }
  .p-close:hover { color:var(--red);border-color:rgba(255,123,107,.3);background:var(--red-dim); }
  .p-body { flex:1;overflow-y:auto;padding:16px 16px 24px;display:flex;flex-direction:column;gap:22px;scrollbar-width:thin;scrollbar-color:var(--border) transparent; }
  .p-body::-webkit-scrollbar { width:4px; }
  .p-body::-webkit-scrollbar-thumb { background:var(--border);border-radius:2px; }
  .p-sec { font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--txt2);margin-bottom:9px;display:flex;align-items:center;gap:6px; }
  .p-sec::after { content:'';flex:1;height:1px;background:var(--border); }
  .p-item { display:flex;align-items:center;gap:11px;padding:10px 12px;background:var(--inset);border:1px solid var(--border);border-radius:12px;cursor:pointer;transition:all .16s;width:100%;text-align:left; }
  .p-item:hover { background:var(--wood-dim);border-color:var(--border2);transform:translateX(3px); }
  .p-item.sel { border-color:var(--wood);background:var(--wood-dim); }
  .p-ico { width:32px;height:32px;background:rgba(180,120,60,0.1);border:1px solid var(--border);border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--wood); }
  .p-ico.green { color:var(--green);background:var(--green-dim); }
  .p-ico.amber { color:var(--amber);background:rgba(255,179,71,0.1); }
  .p-name { font-size:13px;font-weight:500;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  .p-sub { font-size:11px;color:var(--txt2);margin-top:2px;display:flex;align-items:center;gap:4px; }
  .p-arr { margin-left:auto;color:var(--txt2);flex-shrink:0;transition:all .15s; }
  .p-item:hover .p-arr { color:var(--wood);transform:translateX(2px); }
  .p-empty { text-align:center;color:var(--txt2);font-size:12.5px;line-height:1.7;padding:20px 0; }
  .ag { display:grid;grid-template-columns:1fr 1fr;gap:7px; }
  .ab { background:var(--inset);border:1px solid var(--border);border-radius:10px;padding:10px;display:flex;align-items:center;gap:8px;cursor:pointer;transition:all .16s;width:100%;text-align:left; }
  .ab:hover { border-color:var(--border2); }
  .ab.on { border-color:var(--wood);background:var(--wood-dim); }
  .ab-i { color:var(--txt2);flex-shrink:0;transition:color .15s; }
  .ab.on .ab-i { color:var(--wood); }
  .ab-l { font-size:11px;font-weight:500;color:var(--txt2);flex:1;line-height:1.3; }
  .ab.on .ab-l { color:var(--txt); }
  .ab-c { width:15px;height:15px;border-radius:4px;border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;color:transparent; }
  .ab.on .ab-c { background:var(--wood);border-color:var(--wood);color:#1a0c04; }
  .sc { position:absolute;top:14px;left:calc(var(--rail-w) + 14px);z-index:50;width:348px;background:var(--surface);border:1px solid var(--border);border-radius:20px;backdrop-filter:blur(32px);box-shadow:var(--sh-lg),var(--sh-w);transition:border-color .2s; }
  .sc:focus-within { border-color:var(--border2); }
  .sc-head { padding:14px 16px 6px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border); }
  .sc-brand { font-family:var(--ff-d);font-size:15px;font-weight:700;color:var(--txt);letter-spacing:.2px;flex:1; }
  .sc-brand span { color:var(--wood); }
  .sc-inputs { padding:12px 14px 8px;display:flex;flex-direction:column;gap:6px; }
  .rr { position:relative; }
  .rr-dot { position:absolute;left:13px;top:50%;transform:translateY(-50%);width:8px;height:8px;border-radius:50%;pointer-events:none;z-index:1; }
  .rr-dot-g { background:var(--green);box-shadow:0 0 6px var(--green);animation:blk 2.4s ease infinite; }
  .rr-dot-r { background:var(--red);box-shadow:0 0 6px var(--red); }
  @keyframes blk { 0%,100%{opacity:1;transform:translateY(-50%) scale(1)} 50%{opacity:.55;transform:translateY(-50%) scale(1.4)} }
  .ri { width:100%;background:var(--inset);border:1px solid var(--border);border-radius:10px;padding:10px 34px 10px 28px;color:var(--txt);font-family:var(--ff-b);font-size:13.5px;outline:none;transition:border-color .18s,box-shadow .18s,background .18s; }
  .ri::placeholder { color:var(--txt2); }
  .ri:focus { border-color:var(--wood);background:rgba(232,168,112,.06);box-shadow:0 0 0 3px var(--wood-dim); }
  .ri-btn { position:absolute;right:7px;top:50%;transform:translateY(-50%);background:var(--inset);border:1px solid var(--border);border-radius:7px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--txt2);transition:all .15s; }
  .ri-btn:hover { background:var(--wood-dim);border-color:var(--border2);color:var(--wood); }
  .ri-conn { display:flex;align-items:center;gap:8px;padding:0 12px;pointer-events:none; }
  .ri-conn-line { width:1px;height:12px;flex-shrink:0;background:linear-gradient(to bottom,var(--green),var(--red));opacity:.3; }
  .ri-conn-lbl { font-size:11px;color:var(--txt2); }
  .ac { position:relative; }
  .ac-drop { position:absolute;top:calc(100% + 6px);left:0;right:0;background:var(--card);border:1px solid var(--border2);border-radius:14px;overflow:hidden;z-index:300;box-shadow:var(--sh-lg);animation:fd .14s ease; }
  @keyframes fd { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:translateY(0)} }
  .ac-hd { padding:8px 13px 6px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--txt2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px; }
  .ac-row { display:flex;align-items:center;gap:10px;padding:9px 13px;background:transparent;border:none;width:100%;text-align:left;cursor:pointer;transition:background .12s;color:var(--txt); }
  .ac-row:hover,.ac-row.hi { background:var(--wood-dim); }
  .ac-row + .ac-row { border-top:1px solid rgba(232,168,112,.1); }
  .ac-ico { width:28px;height:28px;background:var(--inset);border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--wood); }
  .ac-name { font-size:13px;font-weight:500;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  .ac-addr { font-size:11px;color:var(--txt2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px; }
  .ac-tag { margin-left:auto;font-size:10px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--txt);background:var(--wood-dim);border:1px solid rgba(232,168,112,.3);border-radius:4px;padding:2px 7px;white-space:nowrap;flex-shrink:0;max-width:72px;overflow:hidden;text-overflow:ellipsis; }
  .ac-wait { display:flex;align-items:center;gap:8px;padding:14px;font-size:12px;color:var(--txt2); }
  @keyframes spin { to{transform:rotate(360deg)} }
  .spn { width:12px;height:12px;border:2px solid var(--border);border-top-color:var(--wood);border-radius:50%;animation:spin .6s linear infinite;flex-shrink:0; }
  .spn2 { width:14px;height:14px;border:2px solid rgba(255,255,255,.15);border-top-color:var(--wood);border-radius:50%;animation:spin .65s linear infinite; }
  .sc-modes { display:flex;gap:6px;padding:2px 14px 4px; }
  .mp { flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:9px 4px;background:var(--inset);border:1px solid var(--border);border-radius:11px;cursor:pointer;transition:all .17s;color:var(--txt2);font-family:var(--ff-b); }
  .mp:hover { border-color:var(--border2);color:var(--txt);background:var(--wood-dim); }
  .mp.on { border-color:var(--wood);background:var(--wood-dim);color:var(--wood);box-shadow:0 0 12px var(--wood-glow); }
  .mp-i { flex-shrink:0; }
  .mp-l { font-size:10px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:inherit; }
  .sc-find { margin:6px 14px 12px;width:calc(100% - 28px);padding:13px;background:var(--wood-g);border:none;border-radius:13px;color:#fff;font-family:var(--ff-d);font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s;box-shadow:var(--sh-w);letter-spacing:.2px; }
  .sc-find:hover:not(:disabled) { transform:translateY(-1px);box-shadow:0 8px 28px rgba(232,168,112,.5);filter:brightness(1.1); }
  .sc-find:disabled { background:var(--inset);color:var(--txt2);box-shadow:none;cursor:not-allowed;filter:none; }
  .sc-leg-btn { display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-top:1px solid var(--border);background:transparent;border-left:none;border-right:none;border-bottom:none;width:100%;cursor:pointer;color:var(--txt2);font-family:var(--ff-b);transition:color .15s; }
  .sc-leg-btn:hover { color:var(--txt); }
  .sc-leg-lbl { font-size:10.5px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:inherit; }
  .leg-chv { transition:transform .2s; }
  .leg-chv.open { transform:rotate(180deg); }
  .sc-leg-body { padding:4px 14px 14px;display:flex;flex-direction:column;gap:8px; }
  .leg-row { display:flex;align-items:center;gap:10px; }
  .leg-lbl { font-size:12px;color:var(--txt2); }
  .rbar { position:absolute;bottom:22px;left:calc(var(--rail-w) + 14px);z-index:50;background:var(--surface);border:1px solid var(--border2);border-radius:16px;backdrop-filter:blur(24px);padding:13px 18px;display:flex;align-items:center;gap:14px;box-shadow:var(--sh),var(--sh-w);animation:su .24s ease; }
  @keyframes su { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  .rs { display:flex;flex-direction:column;align-items:center;gap:2px; }
  .rs-v { font-family:var(--ff-d);font-size:15px;font-weight:700;color:var(--wood); }
  .rs-l { font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--txt2); }
  .rs-d { width:1px;height:24px;background:var(--border); }
  .rs-cl { background:var(--red-dim);border:1px solid rgba(255,123,107,.3);border-radius:8px;padding:5px 10px;color:var(--red);font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;margin-left:4px; }
  .rs-cl:hover { background:rgba(255,123,107,.25);color:#ff9b8b; }
  .rs-bus { background:var(--wood-dim);border:1px solid var(--wood);border-radius:8px;padding:5px 10px;color:var(--wood);font-size:11px;font-weight:700;cursor:pointer;transition:all .15s; }
  .rs-dir-btn { background:var(--blue-dim);border:1px solid var(--blue);border-radius:8px;padding:5px 10px;color:var(--blue);font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:5px; }
  .rs-dir-btn:hover { background:rgba(79,195,247,0.25); }
  .rs-dir-btn.on { background:rgba(79,195,247,0.25); }
  .mt-bar { position:absolute;top:16px;right:14px;z-index:50;display:flex;gap:5px; }
  .mt-btn { background:var(--surface);border:1px solid var(--border);border-radius:9px;backdrop-filter:blur(20px);padding:7px 12px;display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--txt2);font-family:var(--ff-b);font-size:12px;font-weight:500;transition:all .15s;white-space:nowrap; }
  .mt-btn:hover { color:var(--txt);border-color:var(--border2); }
  .mt-btn.on { color:var(--wood);border-color:var(--wood);background:var(--wood-dim); }
  .mctrl { position:absolute;right:14px;bottom:80px;z-index:50;display:flex;flex-direction:column;gap:5px; }
  .mc { width:40px;height:40px;background:var(--surface);border:1px solid var(--border);border-radius:10px;backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--txt2);transition:all .15s; }
  .mc:hover { border-color:var(--border2);color:var(--wood);background:var(--wood-dim); }
  .mc-z { font-size:10px;font-weight:700;letter-spacing:.3px;color:var(--txt2);text-align:center;padding:3px 0; }
  .toast { position:absolute;bottom:24px;left:50%;z-index:200;transform:translateX(-50%) translateY(12px);background:var(--surface);border:1px solid var(--border2);border-radius:50px;backdrop-filter:blur(20px);padding:9px 22px;font-size:12.5px;font-weight:500;color:var(--txt);white-space:nowrap;opacity:0;pointer-events:none;transition:all .24s;max-width:calc(100vw - 100px);text-align:center;overflow:hidden;text-overflow:ellipsis;box-shadow:var(--sh); }
  .toast.vis { opacity:1;transform:translateX(-50%) translateY(0); }
  .sr { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0; }
  @keyframes dash-flow-road-top { to{stroke-dashoffset:-36} }
  .obstructed-road-border-top { animation:dash-flow-road-top 0.8s linear infinite;stroke-dashoffset:0;filter:drop-shadow(0 0 2px rgba(255,255,255,0.5)); }

  /* ── Directions Panel ── */
  .dir-panel {
    position: absolute;
    left: calc(var(--rail-w) + 14px);
    bottom: 90px;
    width: 348px;
    max-height: 380px;
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 18px;
    backdrop-filter: blur(28px);
    box-shadow: var(--sh-lg);
    z-index: 48;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: slideUp 0.24s ease;
  }
  .dir-header {
    padding: 12px 16px 10px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .dir-title {
    font-family: var(--ff-d);
    font-size: 14px;
    font-weight: 700;
    color: var(--txt);
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .dir-close {
    background: var(--inset);
    border: 1px solid var(--border);
    border-radius: 7px;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--txt2);
    transition: all .14s;
    flex-shrink: 0;
  }
  .dir-close:hover { color: var(--red); border-color: rgba(255,123,107,.3); background: var(--red-dim); }
  .dir-list {
    overflow-y: auto;
    flex: 1;
    padding: 8px 0;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .dir-list::-webkit-scrollbar { width: 3px; }
  .dir-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  .dir-step {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 14px;
    transition: background .12s;
    cursor: default;
    border-left: 3px solid transparent;
  }
  .dir-step:hover { background: var(--inset); }
  .dir-step.transit-step {
    background: rgba(79,195,247,0.05);
    border-left-color: var(--blue);
  }
  .dir-step.walk-step { border-left-color: var(--green); }
  .dir-step.first-step { border-left-color: var(--green); }
  .dir-step.last-step { border-left-color: var(--red); }
  .dir-step + .dir-step { border-top: 1px solid rgba(255,255,255,0.04); }
  .dir-icon {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .dir-icon.walk-icon { background: var(--green-dim); color: var(--green); }
  .dir-icon.transit-icon { background: var(--blue-dim); color: var(--blue); border: 1px solid rgba(79,195,247,0.3); }
  .dir-icon.turn-icon { background: var(--wood-dim); color: var(--wood); }
  .dir-icon.start-icon { background: rgba(140,214,156,0.2); color: var(--green); }
  .dir-icon.end-icon { background: var(--red-dim); color: var(--red); }
  .dir-content { flex: 1; min-width: 0; }
  .dir-instruction {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--txt);
    line-height: 1.45;
    word-break: break-word;
  }
  .dir-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 3px;
  }
  .dir-dist { font-size: 11px; color: var(--txt3); }
  .dir-dur { font-size: 11px; color: var(--txt3); }
  .transit-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--blue-dim);
    border: 1px solid rgba(79,195,247,0.3);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 10px;
    font-weight: 700;
    color: var(--blue);
    text-transform: uppercase;
    letter-spacing: .4px;
  }
  .walk-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--green-dim);
    border: 1px solid rgba(140,214,156,0.3);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 10px;
    font-weight: 700;
    color: var(--green);
    text-transform: uppercase;
    letter-spacing: .4px;
  }
  .dir-divider {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 14px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .8px;
    text-transform: uppercase;
    color: var(--txt3);
  }
  .dir-divider::before, .dir-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  /* ── 3D View ── */
  .view3d-panel {
    position: absolute;
    bottom: 80px;
    right: 60px;
    width: 520px;
    height: 320px;
    z-index: 45;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: var(--sh-lg);
    border: 1px solid var(--border2);
    transition: all 0.3s cubic-bezier(.4,0,.2,1);
  }
  .view3d-panel.hidden { opacity: 0; pointer-events: none; transform: translateY(20px); }
  .view3d-toggle {
    position: absolute;
    bottom: 80px;
    right: 60px;
    z-index: 50;
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 10px;
    padding: 7px 13px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: var(--wood);
    font-family: var(--ff-b);
    font-size: 12px;
    font-weight: 600;
    transition: all .15s;
    backdrop-filter: blur(20px);
    box-shadow: var(--sh-w);
  }
  .view3d-toggle:hover { background: var(--wood-dim); }

  /* ── New 3D Navigation Panel Styles ── */
  .nav-3d-panel {
    position: fixed;
    z-index: 45;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 18px 56px rgba(0,0,0,0.72), 0 4px 18px rgba(0,0,0,0.4);
    border: 1px solid rgba(232,168,112,0.22);
    transition: all 0.3s cubic-bezier(.4,0,.2,1);
    background: #110a04;
  }
  @media (min-width: 1024px) {
    .nav-3d-panel {
      bottom: 90px;
      right: 60px;
      width: 520px;
      height: 330px;
    }
  }
  @media (min-width: 768px) and (max-width: 1023px) {
    .nav-3d-panel {
      bottom: 0;
      left: 0;
      right: 0;
      height: 280px;
      border-radius: 16px 16px 0 0;
    }
  }
  @media (max-width: 767px) {
    .nav-3d-panel {
      inset: 0;
      border-radius: 0;
      z-index: 100;
    }
  }
  .nav-3d-panel.hidden {
    opacity: 0;
    pointer-events: none;
    transform: translateY(20px);
  }
  .rs-3d-btn {
    background: var(--blue-dim);
    border: 1px solid var(--blue);
    border-radius: 8px;
    padding: 5px 10px;
    color: var(--blue);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all .15s;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .rs-3d-btn:hover { background: rgba(79,195,247,0.25); }
  .rs-3d-btn.on {
    background: var(--wood-g);
    border-color: var(--wood);
    color: #fff;
  }
  @keyframes arrival-pulse {
    0% { transform: scale(0.5); opacity: 1; }
    100% { transform: scale(3); opacity: 0; }
  }
  .arrival-ring {
    position: absolute;
    inset: 0;
    border: 3px solid #14b8a6;
    border-radius: 50%;
    animation: arrival-pulse 1.5s ease-out infinite;
    pointer-events: none;
  }
  @keyframes step-slide-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .hud-instruction-main.new-step {
    animation: step-slide-in 0.25s ease forwards;
  }
`;

// ─── constants ────────────────────────────────────────────────────────────────

const A11Y_FEATS = [
  { key: "visionImpaired", Icon: Eye, label: "Vision Mode" },
  { key: "hearingImpaired", Icon: Ear, label: "Hearing Mode" },
  { key: "highContrast", Icon: Contrast, label: "High Contrast" },
  { key: "largeText", Icon: ZoomIn, label: "Large Text" },
  { key: "reducedMotion", Icon: Wind, label: "Reduce Motion" },
  { key: "lowEnergy", Icon: Zap, label: "Low Energy" },
];

const PREF_FEATS = [
  { k: "avoidStairs", Icon: Route, l: "Avoid Stairs" },
  { k: "elevator", Icon: Building2, l: "Elevator Access" },
  { k: "noHighways", Icon: Layers, l: "No Highways" },
  { k: "wellLit", Icon: Zap, l: "Well-lit Areas" },
  { k: "quietRoads", Icon: Wind, l: "Quiet Roads" },
  { k: "lowCrowds", Icon: PersonStanding, l: "Avoid Crowds" },
];

const SAVED_PLACES = [
  {
    name: "University of Pittsburgh",
    sub: "Education",
    Icon: GraduationCap,
    color: "amber",
  },
  { name: "Carnegie Museum", sub: "Museum", Icon: Building2, color: "" },
  {
    name: "Accessible Transit Hub",
    sub: "Transport",
    Icon: Bus,
    color: "green",
  },
  {
    name: "City Hospital (UPMC)",
    sub: "Medical",
    Icon: Stethoscope,
    color: "",
  },
];

const NEARBY_PITTSBURGH = [
  {
    name: "Allegheny RiverTrail",
    sub: "0.3 mi · Trail & Park",
    Icon: TreePine,
    color: "green",
  },
  {
    name: "Waterworks Mall",
    sub: "0.8 mi · Shopping Center",
    Icon: ShoppingBag,
    color: "",
  },
  {
    name: "UPMC St. Margaret",
    sub: "1.1 mi · Hospital",
    Icon: Stethoscope,
    color: "",
  },
  {
    name: "Pittsburgh Zoo & Aquarium",
    sub: "1.4 mi · Attraction",
    Icon: TreePine,
    color: "green",
  },
  {
    name: "Fox Chapel Area HS",
    sub: "2.0 mi · School",
    Icon: GraduationCap,
    color: "amber",
  },
  {
    name: "Aspinwall Borough Park",
    sub: "0.5 mi · Park",
    Icon: TreePine,
    color: "green",
  },
  {
    name: "Waterworks Cold Stone",
    sub: "0.9 mi · Food & Drink",
    Icon: Coffee,
    color: "amber",
  },
  {
    name: "Blawnox Riverfront",
    sub: "1.2 mi · Scenic Waterfront",
    Icon: Waves,
    color: "green",
  },
];

const MAP_TYPE_ICONS = {
  openstreetmap: Layers,
  tomtom: MapPin,
  satellite: Navigation,
};

function getCatIcon(cat) {
  if (!cat) return MapPin;
  const c = cat.toLowerCase();
  if (c.includes("hospital") || c.includes("medical")) return Stethoscope;
  if (c.includes("school") || c.includes("university")) return GraduationCap;
  if (c.includes("restaurant") || c.includes("food") || c.includes("cafe"))
    return Coffee;
  if (c.includes("park") || c.includes("garden")) return TreePine;
  if (c.includes("transit") || c.includes("bus") || c.includes("station"))
    return Bus;
  if (c.includes("museum") || c.includes("gallery")) return Building2;
  if (c.includes("shop") || c.includes("store") || c.includes("mall"))
    return ShoppingBag;
  return MapPin;
}

function getSegmentColor(s) {
  if (s >= 0.7) return "#8cd69c";
  if (s >= 0.4) return "#ffb347";
  return "#ff7b6b";
}

function getObstructionStyle(type, iconCategory) {
  if (type === "construction" || [7, 8, 9].includes(iconCategory))
    return {
      Icon: Construction,
      color: "#ff7b6b",
      border: "rgba(255,123,107,0.5)",
      label: "Construction Zone",
    };
  if (iconCategory === 1 || type === "accident")
    return {
      Icon: Siren,
      color: "#ff7b6b",
      border: "rgba(255,123,107,0.5)",
      label: "Accident",
    };
  if (iconCategory === 6 || type === "jam")
    return {
      Icon: CarFront,
      color: "#ffb347",
      border: "rgba(255,179,71,0.5)",
      label: "Traffic Jam",
    };
  if (iconCategory === 11 || type === "flooding_risk")
    return {
      Icon: Flame,
      color: "#ffb347",
      border: "rgba(255,179,71,0.5)",
      label: "Flood Risk",
    };
  return {
    Icon: TriangleAlert,
    color: "#ffb347",
    border: "rgba(255,179,71,0.5)",
    label: "Hazard",
  };
}

// ─── map sub-components ───────────────────────────────────────────────────────

const ObstructedRoadSegment = React.memo(({ segment, zoomLevel = 13 }) => {
  const {
    coordinates,
    label,
    color,
    borderColor,
    description,
    name,
    startTime,
    endTime,
  } = segment;
  if (!coordinates || coordinates.length === 0) return null;
  const w = Math.min(8, Math.max(2, 2 + ((zoomLevel - 10) / 8) * 6));
  if (coordinates.length === 1) {
    const r = Math.min(40, Math.max(12, 12 + ((zoomLevel - 10) / 8) * 28));
    return (
      <Circle
        center={coordinates[0]}
        radius={r}
        pathOptions={{
          color: borderColor,
          fillColor: color,
          fillOpacity: 0.85,
          weight: Math.max(1, w / 2),
        }}
      >
        <Popup>
          <div style={{ fontFamily: "DM Sans,sans-serif" }}>
            <b style={{ color: borderColor }}>{label}</b>
            <br />
            {name}
            <br />
            {description}
          </div>
        </Popup>
      </Circle>
    );
  }
  return (
    <>
      <Polyline
        positions={coordinates}
        pathOptions={{
          color,
          weight: w,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
      <Polyline
        positions={coordinates}
        pathOptions={{
          color: borderColor,
          weight: w + 1.5,
          opacity: 0.85,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
      <Polyline
        positions={coordinates}
        pathOptions={{
          color: "#ffffff",
          weight: Math.max(1.5, w * 0.4),
          opacity: 0.95,
          lineCap: "round",
          lineJoin: "round",
          dashArray: "8, 6",
          className: "obstructed-road-border-top",
        }}
      >
        <Popup>
          <div style={{ fontFamily: "DM Sans,sans-serif", minWidth: 200 }}>
            <b style={{ color: borderColor }}>{label}</b>
            <br />
            <b>{name}</b>
            <br />
            {description}
            {startTime && (
              <div style={{ fontSize: 10, color: "#b09878" }}>
                🕒 {new Date(startTime).toLocaleString()}
              </div>
            )}
            {endTime && (
              <div style={{ fontSize: 10, color: "#b09878" }}>
                ⏰ {new Date(endTime).toLocaleString()}
              </div>
            )}
          </div>
        </Popup>
      </Polyline>
    </>
  );
});

const ObstructionMarker = React.memo(
  ({
    lat,
    lng,
    type,
    iconCategory,
    description,
    radius,
    extra,
    zoomLevel = 13,
  }) => {
    if (
      lat === undefined ||
      lat === null ||
      lng === undefined ||
      lng === null
    ) {
      return null;
    }
    const validLat = parseFloat(lat);
    const validLng = parseFloat(lng);
    if (isNaN(validLat) || isNaN(validLng)) return null;
    if (!isFinite(validLat) || !isFinite(validLng)) return null;
    if (validLat < -90 || validLat > 90) return null;
    if (validLng < -180 || validLng > 180) return null;

    const style = getObstructionStyle(type, iconCategory);
    const sz = Math.min(40, Math.max(20, 20 + ((zoomLevel - 10) / 8) * 20));

    return (
      <Marker
        position={[validLat, validLng]}
        icon={makeLucideIcon(style.Icon, style.color, style.border, sz)}
      >
        <Popup>
          <div
            style={{
              fontFamily: "DM Sans,sans-serif",
              minWidth: 180,
              maxWidth: 280,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
                paddingBottom: 8,
                borderBottom: `1px solid ${style.color}40`,
              }}
            >
              <style.Icon size={18} color={style.color} strokeWidth={2.5} />
              <strong style={{ color: style.color, fontSize: 14 }}>
                {style.label}
              </strong>
            </div>
            <div style={{ fontSize: 12, color: "#e0c8b0", lineHeight: 1.5 }}>
              {description || "Obstruction reported"}
            </div>
            {extra && (
              <div
                style={{
                  fontSize: 11,
                  color: "#b09878",
                  borderTop: `1px solid ${style.color}30`,
                  paddingTop: 6,
                  marginTop: 4,
                }}
              >
                {extra}
              </div>
            )}
            {radius && (
              <div style={{ fontSize: 10, color: "#b09878", marginTop: 4 }}>
                ⚠️ ~{radius}m radius
              </div>
            )}
          </div>
        </Popup>
      </Marker>
    );
  },
);

// ─── Directions Panel ─────────────────────────────────────────────────────────

const DirectionsPanel = React.memo(({ steps, onClose, routeType }) => {
  if (!steps || steps.length === 0) return null;

  const cleanStopName = (name) => {
    if (!name) return "stop";
    return name.trim();
  };

  return (
    <div className="dir-panel">
      <div className="dir-header">
        <div className="dir-title">
          <List size={14} style={{ color: "var(--wood)" }} />
          Turn-by-Turn Directions
          {routeType === "transit" && (
            <span className="transit-badge">
              <Bus size={9} /> Transit
            </span>
          )}
        </div>
        <button className="dir-close" onClick={onClose}>
          <X size={12} />
        </button>
      </div>
      <div className="dir-list">
        {steps.map((step, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === steps.length - 1;
          const isTransit =
            step.type === "transit" ||
            step.travel_mode === "TRANSIT" ||
            step.travel_mode === "BUS";
          const isWalk =
            step.type === "walk" ||
            step.travel_mode === "WALKING" ||
            step.travel_mode === "WALK";

          let instruction = "";
          if (isFirst) {
            instruction = "Depart from your location";
          } else if (isLast) {
            instruction = `Arrive at ${step.instruction?.replace("Arrive at ", "") || "your destination"}`;
          } else if (isTransit) {
            const routeName = step.route_short_name || "";
            const routeLong = step.route_long_name || "";
            const fromStop = cleanStopName(
              step.departure_stop || step.start_stop || "stop",
            );
            const toStop = cleanStopName(
              step.arrival_stop || step.end_stop || "next stop",
            );
            const label = routeLong
              ? `Bus ${routeName} (${routeLong})`
              : `Bus ${routeName}`;
            instruction = `Take ${label} from ${fromStop} to ${toStop}`;
          } else if (isWalk) {
            const dist = step.distance_meters
              ? step.distance_meters < 1000
                ? `${Math.round(step.distance_meters)} m`
                : `${(step.distance_meters / 1000).toFixed(1)} km`
              : "";
            const toName = cleanStopName(
              step.to_stop ||
                step.instruction?.replace("Walk to ", "") ||
                "next stop",
            );
            instruction = `Walk ${dist ? `${dist} ` : ""}to ${toName}`;
          } else {
            instruction = stripHtml(step.instruction || "Continue");
          }

          const StepIcon = isFirst
            ? CircleDot
            : isLast
              ? Flag
              : isTransit
                ? Bus
                : getStepIcon(instruction, step.travel_mode);

          const iconClass = isFirst
            ? "start-icon"
            : isLast
              ? "end-icon"
              : isTransit
                ? "transit-icon"
                : isWalk
                  ? "walk-icon"
                  : "turn-icon";

          const stepClass = `dir-step${isTransit ? " transit-step" : isWalk ? " walk-step" : ""}${isFirst ? " first-step" : ""}${isLast ? " last-step" : ""}`;

          return (
            <div key={idx} className={stepClass}>
              <div className={`dir-icon ${iconClass}`}>
                <StepIcon size={14} strokeWidth={2.2} />
              </div>
              <div className="dir-content">
                <div className="dir-instruction">{instruction}</div>
                <div className="dir-meta">
                  {(step.distance || step.distance_meters > 0) && (
                    <span className="dir-dist">
                      {step.distance || fmtDist(step.distance_meters)}
                    </span>
                  )}
                  {(step.duration || step.duration_seconds > 0) && (
                    <span className="dir-dur">
                      {step.duration ||
                        `${Math.round(step.duration_seconds / 60)} min`}
                    </span>
                  )}
                  {isTransit && (
                    <span className="transit-badge">
                      <Bus size={9} />
                      {step.route_short_name || "Bus"}
                    </span>
                  )}
                  {isWalk && !isFirst && !isLast && (
                    <span className="walk-badge">
                      <Footprints size={9} /> Walk
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ─── Helper functions for transit routing ───────────────────────────────────

function buildTransitSegments(steps) {
  const segments = [];
  for (const step of steps) {
    const geom = step.path_geometry || [];
    if (geom.length === 0) continue;
    const coords = geom.map((pt) =>
      Array.isArray(pt) ? [pt[0], pt[1]] : [pt.lat, pt.lon || pt.lng],
    );
    segments.push({
      coords,
      type: step.type,
      line: step.route_short_name || "",
      route_long_name: step.route_long_name || "",
    });
  }
  return segments;
}

function extractCoordsFromSteps(steps) {
  const pts = [];
  for (const step of steps) {
    const geom = step.path_geometry || [];
    for (const pt of geom) {
      const lat = Array.isArray(pt) ? pt[0] : pt.lat;
      const lon = Array.isArray(pt) ? pt[1] : pt.lon || pt.lng;
      if (lat && lon) pts.push([lat, lon]);
    }
  }
  return pts;
}

function buildDisplayStepsFromTransit(steps) {
  const display = [];
  for (const step of steps) {
    if (step.type === "walk") {
      const toName = step.to_stop || "next stop";
      const dist = step.distance_meters || 0;
      const dur = step.duration_seconds || 0;
      display.push({
        type: "walk",
        travel_mode: "WALKING",
        instruction: `Walk ${dist ? `${dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`} ` : ""}to ${toName}`,
        distance_meters: dist,
        duration_seconds: dur,
        distance:
          dist < 1000
            ? `${Math.round(dist)} m`
            : `${(dist / 1000).toFixed(1)} km`,
        duration: dur >= 60 ? `${Math.round(dur / 60)} min` : `${dur} sec`,
        path_geometry: step.path_geometry || [],
      });
    } else if (step.type === "transit") {
      const routeName = step.route_short_name || "";
      const routeLong = step.route_long_name || "";
      const fromStop = step.start_stop || "";
      const toStop = step.end_stop || "";
      const label = routeLong
        ? `Bus ${routeName} (${routeLong})`
        : `Bus ${routeName}`;
      display.push({
        type: "transit",
        travel_mode: "TRANSIT",
        instruction: `Take ${label} from ${fromStop} to ${toStop}`,
        route_short_name: routeName,
        route_long_name: routeLong,
        departure_stop: fromStop,
        arrival_stop: toStop,
        duration_seconds: step.duration_seconds || 0,
        duration:
          step.duration_seconds >= 60
            ? `${Math.round(step.duration_seconds / 60)} min`
            : `${step.duration_seconds} sec`,
        path_geometry: step.path_geometry || [],
      });
    }
  }
  return display;
}

// ================== GPS AND NAVIGATION STATE (NEW) ==================
function smoothGPSCoordinate(newValue, history, alpha = 0.3) {
  if (history.length === 0) return newValue;
  const lastSmoothed = history[history.length - 1];
  return alpha * newValue + (1 - alpha) * lastSmoothed;
}

function calculateBearing(lat1, lng1, lat2, lng2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export default function AccessibleMap() {
  const [mapType, setMapType] = useState("openstreetmap");
  const [zoom, setZoom] = useState(13);
  const [loc, setLoc] = useState([40.472, -79.94]);
  const [routePath, setRoutePath] = useState([]);
  const [routeSegments, setRouteSegments] = useState([]);
  const [dest, setDest] = useState(null);
  const [constructionZones, setConstructionZones] = useState([]);
  const [activeHazards, setActiveHazards] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [showRouteAlert, setShowRouteAlert] = useState(false);
  const [routeAlert, setRouteAlert] = useState(null);
  const [routeAlternatives, setRouteAlternatives] = useState([]);
  const [transitInfo, setTransitInfo] = useState(null);
  const [showTransitInfo, setShowTransitInfo] = useState(false);
  const [alternativeRoutes, setAlternativeRoutes] = useState([]);
  const [fromVal, setFromVal] = useState("Current Location");
  const [toVal, setToVal] = useState("");
  const [mode, setMode] = useState("wheelchair");
  const [sugg, setSugg] = useState([]);
  const [suggOpen, setSuggOpen] = useState(false);
  const [suggLoad, setSuggLoad] = useState(false);
  const [hiIdx, setHiIdx] = useState(-1);
  const [panel, setPanel] = useState(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [a11y, setA11y] = useState({
    visionImpaired: false,
    hearingImpaired: false,
    lowEnergy: false,
    highContrast: false,
    largeText: false,
    screenReader: false,
    reducedMotion: false,
  });
  const [prefs, setPrefs] = useState({});
  const [recents, setRecents] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("ar_recents") || "[]");
    } catch {
      return [];
    }
  });
  const [obstructedRoads, setObstructedRoads] = useState([]);
  const [currentZoom, setCurrentZoom] = useState(13);
  const [show3D, setShow3D] = useState(false);
  const [walkerPosition, setWalkerPosition] = useState(null);
  const [walkerIdx, setWalkerIdx] = useState(0);
  const walkerIntervalRef = useRef(null);

  // ── NEW GPS/NAVIGATION STATE ──
  const gpsWatchIdRef = useRef(null);
  const lastGPSPosition = useRef(null);
  const gpsPositionHistory = useRef([]);
  const [navigationActive, setNavigationActive] = useState(false);
  const [walkerHeading, setWalkerHeading] = useState(0);
  const [navigationState, setNavigationState] = useState("idle");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [distanceToNextTurn, setDistanceToNextTurn] = useState(null);
  const [remainingTotalDistance, setRemainingTotalDistance] = useState(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState(0);

  // ── Directions state ──
  const [routeSteps, setRouteSteps] = useState([]);
  const [showDirections, setShowDirections] = useState(false);
  const [routeType, setRouteType] = useState("walking");
  const [transitSegments, setTransitSegments] = useState([]);
  const [transitAlternatives, setTransitAlternatives] = useState([]);

  // ── Voice modal state ──
  const [showVoiceModal, setShowVoiceModal] = useState(false);

  // ── Search panel collapse state ──
  const [searchPanelCollapsed, setSearchPanelCollapsed] = useState(false);

  const debRef = useRef(null);
  const destRef = useRef(null);
  const suggRef = useRef(null);
  const panelRef = useRef(null);
  const fromRef = useRef(null);
  const fromDebRef = useRef(null);
  const [fromSugg, setFromSugg] = useState([]);
  const [fromSuggOpen, setFromSuggOpen] = useState(false);
  const [fromSuggLoad, setFromSuggLoad] = useState(false);
  const [fromHiIdx, setFromHiIdx] = useState(-1);

  const [emergencies911, setEmergencies911] = useState([]);

  const memoizedSuggItems = useMemo(() => {
    return sugg.map((s, i) => {
      const CIcon = getCatIcon(s.category);
      return (
        <button
          key={s.id || i}
          className={`ac-row${hiIdx === i ? " hi" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            pickSugg(s);
          }}
          onMouseEnter={() => setHiIdx(i)}
        >
          <div className="ac-ico">
            <CIcon size={13} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ac-name">{s.name}</div>
            {s.address && s.address !== s.name && (
              <div className="ac-addr">{s.address}</div>
            )}
          </div>
          {s.category && (
            <div className="ac-tag">{s.category.split(" ")[0]}</div>
          )}
        </button>
      );
    });
  }, [sugg, hiIdx]);

  const memoizedFromSuggItems = useMemo(() => {
    return fromSugg.map((s, i) => {
      const CIcon = getCatIcon(s.category);
      return (
        <button
          key={s.id || i}
          className={`ac-row${fromHiIdx === i ? " hi" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            pickFromSugg(s);
          }}
          onMouseEnter={() => setFromHiIdx(i)}
        >
          <div className="ac-ico">
            <CIcon size={13} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ac-name">{s.name}</div>
            {s.address && s.address !== s.name && (
              <div className="ac-addr">{s.address}</div>
            )}
          </div>
          {s.category && (
            <div className="ac-tag">{s.category.split(" ")[0]}</div>
          )}
        </button>
      );
    });
  }, [fromSugg, fromHiIdx]);

  const throttledSetZoom = useCallback(
    throttle((newZoom) => {
      setZoom(newZoom);
    }, 100),
    [],
  );

  const validCenter = isValidLatLngArray(loc) ? loc : [40.472, -79.94];

  const say = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }, []);

  const isValidCoordinate = useCallback((obj) => {
    return (
      obj &&
      obj.lat != null &&
      obj.lng != null &&
      !isNaN(obj.lat) &&
      !isNaN(obj.lng) &&
      isFinite(obj.lat) &&
      isFinite(obj.lng)
    );
  }, []);

  const cleanObstructions = useCallback((arr) => {
    if (!Array.isArray(arr)) return [];
    return arr.filter((item) => {
      if (!item) return false;
      const lat = item.lat ?? item.latitude ?? item.position?.lat ?? null;
      const lng =
        item.lng ?? item.longitude ?? item.lon ?? item.position?.lng ?? null;
      if (
        lat == null ||
        lng == null ||
        isNaN(Number(lat)) ||
        isNaN(Number(lng))
      ) {
        return false;
      }
      return true;
    });
  }, []);

  useEffect(() => {
    if (constructionZones.length > 0) {
      console.log("First construction zone:", constructionZones[0]);
      constructionZones.forEach((zone, idx) => {
        if (zone.lat && !zone.lng) {
          console.error(`Zone ${idx} has lat but no lng:`, zone);
        }
      });
    }
    if (activeHazards.length > 0) {
      console.log("First hazard:", activeHazards[0]);
      activeHazards.forEach((hazard, idx) => {
        if (hazard.lat && !hazard.lng) {
          console.error(`Hazard ${idx} has lat but no lng:`, hazard);
        }
      });
    }
  }, [constructionZones, activeHazards]);

  const transformedHazards = useMemo(() => {
    return activeHazards
      .filter((h) => {
        const lat = h.lat ?? h.position?.lat;
        const lng = h.lng ?? h.position?.lng;
        return (
          lat != null &&
          lng != null &&
          !isNaN(Number(lat)) &&
          !isNaN(Number(lng))
        );
      })
      .map((h) => {
        const lat = Number(h.lat ?? h.position?.lat);
        const lng = Number(h.lng ?? h.position?.lng);
        return { ...h, position: { lat, lng } };
      });
  }, [activeHazards]);

  const navState3D = useMemo(() => {
    if (!routePath.length) return "idle";
    if (walkerIdx >= routePath.length - 1) return "arrived";
    return "walking";
  }, [routePath, walkerIdx]);

  const remainingDist3D = useMemo(() => {
    if (!routePath.length || walkerIdx >= routePath.length - 1) return 0;
    let d = 0;
    for (let i = walkerIdx; i < routePath.length - 1; i++) {
      d += haversineDistance(
        routePath[i][0],
        routePath[i][1],
        routePath[i + 1][0],
        routePath[i + 1][1],
      );
    }
    return d;
  }, [routePath, walkerIdx]);

  const avgSafety = useMemo(() => {
    if (!routeSegments.length) return 0.75;
    return (
      routeSegments.reduce((a, s) => a + (s.safety_score || 0.7), 0) /
      routeSegments.length
    );
  }, [routeSegments]);

  // Walker animation (kept for compatibility but replaced by GPS)
  useEffect(() => {
    if (walkerIntervalRef.current) clearInterval(walkerIntervalRef.current);
    if (routePath.length < 2) {
      setWalkerPosition(loc);
      setWalkerIdx(0);
      return;
    }
    setWalkerIdx(0);
    setWalkerPosition(routePath[0]);
    let idx = 0;
    walkerIntervalRef.current = setInterval(() => {
      idx = (idx + 1) % routePath.length;
      setWalkerIdx(idx);
      setWalkerPosition(routePath[idx]);
    }, 1200);
    return () => clearInterval(walkerIntervalRef.current);
  }, [routePath]);

  // ── NEW GPS FUNCTIONS ──
  const advanceStepIfNeeded = useCallback(
    (currentLat, currentLng) => {
      if (!routeSteps || routeSteps.length === 0) return;
      if (currentStepIndex >= routeSteps.length - 1) return;
      const STEP_ADVANCE_RADIUS = 20;
      const stepFraction = (currentStepIndex + 1) / routeSteps.length;
      const waypointIdx = Math.min(
        Math.floor(stepFraction * routePath.length),
        routePath.length - 1,
      );
      if (waypointIdx < routePath.length) {
        const waypoint = routePath[waypointIdx];
        const distToWaypoint = haversineDistance(
          currentLat,
          currentLng,
          waypoint[0],
          waypoint[1],
        );
        if (distToWaypoint < STEP_ADVANCE_RADIUS) {
          setCurrentStepIndex((prev) =>
            Math.min(prev + 1, routeSteps.length - 1),
          );
          const newStep = routeSteps[currentStepIndex + 1];
          if (newStep) say(newStep.instruction || "");
        }
      }
    },
    [routeSteps, currentStepIndex, routePath, say],
  );

  const updateRemainingNavigation = useCallback(
    (currentLat, currentLng) => {
      if (!routePath || routePath.length === 0) return;
      let minDist = Infinity;
      let closestIdx = 0;
      for (let i = 0; i < routePath.length; i++) {
        const d = haversineDistance(
          currentLat,
          currentLng,
          routePath[i][0],
          routePath[i][1],
        );
        if (d < minDist) {
          minDist = d;
          closestIdx = i;
        }
      }
      let remaining = 0;
      for (let i = closestIdx; i < routePath.length - 1; i++) {
        remaining += haversineDistance(
          routePath[i][0],
          routePath[i][1],
          routePath[i + 1][0],
          routePath[i + 1][1],
        );
      }
      setRemainingTotalDistance(remaining);
      setEstimatedTimeRemaining(remaining / 1.4);
      const nextStepWaypointIdx = Math.min(
        Math.floor(
          ((currentStepIndex + 1) / routeSteps.length) * routePath.length,
        ),
        routePath.length - 1,
      );
      if (nextStepWaypointIdx < routePath.length) {
        let distToNext = 0;
        for (
          let i = closestIdx;
          i < nextStepWaypointIdx && i < routePath.length - 1;
          i++
        ) {
          distToNext += haversineDistance(
            routePath[i][0],
            routePath[i][1],
            routePath[i + 1][0],
            routePath[i + 1][1],
          );
        }
        setDistanceToNextTurn(distToNext);
      }
    },
    [routePath, currentStepIndex, routeSteps],
  );

  const handleGPSUpdate = useCallback(
    (position) => {
      const rawLat = position.coords.latitude;
      const rawLng = position.coords.longitude;
      const timestamp = position.timestamp;
      const MIN_MOVEMENT_METERS = 1.5;
      const GPS_UPDATE_THROTTLE_MS = 500;

      if (lastGPSPosition.current) {
        const timeDelta = timestamp - lastGPSPosition.current.timestamp;
        if (timeDelta < GPS_UPDATE_THROTTLE_MS) return;
        const dist = haversineDistance(
          lastGPSPosition.current.lat,
          lastGPSPosition.current.lng,
          rawLat,
          rawLng,
        );
        if (dist < MIN_MOVEMENT_METERS) return;
      }

      const historyLats = gpsPositionHistory.current.map((h) => h.lat);
      const historyLngs = gpsPositionHistory.current.map((h) => h.lng);
      const smoothedLat = smoothGPSCoordinate(rawLat, historyLats);
      const smoothedLng = smoothGPSCoordinate(rawLng, historyLngs);

      gpsPositionHistory.current.push({
        lat: smoothedLat,
        lng: smoothedLng,
        timestamp,
      });
      if (gpsPositionHistory.current.length > 5)
        gpsPositionHistory.current.shift();

      if (lastGPSPosition.current) {
        const heading = calculateBearing(
          lastGPSPosition.current.lat,
          lastGPSPosition.current.lng,
          smoothedLat,
          smoothedLng,
        );
        setWalkerHeading(heading);
      }

      const speed = position.coords.speed || 0;
      if (speed < 0.3) {
        setNavigationState((prev) =>
          prev === "arrived" ? "arrived" : "stopped",
        );
      } else {
        setNavigationState("walking");
      }

      setWalkerPosition([smoothedLat, smoothedLng]);
      lastGPSPosition.current = {
        lat: smoothedLat,
        lng: smoothedLng,
        timestamp,
      };

      if (dest) {
        const distToDest = haversineDistance(
          smoothedLat,
          smoothedLng,
          dest[0],
          dest[1],
        );
        if (distToDest < 15) {
          setNavigationState("arrived");
          stopNavigation();
          say("You have arrived at your destination!");
        }
      }

      advanceStepIfNeeded(smoothedLat, smoothedLng);
      updateRemainingNavigation(smoothedLat, smoothedLng);
    },
    [dest, advanceStepIfNeeded, updateRemainingNavigation, say],
  );

  const handleGPSError = useCallback(
    (error) => {
      console.error("GPS error:", error);
      say("Unable to get GPS location. Please check permissions.");
    },
    [say],
  );

  const startNavigation = useCallback(
    (routeCoords) => {
      setNavigationActive(true);
      setNavigationState("walking");
      setCurrentStepIndex(0);
      if (navigator.geolocation) {
        if (gpsWatchIdRef.current)
          navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = navigator.geolocation.watchPosition(
          handleGPSUpdate,
          handleGPSError,
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
        );
      }
    },
    [handleGPSUpdate, handleGPSError],
  );

  const stopNavigation = useCallback(() => {
    if (gpsWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
    }
    setNavigationActive(false);
    setNavigationState("idle");
    gpsPositionHistory.current = [];
    lastGPSPosition.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopNavigation();
    };
  }, [stopNavigation]);

  // Click-outside handler
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        suggRef.current &&
        !suggRef.current.contains(e.target) &&
        e.target !== destRef.current
      )
        setSuggOpen(false);
      if (e.target !== fromRef.current) setFromSuggOpen(false);
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        !e.target.closest(".rail")
      )
        setPanel(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch area obstructions
  useEffect(() => {
    const fetchAreaObstructions = async () => {
      try {
        console.log("🔄 Fetching area obstructions...");
        const res = await fetch("http://127.0.0.1:5000/api/area-obstructions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            use_custom_bbox: true,
            min_lat: 40.2,
            max_lat: 40.8,
            min_lng: -80.8,
            max_lng: -79.5,
            include_emergencies: true,
            include_news: true,
          }),
        });
        const data = await res.json();

        console.log("📡 API RESPONSE SUMMARY:");
        console.log("  - Success:", data.success);
        console.log(
          "  - Construction zones:",
          data.construction_zones?.length || 0,
        );
        console.log("  - Total hazards:", data.hazards?.length || 0);
        console.log("  - News hazards:", data.news_hazards?.length || 0);
        console.log("  - 911 emergencies:", data.emergencies_911?.length || 0);

        if (data.success) {
          const sanitize = (arr) =>
            (arr || [])
              .map((item) => {
                let lat =
                  item.lat ?? item.latitude ?? item.position?.lat ?? null;
                let lng =
                  item.lng ??
                  item.longitude ??
                  item.lon ??
                  item.position?.lng ??
                  null;
                if (lat !== null) lat = Number(lat);
                if (lng !== null) lng = Number(lng);
                if (
                  lat !== null &&
                  lng !== null &&
                  !isNaN(lat) &&
                  !isNaN(lng) &&
                  isFinite(lat) &&
                  isFinite(lng)
                ) {
                  return { ...item, lat, lng };
                }
                return null;
              })
              .filter(Boolean);

          setConstructionZones(sanitize(data.construction_zones));

          const allHazards = sanitize(data.hazards || []);
          const newsHazards = allHazards.filter((h) => h.source === "news_api");
          const arrestHazards = allHazards.filter(
            (h) => h.source === "arrest_data",
          );
          const tomtomHazards = allHazards.filter((h) => h.source === "tomtom");
          const otherHazards = allHazards.filter(
            (h) =>
              h.source !== "news_api" &&
              h.source !== "arrest_data" &&
              h.source !== "tomtom",
          );

          const emergencyMarkers = [...newsHazards, ...arrestHazards];
          setEmergencies911(emergencyMarkers);
          setActiveHazards([...tomtomHazards, ...otherHazards]);

          console.log("📊 HAZARD BREAKDOWN:");
          console.log(`  - News hazards: ${newsHazards.length}`);
          console.log(`  - Arrest hazards: ${arrestHazards.length}`);
          console.log(`  - TomTom hazards: ${tomtomHazards.length}`);
          console.log(
            `  - Construction zones: ${data.construction_zones?.length || 0}`,
          );
          console.log(
            `  - Total emergency markers (red): ${emergencyMarkers.length}`,
          );
        }
      } catch (error) {
        console.error("Error fetching obstructions:", error);
      }
    };
    fetchAreaObstructions();
    const interval = setInterval(fetchAreaObstructions, 300000);
    return () => clearInterval(interval);
  }, [loc]);

  useEffect(() => {
    const fetchRoads = async () => {
      try {
        const minLat = 40.2;
        const maxLat = 40.8;
        const minLng = -80.8;
        const maxLng = -79.5;
        const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;

        console.log("Fetching TomTom road incidents for region:", bbox);

        const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${TOMTOM_API_KEY}&bbox=${bbox}&fields={incidents{geometry{type,coordinates},properties{iconCategory,events{description},from,to,startTime,endTime}}}`;
        const response = await fetch(url);

        if (!response.ok) {
          console.error("TomTom API error:", response.status);
          return;
        }

        const data = await response.json();

        if (data.incidents?.length > 0) {
          console.log(`Found ${data.incidents.length} TomTom incidents`);

          const segs = data.incidents
            .filter((i) =>
              [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14].includes(
                i.properties.iconCategory,
              ),
            )
            .map((inc) => {
              const coords = inc.geometry.coordinates;
              let coordinates = [];

              if (inc.geometry.type === "Point") {
                coordinates = [[coords[1], coords[0]]];
              } else if (inc.geometry.type === "LineString") {
                coordinates = coords.map((c) => [c[1], c[0]]);
              }

              let label = "⚠️ HAZARD";
              let color = "rgba(255,140,70,0.95)";
              let borderColor = "#ffaa66";

              if ([7, 8, 9].includes(inc.properties.iconCategory)) {
                label = "🚧 CONSTRUCTION";
                color = "rgba(255,100,80,0.95)";
                borderColor = "#ff6b6b";
              } else if (inc.properties.iconCategory === 1) {
                label = "⚠️ ACCIDENT";
                color = "rgba(255,80,70,0.95)";
                borderColor = "#ff5555";
              } else if (inc.properties.iconCategory === 6) {
                label = "🚗 JAM";
                color = "rgba(255,180,70,0.95)";
                borderColor = "#ffcc66";
              }

              return {
                id: inc.id,
                name:
                  `${inc.properties.from || ""} to ${inc.properties.to || ""}`.trim() ||
                  "Road Segment",
                coordinates,
                label,
                color,
                borderColor,
                description:
                  inc.properties.events?.[0]?.description || "Road incident",
                fromStreet: inc.properties.from || "",
                toStreet: inc.properties.to || "",
                startTime: inc.properties.startTime,
                endTime: inc.properties.endTime,
              };
            })
            .filter((s) => s.coordinates.length > 0);

          console.log(`Created ${segs.length} road segment overlays`);
          setObstructedRoads(segs);
        } else {
          console.log("No TomTom incidents found in region");
        }
      } catch (error) {
        console.error("Error fetching TomTom road incidents:", error);
      }
    };

    fetchRoads();
  }, []);

  // ─── search ──────────────────────────────────────────────────────────────────

  const searchPlaces = useCallback(
    (q) => {
      if (debRef.current) clearTimeout(debRef.current);
      if (!q || q.length < 2) {
        setSugg([]);
        setSuggOpen(false);
        return;
      }
      debRef.current = setTimeout(async () => {
        setSuggLoad(true);
        try {
          const [lat, lng] = loc;
          const d = await (
            await fetch(
              `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${TOMTOM_API_KEY}&limit=4&lat=${lat}&lon=${lng}&radius=50000&language=en-US`,
            )
          ).json();
          const m = (d.results || [])
            .slice(0, 4)
            .map((r) => ({
              id: r.id,
              name: r.poi?.name || r.address?.freeformAddress,
              address: r.address?.freeformAddress,
              category: r.poi?.categories?.[0] || null,
            }))
            .filter((r) => r.name);
          setSugg(m);
          setSuggOpen(m.length > 0);
          setHiIdx(-1);
        } catch {
        } finally {
          setSuggLoad(false);
        }
      }, 300);
    },
    [loc],
  );

  const searchFromPlaces = (q) => {
    if (fromDebRef.current) clearTimeout(fromDebRef.current);
    if (!q || q.length < 2 || q === "Current Location") {
      setFromSugg([]);
      setFromSuggOpen(false);
      return;
    }
    fromDebRef.current = setTimeout(async () => {
      setFromSuggLoad(true);
      try {
        const [lat, lng] = loc;
        const d = await (
          await fetch(
            `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${TOMTOM_API_KEY}&limit=6&lat=${lat}&lon=${lng}&radius=50000&language=en-US`,
          )
        ).json();
        const m = (d.results || [])
          .map((r) => ({
            id: r.id,
            name: r.poi?.name || r.address?.freeformAddress,
            address: r.address?.freeformAddress,
            category: r.poi?.categories?.[0] || null,
          }))
          .filter((r) => r.name);
        setFromSugg(m);
        setFromSuggOpen(m.length > 0);
        setFromHiIdx(-1);
      } catch {
      } finally {
        setFromSuggLoad(false);
      }
    }, 280);
  };

  const pickFromSugg = (s) => {
    setFromVal(s.address || s.name);
    setFromSugg([]);
    setFromSuggOpen(false);
    setFromHiIdx(-1);
    fromRef.current?.blur();
    say(`Start set — ${s.name}`);
  };

  const pickSugg = (s) => {
    setToVal(s.address || s.name);
    setSugg([]);
    setSuggOpen(false);
    setHiIdx(-1);
    destRef.current?.blur();
    say(`Destination set — ${s.name}`);
  };

  const fromKD = (e) => {
    if (!fromSuggOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFromHiIdx((p) => Math.min(p + 1, fromSugg.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFromHiIdx((p) => Math.max(p - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (fromHiIdx >= 0) pickFromSugg(fromSugg[fromHiIdx]);
    } else if (e.key === "Escape") {
      setFromSuggOpen(false);
      setFromHiIdx(-1);
    }
  };

  const destKD = (e) => {
    if (!suggOpen) {
      if (e.key === "Enter") calcRoute();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHiIdx((p) => Math.min(p + 1, sugg.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHiIdx((p) => Math.max(p - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hiIdx >= 0) pickSugg(sugg[hiIdx]);
      else calcRoute();
    } else if (e.key === "Escape") {
      setSuggOpen(false);
      setHiIdx(-1);
    }
  };

  // ─── obstruction check ────────────────────────────────────────────────────────

  const checkRouteForObstructions = async (routeCoords) => {
    try {
      const res = await fetch("http://127.0.0.1:5000/api/check-obstructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route_coords: routeCoords,
          include_emergencies: true,
        }),
      });
      const data = await res.json();
      if (data.success && data.obstructions) {
        if (data.obstructions.construction_zones?.length > 0) {
          const validZones = data.obstructions.construction_zones
            .map((zone) => {
              let lat = zone.lat ?? zone.latitude ?? null;
              let lng = zone.lng ?? zone.longitude ?? zone.lon ?? null;
              if (lat !== null) lat = Number(lat);
              if (lng !== null) lng = Number(lng);
              if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
                return { ...zone, lat, lng };
              }
              return null;
            })
            .filter((z) => z !== null);

          setConstructionZones((prev) => {
            const existing = new Set(prev.map((z) => `${z.lat},${z.lng}`));
            return [
              ...prev,
              ...validZones.filter((z) => !existing.has(`${z.lat},${z.lng}`)),
            ];
          });
        }

        if (data.obstructions.hazards?.length > 0) {
          const validHazards = data.obstructions.hazards
            .map((hazard) => {
              let lat = hazard.lat ?? hazard.latitude ?? null;
              let lng = hazard.lng ?? hazard.longitude ?? hazard.lon ?? null;
              if (lat !== null) lat = Number(lat);
              if (lng !== null) lng = Number(lng);
              if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
                return { ...hazard, lat, lng };
              }
              return null;
            })
            .filter((h) => h !== null);

          const newEmergencies = validHazards.filter(
            (h) => h.source === "911_dispatch",
          );
          const newRegularHazards = validHazards.filter(
            (h) => h.source !== "911_dispatch",
          );

          setEmergencies911((prev) => {
            const existing = new Set(prev.map((e) => `${e.lat},${e.lng}`));
            return [
              ...prev,
              ...newEmergencies.filter(
                (e) => !existing.has(`${e.lat},${e.lng}`),
              ),
            ];
          });

          setActiveHazards((prev) => {
            const existing = new Set(prev.map((h) => `${h.lat},${h.lng}`));
            return [
              ...prev,
              ...newRegularHazards.filter(
                (h) => !existing.has(`${h.lat},${h.lng}`),
              ),
            ];
          });
        }

        if (data.obstructions.has_obstruction) {
          const emergencyCount =
            data.obstructions.hazards?.filter(
              (h) => h.source === "911_dispatch",
            ).length || 0;
          const message =
            emergencyCount > 0
              ? `⚠ ${emergencyCount} active 911 emergency(s) near your route!`
              : "⚠ Obstruction near your route!";
          setRouteAlert({
            type: "obstruction",
            message: message,
          });
          setShowRouteAlert(true);
        }
      }
    } catch (err) {
      console.error("Error checking obstructions:", err);
    }
  };

  // ─── route alternatives ───────────────────────────────────────────────────────

  const getRouteAlternatives = async () => {
    try {
      const res = await fetch("http://127.0.0.1:5000/api/route-alternatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_lat: loc[0],
          start_lng: loc[1],
          end_lat: dest?.[0] || loc[0],
          end_lng: dest?.[1] || loc[1],
          accessibility_preferences: {
            wheelchair: mode === "wheelchair",
            blind: a11y.visionImpaired,
          },
        }),
      });
      const data = await res.json();
      if (data.success && data.alternatives.length > 0) {
        setRouteAlternatives(data.alternatives);
        setAlternativeRoutes(data.alternatives);
      }
    } catch {}
  };

  // ─── transit info modal ───────────────────────────────────────────────────────

  const getTransitInfo = async () => {
    if (!toVal.trim() && !dest) {
      say("Please enter a destination first");
      return;
    }
    try {
      let startLat = loc[0];
      let startLng = loc[1];

      if (fromVal !== "Current Location") {
        const startGeoData = await (
          await fetch(
            `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(fromVal)}.json?key=${TOMTOM_API_KEY}&limit=1`,
          )
        ).json();
        if (startGeoData.results?.length > 0) {
          startLat = startGeoData.results[0].position.lat;
          startLng = startGeoData.results[0].position.lon;
        }
      }

      let endLat = dest?.[0];
      let endLng = dest?.[1];

      if (!endLat && toVal) {
        const endGeoData = await (
          await fetch(
            `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(toVal)}.json?key=${TOMTOM_API_KEY}&limit=1`,
          )
        ).json();
        if (endGeoData.results?.length > 0) {
          endLat = endGeoData.results[0].position.lat;
          endLng = endGeoData.results[0].position.lon;
        }
      }

      if (!endLat || !endLng) {
        say("Couldn't find destination coordinates");
        return;
      }

      const res = await fetch("http://127.0.0.1:5000/api/transit-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_lat: startLat,
          start_lng: startLng,
          end_lat: endLat,
          end_lng: endLng,
          start_time: new Date().toISOString(),
          max_walk_distance: 1000,
        }),
      });

      const data = await res.json();

      if (data.success && data.best_route) {
        const bestRoute = data.best_route;
        const transitSteps =
          bestRoute.steps?.filter((s) => s.type === "transit") || [];
        const walkingSteps =
          bestRoute.steps?.filter((s) => s.type === "walk") || [];

        const cleanStopName = (name) => {
          if (!name || name === "Stop" || name === "stop") return name;
          let cleaned = name.replace(/\s+\+\s*#?\d+/, "");
          cleaned = cleaned.replace(/\s+at\s+.+$/, "");
          cleaned = cleaned.replace(/\s+\d+$/, "");
          cleaned = cleaned.replace(/\s+\+\s+#\d+/, "");
          cleaned = cleaned.replace(/STOP\s+#\d+\s*-\s*/i, "");
          cleaned = cleaned.replace(/STOP\s+#\d+/i, "");
          cleaned = cleaned
            .split(" ")
            .map(
              (word) =>
                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
            )
            .join(" ");
          return cleaned.trim() || name;
        };

        const getRouteName = (step) => {
          if (step.route_short_name && step.route_short_name !== "") {
            return step.route_short_name;
          }
          if (step.route_long_name && step.route_long_name !== "") {
            const shortName = step.route_long_name
              .replace(/Bus|Line|Route/i, "")
              .trim();
            return shortName.length > 15
              ? shortName.substring(0, 15)
              : shortName;
          }
          if (step.route_id && step.route_id !== "") {
            return step.route_id;
          }
          if (step.trip_id) {
            const possibleRoute = step.trip_id.split("_")[0];
            if (possibleRoute && !possibleRoute.match(/^\d{7,}$/)) {
              return possibleRoute;
            }
          }
          return "Bus";
        };

        const tripsByLine = new Map();
        transitSteps.forEach((step) => {
          const routeName = getRouteName(step);
          if (!tripsByLine.has(routeName)) tripsByLine.set(routeName, []);
          tripsByLine.get(routeName).push(step);
        });

        const transitLines = Array.from(tripsByLine.entries()).map(
          ([line, steps]) => ({
            line: line,
            vehicle: "Bus",
            from_stop: cleanStopName(
              steps[0]?.start_stop_name || steps[0]?.start_stop || "Stop",
            ),
            to_stop: cleanStopName(
              steps[steps.length - 1]?.end_stop_name ||
                steps[steps.length - 1]?.end_stop ||
                "Stop",
            ),
            departure_time: steps[0]?.departure_time
              ? (() => {
                  try {
                    const d = new Date(steps[0].departure_time);
                    return d.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  } catch {
                    return steps[0]?.time
                      ? new Date(steps[0].time).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Soon";
                  }
                })()
              : steps[0]?.time
                ? new Date(steps[0].time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "Soon",
            arrival_time: steps[steps.length - 1]?.arrival_time
              ? (() => {
                  try {
                    const d = new Date(steps[steps.length - 1].arrival_time);
                    return d.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  } catch {
                    return steps[steps.length - 1]?.time
                      ? new Date(
                          steps[steps.length - 1].time,
                        ).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Arriving";
                  }
                })()
              : steps[steps.length - 1]?.time
                ? new Date(steps[steps.length - 1].time).toLocaleTimeString(
                    [],
                    { hour: "2-digit", minute: "2-digit" },
                  )
                : "Arriving",
            stop_count: steps.length,
          }),
        );

        const totalMinutes = Math.round(bestRoute.total_time_seconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;

        let walkingSeconds = 0;
        let transitSeconds = 0;
        bestRoute.steps?.forEach((step) => {
          if (step.type === "walk" && step.duration_seconds) {
            walkingSeconds += step.duration_seconds;
          } else if (step.type === "transit" && step.duration_seconds) {
            transitSeconds += step.duration_seconds;
          }
        });

        setTransitInfo([
          {
            duration_minutes: totalMinutes,
            duration_str: durationStr,
            walking_minutes: Math.round(walkingSeconds / 60),
            transit_minutes: Math.round(transitSeconds / 60),
            transit_lines: transitLines,
            total_steps: bestRoute.steps?.length || 0,
            arrival_time: bestRoute.arrival_time
              ? new Date(bestRoute.arrival_time).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Arriving",
            departure_time: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          },
        ]);
        setShowTransitInfo(true);

        const routeSummary = transitLines.map((l) => l.line).join(" → ");
        say(
          `Found ${transitSteps.length} transit connection(s) · ${durationStr} · ${routeSummary}`,
        );
      } else {
        say(data.error || "No transit routes available at this time");
      }
    } catch (err) {
      console.error("Transit info error:", err);
      say("Could not fetch transit information");
    }
  };

  // ─── clear route ──────────────────────────────────────────────────────────────

  const clearRoute = () => {
    setRoutePath([]);
    setRouteSegments([]);
    setDest(null);
    setRouteInfo(null);
    setShowRouteAlert(false);
    setAlternativeRoutes([]);
    setShow3D(false);
    setRouteSteps([]);
    setShowDirections(false);
    setTransitSegments([]);
    setTransitAlternatives([]);
    stopNavigation();
    setCurrentStepIndex(0);
    setDistanceToNextTurn(null);
    setRemainingTotalDistance(0);
    setEstimatedTimeRemaining(0);
    setWalkerHeading(0);
    setNavigationState("idle");
  };

  // ─── main route calc ──────────────────────────────────────────────────────────

  const calcRoute = async () => {
    if (!toVal.trim()) {
      say("Please enter a destination");
      return;
    }
    setIsLoading(true);
    say("Finding your safe, accessible route…");

    setRouteSteps([]);
    setShowDirections(false);
    setTransitSegments([]);
    setTransitAlternatives([]);

    try {
      const geoData = await (
        await fetch(
          `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(toVal)}.json?key=${TOMTOM_API_KEY}&limit=1`,
        )
      ).json();

      if (!geoData.results?.length) {
        say("Couldn't find that location");
        setIsLoading(false);
        return;
      }

      const destPos = geoData.results[0].position;
      const destCoords = { lat: destPos.lat, lng: destPos.lon };

      let startCoords = { lat: loc[0], lng: loc[1] };
      if (fromVal !== "Current Location") {
        const startGeoData = await (
          await fetch(
            `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(fromVal)}.json?key=${TOMTOM_API_KEY}&limit=1`,
          )
        ).json();
        if (startGeoData.results?.length > 0) {
          const sp = startGeoData.results[0].position;
          startCoords = { lat: sp.lat, lng: sp.lon };
        }
      }

      // ── TRANSIT MODE ──────────────────────────────────────────────────────────

      if (mode === "transit") {
        try {
          say("Searching for transit routes...");

          const transitRes = await fetch(
            "http://127.0.0.1:5000/api/transit-route",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                start_lat: startCoords.lat,
                start_lng: startCoords.lng,
                end_lat: destCoords.lat,
                end_lng: destCoords.lng,
                start_time: new Date().toISOString(),
                max_walk_distance: 1000,
              }),
            },
          );

          const transitData = await transitRes.json();

          if (transitData.success && transitData.best_route) {
            const bestRoute = transitData.best_route;
            const allRoutes = transitData.routes || [bestRoute];

            const primarySegments = buildTransitSegments(bestRoute.steps);
            setTransitSegments(primarySegments);

            const alts = allRoutes.slice(1).map((alt, idx) => ({
              coords: extractCoordsFromSteps(alt.steps),
              route_summary: alt.route_summary,
              safety: alt.safety?.overall_safety || 0.7,
              total_time_seconds: alt.total_time_seconds,
              index: idx + 1,
            }));
            setTransitAlternatives(alts);

            const allCoords = primarySegments.flatMap((s) => s.coords);
            setRoutePath(allCoords);
            setDest([destCoords.lat, destCoords.lng]);
            setRouteType("transit");

            const displaySteps = buildDisplayStepsFromTransit(bestRoute.steps);
            setRouteSteps(displaySteps);
            setShowDirections(true);

            const totalMinutes = Math.round(bestRoute.total_time_seconds / 60);
            const hours = Math.floor(totalMinutes / 60);
            const mins = totalMinutes % 60;
            const durationStr =
              hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;

            setRouteInfo({
              distance: `${(bestRoute.total_distance_meters / 1000).toFixed(1)} km`,
              duration: durationStr,
              total_minutes: totalMinutes,
              transit_steps: bestRoute.steps.filter((s) => s.type === "transit")
                .length,
              walking_steps: bestRoute.steps.filter((s) => s.type === "walk")
                .length,
            });

            const nr = [
              {
                name: toVal,
                address: geoData.results[0].address?.freeformAddress || toVal,
                type: "transit",
              },
              ...recents.filter((r) => r.name !== toVal),
            ].slice(0, 6);
            setRecents(nr);
            localStorage.setItem("ar_recents", JSON.stringify(nr));

            const routeSummary = bestRoute.steps
              .filter((s) => s.type === "transit")
              .map((s) => s.route_short_name || "Bus")
              .join(" → ");

            say(
              `Transit route found · ${durationStr} · ${routeSummary || `${bestRoute.steps.filter((s) => s.type === "transit").length} connections`}`,
            );

            setShow3D(true);
            setTimeout(() => checkRouteForObstructions(allCoords), 500);
            // Start navigation
            setTimeout(() => {
              startNavigation(allCoords);
            }, 300);
            setIsLoading(false);
            return;
          } else {
            say(
              transitData.error ||
                "No transit routes found. Trying walking route...",
            );
          }
        } catch (transitErr) {
          console.error("GTFS transit error:", transitErr);
          say("Transit service unavailable. Using walking route...");
        }
      }

      // ── WALKING / WHEELCHAIR MODE ─────────────────────────────────────────────

      const routeRes = await fetch(
        "http://127.0.0.1:5000/api/calculate-route",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start_lat: startCoords.lat,
            start_lng: startCoords.lng,
            end_lat: destCoords.lat,
            end_lng: destCoords.lng,
            travel_mode: "pedestrian",
            accessibility_preferences: {
              elevator_access: true,
              wheelchair: mode === "wheelchair",
              wellLitAreas: a11y.visionImpaired,
              avoidStairs: true,
            },
          }),
        },
      );

      if (!routeRes.ok) throw new Error();
      const data = await routeRes.json();

      if (data.success && data.route?.coordinates?.length >= 2) {
        const coords = data.route.coordinates.map((c) => [c.lat, c.lng]);
        setRoutePath(coords);
        setDest(coords[coords.length - 1]);
        setRouteType("walking");
        setTransitSegments([]);
        setTransitAlternatives([]);

        if (data.route.segments?.length > 0) {
          setRouteSegments(data.route.segments);
        } else {
          const segs = [];
          for (let i = 0; i < coords.length - 1; i++) {
            segs.push({
              start: coords[i],
              end: coords[i + 1],
              safety_score: data.route.safety?.overall_safety || 0.7,
              instructions: "Continue on route",
            });
          }
          setRouteSegments(segs);
        }

        const rawSteps = data.route.steps || [];
        if (rawSteps.length > 0) {
          const displaySteps = [
            {
              instruction: `Depart from ${data.route.start_address || "your location"}`,
              travel_mode: "DEPART",
              distance_meters: 0,
              duration_seconds: 0,
            },
            ...rawSteps.map((s) => ({
              ...s,
              instruction: stripHtml(
                s.instruction || s.maneuver?.instruction || "Continue",
              ),
              travel_mode: s.travel_mode || "WALKING",
            })),
            {
              instruction: `Arrive at ${toVal}`,
              travel_mode: "ARRIVE",
              distance_meters: 0,
              duration_seconds: 0,
            },
          ];
          setRouteSteps(displaySteps);
          setShowDirections(true);
        } else {
          setRouteSteps([
            {
              instruction: `Head towards ${toVal}`,
              travel_mode: "WALKING",
              distance_meters: data.route.distance_meters,
              duration_seconds: data.route.duration_seconds,
            },
            {
              instruction: `Arrive at ${toVal}`,
              travel_mode: "ARRIVE",
              distance_meters: 0,
              duration_seconds: 0,
            },
          ]);
          setShowDirections(true);
        }

        setRouteInfo({
          distance: data.route.distance,
          duration: data.route.duration,
          type: "pedestrian",
        });

        const nr = [
          {
            name: toVal,
            address: geoData.results[0].address?.freeformAddress || toVal,
            type: "pedestrian",
          },
          ...recents.filter((r) => r.name !== toVal),
        ].slice(0, 6);
        setRecents(nr);
        localStorage.setItem("ar_recents", JSON.stringify(nr));

        say(`Route found · ${data.route.distance} · ${data.route.duration}`);
        setShow3D(true);
        setTimeout(() => checkRouteForObstructions(coords), 500);
        setTimeout(() => {
          startNavigation(coords);
        }, 300);
      } else {
        say("Couldn't find a route. Try a different destination.");
      }
    } catch (err) {
      console.error("Route calculation error:", err);
      say("Connection error — is the server running?");
    } finally {
      setIsLoading(false);
    }
  };

  const getGPS = () => {
    if (!navigator.geolocation) return;
    say("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc([p.coords.latitude, p.coords.longitude]);
        setFromVal("Current Location");
        say("Location updated ✓");
      },
      () => say("Couldn't get location. Using default."),
    );
  };

  const MapZoomTracker = () => {
    const map = useMap();
    useEffect(() => {
      const u = () => setCurrentZoom(map.getZoom());
      map.on("zoomend", u);
      u();
      return () => map.off("zoomend", u);
    }, [map]);
    return null;
  };

  const togglePanel = (name) => setPanel((p) => (p === name ? null : name));
  const hc = a11y.highContrast;
  const lt = a11y.largeText;

  // ─── render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{CSS}</style>
      <div
        className={`root${hc ? " hc" : ""}`}
        style={{ fontSize: lt ? "1.06rem" : "1rem" }}
        role="application"
        aria-label="AccessRoute — Accessible Navigation"
      >
        <div
          aria-live="assertive"
          aria-atomic="true"
          className="sr"
          role="status"
        >
          {toast}
        </div>

        {/* ── MAP ── */}
        <div className="map-wrap">
          <MapContainer
            center={validCenter}
            zoom={zoom}
            preferCanvas={true}
            style={{
              width: "100%",
              height: "100%",
              filter: hc ? "contrast(1.35)" : "none",
            }}
          >
            <MapZoomTracker />
            <ChangeView
              center={loc}
              zoom={zoom}
              routeBounds={routePath.length >= 2 ? routePath : null}
            />
            <TileLayer
              attribution={mapTypes[mapType].attribution}
              url={mapTypes[mapType].url}
            />

            {/* User position dot */}
            {isValidLatLngArray(loc) && (
              <CircleMarker
                center={loc}
                radius={11}
                pathOptions={{
                  color: "#e8a870",
                  fillColor: "#e8a870",
                  fillOpacity: 0.28,
                  weight: 2,
                }}
              >
                <Popup>
                  <strong style={{ fontFamily: "DM Sans,sans-serif" }}>
                    You are here
                  </strong>
                </Popup>
              </CircleMarker>
            )}

            {/* Destination marker */}
            {dest && isValidLatLngArray(dest) && (
              <Marker position={dest} icon={destinationIcon}>
                <Popup>
                  <strong>Destination</strong>
                  <br />
                  <small style={{ color: "#e0c8b0" }}>{toVal}</small>
                </Popup>
              </Marker>
            )}

            {/* Construction zone markers */}
            {constructionZones.map((zone, idx) => (
              <ObstructionMarker
                key={`cz-${idx}`}
                lat={zone.lat}
                lng={zone.lng}
                type="construction"
                iconCategory={zone.icon_category}
                description={zone.description}
                radius={zone.radius}
                zoomLevel={currentZoom}
                extra={
                  zone.distance_meters ? (
                    <div style={{ fontSize: 11, color: "#b09878" }}>
                      📍 {zone.distance_meters.toFixed(0)}m from route
                    </div>
                  ) : null
                }
              />
            ))}

            {/* Hazard markers */}
            {activeHazards.map((hazard, idx) => (
              <ObstructionMarker
                key={`hz-${idx}`}
                lat={hazard.lat}
                lng={hazard.lng}
                type={hazard.type || "hazard"}
                iconCategory={hazard.icon_category}
                description={hazard.description}
                radius={hazard.radius}
                zoomLevel={currentZoom}
                extra={
                  hazard.severity ? (
                    <div style={{ fontSize: 11 }}>
                      <span
                        style={{
                          color: hazard.severity > 0.7 ? "#ff7b6b" : "#ffb347",
                        }}
                      >
                        ⚡ Severity: {Math.round(hazard.severity * 100)}%
                      </span>
                    </div>
                  ) : null
                }
              />
            ))}

            {/* Obstructed road segments from TomTom */}
            {obstructedRoads.map((seg, idx) => (
              <ObstructedRoadSegment
                key={`road-${idx}`}
                segment={seg}
                zoomLevel={currentZoom}
              />
            ))}

            {/* ── 911 EMERGENCY MARKERS ── */}
            {emergencies911.map((emergency, idx) => (
              <Marker
                key={`emergency-${idx}`}
                position={[emergency.lat, emergency.lng]}
                icon={makeLucideIcon(
                  emergency.type === "accident"
                    ? CarFront
                    : emergency.type === "fire"
                      ? Flame
                      : emergency.type === "medical"
                        ? Stethoscope
                        : emergency.type === "hazardous"
                          ? TriangleAlert
                          : emergency.type === "rescue"
                            ? Siren
                            : ShieldAlert,
                  emergency.severity > 0.7 ? "#ff4444" : "#ff8844",
                  "#ff0000",
                  Math.min(
                    42,
                    Math.max(28, 28 + ((currentZoom - 12) / 6) * 14),
                  ),
                )}
              >
                <Popup>
                  <div
                    style={{ fontFamily: "DM Sans,sans-serif", minWidth: 200 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 12,
                        paddingBottom: 8,
                        borderBottom: "1px solid rgba(255,68,68,0.3)",
                      }}
                    >
                      {emergency.type === "accident" && (
                        <CarFront size={18} color="#ff4444" />
                      )}
                      {emergency.type === "fire" && (
                        <Flame size={18} color="#ff4444" />
                      )}
                      {emergency.type === "medical" && (
                        <Stethoscope size={18} color="#ff4444" />
                      )}
                      {emergency.type === "hazardous" && (
                        <TriangleAlert size={18} color="#ff8844" />
                      )}
                      {emergency.type === "rescue" && (
                        <Siren size={18} color="#ff4444" />
                      )}
                      {!emergency.type && (
                        <ShieldAlert size={18} color="#ff4444" />
                      )}
                      <strong style={{ color: "#ff6666", fontSize: 14 }}>
                        🚨 911 EMERGENCY
                      </strong>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: "bold",
                        color: "#fff",
                        marginBottom: 6,
                      }}
                    >
                      {emergency.description ||
                        `${emergency.type?.toUpperCase()} incident`}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#e0c8b0",
                        marginBottom: 4,
                      }}
                    >
                      {emergency.subtype && (
                        <span
                          style={{ display: "inline-block", marginRight: 12 }}
                        >
                          📋 {emergency.subtype}
                        </span>
                      )}
                      {emergency.severity && (
                        <span>
                          ⚡ Severity: {Math.round(emergency.severity * 100)}%
                        </span>
                      )}
                    </div>
                    {emergency.timestamp && (
                      <div
                        style={{ fontSize: 10, color: "#b09878", marginTop: 6 }}
                      >
                        🕒 Reported:{" "}
                        {new Date(emergency.timestamp).toLocaleString()}
                      </div>
                    )}
                    {emergency.distance_meters && (
                      <div style={{ fontSize: 10, color: "#b09878" }}>
                        📍 {emergency.distance_meters.toFixed(0)}m from center
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: 10,
                        color: "#ff8888",
                        marginTop: 8,
                        paddingTop: 6,
                        borderTop: "1px solid rgba(255,68,68,0.2)",
                      }}
                    >
                      ⚠️ Active emergency response in area
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* ── TRANSIT route: colour walking vs bus segments differently ── */}
            {transitSegments.length > 0 ? (
              transitSegments.map((seg, idx) => {
                const isTransit = seg.type === "transit";
                return (
                  <React.Fragment key={`tseg-${idx}`}>
                    {/* Shadow */}
                    <Polyline
                      positions={seg.coords}
                      pathOptions={{
                        color: "#000",
                        weight: isTransit ? 12 : 8,
                        opacity: 0.25,
                        lineCap: "round",
                        lineJoin: "round",
                      }}
                    />
                    {/* Main line */}
                    <Polyline
                      positions={seg.coords}
                      pathOptions={{
                        color: isTransit ? "#4fc3f7" : "#8cd69c",
                        weight: isTransit ? 7 : 5,
                        opacity: 1,
                        dashArray: isTransit ? undefined : "10,6",
                        lineCap: "round",
                        lineJoin: "round",
                      }}
                    >
                      <Popup>
                        <div style={{ fontFamily: "DM Sans,sans-serif" }}>
                          {isTransit ? (
                            <>
                              <Bus
                                size={12}
                                style={{
                                  verticalAlign: "middle",
                                  color: "#4fc3f7",
                                }}
                              />{" "}
                              <strong>Transit segment</strong>
                            </>
                          ) : (
                            <>
                              <Footprints
                                size={12}
                                style={{
                                  verticalAlign: "middle",
                                  color: "#8cd69c",
                                }}
                              />{" "}
                              <strong>Walking segment</strong>
                            </>
                          )}
                        </div>
                      </Popup>
                    </Polyline>
                  </React.Fragment>
                );
              })
            ) : routeSegments.length > 0 ? (
              /* Walking route with safety colouring and obstruction detection */
              routeSegments.map((seg, idx) => {
                let hasObs = false,
                  obsDesc = null;
                for (const z of constructionZones) {
                  const d = pointToSegmentDistanceMeters(
                    [z.lng, z.lat],
                    [seg.start[1], seg.start[0]],
                    [seg.end[1], seg.end[0]],
                  );
                  if (d < (z.radius || 50)) {
                    hasObs = true;
                    obsDesc = z.description;
                    break;
                  }
                }
                if (!hasObs)
                  for (const h of activeHazards) {
                    const d = pointToSegmentDistanceMeters(
                      [h.lng, h.lat],
                      [seg.start[1], seg.start[0]],
                      [seg.end[1], seg.end[0]],
                    );
                    if (d < (h.radius || 50)) {
                      hasObs = true;
                      obsDesc = h.description;
                      break;
                    }
                  }
                return (
                  <React.Fragment key={`seg-${idx}`}>
                    <Polyline
                      positions={[seg.start, seg.end]}
                      pathOptions={{
                        color: "#000",
                        weight: 10,
                        opacity: 0.4,
                        lineCap: "round",
                        lineJoin: "round",
                      }}
                    />
                    {hasObs && (
                      <>
                        <Polyline
                          positions={[seg.start, seg.end]}
                          pathOptions={{
                            color: "rgba(255,123,107,0.5)",
                            weight: 18,
                            opacity: 0.55,
                            lineCap: "round",
                            lineJoin: "round",
                            className: "obstruction-overlay",
                          }}
                        />
                        <Polyline
                          positions={[seg.start, seg.end]}
                          pathOptions={{
                            color: "#ff7b6b",
                            weight: 3,
                            opacity: 0.9,
                            lineCap: "round",
                            lineJoin: "round",
                            dashArray: "8,8",
                            className: "obstruction-border",
                          }}
                        />
                      </>
                    )}
                    <Polyline
                      positions={[seg.start, seg.end]}
                      pathOptions={{
                        color: getSegmentColor(seg.safety_score || 0.7),
                        weight: 6,
                        opacity: 1,
                        lineCap: "round",
                        lineJoin: "round",
                      }}
                    >
                      <Popup>
                        <div>
                          <strong>Segment {idx + 1}</strong>
                          <br />
                          Safety: {Math.round((seg.safety_score || 0.7) * 100)}%
                          <br />
                          {hasObs && obsDesc && (
                            <div style={{ color: "#ff7b6b" }}>
                              <TriangleAlert size={12} /> {obsDesc}
                            </div>
                          )}
                          {seg.instructions || "Continue on route"}
                        </div>
                      </Popup>
                    </Polyline>
                  </React.Fragment>
                );
              })
            ) : routePath.length >= 2 ? (
              /* Fallback plain route */
              <>
                <Polyline
                  positions={routePath}
                  pathOptions={{
                    color: mode === "wheelchair" ? "#e8a870" : "#8cd69c",
                    weight: 14,
                    opacity: 0.2,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                />
                <Polyline
                  positions={routePath}
                  pathOptions={{
                    color: "#1a0c04",
                    weight: 8,
                    opacity: 0.6,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                />
                <Polyline
                  positions={routePath}
                  pathOptions={{
                    color: mode === "wheelchair" ? "#f0b060" : "#60e890",
                    weight: 5,
                    opacity: 1,
                    dashArray: mode === "wheelchair" ? "14,10" : undefined,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                />
              </>
            ) : null}

            {/* Alternative routes overlay */}
            {alternativeRoutes.map(
              (alt, idx) =>
                alt.waypoints?.length > 0 && (
                  <Polyline
                    key={`alt-${idx}`}
                    positions={alt.waypoints}
                    pathOptions={{
                      color: "#e8a870",
                      weight: 3,
                      opacity: 0.6,
                      dashArray: "10,5",
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                  >
                    <Popup>
                      <div>
                        <strong>Alternative {idx + 1}</strong>
                        <br />
                        {alt.duration_minutes} min
                      </div>
                    </Popup>
                  </Polyline>
                ),
            )}

            {/* ── TRANSIT ALTERNATIVE ROUTES (dotted) ── */}
            {transitAlternatives.map(
              (alt, altIdx) =>
                alt.coords.length > 1 && (
                  <Polyline
                    key={`transit-alt-${altIdx}`}
                    positions={alt.coords}
                    pathOptions={{
                      color: "#e8a870",
                      weight: 3,
                      opacity: 0.55,
                      dashArray: "8,7",
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                  >
                    <Popup>
                      <div style={{ fontFamily: "DM Sans,sans-serif" }}>
                        <strong>Alternative {alt.index}</strong>
                        <br />
                        {alt.route_summary}
                        <br />
                        <small style={{ color: "#b09878" }}>
                          {Math.round(alt.total_time_seconds / 60)} min ·
                          Safety: {Math.round((alt.safety || 0.7) * 100)}%
                        </small>
                      </div>
                    </Popup>
                  </Polyline>
                ),
            )}
          </MapContainer>
        </div>

        {/* ── 3D WALK VIEW (New integrated panel) ── */}
        {navigationActive && routePath.length > 0 && (
          <div className="nav-3d-panel">
            <Suspense
              fallback={
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    background: "rgba(0,0,0,0.7)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                  }}
                >
                  Loading 3D View...
                </div>
              }
            >
              <Walking3DView
                route={routePath}
                routeSteps={routeSteps}
                currentStepIndex={currentStepIndex}
                distanceToNextTurn={distanceToNextTurn}
                hazards={transformedHazards}
                constructionZones={constructionZones}
                emergencies={emergencies911}
                userPosition={walkerPosition}
                userHeading={walkerHeading}
                navigationState={navigationState}
                routeSafety={avgSafety}
                remainingDistance={remainingTotalDistance}
                estimatedTime={estimatedTimeRemaining}
                routeType={routeType}
                transitSegments={transitSegments}
                testMode={process.env.NODE_ENV === "development"}
                onTestPositionUpdate={(newPos) => {
                  setWalkerPosition(newPos);
                }}
                onClose={() => setShow3D(false)}
                style={{ width: "100%", height: "100%" }}
              />
            </Suspense>
          </div>
        )}

        {routePath.length > 0 && !navigationActive && !show3D && (
          <button
            className="view3d-toggle"
            onClick={() => {
              setShow3D(true);
              startNavigation(routePath);
            }}
          >
            <Play size={12} /> Start Navigation
          </button>
        )}

        {/* ── NAVIGATION RAIL ── */}
        <nav className="rail" role="navigation" aria-label="Main navigation">
          <div className="r-logo" aria-hidden="true">
            <Accessibility size={20} />
          </div>
          <button
            className={`r-btn${panel === "saved" ? " on" : ""}`}
            onClick={() => togglePanel("saved")}
            data-tip="Saved Places"
            aria-label="Saved places"
            aria-pressed={panel === "saved"}
          >
            <Bookmark size={18} />
            <span className="r-lbl">Saved</span>
          </button>
          <button
            className={`r-btn${panel === "recents" ? " on" : ""}`}
            onClick={() => togglePanel("recents")}
            data-tip="Recent Routes"
            aria-label="Recent routes"
            aria-pressed={panel === "recents"}
          >
            <Clock size={18} />
            <span className="r-lbl">Recent</span>
          </button>
          <button
            className={`r-btn${showTransitInfo ? " on" : ""}`}
            onClick={getTransitInfo}
            data-tip="Transit Info"
            aria-label="Transit info"
          >
            <Bus size={18} />
            <span className="r-lbl">Transit</span>
          </button>
          <div className="r-sep" aria-hidden="true" />
          <button
            className={`r-btn${panel === "a11y" ? " on" : ""}`}
            onClick={() => togglePanel("a11y")}
            data-tip="Accessibility"
            aria-label="Accessibility settings"
            aria-pressed={panel === "a11y"}
          >
            <Settings size={18} />
            <span className="r-lbl">Access</span>
          </button>
          {/* ── VOICE NAVIGATION BUTTON ── */}
          <button
            className={`r-btn${showVoiceModal ? " on" : ""}`}
            onClick={() => setShowVoiceModal(true)}
            data-tip="Voice Navigation"
            aria-label="Voice navigation"
            aria-pressed={showVoiceModal}
          >
            <Mic size={18} />
            <span className="r-lbl">Voice</span>
          </button>
          <div className="r-space" aria-hidden="true" />
          <button
            className="r-btn"
            onClick={getGPS}
            data-tip="My Location"
            aria-label="Center on my location"
          >
            <LocateFixed size={18} />
          </button>
        </nav>

        {/* ── SIDE PANEL ── */}
        <aside
          ref={panelRef}
          className={`panel${panel ? " open" : ""}`}
          role="complementary"
        >
          <div className="p-head">
            <div className="p-title">
              {panel === "saved"
                ? "Saved Places"
                : panel === "recents"
                  ? "Recent Routes"
                  : "Accessibility"}
            </div>
            <button
              className="p-close"
              onClick={() => setPanel(null)}
              aria-label="Close panel"
            >
              <X size={14} />
            </button>
          </div>
          <div className="p-body">
            {panel === "saved" && (
              <>
                <div>
                  <div className="p-sec">Pinned</div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {SAVED_PLACES.map((d) => (
                      <button
                        key={d.name}
                        className="p-item"
                        onClick={() => {
                          setToVal(d.name);
                          say(`Destination: ${d.name}`);
                          setPanel(null);
                        }}
                      >
                        <div className={`p-ico ${d.color}`}>
                          <d.Icon size={15} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="p-name">{d.name}</div>
                          <div className="p-sub">
                            <Accessibility
                              size={10}
                              style={{ color: "var(--green)" }}
                            />
                            {d.sub}
                          </div>
                        </div>
                        <span className="p-arr">
                          <ChevronRight size={14} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="p-sec">Nearby in Pittsburgh</div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {NEARBY_PITTSBURGH.map((d) => (
                      <button
                        key={d.name}
                        className="p-item"
                        onClick={() => {
                          setToVal(d.name);
                          say(`Destination: ${d.name}`);
                          setPanel(null);
                        }}
                      >
                        <div className={`p-ico ${d.color}`}>
                          <d.Icon size={15} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="p-name">{d.name}</div>
                          <div className="p-sub">{d.sub}</div>
                        </div>
                        <span className="p-arr">
                          <ChevronRight size={14} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {panel === "recents" && (
              <div>
                <div className="p-sec">Recent</div>
                {recents.length === 0 ? (
                  <div className="p-empty">
                    No recent routes yet.
                    <br />
                    Routes you calculate will appear here.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {recents.map((r, i) => (
                      <button
                        key={i}
                        className="p-item"
                        onClick={() => {
                          setToVal(r.name);
                          say(`Destination: ${r.name}`);
                          setPanel(null);
                        }}
                      >
                        <div className="p-ico">
                          <Clock size={15} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="p-name">{r.name}</div>
                          <div className="p-sub">Recent destination</div>
                        </div>
                        <span className="p-arr">
                          <ChevronRight size={14} />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {panel === "a11y" && (
              <>
                <div>
                  <div className="p-sec">Accessibility Modes</div>
                  <div className="ag">
                    {A11Y_FEATS.map((f) => (
                      <button
                        key={f.key}
                        className={`ab${a11y[f.key] ? " on" : ""}`}
                        onClick={() =>
                          setA11y((p) => ({ ...p, [f.key]: !p[f.key] }))
                        }
                        aria-pressed={a11y[f.key]}
                      >
                        <span className="ab-i">
                          <f.Icon size={14} />
                        </span>
                        <span className="ab-l">{f.label}</span>
                        <span className="ab-c">{a11y[f.key] ? "✓" : ""}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="p-sec">Map Style</div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {Object.entries(mapTypes).map(([k, v]) => {
                      const MIcon = MAP_TYPE_ICONS[k] || Layers;
                      return (
                        <button
                          key={k}
                          className={`p-item${mapType === k ? " sel" : ""}`}
                          onClick={() => {
                            setMapType(k);
                            say(`${v.name} map`);
                          }}
                        >
                          <div className="p-ico">
                            <MIcon size={15} />
                          </div>
                          <div className="p-name">{v.name}</div>
                          {mapType === k && (
                            <span
                              style={{
                                marginLeft: "auto",
                                color: "var(--wood)",
                              }}
                            >
                              <ChevronRight size={14} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="p-sec">Route Preferences</div>
                  <div className="ag">
                    {PREF_FEATS.map((f) => (
                      <button
                        key={f.k}
                        className={`ab${prefs[f.k] ? " on" : ""}`}
                        onClick={() =>
                          setPrefs((p) => ({ ...p, [f.k]: !p[f.k] }))
                        }
                      >
                        <span className="ab-i">
                          <f.Icon size={14} />
                        </span>
                        <span className="ab-l">{f.l}</span>
                        <span className="ab-c">{prefs[f.k] ? "✓" : ""}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>

        {/* ── SEARCH / ROUTE PLANNER CARD ── */}
        <div
          className={`sc${searchPanelCollapsed ? " collapsed" : ""}`}
          role="search"
          aria-label="Route planner"
        >
          <div className="sc-head">
            <Route size={16} style={{ color: "var(--wood)", flexShrink: 0 }} />
            <div className="sc-brand">
              Try<span>ver</span>
            </div>
            <button
              className="sc-collapse-btn"
              onClick={() => setSearchPanelCollapsed(!searchPanelCollapsed)}
              aria-label={
                searchPanelCollapsed
                  ? "Expand search panel"
                  : "Collapse search panel"
              }
            >
              {searchPanelCollapsed ? (
                <ChevronUp size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>
          </div>

          <div
            className="sc-content"
            style={{
              maxHeight: searchPanelCollapsed ? 0 : "70vh",
              overflowY: "auto",
              transition: "max-height 0.2s ease",
            }}
          >
            {!searchPanelCollapsed && (
              <>
                <div className="sc-inputs">
                  {/* From input */}
                  <div className="ac">
                    <div className="rr">
                      <span className="rr-dot rr-dot-g" />
                      <input
                        ref={fromRef}
                        type="text"
                        value={fromVal}
                        onChange={(e) => {
                          setFromVal(e.target.value);
                          searchFromPlaces(e.target.value);
                        }}
                        className="ri"
                        placeholder="Your starting point"
                        aria-label="Starting location"
                        onKeyDown={fromKD}
                        onFocus={() =>
                          fromSugg.length > 0 && setFromSuggOpen(true)
                        }
                        autoComplete="off"
                      />
                      {fromSuggLoad && (
                        <div
                          style={{
                            position: "absolute",
                            right: 34,
                            top: "50%",
                            transform: "translateY(-50%)",
                          }}
                        >
                          <div className="spn" />
                        </div>
                      )}
                      <button
                        className="ri-btn"
                        onClick={getGPS}
                        title="Use my location"
                      >
                        <Crosshair size={12} />
                      </button>
                    </div>
                    {fromSuggOpen && (
                      <div className="ac-drop" role="listbox">
                        <div className="ac-hd">
                          <MapPin size={10} /> Suggestions
                        </div>
                        {fromSuggLoad && fromSugg.length === 0 ? (
                          <div className="ac-wait">
                            <div className="spn" />
                            Searching…
                          </div>
                        ) : (
                          memoizedFromSuggItems
                        )}
                      </div>
                    )}
                  </div>

                  <div className="ri-conn">
                    <div className="ri-conn-line" />
                    <span className="ri-conn-lbl">to</span>
                  </div>

                  {/* To input */}
                  <div className="ac">
                    <div className="rr">
                      <span className="rr-dot rr-dot-r" />
                      <input
                        ref={destRef}
                        type="text"
                        value={toVal}
                        onChange={(e) => {
                          setToVal(e.target.value);
                          searchPlaces(e.target.value);
                        }}
                        className="ri"
                        placeholder="Address, place or business…"
                        aria-label="Destination"
                        onKeyDown={destKD}
                        onFocus={() => sugg.length > 0 && setSuggOpen(true)}
                        autoComplete="off"
                      />
                      {suggLoad && (
                        <div
                          style={{
                            position: "absolute",
                            right: 9,
                            top: "50%",
                            transform: "translateY(-50%)",
                          }}
                        >
                          <div className="spn" />
                        </div>
                      )}
                      {toVal && !suggLoad && (
                        <button
                          className="ri-btn"
                          tabIndex={-1}
                          onClick={() => {
                            setToVal("");
                            setSugg([]);
                            setSuggOpen(false);
                            destRef.current?.focus();
                          }}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                    {suggOpen && (
                      <div
                        ref={suggRef}
                        className="ac-drop"
                        id="ac-list"
                        role="listbox"
                      >
                        <div className="ac-hd">
                          <MapPin size={10} /> Suggestions
                        </div>
                        {suggLoad && sugg.length === 0 ? (
                          <div className="ac-wait">
                            <div className="spn" />
                            Searching…
                          </div>
                        ) : (
                          memoizedSuggItems
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Mode buttons */}
                <div className="sc-modes" role="radiogroup">
                  {[
                    { id: "walk", Icon: PersonStanding, l: "Walk" },
                    { id: "transit", Icon: Bus, l: "Transit" },
                    { id: "wheelchair", Icon: Accessibility, l: "Access" },
                  ].map((t) => (
                    <button
                      key={t.id}
                      className={`mp${mode === t.id ? " on" : ""}`}
                      onClick={() => {
                        setMode(t.id);
                        clearRoute();
                        say(`${t.l} mode`);
                      }}
                    >
                      <span className="mp-i">
                        <t.Icon size={18} />
                      </span>
                      <span className="mp-l">{t.l}</span>
                    </button>
                  ))}
                </div>

                <button
                  className="sc-find"
                  onClick={calcRoute}
                  disabled={!toVal.trim() || isLoading}
                >
                  {isLoading ? (
                    <>
                      <div className="spn2" /> Calculating…
                    </>
                  ) : (
                    <>
                      <Search size={15} /> Find Safe Route
                    </>
                  )}
                </button>

                {/* Map Legend - Commented out for now */}
                {/* <button className="sc-leg-btn" onClick={() => setLegendOpen((o) => !o)}>
          <span className="sc-leg-lbl">Map Legend</span>
          <ChevronDown size={13} className={`leg-chv${legendOpen ? " open" : ""}`} />
        </button>
        {legendOpen && (
          <div className="sc-leg-body" role="list">
            {[
              { color: "#8cd69c", label: "Safe Route (70-100%)", type: "line" },
              { color: "#ffb347", label: "Caution Route (40-69%)", type: "line" },
              { color: "#ff7b6b", label: "Unsafe Route (0-39%)", type: "line" },
              { color: "#4fc3f7", label: "Transit (Bus) Segment", type: "line" },
              { color: "#8cd69c", label: "Walking Segment", type: "line", dash: true },
              { color: "#ff7b6b", label: "Construction Zone", type: "circle", dash: true },
              { color: "#ffb347", label: "Hazard Area", type: "circle" },
              { color: "#e8a870", label: "Alternative Route", type: "line", dash: true },
            ].map((item) => (
              <div key={item.label} className="leg-row" role="listitem">
                {item.type === "circle" ? (
                  <div style={{ width: 12, height: 12, borderRadius: "50%", background: item.color, border: item.dash ? "1px dashed white" : "none", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 28, height: 3, borderRadius: 2, flexShrink: 0, background: item.dash ? `repeating-linear-gradient(90deg,${item.color} 0,${item.color} 6px,transparent 6px,transparent 10px)` : item.color }} />
                )}
                <span className="leg-lbl">{item.label}</span>
              </div>
            ))}
          </div>
        )} */}
              </>
            )}
          </div>
        </div>

        {/* ── DIRECTIONS PANEL - ATTACHED DIRECTLY UNDER SEARCH PANEL ── */}
        {showDirections && routeSteps.length > 0 && (
          <div
            className="directions-attached"
            style={{
              background: "var(--surface)",
              borderTop: "1px solid var(--border)",
              borderRadius: "0 0 20px 20px",
              marginTop: "-8px",
              marginLeft: "16px",
              marginRight: "16px",
              marginBottom: "16px",
              maxHeight: "45vh",
              overflowY: "auto",
              boxShadow: "0 8px 20px rgba(0,0,0,0.2)",
              animation: "slideDown 0.3s ease",
            }}
          >
            <DirectionsPanel
              steps={routeSteps}
              onClose={() => setShowDirections(false)}
              routeType={routeType}
            />
          </div>
        )}

        {/* ── MAP TYPE BAR ── */}
        <div className="mt-bar" role="radiogroup">
          {Object.entries(mapTypes).map(([k, v]) => {
            const MIcon = MAP_TYPE_ICONS[k] || Layers;
            return (
              <button
                key={k}
                className={`mt-btn${mapType === k ? " on" : ""}`}
                onClick={() => {
                  setMapType(k);
                  say(`${v.name} map`);
                }}
                title={v.name}
              >
                <MIcon size={12} /> {v.name}
              </button>
            );
          })}
        </div>

        {/* Add this animation to your global CSS or style tag */}
        <style>{`
  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  .directions-attached::-webkit-scrollbar {
    width: 6px;
  }
  
  .directions-attached::-webkit-scrollbar-track {
    background: var(--inset);
    border-radius: 10px;
  }
  
  .directions-attached::-webkit-scrollbar-thumb {
    background: var(--wood);
    border-radius: 10px;
  }
`}</style>

        {/* ── ZOOM CONTROLS ── */}
        <div className="mctrl">
          <button
            className="mc"
            onClick={() => throttledSetZoom(Math.min(zoom + 1, 18))}
            aria-label="Zoom in"
          >
            <Plus size={16} />
          </button>
          <button
            className="mc"
            onClick={() => throttledSetZoom(Math.max(zoom - 1, 10))}
            aria-label="Zoom out"
          >
            <Minus size={16} />
          </button>
        </div>

        {/* ── ROUTE INFO BAR ── */}
        {routeInfo && (
          <div className="rbar" role="region" aria-label="Route information">
            <div className="rs">
              <div className="rs-v">{routeInfo.distance}</div>
              <div className="rs-l">Distance</div>
            </div>
            <div className="rs-d" />
            <div className="rs">
              <div className="rs-v">{routeInfo.duration}</div>
              <div className="rs-l">Est. Time</div>
            </div>
            <div className="rs-d" />
            <div className="rs">
              <div className="rs-v" style={{ color: "var(--green)" }}>
                <Accessibility size={16} />
              </div>
              <div className="rs-l">Accessible</div>
            </div>

            {constructionZones.length > 0 && (
              <>
                <div className="rs-d" />
                <div className="rs">
                  <div className="rs-v" style={{ color: "#ff7b6b" }}>
                    <Construction size={14} /> {constructionZones.length}
                  </div>
                  <div className="rs-l">Obstructions</div>
                </div>
              </>
            )}

            {emergencies911.filter((e) => {
              if (!routePath.length) return false;
              let minDist = Infinity;
              for (const point of routePath) {
                const dist = haversineDistance(
                  point[0],
                  point[1],
                  e.lat,
                  e.lng,
                );
                minDist = Math.min(minDist, dist);
              }
              return minDist < 500;
            }).length > 0 && (
              <>
                <div className="rs-d" />
                <div className="rs">
                  <div className="rs-v" style={{ color: "#ff4444" }}>
                    <Siren size={14} />{" "}
                    {
                      emergencies911.filter((e) => {
                        let minDist = Infinity;
                        for (const point of routePath) {
                          const dist = haversineDistance(
                            point[0],
                            point[1],
                            e.lat,
                            e.lng,
                          );
                          minDist = Math.min(minDist, dist);
                        }
                        return minDist < 500;
                      }).length
                    }
                  </div>
                  <div className="rs-l">Emergencies</div>
                </div>
              </>
            )}

            <div className="rs-d" />
            <button
              className={`rs-dir-btn${showDirections ? " on" : ""}`}
              onClick={() => setShowDirections((v) => !v)}
            >
              <List size={13} /> {showDirections ? "Hide" : "Directions"}
            </button>

            {mode === "transit" && (
              <>
                <div className="rs-d" />
                <button className="rs-bus" onClick={getTransitInfo}>
                  <Bus size={14} /> Bus Info
                </button>
              </>
            )}

            <button className="rs-cl" onClick={clearRoute}>
              Clear
            </button>

            {routePath.length > 0 && (
              <>
                <div className="rs-d" />
                <button
                  className={`rs-3d-btn${navigationActive ? " on" : ""}`}
                  onClick={() => {
                    if (navigationActive) {
                      stopNavigation();
                      setShow3D(false);
                    } else {
                      startNavigation(routePath);
                      setShow3D(true);
                    }
                  }}
                >
                  <Navigation size={13} />
                  {navigationActive ? "Stop Nav" : "Navigate"}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── ROUTE ALERT OVERLAY ── */}
        {showRouteAlert && routeAlert && (
          <div
            style={{
              position: "absolute",
              top: 100,
              left: "calc(var(--rail-w) + 14px)",
              right: 14,
              maxWidth: 400,
              background: "var(--surface)",
              border: "1px solid #ff7b6b",
              borderRadius: 16,
              padding: 16,
              zIndex: 100,
              backdropFilter: "blur(24px)",
              boxShadow: "var(--sh-lg)",
              animation: "slideDown 0.3s ease",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <ShieldAlert size={22} color="#ff7b6b" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: "bold", color: "var(--txt)" }}>
                  {routeAlert.message}
                </div>
              </div>
              <button
                onClick={() => setShowRouteAlert(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--txt2)",
                  cursor: "pointer",
                }}
              >
                <X size={16} />
              </button>
            </div>
            {routeAlternatives.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: "bold",
                    marginBottom: 8,
                    color: "var(--wood)",
                  }}
                >
                  Alternative Routes:
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {routeAlternatives.slice(0, 3).map((alt, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setRoutePath(alt.waypoints);
                        setDest(alt.waypoints[alt.waypoints.length - 1]);
                        setRouteInfo({
                          distance: `${(alt.distance_meters / 1000).toFixed(1)} km`,
                          duration: `${alt.duration_minutes} min`,
                        });
                        setShowRouteAlert(false);
                        say(`Switched to ${alt.type} route`);
                      }}
                      style={{
                        background: "var(--inset)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        padding: 10,
                        textAlign: "left",
                        cursor: "pointer",
                        width: "100%",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {alt.type === "transit" ? (
                          <Bus size={14} style={{ color: "var(--wood)" }} />
                        ) : (
                          <PersonStanding
                            size={14}
                            style={{ color: "var(--green)" }}
                          />
                        )}
                        <span style={{ fontWeight: 500, fontSize: 13 }}>
                          {alt.type === "transit" ? "Transit" : "Walking"} •{" "}
                          {alt.duration_minutes} min
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TRANSIT INFO MODAL ── */}
        {showTransitInfo && transitInfo && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%,-50%)",
              width: "90%",
              maxWidth: 500,
              maxHeight: "80vh",
              background: "var(--surface)",
              border: "1px solid var(--border2)",
              borderRadius: 20,
              zIndex: 200,
              backdropFilter: "blur(32px)",
              boxShadow: "var(--sh-lg)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div className="p-head">
              <div className="p-title">Transit Information</div>
              <button
                className="p-close"
                onClick={() => setShowTransitInfo(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ overflowY: "auto", padding: 16 }}>
              {transitInfo.map((route, idx) => (
                <div
                  key={idx}
                  style={{
                    marginBottom: 20,
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: 12,
                  }}
                >
                  <div
                    style={{
                      fontWeight: "bold",
                      color: "var(--wood)",
                      marginBottom: 8,
                    }}
                  >
                    Option {idx + 1}:{" "}
                    {route.duration_str || `${route.duration_minutes} min`}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--txt2)",
                      marginBottom: 8,
                    }}
                  >
                    🚶 Walk: {route.walking_minutes} min · 🚌 Ride:{" "}
                    {route.transit_minutes} min
                  </div>
                  {route.transit_lines.map((line, li) => (
                    <div
                      key={li}
                      style={{
                        background: "var(--inset)",
                        padding: "10px 12px",
                        borderRadius: 10,
                        marginBottom: 8,
                        border: "1px solid rgba(79,195,247,0.2)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <Bus size={14} color="#4fc3f7" />
                        <strong style={{ color: "#4fc3f7" }}>
                          {line.line}
                        </strong>
                        <span style={{ fontSize: 11, color: "var(--txt2)" }}>
                          {line.vehicle}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--txt2)" }}>
                        <span>
                          From:{" "}
                          <strong style={{ color: "var(--txt)" }}>
                            {line.from_stop}
                          </strong>
                        </span>
                        <br />
                        <span>
                          To:{" "}
                          <strong style={{ color: "var(--txt)" }}>
                            {line.to_stop}
                          </strong>
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--txt3)",
                          marginTop: 4,
                        }}
                      >
                        Departs {line.departure_time} · Arrives{" "}
                        {line.arrival_time}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowTransitInfo(false)}
              style={{
                margin: "12px 16px 16px",
                padding: 10,
                background: "var(--wood-g)",
                border: "none",
                borderRadius: 12,
                color: "white",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        )}

        {/* ── TOAST NOTIFICATION ── */}
        <div
          className={`toast${toast ? " vis" : ""}`}
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>

        {/* ── VOICE ACCESSIBILITY MODAL ── */}
        <VoiceAccessibilityModal
          isVisible={showVoiceModal}
          onVisibilityChange={setShowVoiceModal}
          onDismiss={() => setShowVoiceModal(false)}
          onRouteCalculated={(routeData) => {
            if (routeData.success && routeData.route.coordinates?.length >= 2) {
              const coords = routeData.route.coordinates.map((c) => [
                c.lat,
                c.lng,
              ]);
              setRoutePath(coords);
              setDest(coords[coords.length - 1]);
              setRouteType(
                routeData.route.travel_mode === "transit"
                  ? "transit"
                  : "walking",
              );
              setRouteSteps(routeData.route.steps || []);
              setShowDirections(true);
              setRouteInfo({
                distance: routeData.route.distance,
                duration: routeData.route.duration,
                type: routeData.route.travel_mode,
              });
              setShow3D(true);
              startNavigation(coords);
            }
          }}
          userLocation={loc}
        />
      </div>
    </>
  );
}