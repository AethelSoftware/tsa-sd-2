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
} from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

// Lazy load 3D view to reduce initial bundle size
const Walking3DView = lazy(() => import("./Walking3DView"));

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
  if (
    txt.includes("depart") ||
    txt.includes("head") ||
    txt.includes("start")
  )
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
  night: {
    name: "Night",
    url: `https://{s}.api.tomtom.com/map/1/tile/night/main/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}`,
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
  night: Layers,
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

const ObstructionMarker = React.memo(({
  lat,
  lng,
  type,
  iconCategory,
  description,
  radius,
  extra,
  zoomLevel = 13,
}) => {
  if (lat === undefined || lat === null || lng === undefined || lng === null) {
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
});

// ─── Directions Panel ─────────────────────────────────────────────────────────

const DirectionsPanel = React.memo(({ steps, onClose, routeType }) => {
  if (!steps || steps.length === 0) return null;

  // Helper to clean stop names (remove address numbers, etc.)
  const cleanStopName = (name) => {
    if (!name) return "stop";
    // Remove patterns like " + #2238" or " at 123 Main St"
    let cleaned = name.replace(/\s+\+\s+#\d+/, "");
    cleaned = cleaned.replace(/\s+at\s+.+$/, "");
    // Remove trailing numbers like "FREEPORT RD 2238"
    cleaned = cleaned.replace(/\s+\d+$/, "");
    return cleaned;
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

          // Build a cleaner instruction
          let instruction = "";
          if (isFirst) {
            instruction = "Depart from your location";
          } else if (isLast) {
            instruction = `Arrive at ${step.instruction?.replace("Arrive at ", "") || "your destination"}`;
          } else if (isTransit) {
            const routeName = step.route_short_name || step.transit_line || step.trip_id?.split("_")[0] || "Bus";
            const fromStop = cleanStopName(step.departure_stop || step.start_stop || "stop");
            const toStop = cleanStopName(step.arrival_stop || step.end_stop || "next stop");
            instruction = `Take Bus ${routeName} from ${fromStop} to ${toStop}`;
          } else if (isWalk) {
            const toStop = cleanStopName(step.to_stop || step.instruction?.replace("Walk to ", "") || "next stop");
            instruction = `Walk to ${toStop}`;
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
                      {step.route_short_name || step.transit_line || "Bus"}
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

// ─── Main component ───────────────────────────────────────────────────────────

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

  // ── Directions state (from new version) ──
  const [routeSteps, setRouteSteps] = useState([]);
  const [showDirections, setShowDirections] = useState(false);
  const [routeType, setRouteType] = useState("walking"); // "walking" | "transit"
  const [transitSegments, setTransitSegments] = useState([]); // [{coords, type:'walk'|'transit', line}]

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

  // Debug logging (kept from old version)
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

  // Walker animation
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

  // Fetch area obstructions (enhanced from old version with proper sanitization)
  useEffect(() => {
    const fetchAreaObstructions = async () => {
      try {
        const res = await fetch("http://127.0.0.1:5000/api/area-obstructions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: loc[0], lng: loc[1], radius: 10000 }),
        });
        const data = await res.json();
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
                console.warn("Filtered out invalid obstruction:", item);
                return null;
              })
              .filter(Boolean);

          setConstructionZones(sanitize(data.construction_zones));
          setActiveHazards(sanitize(data.hazards));
          console.log(
            `Loaded ${sanitize(data.construction_zones).length} valid zones and ${sanitize(data.hazards).length} valid hazards`,
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

  // Fetch road incidents from TomTom
  useEffect(() => {
    const fetchRoads = async () => {
      try {
        const bbox = `${loc[1] - 0.08},${loc[0] - 0.08},${loc[1] + 0.08},${loc[0] + 0.08}`;
        const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${TOMTOM_API_KEY}&bbox=${bbox}&fields={incidents{geometry{type,coordinates},properties{iconCategory,events{description},from,to,startTime,endTime}}}`;
        const data = await (await fetch(url)).json();
        if (data.incidents?.length > 0) {
          const segs = data.incidents
            .filter((i) =>
              [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14].includes(
                i.properties.iconCategory,
              ),
            )
            .map((inc) => {
              const coords = inc.geometry.coordinates;
              let coordinates = [];
              if (inc.geometry.type === "Point")
                coordinates = [[coords[1], coords[0]]];
              else if (inc.geometry.type === "LineString")
                coordinates = coords.map((c) => [c[1], c[0]]);
              let label = "⚠️ HAZARD",
                color = "rgba(255,140,70,0.95)",
                borderColor = "#ffaa66";
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
          setObstructedRoads(segs);
        }
      } catch {}
    };
    fetchRoads();
  }, [loc]);

  // ─── search ──────────────────────────────────────────────────────────────────

  const searchPlaces = (q) => {
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
        setSugg(m);
        setSuggOpen(m.length > 0);
        setHiIdx(-1);
      } catch {
      } finally {
        setSuggLoad(false);
      }
    }, 280);
  };

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
        body: JSON.stringify({ route_coords: routeCoords }),
      });
      const data = await res.json();
      if (data.success && data.obstructions) {
        // Safely process construction zones
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

        // Safely process hazards
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

          setActiveHazards((prev) => {
            const existing = new Set(prev.map((h) => `${h.lat},${h.lng}`));
            return [
              ...prev,
              ...validHazards.filter(
                (h) => !existing.has(`${h.lat},${h.lng}`),
              ),
            ];
          });
        }

        if (data.obstructions.has_obstruction) {
          setRouteAlert({
            type: "obstruction",
            message: "⚠ Obstruction near your route!",
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
  
      if (data.success && data.route) {
        const transitSteps =
          data.route.steps?.filter((s) => s.type === "transit") || [];
        const walkingSteps =
          data.route.steps?.filter((s) => s.type === "walk") || [];
  
        // Helper function to clean stop names (remove address numbers and patterns)
        const cleanStopName = (name) => {
          if (!name || name === "Stop" || name === "stop") return name;
          // Remove patterns like " + #2238" or " + 2238"
          let cleaned = name.replace(/\s+\+\s*#?\d+/, "");
          // Remove " at " and everything after
          cleaned = cleaned.replace(/\s+at\s+.+$/, "");
          // Remove trailing numbers like "FREEPORT RD 2238"
          cleaned = cleaned.replace(/\s+\d+$/, "");
          // Remove "FREEPORT RD + #2238" pattern
          cleaned = cleaned.replace(/\s+\+\s+#\d+/, "");
          // Remove "STOP #" patterns
          cleaned = cleaned.replace(/STOP\s+#\d+\s*-\s*/i, "");
          cleaned = cleaned.replace(/STOP\s+#\d+/i, "");
          // Capitalize first letter of each word
          cleaned = cleaned.split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
          ).join(' ');
          return cleaned.trim() || name;
        };
  
        // Helper to get user-friendly route name
        const getRouteName = (step) => {
          // Priority order: route_short_name > route_long_name > route_id > trip_id
          if (step.route_short_name && step.route_short_name !== '') {
            return step.route_short_name;
          }
          if (step.route_long_name && step.route_long_name !== '') {
            // Shorten long route names
            const shortName = step.route_long_name.replace(/Bus|Line|Route/i, '').trim();
            return shortName.length > 15 ? shortName.substring(0, 15) : shortName;
          }
          if (step.route_id && step.route_id !== '') {
            return step.route_id;
          }
          if (step.trip_id) {
            // Try to extract route number from trip_id (e.g., "4035020" -> try to map, but fallback)
            const possibleRoute = step.trip_id.split('_')[0];
            if (possibleRoute && !possibleRoute.match(/^\d{7,}$/)) {
              return possibleRoute;
            }
          }
          return "Bus";
        };
  
        // Group transit steps by route line
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
            from_stop: cleanStopName(steps[0]?.start_stop_name || steps[0]?.start_stop || "Stop"),
            to_stop: cleanStopName(steps[steps.length - 1]?.end_stop_name || steps[steps.length - 1]?.end_stop || "Stop"),
            departure_time: steps[0]?.departure_time 
              ? (() => {
                  try {
                    const d = new Date(steps[0].departure_time);
                    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  } catch {
                    return steps[0]?.time ? new Date(steps[0].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Soon";
                  }
                })()
              : steps[0]?.time 
                ? new Date(steps[0].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : "Soon",
            arrival_time: steps[steps.length - 1]?.arrival_time
              ? (() => {
                  try {
                    const d = new Date(steps[steps.length - 1].arrival_time);
                    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  } catch {
                    return steps[steps.length - 1]?.time 
                      ? new Date(steps[steps.length - 1].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : "Arriving";
                  }
                })()
              : steps[steps.length - 1]?.time
                ? new Date(steps[steps.length - 1].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : "Arriving",
            stop_count: steps.length,
          }),
        );
  
        const totalMinutes = Math.round(data.route.total_time_seconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;
  
        // Calculate estimated walking and transit times
        let walkingSeconds = 0;
        let transitSeconds = 0;
        data.route.steps?.forEach((step) => {
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
            total_steps: data.route.steps?.length || 0,
            arrival_time: data.route.arrival_time 
              ? new Date(data.route.arrival_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : "Arriving",
            departure_time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
        setShowTransitInfo(true);
        
        // Create a user-friendly summary message
        const routeSummary = transitLines.map(l => l.line).join(" → ");
        say(`Found ${transitSteps.length} transit connection(s) · ${durationStr} · ${routeSummary}`);
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
  };

  // ─── main route calc ──────────────────────────────────────────────────────────

  const calcRoute = async () => {
    if (!toVal.trim()) {
      say("Please enter a destination");
      return;
    }
    setIsLoading(true);
    say("Finding your safe, accessible route…");
  
    // Reset directions state
    setRouteSteps([]);
    setShowDirections(false);
    setTransitSegments([]);
  
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
  
          if (transitData.success && transitData.route) {
            const steps = transitData.route.steps || [];
  
            // Build segments using path_geometry from backend (SHAPES FROM GTFS!)
            const allCoords = [];
            const segments = [];
  
            steps.forEach((step) => {
              if (step.type === "transit" && step.path_geometry && step.path_geometry.length > 0) {
                // USE THE SHAPE GEOMETRY FROM GTFS shapes.txt!
                const segCoords = step.path_geometry;
                segments.push({
                  coords: segCoords,
                  type: "transit",
                  line: step.route_short_name || "Bus",
                  route_short_name: step.route_short_name,
                });
                segCoords.forEach(c => {
                  if (c[0] && c[1]) allCoords.push(c);
                });
                console.log(`Added transit segment with ${segCoords.length} points from shapes.txt`);
              } else if (step.type === "transit") {
                // Fallback for transit without geometry - use start/end points
                const segCoords = [];
                if (step.start_location) {
                  segCoords.push([step.start_location.lat, step.start_location.lng || step.start_location.lon]);
                }
                if (step.end_location) {
                  segCoords.push([step.end_location.lat, step.end_location.lng || step.end_location.lon]);
                }
                if (segCoords.length > 0) {
                  segments.push({
                    coords: segCoords,
                    type: "transit",
                    line: step.route_short_name || "Bus",
                    route_short_name: step.route_short_name,
                  });
                  segCoords.forEach(c => {
                    if (c[0] && c[1]) allCoords.push(c);
                  });
                }
              } else if (step.type === "walk" && step.to_location) {
                // Walking segments - will be handled separately
                // Just add the point for bounds
                if (step.to_location) {
                  allCoords.push([step.to_location.lat, step.to_location.lon]);
                }
              }
            });
  
            // Add start and end points if not already included
            if (allCoords.length === 0) {
              allCoords.push([startCoords.lat, startCoords.lng], [destCoords.lat, destCoords.lng]);
            }
  
            // Dedupe coordinates for bounds
            const uniqueCoords = allCoords.filter((c, i, arr) => {
              if (i === 0) return true;
              const prev = arr[i - 1];
              return !(prev[0] === c[0] && prev[1] === c[1]);
            });
  
            setRoutePath(uniqueCoords);
            setDest([destCoords.lat, destCoords.lng]);
            setTransitSegments(segments);
            setRouteType("transit");
  
            // Build display steps for directions panel
            const displaySteps = [];
            displaySteps.push({
              instruction: "Depart from your location",
              type: "walk",
              travel_mode: "WALKING",
            });
            
            steps.forEach((step) => {
              if (step.type === "transit") {
                const routeName = step.route_short_name || step.trip_id?.split("_")[0] || "Bus";
                const startStopName = step.start_stop || "stop";
                const endStopName = step.end_stop || "next stop";
                
                displaySteps.push({
                  ...step,
                  instruction: `Take Bus ${routeName} from ${startStopName} to ${endStopName}`,
                  travel_mode: "TRANSIT",
                  transit_line: routeName,
                  departure_stop: startStopName,
                  arrival_stop: endStopName,
                  route_short_name: routeName,
                });
              } else if (step.type === "walk") {
                const toStopName = step.to_stop || "next stop";
                displaySteps.push({
                  ...step,
                  instruction: `Walk to ${toStopName}`,
                  travel_mode: "WALKING",
                });
              }
            });
            
            displaySteps.push({
              instruction: `Arrive at ${toVal}`,
              type: "arrive",
              travel_mode: "ARRIVE",
            });
  
            setRouteSteps(displaySteps);
            setShowDirections(true);
  
            // Build segments for safety colouring (fallback)
            const segs = [];
            for (let i = 0; i < uniqueCoords.length - 1; i++) {
              segs.push({
                start: uniqueCoords[i],
                end: uniqueCoords[i + 1],
                safety_score: transitData.route.safety?.overall_safety || 0.75,
                instructions: "Transit route",
              });
            }
            setRouteSegments(segs);
  
            const totalMinutes = Math.round(transitData.route.total_time_seconds / 60);
            const hours = Math.floor(totalMinutes / 60);
            const mins = totalMinutes % 60;
            const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;
  
            setRouteInfo({
              distance: `${totalMinutes} min transit`,
              duration: durationStr,
              total_minutes: totalMinutes,
              transit_steps: steps.filter((s) => s.type === "transit").length,
              walking_steps: steps.filter((s) => s.type === "walk").length,
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
  
            // Show user-friendly summary
            const routeSummary = steps
              .filter(s => s.type === "transit")
              .map(s => s.route_short_name || "Bus")
              .join(" → ");
            
            say(`Transit route found · ${durationStr} · ${routeSummary || `${steps.filter(s => s.type === "transit").length} connections`}`);
            
            setShow3D(true);
            setTimeout(() => checkRouteForObstructions(uniqueCoords), 500);
            setIsLoading(false);
            return;
          } else {
            say(transitData.error || "No transit routes found. Trying walking route...");
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
  
        // Build turn-by-turn directions
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
                          color:
                            hazard.severity > 0.7 ? "#ff7b6b" : "#ffb347",
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
                          Safety:{" "}
                          {Math.round((seg.safety_score || 0.7) * 100)}%
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
          </MapContainer>
        </div>

        {/* ── 3D WALK VIEW ── */}
        <div
          className={`view3d-panel${show3D && routePath.length > 0 ? "" : " hidden"}`}
        >
          <Suspense fallback={<div style={{ width: "100%", height: "100%", background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>Loading 3D View...</div>}>
            <Walking3DView
              route={routePath}
              hazards={transformedHazards}
              userPosition={walkerPosition || loc}
              navigationState={navState3D}
              routeSafety={avgSafety}
              remainingDistance={remainingDist3D}
              estimatedTime={remainingDist3D / 1.4}
              style={{ width: "100%", height: "100%" }}
            />
          </Suspense>
          <button
            onClick={() => setShow3D(false)}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: "rgba(0,0,0,0.5)",
              border: "none",
              borderRadius: 6,
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#fff",
              zIndex: 20,
            }}
          >
            <X size={12} />
          </button>
        </div>
        {routePath.length > 0 && !show3D && (
          <button className="view3d-toggle" onClick={() => setShow3D(true)}>
            <Play size={12} /> 3D Walk View
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
        <div className="sc" role="search" aria-label="Route planner">
          <div className="sc-head">
            <Route size={16} style={{ color: "var(--wood)", flexShrink: 0 }} />
            <div className="sc-brand">
              Access<span>Route</span>
            </div>
          </div>
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
                  onFocus={() => fromSugg.length > 0 && setFromSuggOpen(true)}
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
                    fromSugg.map((s, i) => {
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
                            <div className="ac-tag">
                              {s.category.split(" ")[0]}
                            </div>
                          )}
                        </button>
                      );
                    })
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
                    sugg.map((s, i) => {
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
                            <div className="ac-tag">
                              {s.category.split(" ")[0]}
                            </div>
                          )}
                        </button>
                      );
                    })
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

          <button
            className="sc-leg-btn"
            onClick={() => setLegendOpen((o) => !o)}
          >
            <span className="sc-leg-lbl">Map Legend</span>
            <ChevronDown
              size={13}
              className={`leg-chv${legendOpen ? " open" : ""}`}
            />
          </button>
          {legendOpen && (
            <div className="sc-leg-body" role="list">
              {[
                {
                  color: "#8cd69c",
                  label: "Safe Route (70-100%)",
                  type: "line",
                },
                {
                  color: "#ffb347",
                  label: "Caution Route (40-69%)",
                  type: "line",
                },
                {
                  color: "#ff7b6b",
                  label: "Unsafe Route (0-39%)",
                  type: "line",
                },
                {
                  color: "#4fc3f7",
                  label: "Transit (Bus) Segment",
                  type: "line",
                },
                {
                  color: "#8cd69c",
                  label: "Walking Segment",
                  type: "line",
                  dash: true,
                },
                {
                  color: "#ff7b6b",
                  label: "Construction Zone",
                  type: "circle",
                  dash: true,
                },
                { color: "#ffb347", label: "Hazard Area", type: "circle" },
                {
                  color: "#e8a870",
                  label: "Alternative Route",
                  type: "line",
                  dash: true,
                },
              ].map((item) => (
                <div key={item.label} className="leg-row" role="listitem">
                  {item.type === "circle" ? (
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: item.color,
                        border: item.dash ? "1px dashed white" : "none",
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 28,
                        height: 3,
                        borderRadius: 2,
                        flexShrink: 0,
                        background: item.dash
                          ? `repeating-linear-gradient(90deg,${item.color} 0,${item.color} 6px,transparent 6px,transparent 10px)`
                          : item.color,
                      }}
                    />
                  )}
                  <span className="leg-lbl">{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

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

        {/* ── ZOOM CONTROLS ── */}
        <div className="mctrl">
          <button
            className="mc"
            onClick={() =>
              setZoom((z) => {
                const n = Math.min(z + 1, 18);
                say(`Zoom ${n}`);
                return n;
              })
            }
            aria-label="Zoom in"
          >
            <Plus size={16} />
          </button>
          <div className="mc-z">{zoom}×</div>
          <button
            className="mc"
            onClick={() =>
              setZoom((z) => {
                const n = Math.max(z - 1, 10);
                say(`Zoom ${n}`);
                return n;
              })
            }
            aria-label="Zoom out"
          >
            <Minus size={16} />
          </button>
        </div>

        {/* ── DIRECTIONS PANEL (new feature) ── */}
        {showDirections && routeSteps.length > 0 && (
          <DirectionsPanel
            steps={routeSteps}
            onClose={() => setShowDirections(false)}
            routeType={routeType}
          />
        )}

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
            {/* Directions toggle button (new feature) */}
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
                    Option {idx + 1}: {route.duration_str || `${route.duration_minutes} min`}
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
                        <strong style={{ color: "#4fc3f7" }}>{line.line}</strong>
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
      </div>
    </>
  );
}