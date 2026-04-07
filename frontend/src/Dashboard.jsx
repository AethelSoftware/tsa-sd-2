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

// ─── Add these near the top of your component (after imports) ───

// Map emergency type → icon component (replaces the inline ternary chain)
const EMERGENCY_ICONS = {
  accident: CarFront,
  fire: Flame,
  medical: Stethoscope,
  hazardous: TriangleAlert,
  rescue: Siren,
};

// Lazy imports
const Walking3DView = lazy(() => import("./Walking3DView"));
const DirectionsPanel = lazy(() => import("./components/DirectionsPanel"));
const ObstructionMarker = lazy(() => import("./components/ObstructionMarker"));

// Separate imports for hook and panel component
import useAlternateDestinations from "./useAlternateDestinations";
const AlternateDestinationsPanel = lazy(
  () => import("./AlternateDestinationsPanel"),
);

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

// ========== helper functions ==========
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

function stripHtml(str = "") {
  return str
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fmtDist(meters) {
  if (!meters) return "";
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

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

function doesRoutePassThroughHazards(
  routeCoords,
  hazards,
  constructionZones,
  bufferMeters = 120,
) {
  const allHazards = [
    ...(hazards || [])
      .filter((h) => h.severity >= 0.5)
      .map((h) => ({
        lat: h.lat,
        lng: h.lng,
        radius: (h.radius || 50) + bufferMeters,
        severity: h.severity,
        label: h.description || "Hazard",
        type: h.type || "hazard",
        source: h.source || "unknown",
      })),
    ...(constructionZones || []).map((z) => ({
      lat: z.lat,
      lng: z.lng,
      radius: (z.radius || 50) + bufferMeters,
      severity: 0.7,
      label: z.description || "Construction",
      type: "construction",
      source: "tomtom",
    })),
  ];

  const encounteredHazards = [];

  for (const hazard of allHazards) {
    for (let i = 0; i < routeCoords.length - 1; i++) {
      const segStart = [routeCoords[i][1], routeCoords[i][0]];
      const segEnd = [routeCoords[i + 1][1], routeCoords[i + 1][0]];
      const hazardPoint = [hazard.lng, hazard.lat];

      const dist = pointToSegmentDistanceMeters(hazardPoint, segStart, segEnd);
      if (dist < hazard.radius) {
        if (
          !encounteredHazards.find(
            (e) => e.lat === hazard.lat && e.lng === hazard.lng,
          )
        ) {
          encounteredHazards.push({ ...hazard, distanceFromRoute: dist });
        }
        break;
      }
    }
  }

  return {
    hasHazards: encounteredHazards.length > 0,
    hazards: encounteredHazards,
    worstSeverity: encounteredHazards.reduce(
      (max, h) => Math.max(max, h.severity),
      0,
    ),
    count: encounteredHazards.length,
  };
}

function isDestinationInHazardZone(
  destLat,
  destLng,
  hazards,
  constructionZones,
) {
  const allHazards = [
    ...(hazards || []).filter((h) => h.severity >= 0.6),
    ...(constructionZones || []).map((z) => ({ ...z, severity: 0.7 })),
  ];

  for (const hazard of allHazards) {
    const dist = haversineDistance(destLat, destLng, hazard.lat, hazard.lng);
    if (dist < (hazard.radius || 50)) {
      return { inHazard: true, hazard };
    }
  }
  return { inHazard: false, hazard: null };
}

function inferCategory(destinationName, destinationAddress = "") {
  const name = (destinationName + " " + destinationAddress).toLowerCase();
  if (/museum|gallery|exhibit|art|science center/.test(name)) return "museum";
  if (
    /hospital|medical|upmc|allegheny health|urgent care|clinic|er |emergency room/.test(
      name,
    )
  )
    return "medical";
  if (/university|college|school|campus|academy/.test(name)) return "education";
  if (/coffee|cafe|starbucks|dunkin|espresso|roast/.test(name)) return "cafe";
  if (
    /restaurant|dining|kitchen|grill|bar |pub |tavern|bistro|eatery/.test(name)
  )
    return "restaurant";
  if (/park|trail|greenway|reserve|recreation|garden/.test(name)) return "park";
  if (/mall|shopping|store|shop|market|grocery/.test(name)) return "shopping";
  if (/pharmacy|cvs|walgreens|rite aid|drug/.test(name)) return "pharmacy";
  if (/library|public library/.test(name)) return "library";
  if (/transit|bus stop|station|terminal/.test(name)) return "transit";
  return "general";
}

// NEW color palette for alternate elements
const ALTERNATE_COLORS = {
  ROUTE_1: {
    line: "#818cf8",
    halo: "rgba(129,140,248,0.35)",
    label: "Indigo",
    darkText: "#312e81",
  },
  ROUTE_2: {
    line: "#f472b6",
    halo: "rgba(244,114,182,0.35)",
    label: "Pink",
    darkText: "#831843",
  },
  ALT_DEST: {
    line: "#c084fc",
    halo: "rgba(192,132,252,0.35)",
    label: "Purple",
    darkText: "#581c87",
  },
};

// Floating arrow label generator
function makeAltRouteLabel(
  routeLabel,
  distance,
  hazardCount,
  color,
  isDestination = false,
) {
  const icon = isDestination ? "◆" : "▶";
  const hazardText =
    hazardCount === 0
      ? `<span style="color:#8cd69c;margin-left:5px;">✓ Safe</span>`
      : `<span style="color:#ffb347;margin-left:5px;">⚠ ${hazardCount}</span>`;
  const displayLabel = isDestination
    ? routeLabel.length > 20
      ? routeLabel.slice(0, 20) + "…"
      : routeLabel
    : routeLabel;
  return `
    <div style="
      background:rgba(10,6,2,0.96);
      border:1.5px solid ${color};
      border-radius:10px;
      padding:6px 12px 6px 8px;
      color:${color};
      font-family:'DM Sans',system-ui,sans-serif;
      font-size:11px;
      font-weight:700;
      white-space:nowrap;
      box-shadow:0 3px 12px rgba(0,0,0,0.55);
      cursor:pointer;
      pointer-events:auto;
      display:flex;
      align-items:center;
      gap:6px;
      user-select:none;
    ">
      <span style="font-size:10px;">${icon}</span>
      <span>${displayLabel} · ${distance}${hazardText}</span>
    </div>
  `;
}

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

  /* ── Animations ── */
  @keyframes slideDown { from{opacity:0;transform:translateY(-20px)} to{opacity:1;transform:translateY(0)} }
  @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
  @keyframes pulse-overlay { 0%,100%{opacity:0.45} 50%{opacity:0.65} }
  @keyframes dash-flow { to{stroke-dashoffset:-16} }
  @keyframes spin { to{transform:rotate(360deg)} }
  @keyframes fd { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:translateY(0)} }
  @keyframes blk { 0%,100%{opacity:1;transform:translateY(-50%) scale(1)} 50%{opacity:.55;transform:translateY(-50%) scale(1.4)} }
  @keyframes su { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes dash-flow-road-top { to{stroke-dashoffset:-36} }
  @keyframes altPulse { 0%, 100% { stroke-opacity: 0.72; } 50% { stroke-opacity: 1.0; } }
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
  @keyframes arrival-pulse { 0% { transform: scale(0.5); opacity: 1; } 100% { transform: scale(3); opacity: 0; } }
  @keyframes step-slide-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  .obstruction-overlay { animation: pulse-overlay 2s ease-in-out infinite; }
  .obstruction-border { animation: dash-flow 0.5s linear infinite; stroke-dashoffset:0; }
  .obstructed-road-border-top { animation:dash-flow-road-top 0.8s linear infinite;stroke-dashoffset:0;filter:drop-shadow(0 0 2px rgba(255,255,255,0.5)); }

  /* ── Root ── */
  .root { font-family:var(--ff-b);background:var(--bg);color:var(--txt);width:100vw;height:100vh;overflow:hidden;position:relative; }
  .map-wrap { position:absolute;inset:0;z-index:0; }

  /* ── Leaflet overrides ── */
  .leaflet-container { background:#0e0804 !important; }
  .leaflet-tile-pane { filter:saturate(.7) brightness(.82) sepia(.08); }
  .leaflet-popup-content-wrapper { background:var(--card) !important;border:1px solid var(--border2) !important;border-radius:12px !important;color:var(--txt) !important;box-shadow:var(--sh) !important;font-family:var(--ff-b) !important; }
  .leaflet-popup-tip { background:rgba(42,26,12,.98) !important; }
  .leaflet-control-zoom { display:none !important; }
  .leaflet-control-attribution { display:none; }

  /* ── Popup utility classes (extracted from inline styles) ── */
  .popup-dest { font-family: DM Sans, sans-serif; }
  .popup-dest strong { display: block; }
  .popup-dest small { color: #e0c8b0; }
  .popup-distance { font-size: 11px; color: #b09878; }
  .popup-severity { font-size: 11px; }
  .popup-segment-label { font-family: DM Sans, sans-serif; }
  .popup-sub { color: #b09878; }
  .popup-icon-transit { vertical-align: middle; color: #4fc3f7; }
  .popup-icon-walk { vertical-align: middle; color: #8cd69c; }
  .popup-alt-name { font-weight: 700; color: var(--wood); margin-bottom: 4px; }
  .popup-alt-safe { font-size: 11px; color: #8cd69c; margin-top: 4px; }
  .popup-compare-btn {
    margin-top: 8px; padding: 5px 10px; background: #c06c30; border: none;
    border-radius: 8px; color: #fff; font-size: 11px; font-weight: 700; cursor: pointer;
  }
  .popup-compare-btn:hover { filter: brightness(1.15); }

  /* ── Emergency popup classes ── */
  .emergency-popup { font-family: DM Sans, sans-serif; min-width: 200px; }
  .emergency-popup-header {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 12px; padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,68,68,0.3);
  }
  .emergency-popup-title { color: #ff6666; font-size: 14px; }
  .emergency-popup-desc { font-size: 13px; font-weight: bold; color: #fff; margin-bottom: 6px; }
  .emergency-popup-meta { font-size: 11px; color: #e0c8b0; margin-bottom: 4px; }
  .emergency-popup-tag { display: inline-block; margin-right: 12px; }
  .emergency-popup-time { font-size: 10px; color: #b09878; margin-top: 4px; }
  .emergency-popup-footer {
    font-size: 10px; color: #ff8888; margin-top: 8px;
    padding-top: 6px; border-top: 1px solid rgba(255,68,68,0.2);
  }

  /* ── 3D loading fallback ── */
  .nav-3d-loading {
    width: 100%; height: 100%; background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center; color: white;
    font-family: var(--ff-b);
  }

  /* ── Route alert (extracted from inline) ── */
  .route-alert {
    position: absolute; top: 100px; left: calc(var(--rail-w) + 14px); right: 14px;
    max-width: 400px; background: var(--surface); border: 1px solid #ff7b6b;
    border-radius: 16px; padding: 16px; z-index: 100;
    backdrop-filter: blur(24px); box-shadow: var(--sh-lg); animation: slideDown 0.3s ease;
  }
  .route-alert-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .route-alert-msg { flex: 1; font-weight: bold; color: var(--txt); }
  .route-alert-close { background: transparent; border: none; color: var(--txt2); cursor: pointer; padding: 4px; }
  .route-alert-alts-title { font-size: 12px; font-weight: bold; margin-bottom: 8px; color: var(--wood); }
  .route-alert-alts { display: flex; flex-direction: column; gap: 8px; }
  .route-alert-alt-btn {
    background: var(--inset); border: 1px solid var(--border); border-radius: 12px;
    padding: 10px; text-align: left; cursor: pointer; width: 100%;
    transition: border-color .15s, background .15s;
  }
  .route-alert-alt-btn:hover { border-color: var(--border2); background: var(--wood-dim); }
  .route-alert-alt-row { display: flex; align-items: center; gap: 8px; }
  .route-alert-alt-label { font-weight: 500; font-size: 13px; }
  .icon-wood { color: var(--wood); }
  .icon-green { color: var(--green); }

  /* ── Transit modal (extracted from inline) ── */
  .transit-modal {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
    width: 90%; max-width: 500px; max-height: 80vh;
    background: var(--surface); border: 1px solid var(--border2);
    border-radius: 20px; z-index: 200; backdrop-filter: blur(32px);
    box-shadow: var(--sh-lg); overflow: hidden; display: flex; flex-direction: column;
  }
  .transit-modal-body { overflow-y: auto; padding: 16px; }
  .transit-modal-route { margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
  .transit-modal-route-title { font-weight: bold; color: var(--wood); margin-bottom: 8px; }
  .transit-modal-route-meta { font-size: 12px; color: var(--txt2); margin-bottom: 8px; }
  .transit-modal-line {
    background: var(--inset); padding: 10px 12px; border-radius: 10px;
    margin-bottom: 8px; border: 1px solid rgba(79,195,247,0.2);
  }
  .transit-modal-line-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .transit-modal-line-name { color: #4fc3f7; }
  .transit-modal-line-vehicle { font-size: 11px; color: var(--txt2); }
  .transit-modal-line-stops { font-size: 12px; color: var(--txt2); }
  .transit-modal-stop { color: var(--txt); }
  .transit-modal-line-time { font-size: 11px; color: var(--txt3); margin-top: 4px; }
  .transit-modal-close-btn {
    margin: 12px 16px 16px; padding: 10px; background: var(--wood-g);
    border: none; border-radius: 12px; color: white; font-weight: bold; cursor: pointer;
  }
  .transit-modal-close-btn:hover { filter: brightness(1.1); }

  /* ── Directions loading ── */
  .dir-loading { padding: 12px; color: var(--txt2); font-size: 12px; }

  /* ── Route bar value colors ── */
  .rs-v-green { color: var(--green); }
  .rs-v-red { color: #ff7b6b; }
  .rs-v-crit { color: #ff4444; }

  /* ── Side panel list container ── */
  .p-list { display: flex; flex-direction: column; gap: 6px; }
  .p-item-text { flex: 1; min-width: 0; }
  .p-sub-icon { color: var(--green); }
  .p-arr-active { margin-left: auto; color: var(--wood); }

  /* ── Search card head icon ── */
  .sc-head-icon { color: var(--wood); flex-shrink: 0; }

  /* ── Spinner positioning ── */
  .ri-spinner-wrap { position: absolute; right: 34px; top: 50%; transform: translateY(-50%); }
  .ri-spinner-wrap-right { position: absolute; right: 9px; top: 50%; transform: translateY(-50%); }

  /* ── Search content collapse ── */
  .sc-content { max-height: 70vh; overflow-y: auto; transition: max-height 0.25s ease, opacity 0.2s ease; }
  .sc-content-collapsed { max-height: 0 !important; overflow: hidden; opacity: 0; }

  /* ── Alt comp drawer classes (extracted from inline) ── */
  .alt-comp-header-row { display: flex; align-items: center; gap: 8px; }
  .alt-comp-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .alt-comp-label { font-family: var(--ff-d); font-size: 15px; font-weight: 700; color: var(--txt); }
  .alt-comp-sublabel { font-size: 11px; color: var(--txt2); }
  .alt-comp-close {
    margin-left: auto; background: var(--inset); border: 1px solid var(--border);
    border-radius: 7px; width: 26px; height: 26px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--txt2);
  }
  .alt-comp-close:hover { color: var(--red); border-color: rgba(255,123,107,.3); background: var(--red-dim); }
  .alt-comp-hazard-banner.safe {
    background: rgba(140,214,156,0.1); border: 1px solid rgba(140,214,156,0.3); color: var(--green);
  }
  .alt-comp-hazard-banner.warn {
    background: rgba(255,179,71,0.08); border: 1px solid rgba(255,179,71,0.25); color: var(--amber);
  }

  /* ═══ RAIL ═══ */
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

  /* ═══ SIDE PANEL ═══ */
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

  /* ═══ SEARCH CARD ═══ */
  .sc { position:absolute;top:14px;left:calc(var(--rail-w) + 14px);z-index:50;width:348px;background:var(--surface);border:1px solid var(--border);border-radius:20px;backdrop-filter:blur(32px);box-shadow:var(--sh-lg),var(--sh-w);transition:border-color .2s; }
  .sc:focus-within { border-color:var(--border2); }
  .sc.collapsed { border-radius: 20px; }
  .sc-head { padding:14px 16px 6px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border); }
  .sc-brand { font-family:var(--ff-d);font-size:15px;font-weight:700;color:var(--txt);letter-spacing:.2px;flex:1; }
  .sc-brand span { color:var(--wood); }
  .sc-collapse-btn {
    background: var(--inset); border: 1px solid var(--border); border-radius: 7px;
    width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--txt2); transition: all .15s; flex-shrink: 0;
  }
  .sc-collapse-btn:hover { color: var(--wood); border-color: var(--border2); }
  .sc-inputs { padding:12px 14px 8px;display:flex;flex-direction:column;gap:6px; }
  .rr { position:relative; }
  .rr-dot { position:absolute;left:13px;top:50%;transform:translateY(-50%);width:8px;height:8px;border-radius:50%;pointer-events:none;z-index:1; }
  .rr-dot-g { background:var(--green);box-shadow:0 0 6px var(--green);animation:blk 2.4s ease infinite; }
  .rr-dot-r { background:var(--red);box-shadow:0 0 6px var(--red); }
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
  .ac-hd { padding:8px 13px 6px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--txt2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px; }
  .ac-row { display:flex;align-items:center;gap:10px;padding:9px 13px;background:transparent;border:none;width:100%;text-align:left;cursor:pointer;transition:background .12s;color:var(--txt); }
  .ac-row:hover,.ac-row.hi { background:var(--wood-dim); }
  .ac-row + .ac-row { border-top:1px solid rgba(232,168,112,.1); }
  .ac-ico { width:28px;height:28px;background:var(--inset);border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--wood); }
  .ac-name { font-size:13px;font-weight:500;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  .ac-addr { font-size:11px;color:var(--txt2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px; }
  .ac-tag { margin-left:auto;font-size:10px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--txt);background:var(--wood-dim);border:1px solid rgba(232,168,112,.3);border-radius:4px;padding:2px 7px;white-space:nowrap;flex-shrink:0;max-width:72px;overflow:hidden;text-overflow:ellipsis; }
  .ac-wait { display:flex;align-items:center;gap:8px;padding:14px;font-size:12px;color:var(--txt2); }
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

  /* ═══ ROUTE INFO BAR ═══ */
  .rbar { position:absolute;bottom:22px;left:calc(var(--rail-w) + 14px);z-index:50;background:var(--surface);border:1px solid var(--border2);border-radius:16px;backdrop-filter:blur(24px);padding:13px 18px;display:flex;align-items:center;gap:14px;box-shadow:var(--sh),var(--sh-w);animation:su .24s ease;flex-wrap:wrap; }
  .rs { display:flex;flex-direction:column;align-items:center;gap:2px; }
  .rs-v { font-family:var(--ff-d);font-size:15px;font-weight:700;color:var(--wood);display:flex;align-items:center;gap:4px; }
  .rs-l { font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--txt2); }
  .rs-d { width:1px;height:24px;background:var(--border); }
  .rs-cl { background:var(--red-dim);border:1px solid rgba(255,123,107,.3);border-radius:8px;padding:5px 10px;color:var(--red);font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;margin-left:4px; }
  .rs-cl:hover { background:rgba(255,123,107,.25);color:#ff9b8b; }
  .rs-bus { background:var(--wood-dim);border:1px solid var(--wood);border-radius:8px;padding:5px 10px;color:var(--wood);font-size:11px;font-weight:700;cursor:pointer;transition:all .15s; }
  .rs-dir-btn { background:var(--blue-dim);border:1px solid var(--blue);border-radius:8px;padding:5px 10px;color:var(--blue);font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:5px; }
  .rs-dir-btn:hover { background:rgba(79,195,247,0.25); }
  .rs-dir-btn.on { background:rgba(79,195,247,0.25); }
  .rs-3d-btn {
    background: var(--blue-dim); border: 1px solid var(--blue); border-radius: 8px;
    padding: 5px 10px; color: var(--blue); font-size: 11px; font-weight: 700;
    cursor: pointer; transition: all .15s; display: flex; align-items: center; gap: 5px;
  }
  .rs-3d-btn:hover { background: rgba(79,195,247,0.25); }
  .rs-3d-btn.on { background: var(--wood-g); border-color: var(--wood); color: #fff; }

  /* ═══ MAP CONTROLS ═══ */
  .mt-bar { position:absolute;top:16px;right:14px;z-index:50;display:flex;gap:5px; }
  .mt-btn { background:var(--surface);border:1px solid var(--border);border-radius:9px;backdrop-filter:blur(20px);padding:7px 12px;display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--txt2);font-family:var(--ff-b);font-size:12px;font-weight:500;transition:all .15s;white-space:nowrap; }
  .mt-btn:hover { color:var(--txt);border-color:var(--border2); }
  .mt-btn.on { color:var(--wood);border-color:var(--wood);background:var(--wood-dim); }
  .mctrl { position:absolute;right:14px;bottom:80px;z-index:50;display:flex;flex-direction:column;gap:5px; }
  .mc { width:40px;height:40px;background:var(--surface);border:1px solid var(--border);border-radius:10px;backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--txt2);transition:all .15s; }
  .mc:hover { border-color:var(--border2);color:var(--wood);background:var(--wood-dim); }

  /* ═══ TOAST ═══ */
  .toast { position:absolute;bottom:24px;left:50%;z-index:200;transform:translateX(-50%) translateY(12px);background:var(--surface);border:1px solid var(--border2);border-radius:50px;backdrop-filter:blur(20px);padding:9px 22px;font-size:12.5px;font-weight:500;color:var(--txt);white-space:nowrap;opacity:0;pointer-events:none;transition:all .24s;max-width:calc(100vw - 100px);text-align:center;overflow:hidden;text-overflow:ellipsis;box-shadow:var(--sh); }
  .toast.vis { opacity:1;transform:translateX(-50%) translateY(0); }
  .sr { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0; }

  /* ═══ DIRECTIONS PANEL ═══ */
  .dir-panel {
    overflow: visible !important; max-height: none !important;
    border-radius: 0 0 20px 20px; border: none !important;
    backdrop-filter: none !important; box-shadow: none !important;
    animation: none !important; position: relative !important;
    font-family: var(--ff-b);
  }
  .dir-header {
    padding: 12px 16px 10px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
  }
  .dir-title {
    font-family: var(--ff-d); font-size: 14px; font-weight: 700; color: var(--txt);
    display: flex; align-items: center; gap: 7px;
  }
  .dir-close {
    background: var(--inset); border: 1px solid var(--border); border-radius: 7px;
    width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--txt2); transition: all .14s; flex-shrink: 0;
  }
  .dir-close:hover { color: var(--red); border-color: rgba(255,123,107,.3); background: var(--red-dim); }
  .dir-list { overflow: visible !important; max-height: none !important; padding: 8px 0; }
  .dir-step {
    display: flex; align-items: flex-start; gap: 10px; padding: 9px 14px;
    transition: background .12s; cursor: default; border-left: 3px solid transparent;
    min-height: 44px; /* touch target */
  }
  .dir-step:hover { background: var(--inset); }
  .dir-step.transit-step { background: rgba(79,195,247,0.05); border-left-color: var(--blue); }
  .dir-step.walk-step { border-left-color: var(--green); }
  .dir-step.first-step { border-left-color: var(--green); }
  .dir-step.last-step { border-left-color: var(--red); }
  .dir-step + .dir-step { border-top: 1px solid rgba(255,255,255,0.04); }
  .dir-icon {
    width: 30px; height: 30px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;
  }
  .dir-icon.walk-icon { background: var(--green-dim); color: var(--green); }
  .dir-icon.transit-icon { background: var(--blue-dim); color: var(--blue); border: 1px solid rgba(79,195,247,0.3); }
  .dir-icon.turn-icon { background: var(--wood-dim); color: var(--wood); }
  .dir-icon.start-icon { background: rgba(140,214,156,0.2); color: var(--green); }
  .dir-icon.end-icon { background: var(--red-dim); color: var(--red); }
  .dir-content { flex: 1; min-width: 0; }
  .dir-instruction { font-size: 12.5px; font-weight: 500; color: var(--txt); line-height: 1.45; word-break: break-word; }
  .dir-meta { display: flex; align-items: center; gap: 8px; margin-top: 3px; }
  .dir-dist { font-size: 11px; color: var(--txt3); }
  .dir-dur { font-size: 11px; color: var(--txt3); }
  .transit-badge {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--blue-dim); border: 1px solid rgba(79,195,247,0.3);
    border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: 700;
    color: var(--blue); text-transform: uppercase; letter-spacing: .4px;
  }
  .walk-badge {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--green-dim); border: 1px solid rgba(140,214,156,0.3);
    border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: 700;
    color: var(--green); text-transform: uppercase; letter-spacing: .4px;
  }

  /* ═══ DIRECTIONS ATTACHED ═══ */
  .directions-attached {
    position: absolute; left: calc(var(--rail-w) + 14px); width: 348px;
    background: var(--surface); border-top: 1px solid var(--border);
    border-radius: 0 0 20px 20px; margin-top: 0;
    box-shadow: 0 8px 20px rgba(0,0,0,0.2); animation: slideDown 0.3s ease;
    z-index: 49; overflow-y: auto !important; overflow-x: hidden !important;
    max-height: 45vh; -webkit-overflow-scrolling: touch; scroll-behavior: smooth;
  }
  .directions-attached::-webkit-scrollbar { width: 5px; }
  .directions-attached::-webkit-scrollbar-track { background: transparent; border-radius: 10px; }
  .directions-attached::-webkit-scrollbar-thumb { background: var(--wood); border-radius: 10px; opacity: 0.7; }

  /* ═══ 3D VIEW ═══ */
  .view3d-toggle {
    position: absolute; bottom: 80px; right: 60px; z-index: 50;
    background: var(--surface); border: 1px solid var(--border2); border-radius: 10px;
    padding: 7px 13px; display: flex; align-items: center; gap: 6px;
    cursor: pointer; color: var(--wood); font-family: var(--ff-b); font-size: 12px;
    font-weight: 600; transition: all .15s; backdrop-filter: blur(20px); box-shadow: var(--sh-w);
  }
  .view3d-toggle:hover { background: var(--wood-dim); }
  .nav-3d-panel {
    position: fixed; z-index: 45; border-radius: 16px; overflow: hidden;
    box-shadow: var(--sh-lg); border: 1px solid rgba(232,168,112,0.22);
    transition: all 0.3s cubic-bezier(.4,0,.2,1); background: #110a04;
  }
  @media (min-width: 1024px) {
    .nav-3d-panel { bottom: 90px; right: 60px; width: 520px; height: 330px; }
  }
  @media (min-width: 768px) and (max-width: 1023px) {
    .nav-3d-panel { bottom: 0; left: 0; right: 0; height: 280px; border-radius: 16px 16px 0 0; }
  }
  @media (max-width: 767px) {
    .nav-3d-panel { inset: 0; border-radius: 0; z-index: 100; }
  }
  .nav-3d-panel.hidden { opacity: 0; pointer-events: none; transform: translateY(20px); }
  .arrival-ring {
    position: absolute; inset: 0; border: 3px solid #14b8a6; border-radius: 50%;
    animation: arrival-pulse 1.5s ease-out infinite; pointer-events: none;
  }
  .hud-instruction-main.new-step { animation: step-slide-in 0.25s ease forwards; }

  /* ═══ ALTERNATE DESTINATIONS ═══ */
  .alt-dest-panel {
    position: absolute; left: calc(var(--rail-w) + 14px); bottom: 90px;
    width: 380px; max-width: calc(100vw - var(--rail-w) - 28px);
    background: var(--surface); border: 1px solid rgba(232,168,112,0.30);
    border-radius: 20px; backdrop-filter: blur(28px); box-shadow: var(--sh-lg);
    z-index: 52; overflow: hidden; animation: slideUp 0.26s ease;
  }
  .alt-dest-header {
    padding: 12px 16px 10px; border-bottom: 1px solid var(--border);
    display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
    background: rgba(255,123,107,0.06);
  }
  .alt-dest-header-icon {
    width: 32px; height: 32px; border-radius: 8px;
    background: rgba(255,123,107,0.15); border: 1px solid rgba(255,123,107,0.35);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #ff7b6b;
  }
  .alt-dest-header-text { flex: 1; min-width: 0; }
  .alt-dest-title { font-family: var(--ff-d); font-size: 13px; font-weight: 700; color: var(--txt); margin-bottom: 2px; }
  .alt-dest-subtitle { font-size: 10px; color: var(--txt2); letter-spacing: 0.2px; }
  .alt-dest-close {
    background: var(--inset); border: 1px solid var(--border); border-radius: 7px;
    width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--txt2); transition: all .14s; flex-shrink: 0;
  }
  .alt-dest-close:hover { color: var(--red); border-color: rgba(255,123,107,.35); background: var(--red-dim); }
  .alt-dest-scroll {
    display: flex; gap: 10px; padding: 12px 14px;
    overflow-x: auto; scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch; scrollbar-width: none;
  }
  .alt-dest-scroll::-webkit-scrollbar { display: none; }
  .alt-card {
    flex-shrink: 0; width: 136px; scroll-snap-align: start;
    background: var(--inset); border: 1px solid var(--border); border-radius: 14px;
    padding: 10px; cursor: pointer; transition: all .18s;
    display: flex; flex-direction: column; gap: 6px; position: relative; overflow: hidden;
  }
  .alt-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: var(--alt-color, var(--wood)); opacity: 0; transition: opacity .18s;
  }
  .alt-card.hovered, .alt-card:hover {
    border-color: var(--alt-color, var(--wood)); background: var(--wood-dim); transform: translateY(-2px);
  }
  .alt-card.hovered::before, .alt-card:hover::before { opacity: 1; }
  .alt-card-badge {
    display: flex; align-items: center; gap: 5px; font-size: 9px; font-weight: 700;
    letter-spacing: 0.5px; text-transform: uppercase; color: var(--alt-color, var(--wood));
  }
  .alt-card-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--alt-color, var(--wood)); flex-shrink: 0; }
  .alt-card-name {
    font-size: 11.5px; font-weight: 600; color: var(--txt); line-height: 1.35;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .alt-card-stat { font-size: 10px; color: var(--txt2); display: flex; align-items: center; gap: 4px; }
  .alt-card-stat.safe { color: var(--green); }
  .alt-card-stat.warn { color: var(--amber); }
  .alt-card-compare-btn {
    margin-top: auto; padding: 5px 0; background: transparent;
    border: 1px solid var(--alt-color, var(--border)); border-radius: 8px;
    color: var(--alt-color, var(--wood)); font-size: 10px; font-weight: 700;
    cursor: pointer; transition: all .14s; text-align: center;
  }
  .alt-card-compare-btn:hover { background: rgba(232,168,112,0.12); }
  .alt-dest-footer { padding: 8px 14px 12px; border-top: 1px solid var(--border); }
  .alt-dest-continue-btn {
    width: 100%; padding: 9px; background: transparent;
    border: 1px solid rgba(255,123,107,0.3); border-radius: 12px;
    color: var(--red); font-family: var(--ff-b); font-size: 11px; font-weight: 600;
    cursor: pointer; transition: all .15s; display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .alt-dest-continue-btn:hover { background: var(--red-dim); border-color: rgba(255,123,107,0.6); }
  .alt-loading-row { display: flex; align-items: center; gap: 10px; padding: 14px 16px; font-size: 12px; color: var(--txt2); }

  /* Comparison Drawer */
  .alt-comparison-drawer {
    position: absolute; z-index: 55; background: var(--surface);
    border: 1px solid var(--border2); backdrop-filter: blur(28px);
    box-shadow: var(--sh-lg); overflow: hidden; display: flex; flex-direction: column;
  }
  .alt-comparison-drawer.desktop {
    top: 0; right: 0; bottom: 0; width: min(460px, 100vw);
    border-radius: 0; border-right: none; animation: slideDown 0.28s ease;
  }
  .alt-comparison-drawer.mobile {
    left: 0; right: 0; bottom: 0; max-height: 92dvh;
    border-radius: 20px 20px 0 0; animation: slideUp 0.28s ease;
  }
  .comp-section { padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .comp-section-label {
    font-size: 9px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase;
    color: var(--txt2); margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
  }
  .comp-section-label::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .comp-route-stats { display: flex; gap: 12px; margin-bottom: 8px; }
  .comp-stat { display: flex; flex-direction: column; gap: 2px; }
  .comp-stat-value { font-family: var(--ff-d); font-size: 14px; font-weight: 700; color: var(--txt); }
  .comp-stat-label { font-size: 9px; letter-spacing: 0.8px; text-transform: uppercase; color: var(--txt2); }
  .comp-steps-list {
    display: flex; flex-direction: column; gap: 0; max-height: 200px;
    overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  }
  .comp-step {
    display: flex; align-items: flex-start; gap: 8px; padding: 7px 4px;
    border-left: 3px solid transparent; transition: background .12s;
    font-size: 11.5px; color: var(--txt); line-height: 1.4;
  }
  .comp-step.hazard { border-left-color: #ff7b6b; background: rgba(255,123,107,0.05); }
  .comp-step-icon {
    width: 22px; height: 22px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11px;
  }
  .comp-hazard-badge {
    display: inline-flex; align-items: center; gap: 3px;
    background: rgba(255,123,107,0.15); border: 1px solid rgba(255,123,107,0.35);
    border-radius: 4px; padding: 1px 5px; font-size: 9px; font-weight: 700;
    color: #ff7b6b; margin-left: 6px;
  }
  .comp-sim-item, .comp-draw-item {
    display: flex; align-items: flex-start; gap: 6px; font-size: 11.5px; padding: 3px 0; line-height: 1.4;
  }
  .comp-sim-item { color: var(--green); }
  .comp-draw-item { color: var(--amber); }
  .comp-accept-btn {
    margin: 12px 16px; padding: 13px; background: var(--wood-g);
    border: none; border-radius: 14px; color: #fff; font-family: var(--ff-d);
    font-size: 14px; font-weight: 700; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: all .2s; box-shadow: var(--sh-w);
  }
  .comp-accept-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 28px rgba(232,168,112,0.5); filter: brightness(1.1); }

  /* ═══ ALT COMP DRAWER (inline route comparison) ═══ */
  .alt-comp-drawer {
    position: absolute; bottom: 90px; left: calc(var(--rail-w) + 14px);
    width: 380px; max-width: calc(100vw - var(--rail-w) - 28px);
    background: var(--surface); border: 1px solid var(--border2);
    border-top: 3px solid var(--wood); border-radius: 16px;
    backdrop-filter: blur(28px); box-shadow: var(--sh-lg);
    z-index: 53; animation: slideUp 0.26s ease;
  }
  .alt-comp-header { padding: 12px 16px 10px; border-bottom: 1px solid var(--border); }
  .alt-comp-stats-grid { display: flex; gap: 0; padding: 12px 16px; }
  .alt-comp-stat-col { flex: 1; text-align: center; }
  .alt-comp-stat-col + .alt-comp-stat-col { border-left: 1px solid var(--border); }
  .alt-comp-col-label { font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
  .alt-comp-stat-value { font-family: var(--ff-d); font-size: 15px; font-weight: 700; color: var(--txt); }
  .alt-comp-stat-sub { font-size: 11px; color: var(--txt2); margin-top: 2px; }
  .alt-comp-hazard-banner {
    margin: 0 16px; padding: 8px 12px; border-radius: 10px;
    font-size: 12px; font-weight: 600; text-align: center;
  }
  .alt-comp-action-area { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .alt-comp-accept {
    width: 100%; padding: 12px; background: var(--wood-g); border: none;
    border-radius: 12px; color: #fff; font-family: var(--ff-d); font-size: 14px;
    font-weight: 700; cursor: pointer; transition: all .2s; box-shadow: var(--sh-w);
  }
  .alt-comp-accept:hover { filter: brightness(1.1); transform: translateY(-1px); }
  .alt-comp-decline {
    width: 100%; padding: 10px; background: transparent;
    border: 1px solid var(--border); border-radius: 12px; color: var(--txt2);
    font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s;
  }
  .alt-comp-decline:hover { border-color: var(--border2); color: var(--txt); }

  /* ═══ MOBILE RESPONSIVE ═══ */
  @media (max-width: 639px) {
    :root { --rail-w: 52px; }
    .r-btn { width: 38px; height: 38px; }
    .r-lbl { font-size: 8px; }
    .r-btn[data-tip]::after { display: none; }
    .sc { left: calc(var(--rail-w) + 8px); width: calc(100vw - var(--rail-w) - 16px); max-width: 360px; top: 10px; }
    .directions-attached { left: calc(var(--rail-w) + 8px); width: calc(100vw - var(--rail-w) - 16px); max-width: 360px; max-height: 55vh; }
    .rbar {
      left: calc(var(--rail-w) + 8px); right: 8px; bottom: 16px;
      padding: 10px 12px; gap: 10px; border-radius: 14px;
      overflow-x: auto; scrollbar-width: none; flex-wrap: nowrap;
    }
    .rbar::-webkit-scrollbar { display: none; }
    .rs-v { font-size: 13px; }
    .rs-l { font-size: 9px; }
    .mt-bar { top: 10px; right: 8px; }
    .mt-btn { padding: 5px 8px; font-size: 11px; }
    .mctrl { right: 8px; bottom: 70px; }
    .mc { width: 36px; height: 36px; }
    .panel { width: calc(100vw - var(--rail-w)); max-width: var(--panel-w); }
    .alt-dest-panel { left: calc(var(--rail-w) + 8px); width: calc(100vw - var(--rail-w) - 16px); }
    .alt-comp-drawer { left: calc(var(--rail-w) + 8px); width: calc(100vw - var(--rail-w) - 16px); }
    .route-alert { left: calc(var(--rail-w) + 8px); right: 8px; max-width: none; }
    .view3d-toggle { right: 8px; bottom: 70px; }
  }

  /* ── Focus visible for keyboard nav ── */
  .r-btn:focus-visible, .p-item:focus-visible, .ab:focus-visible,
  .mp:focus-visible, .sc-find:focus-visible, .mc:focus-visible,
  .mt-btn:focus-visible, .rs-dir-btn:focus-visible, .rs-cl:focus-visible,
  .dir-close:focus-visible, .p-close:focus-visible, .alt-comp-accept:focus-visible,
  .alt-comp-decline:focus-visible, .ri:focus-visible {
    outline: 2px solid var(--wood);
    outline-offset: 2px;
  }

  /* ── High contrast mode ── */
  .hc { --border: rgba(255,255,255,0.35); --border2: rgba(255,255,255,0.55); --txt2: #fff; --txt3: #ddd; }
  .hc .leaflet-tile-pane { filter: contrast(1.4) brightness(0.9); }
`;

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
          dashArray: "8,6",
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
    let geom = step.path_geometry;
    if (!geom || geom.length === 0) {
      if (step.type === "transit" && step.start_location && step.end_location) {
        const start = step.start_location;
        const end = step.end_location;
        geom = [
          [start.lat, start.lon || start.lng],
          [end.lat, end.lon || end.lng],
        ];
      } else if (
        step.type === "walk" &&
        step.from_location &&
        step.to_location
      ) {
        const from = step.from_location;
        const to = step.to_location;
        geom = [
          [from.lat, from.lon || from.lng],
          [to.lat, to.lon || to.lng],
        ];
      }
    }
    if (geom && geom.length) {
      for (const pt of geom) {
        const lat = Array.isArray(pt) ? pt[0] : pt.lat;
        const lon = Array.isArray(pt) ? pt[1] : pt.lon || pt.lng;
        if (lat && lon && !isNaN(lat) && !isNaN(lon)) {
          pts.push([lat, lon]);
        }
      }
    }
  }
  const unique = [];
  for (const p of pts) {
    if (
      unique.length === 0 ||
      Math.abs(unique[unique.length - 1][0] - p[0]) > 0.00001 ||
      Math.abs(unique[unique.length - 1][1] - p[1]) > 0.00001
    ) {
      unique.push(p);
    }
  }
  return unique;
}

function buildDisplayStepsFromTransit(steps) {
  const fmt = (s) => {
    if (!s || isNaN(s) || s <= 0) return "—";
    if (s >= 3600) {
      const h = Math.floor(s / 3600),
        m = Math.round((s % 3600) / 60);
      return m ? `${h}h ${m}m` : `${h}h`;
    }
    if (s >= 60) return `${Math.round(s / 60)} min`;
    return `${Math.round(s)} sec`;
  };
  const display = [];
  for (const step of steps) {
    if (step.type === "walk") {
      const dist = step.distance_meters || 0;
      const dur = step.duration_seconds;
      const toName = step.to_stop || "next stop";
      display.push({
        type: "walk",
        travel_mode: "WALKING",
        instruction: `Walk${dist ? ` ${dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`}` : ""} to ${toName}`,
        distance_meters: dist,
        duration_seconds: dur || 0,
        distance:
          dist < 1000
            ? `${Math.round(dist)} m`
            : `${(dist / 1000).toFixed(1)} km`,
        duration: fmt(dur),
        path_geometry: step.path_geometry || [],
        from_location: step.from_location,
        to_location: step.to_location,
      });
    } else if (step.type === "transit") {
      const routeName = step.route_short_name || "";
      const routeLong = step.route_long_name || "";
      const fromStop = step.start_stop || "";
      const toStop = step.end_stop || "";
      const dur = step.duration_seconds;
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
        duration_seconds: dur || 0,
        duration: fmt(dur),
        path_geometry: step.path_geometry || [],
        start_location: step.start_location,
        end_location: step.end_location,
      });
    }
  }
  return display;
}

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

// ================== MAIN COMPONENT ==================
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

  // GPS/Navigation state
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

  // Directions state
  const [routeSteps, setRouteSteps] = useState([]);
  const [showDirections, setShowDirections] = useState(false);
  const [routeType, setRouteType] = useState("walking");
  const [transitSegments, setTransitSegments] = useState([]);
  const [transitAlternatives, setTransitAlternatives] = useState([]);

  // Voice modal state
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [searchPanelCollapsed, setSearchPanelCollapsed] = useState(false);

  // ── NEW ALTERNATE ROUTES & DESTINATIONS STATE ──
  const [alternateRoutes, setAlternateRoutes] = useState([]);
  const [hoveredAlternateRoute, setHoveredAlternateRoute] = useState(null);
  const [selectedAlternateRoute, setSelectedAlternateRoute] = useState(null);
  const [showAlternateRouteComparison, setShowAlternateRouteComparison] =
    useState(false);
  const [alternateDestinations, setAlternateDestinations] = useState([]);
  const [showAlternateDestinations, setShowAlternateDestinations] =
    useState(false);
  const [alternateDestinationsLoading, setAlternateDestinationsLoading] =
    useState(false);
  const [hoveredAlternate, setHoveredAlternate] = useState(null);
  const [hoveredAltDest, setHoveredAltDest] = useState(false);
  const [selectedAlternate, setSelectedAlternate] = useState(null);
  const [showAlternateComparison, setShowAlternateComparison] = useState(false);
  const [routeHazardSummary, setRouteHazardSummary] = useState(null);
  const [alternatesDismissed, setAlternatesDismissed] = useState(false);
  const alternateCheckDoneRef = useRef(false);

  // Search card position for directions panel
  const searchCardRef = useRef(null);
  const [searchCardBottom, setSearchCardBottom] = useState(250);

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
  const [mapBounds, setMapBounds] = useState(null);

  // ResizeObserver for search card
  useEffect(() => {
    if (!searchCardRef.current) return;
    const update = () => {
      if (!searchCardRef.current) return;
      const rect = searchCardRef.current.getBoundingClientRect();
      setSearchCardBottom(rect.bottom + 8);
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(searchCardRef.current);
    window.addEventListener("resize", update);
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const memoizedSuggItems = useMemo(
    () =>
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
              <div className="ac-tag">{s.category.split(" ")[0]}</div>
            )}
          </button>
        );
      }),
    [sugg, hiIdx],
  );

  const memoizedFromSuggItems = useMemo(
    () =>
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
              <div className="ac-tag">{s.category.split(" ")[0]}</div>
            )}
          </button>
        );
      }),
    [fromSugg, fromHiIdx],
  );

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
  const isValidCoordinate = useCallback(
    (obj) =>
      obj &&
      obj.lat != null &&
      obj.lng != null &&
      !isNaN(obj.lat) &&
      !isNaN(obj.lng) &&
      isFinite(obj.lat) &&
      isFinite(obj.lng),
    [],
  );
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
      )
        return false;
      return true;
    });
  }, []);

  useEffect(() => {
    if (constructionZones.length > 0)
      console.log("First construction zone:", constructionZones[0]);
    if (activeHazards.length > 0)
      console.log("First hazard:", activeHazards[0]);
  }, [constructionZones, activeHazards]);

  const transformedHazards = useMemo(
    () =>
      activeHazards
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
        }),
    [activeHazards],
  );

  const navState3D = useMemo(() => {
    if (!routePath.length) return "idle";
    if (walkerIdx >= routePath.length - 1) return "arrived";
    return "walking";
  }, [routePath, walkerIdx]);
  const remainingDist3D = useMemo(() => {
    if (!routePath.length || walkerIdx >= routePath.length - 1) return 0;
    let d = 0;
    for (let i = walkerIdx; i < routePath.length - 1; i++)
      d += haversineDistance(
        routePath[i][0],
        routePath[i][1],
        routePath[i + 1][0],
        routePath[i + 1][1],
      );
    return d;
  }, [routePath, walkerIdx]);
  const avgSafety = useMemo(() => {
    if (!routeSegments.length) return 0.75;
    return (
      routeSegments.reduce((a, s) => a + (s.safety_score || 0.7), 0) /
      routeSegments.length
    );
  }, [routeSegments]);

  // Memoize nearby emergency count so it's not computed twice per render
  const nearbyEmergencyCount = useMemo(() => {
    if (!routePath.length || !emergencies911.length) return 0;
    return emergencies911.filter((e) => {
      let minDist = Infinity;
      for (const point of routePath) {
        const dist = haversineDistance(point[0], point[1], e.lat, e.lng);
        minDist = Math.min(minDist, dist);
      }
      return minDist < 500;
    }).length;
  }, [routePath, emergencies911]);

  const isInBounds = useCallback(
    (lat, lng) => {
      if (!mapBounds) return true;
      return mapBounds.contains([lat, lng]);
    },
    [mapBounds],
  );
  
  const visibleConstructionZones = useMemo(
    () => constructionZones.filter((z) => isInBounds(z.lat, z.lng)),
    [constructionZones, isInBounds],
  );
  
  const visibleActiveHazards = useMemo(
    () => activeHazards.filter((h) => isInBounds(h.lat, h.lng)),
    [activeHazards, isInBounds],
  );
  
  const visibleEmergencies = useMemo(
    () => emergencies911.filter((e) => isInBounds(e.lat, e.lng)),
    [emergencies911, isInBounds],
  );

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
      let minDist = Infinity,
        closestIdx = 0;
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
      for (let i = closestIdx; i < routePath.length - 1; i++)
        remaining += haversineDistance(
          routePath[i][0],
          routePath[i][1],
          routePath[i + 1][0],
          routePath[i + 1][1],
        );
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
        )
          distToNext += haversineDistance(
            routePath[i][0],
            routePath[i][1],
            routePath[i + 1][0],
            routePath[i + 1][1],
          );
        setDistanceToNextTurn(distToNext);
      }
    },
    [routePath, currentStepIndex, routeSteps],
  );

  const handleGPSUpdate = useCallback(
    (position) => {
      const rawLat = position.coords.latitude,
        rawLng = position.coords.longitude,
        timestamp = position.timestamp;
      const MIN_MOVEMENT_METERS = 1.5,
        GPS_UPDATE_THROTTLE_MS = 500;
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
      if (speed < 0.3)
        setNavigationState((prev) =>
          prev === "arrived" ? "arrived" : "stopped",
        );
      else setNavigationState("walking");
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

  useEffect(() => {
    return () => stopNavigation();
  }, [stopNavigation]);

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
                )
                  return { ...item, lat, lng };
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
          setEmergencies911([...newsHazards, ...arrestHazards]);
          setActiveHazards([...tomtomHazards, ...otherHazards]);
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
        const minLat = 40.2,
          maxLat = 40.8,
          minLng = -80.8,
          maxLng = -79.5;
        const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;
        const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${TOMTOM_API_KEY}&bbox=${bbox}&fields={incidents{geometry{type,coordinates},properties{iconCategory,events{description},from,to,startTime,endTime}}}`;
        const response = await fetch(url);
        if (!response.ok) {
          console.error("TomTom API error:", response.status);
          return;
        }
        const data = await response.json();
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
      } catch (error) {
        console.error("Error fetching TomTom road incidents:", error);
      }
    };
    fetchRoads();
  }, []);

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
              if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng))
                return { ...zone, lat, lng };
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
              if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng))
                return { ...hazard, lat, lng };
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
          setRouteAlert({ type: "obstruction", message });
          setShowRouteAlert(true);
        }
      }
    } catch (err) {
      console.error("Error checking obstructions:", err);
    }
  };

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

  const getTransitInfo = async () => {
    if (!toVal.trim() && !dest) {
      say("Please enter a destination first");
      return;
    }
    try {
      let startLat = loc[0],
        startLng = loc[1];
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
      let endLat = dest?.[0],
        endLng = dest?.[1];
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
          if (step.route_short_name && step.route_short_name !== "")
            return step.route_short_name;
          if (step.route_long_name && step.route_long_name !== "") {
            const shortName = step.route_long_name
              .replace(/Bus|Line|Route/i, "")
              .trim();
            return shortName.length > 15
              ? shortName.substring(0, 15)
              : shortName;
          }
          if (step.route_id && step.route_id !== "") return step.route_id;
          if (step.trip_id) {
            const possibleRoute = step.trip_id.split("_")[0];
            if (possibleRoute && !possibleRoute.match(/^\d{7,}$/))
              return possibleRoute;
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
            line,
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
                    return new Date(steps[0].departure_time).toLocaleTimeString(
                      [],
                      { hour: "2-digit", minute: "2-digit" },
                    );
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
                    return new Date(
                      steps[steps.length - 1].arrival_time,
                    ).toLocaleTimeString([], {
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
        const hours = Math.floor(totalMinutes / 60),
          mins = totalMinutes % 60;
        const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;
        let walkingSeconds = 0,
          transitSeconds = 0;
        bestRoute.steps?.forEach((step) => {
          if (step.type === "walk" && step.duration_seconds)
            walkingSeconds += step.duration_seconds;
          else if (step.type === "transit" && step.duration_seconds)
            transitSeconds += step.duration_seconds;
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
        say(
          `Found ${transitSteps.length} transit connection(s) · ${durationStr} · ${transitLines.map((l) => l.line).join(" → ")}`,
        );
      } else say(data.error || "No transit routes available at this time");
    } catch (err) {
      console.error("Transit info error:", err);
      say("Could not fetch transit information");
    }
  };

  // ================== ALTERNATE ROUTES FETCH ==================
  const fetchAlternateRoutes = useCallback(
    async (startLat, startLng, endLat, endLng, mode, primaryRouteCoords) => {
      const TOMTOM_KEY = "pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM";
      const travelMode = mode === "transit" ? "pedestrian" : "pedestrian";
      const routeVariants = [
        {
          params: { routeType: "shortest", traffic: "true" },
          label: "Alt Route 1",
          color: ALTERNATE_COLORS.ROUTE_1.line,
        },
        {
          params: { routeType: "eco", traffic: "false" },
          label: "Alt Route 2",
          color: ALTERNATE_COLORS.ROUTE_2.line,
        },
      ];
      const results = [];
      let forcedFallback = null;
      for (const variant of routeVariants) {
        try {
          const url = `https://api.tomtom.com/routing/1/calculateRoute/${startLat},${startLng}:${endLat},${endLng}/json`;
          const params = new URLSearchParams({
            key: TOMTOM_KEY,
            travelMode,
            routeRepresentation: "polyline",
            computeTravelTimeFor: "all",
            instructionsType: "text",
            language: "en-US",
            ...variant.params,
          });
          const resp = await fetch(`${url}?${params}`);
          if (!resp.ok) continue;
          const data = await resp.json();
          const route = data.routes?.[0];
          if (!route) continue;
          const legs = route.legs || [];
          const pts = [];
          for (const leg of legs) {
            const points = leg.points || [];
            for (const pt of points) pts.push([pt.latitude, pt.longitude]);
          }
          if (pts.length < 2) continue;
          // Improved distinctness check: require at least 10% of points deviate >30m from primary
          let deviatingPoints = 0;
          const checkInterval = Math.max(1, Math.floor(pts.length / 20));
          for (let pi = 0; pi < pts.length; pi += checkInterval) {
            const pt = pts[pi];
            let minDistFromPrimary = Infinity;
            const searchWindow = Math.max(
              1,
              Math.floor(primaryRouteCoords.length / 10),
            );
            const startSearch = Math.max(
              0,
              Math.floor((pi / pts.length) * primaryRouteCoords.length) -
                searchWindow,
            );
            const endSearch = Math.min(
              primaryRouteCoords.length - 1,
              startSearch + searchWindow * 2,
            );
            for (let qi = startSearch; qi < endSearch; qi++) {
              const d = haversineDistance(
                pt[0],
                pt[1],
                primaryRouteCoords[qi][0],
                primaryRouteCoords[qi][1],
              );
              if (d < minDistFromPrimary) minDistFromPrimary = d;
            }
            if (minDistFromPrimary > 30) deviatingPoints++;
          }
          const deviationRatio =
            deviatingPoints / Math.ceil(pts.length / checkInterval);
          if (deviationRatio < 0.1) {
            if (!forcedFallback) forcedFallback = variant;
            continue;
          }
          const instructions = [];
          for (const leg of legs) {
            for (const point of leg.guidance?.instructions || []) {
              instructions.push({
                instruction: stripHtml(
                  point.message || point.combinedMessage || "",
                ),
                travel_mode: "WALKING",
                distance_meters: point.routeOffsetInMeters || 0,
                duration_seconds: point.travelTimeInSeconds || 0,
              });
            }
          }
          const summary = route.summary || {};
          const distM = summary.lengthInMeters || 0;
          const durS = summary.travelTimeInSeconds || 0;
          const hazardCheck = doesRoutePassThroughHazards(
            pts,
            activeHazards,
            constructionZones,
            80,
          );
          results.push({
            id: `alt_route_${variant.label.replace(/\s/g, "_")}_${Date.now()}`,
            label: variant.label,
            routeCoords: pts,
            distance:
              distM >= 1000
                ? `${(distM / 1000).toFixed(1)} km`
                : `${Math.round(distM)} m`,
            duration:
              durS >= 3600
                ? `${Math.floor(durS / 3600)}h ${Math.round((durS % 3600) / 60)}m`
                : `${Math.round(durS / 60)} min`,
            hazardCount: hazardCheck.count,
            hazardsOnRoute: hazardCheck.hazards,
            color: variant.color,
            steps: instructions,
            routeType: variant.params.routeType,
            distanceMeters: distM,
            durationSeconds: durS,
          });
        } catch (err) {
          console.warn(
            `Alternate route fetch failed for variant ${variant.label}:`,
            err,
          );
        }
      }
      if (results.length === 0 && forcedFallback) {
        // Force-include the best variant
        const variant = forcedFallback;
        try {
          const url = `https://api.tomtom.com/routing/1/calculateRoute/${startLat},${startLng}:${endLat},${endLng}/json`;
          const params = new URLSearchParams({
            key: TOMTOM_KEY,
            travelMode,
            routeRepresentation: "polyline",
            computeTravelTimeFor: "all",
            instructionsType: "text",
            language: "en-US",
            ...variant.params,
          });
          const resp = await fetch(`${url}?${params}`);
          if (resp.ok) {
            const data = await resp.json();
            const route = data.routes?.[0];
            if (route) {
              const legs = route.legs || [];
              const pts = [];
              for (const leg of legs) {
                const points = leg.points || [];
                for (const pt of points) pts.push([pt.latitude, pt.longitude]);
              }
              if (pts.length >= 2) {
                const instructions = [];
                for (const leg of legs) {
                  for (const point of leg.guidance?.instructions || []) {
                    instructions.push({
                      instruction: stripHtml(
                        point.message || point.combinedMessage || "",
                      ),
                      travel_mode: "WALKING",
                      distance_meters: point.routeOffsetInMeters || 0,
                      duration_seconds: point.travelTimeInSeconds || 0,
                    });
                  }
                }
                const summary = route.summary || {};
                const distM = summary.lengthInMeters || 0;
                const durS = summary.travelTimeInSeconds || 0;
                const hazardCheck = doesRoutePassThroughHazards(
                  pts,
                  activeHazards,
                  constructionZones,
                  80,
                );
                results.push({
                  id: `alt_route_${variant.label.replace(/\s/g, "_")}_${Date.now()}`,
                  label: variant.label,
                  routeCoords: pts,
                  distance:
                    distM >= 1000
                      ? `${(distM / 1000).toFixed(1)} km`
                      : `${Math.round(distM)} m`,
                  duration:
                    durS >= 3600
                      ? `${Math.floor(durS / 3600)}h ${Math.round((durS % 3600) / 60)}m`
                      : `${Math.round(durS / 60)} min`,
                  hazardCount: hazardCheck.count,
                  hazardsOnRoute: hazardCheck.hazards,
                  color: variant.color,
                  steps: instructions,
                  routeType: variant.params.routeType,
                  distanceMeters: distM,
                  durationSeconds: durS,
                });
              }
            }
          }
        } catch (err) {
          console.warn(`Forced fallback fetch failed:`, err);
        }
      }
      results.sort((a, b) => a.hazardCount - b.hazardCount);
      return results;
    },
    [activeHazards, constructionZones],
  );

  const handleAcceptAlternateRoute = useCallback(
    (altRoute) => {
      setRoutePath(altRoute.routeCoords);
      const segs = [];
      for (let i = 0; i < altRoute.routeCoords.length - 1; i++) {
        segs.push({
          start: altRoute.routeCoords[i],
          end: altRoute.routeCoords[i + 1],
          safety_score: altRoute.hazardCount === 0 ? 0.9 : 0.6,
          instructions: "Continue on route",
        });
      }
      setRouteSegments(segs);
      setRouteInfo({
        distance: altRoute.distance,
        duration: altRoute.duration,
        type: mode,
      });
      setRouteSteps(altRoute.steps || []);
      setShowDirections(true);
      setAlternateRoutes([]);
      setShowAlternateRouteComparison(false);
      setSelectedAlternateRoute(null);
      setHoveredAlternateRoute(null);
      setAlternatesDismissed(true);
      setShowAlternateDestinations(false);
      say(`Route updated — using ${altRoute.label}`);
      setTimeout(() => startNavigation(altRoute.routeCoords), 300);
    },
    [mode, say, startNavigation],
  );

  // ================== ROUTE CALCULATION ==================
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
    setAlternateDestinations([]);
    setShowAlternateDestinations(false);
    setAlternateDestinationsLoading(false);
    setHoveredAlternate(null);
    setSelectedAlternate(null);
    setShowAlternateComparison(false);
    setRouteHazardSummary(null);
    setAlternatesDismissed(false);
    setAlternateRoutes([]);
    setHoveredAlternateRoute(null);
    setSelectedAlternateRoute(null);
    setShowAlternateRouteComparison(false);
    setHoveredAltDest(false);
    alternateCheckDoneRef.current = false;
  };

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
    alternateCheckDoneRef.current = false;
    setAlternatesDismissed(false);
    setAlternateDestinations([]);
    setShowAlternateDestinations(false);
    setRouteHazardSummary(null);
    setAlternateRoutes([]);
    setShowAlternateRouteComparison(false);
    setSelectedAlternateRoute(null);

    // --- Alternate suggestion helper (hoisted) ---
    const checkAndSuggestAlternates = async (
      routeCoords,
      destLat,
      destLng,
      destName,
    ) => {
      if (alternateCheckDoneRef.current) return;
      alternateCheckDoneRef.current = true;
      let freshHazards = activeHazards;
      let freshZones = constructionZones;
      try {
        const obsRes = await fetch(
          "http://127.0.0.1:5000/api/area-obstructions",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              use_custom_bbox: true,
              min_lat: 40.2,
              max_lat: 40.8,
              min_lng: -80.8,
              max_lng: -79.5,
              include_emergencies: false,
              include_news: true,
            }),
          },
        );
        const obsData = await obsRes.json();
        if (obsData.success) {
          const sanitize = (arr) =>
            (arr || [])
              .map((item) => {
                const lat = Number(item.lat ?? item.latitude ?? null);
                const lng = Number(
                  item.lng ?? item.longitude ?? item.lon ?? null,
                );
                if (
                  !isNaN(lat) &&
                  !isNaN(lng) &&
                  isFinite(lat) &&
                  isFinite(lng)
                )
                  return { ...item, lat, lng };
                return null;
              })
              .filter(Boolean);
          freshHazards = sanitize(obsData.hazards || []);
          freshZones = sanitize(obsData.construction_zones || []);
        }
      } catch (e) {
        console.warn("Fresh hazard fetch failed, using cached:", e);
      }
      const routeHazardCheck = doesRoutePassThroughHazards(
        routeCoords,
        freshHazards,
        freshZones,
        120,
      );
      const destHazardCheck = isDestinationInHazardZone(
        destLat,
        destLng,
        freshHazards,
        freshZones,
      );
      const shouldSuggest =
        routeHazardCheck.hasHazards || destHazardCheck.inHazard;
      if (!shouldSuggest) {
        console.log("No hazards detected — skipping alternates");
        return;
      }
      console.log(
        `Hazard trigger: routeHazards=${routeHazardCheck.count}, destInHazard=${destHazardCheck.inHazard}`,
      );
      setRouteHazardSummary(routeHazardCheck);
      const startLat = loc[0],
        startLng = loc[1];
      const [altRoutesResult, altDestResult] = await Promise.allSettled([
        fetchAlternateRoutes(
          startLat,
          startLng,
          destLat,
          destLng,
          mode,
          routeCoords,
        ),
        (async () => {
          setAlternateDestinationsLoading(true);
          try {
            return await computeAlternateDestinations(
              destLat,
              destLng,
              destName,
              startLat,
              startLng,
              freshHazards,
              freshZones,
              mode,
            );
          } finally {
            setAlternateDestinationsLoading(false);
          }
        })(),
      ]);
      if (
        altRoutesResult.status === "fulfilled" &&
        altRoutesResult.value?.length > 0
      ) {
        setAlternateRoutes(altRoutesResult.value);
        console.log(
          `Set ${altRoutesResult.value.length} alternate route(s) on map`,
        );
      }
      if (
        altDestResult.status === "fulfilled" &&
        altDestResult.value?.length > 0
      ) {
        const dests = altDestResult.value.slice(0, 1);
        setAlternateDestinations(dests);
        setShowAlternateDestinations(true);
      }
      const routeCount =
        altRoutesResult.status === "fulfilled"
          ? altRoutesResult.value?.length || 0
          : 0;
      const destCount =
        altDestResult.status === "fulfilled"
          ? altDestResult.value?.length || 0
          : 0;
      if (routeCount > 0 || destCount > 0) {
        const parts = [];
        if (routeCount > 0)
          parts.push(
            `${routeCount} safer route${routeCount > 1 ? "s" : ""} to same destination`,
          );
        if (destCount > 0) parts.push(`1 alternate destination`);
        say(`Hazard on route — showing: ${parts.join(" + ")}`);
      }
    };
    // --- end hoisted helper ---

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

      // TRANSIT MODE
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
            const hours = Math.floor(totalMinutes / 60),
              mins = totalMinutes % 60;
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
            say(
              `Transit route found · ${durationStr} · ${bestRoute.steps
                .filter((s) => s.type === "transit")
                .map((s) => s.route_short_name || "Bus")
                .join(" → ")}`,
            );
            setShow3D(true);
            setTimeout(() => checkRouteForObstructions(allCoords), 500);
            setTimeout(() => startNavigation(allCoords), 300);
            // Call alternate suggestion for transit too
            const capturedTransitCoords = allCoords;
            const capturedDestLat = destCoords.lat;
            const capturedDestLng = destCoords.lng;
            const capturedDestName = toVal;
            setTimeout(
              () =>
                checkAndSuggestAlternates(
                  capturedTransitCoords,
                  capturedDestLat,
                  capturedDestLng,
                  capturedDestName,
                ),
              100,
            );
            setIsLoading(false);
            return;
          } else
            say(
              transitData.error ||
                "No transit routes found. Trying walking route...",
            );
        } catch (transitErr) {
          console.error("GTFS transit error:", transitErr);
          say("Transit service unavailable. Using walking route...");
        }
      }

      // WALKING / WHEELCHAIR MODE
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
        if (data.route.segments?.length > 0)
          setRouteSegments(data.route.segments);
        else {
          const segs = [];
          for (let i = 0; i < coords.length - 1; i++)
            segs.push({
              start: coords[i],
              end: coords[i + 1],
              safety_score: data.route.safety?.overall_safety || 0.7,
              instructions: "Continue on route",
            });
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
        setTimeout(() => startNavigation(coords), 300);
        // Call alternate suggestion
        const capturedDestLat = destCoords.lat;
        const capturedDestLng = destCoords.lng;
        const capturedDestName = toVal;
        const capturedCoords = coords;
        setTimeout(
          () =>
            checkAndSuggestAlternates(
              capturedCoords,
              capturedDestLat,
              capturedDestLng,
              capturedDestName,
            ),
          100,
        );
      } else say("Couldn't find a route. Try a different destination.");
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
      const update = () => {
        setCurrentZoom(map.getZoom());
        const b = map.getBounds();
        setMapBounds(b);
      };
      map.on("zoomend", update);
      map.on("moveend", update);
      update();
      return () => {
        map.off("zoomend", update);
        map.off("moveend", update);
      };
    }, [map]);
    return null;
  };
  const togglePanel = (name) => setPanel((p) => (p === name ? null : name));
  const hc = a11y.highContrast;
  const lt = a11y.largeText;

  // Alternate Destinations Hook
  const {
    computeAlternateDestinations,
    cancelComputation,
    isComputing: altIsComputing,
    error: altError,
  } = useAlternateDestinations();
  const handleAcceptAlternate = useCallback(
    (alt) => {
      setToVal(alt.name);
      setDest([alt.lat, alt.lng]);
      setRoutePath(alt.routeCoords);
      const segs = [];
      for (let i = 0; i < alt.routeCoords.length - 1; i++)
        segs.push({
          start: alt.routeCoords[i],
          end: alt.routeCoords[i + 1],
          safety_score: alt.safetyScore,
          instructions: "Continue on route",
        });
      setRouteSegments(segs);
      setRouteInfo({
        distance: alt.routeDistance,
        duration: alt.routeDuration,
        type: mode,
      });
      setRouteSteps(alt.routeSteps || []);
      setShowDirections(true);
      setShowAlternateDestinations(false);
      setAlternateDestinations([]);
      setShowAlternateComparison(false);
      setSelectedAlternate(null);
      setAlternatesDismissed(true);
      say(`Route updated — navigating to ${alt.name}`);
      setTimeout(() => startNavigation(alt.routeCoords), 300);
    },
    [mode, say, startNavigation],
  );

  // ================== RENDER ==================
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

        {/* ═══ MAP ═══ */}
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

            {/* User location */}
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
                  <strong>You are here</strong>
                </Popup>
              </CircleMarker>
            )}

            {/* Destination */}
            {dest && isValidLatLngArray(dest) && (
              <Marker position={dest} icon={destinationIcon}>
                <Popup>
                  <div className="popup-dest">
                    <strong>Destination</strong>
                    <small>{toVal}</small>
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Construction zones */}
{visibleConstructionZones.map((zone, idx) => (
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
        <div className="popup-distance">
          📍 {zone.distance_meters.toFixed(0)}m from route
        </div>
      ) : null
    }
  />
))}

            {/* Active hazards */}
            {visibleActiveHazards.map((hazard, idx) => (
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
                    <div className="popup-severity">
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

            {/* Obstructed roads */}
            {obstructedRoads.map((seg, idx) => (
              <ObstructedRoadSegment
                key={`road-${idx}`}
                segment={seg}
                zoomLevel={currentZoom}
              />
            ))}

            {/* ── 911 Emergencies ── */}
            {visibleEmergencies.map((emergency, idx) => {
              const EmIcon = EMERGENCY_ICONS[emergency.type] || ShieldAlert;
              const isHigh = emergency.severity > 0.7;
              const iconColor = isHigh ? "#ff4444" : "#ff8844";
              const markerSize = Math.min(
                42,
                Math.max(28, 28 + ((currentZoom - 12) / 6) * 14),
              );

              return (
                <Marker
                  key={`emergency-${idx}`}
                  position={[emergency.lat, emergency.lng]}
                  icon={makeLucideIcon(
                    EmIcon,
                    iconColor,
                    "#ff0000",
                    markerSize,
                  )}
                >
                  <Popup>
                    <div className="emergency-popup">
                      <div className="emergency-popup-header">
                        <EmIcon size={18} color="#ff4444" />
                        <strong className="emergency-popup-title">
                          🚨 911 EMERGENCY
                        </strong>
                      </div>
                      <div className="emergency-popup-desc">
                        {emergency.description ||
                          `${emergency.type?.toUpperCase()} incident`}
                      </div>
                      <div className="emergency-popup-meta">
                        {emergency.subtype && (
                          <span className="emergency-popup-tag">
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
                        <div className="emergency-popup-time">
                          🕒 Reported:{" "}
                          {new Date(emergency.timestamp).toLocaleString()}
                        </div>
                      )}
                      {emergency.distance_meters && (
                        <div className="emergency-popup-time">
                          📍 {emergency.distance_meters.toFixed(0)}m from center
                        </div>
                      )}
                      <div className="emergency-popup-footer">
                        ⚠️ Active emergency response in area
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            {/* ── TRANSIT / WALKING ROUTES ── */}
            {transitSegments.length > 0
              ? transitSegments.map((seg, idx) => {
                  const isTransit = seg.type === "transit";
                  return (
                    <React.Fragment key={`tseg-${idx}`}>
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
                          <div className="popup-segment-label">
                            {isTransit ? (
                              <>
                                <Bus size={12} className="popup-icon-transit" />{" "}
                                <strong>Transit segment</strong>
                              </>
                            ) : (
                              <>
                                <Footprints
                                  size={12}
                                  className="popup-icon-walk"
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
              : routeSegments.length > 0
                ? routeSegments.map((seg, idx) => {
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
                : routePath.length >= 2 && (
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
                          dashArray:
                            mode === "wheelchair" ? "14,10" : undefined,
                          lineCap: "round",
                          lineJoin: "round",
                        }}
                      />
                    </>
                  )}

            {/* Alternative routes */}
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

            {/* Transit alternatives */}
            {transitAlternatives.map(
              (alt, altIdx) =>
                alt.coords &&
                alt.coords.length > 1 && (
                  <Polyline
                    key={`transit-alt-${altIdx}`}
                    positions={alt.coords}
                    pathOptions={{
                      color: "#e8a870",
                      weight: 3,
                      opacity: 0.9,
                      dashArray: "8,7",
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                  >
                    <Popup>
                      <div className="popup-segment-label">
                        <strong>Alternative {alt.index}</strong>
                        <br />
                        {alt.route_summary}
                        <br />
                        <small className="popup-sub">
                          {Math.round(alt.total_time_seconds / 60)} min ·
                          Safety: {Math.round((alt.safety || 0.7) * 100)}%
                        </small>
                      </div>
                    </Popup>
                  </Polyline>
                ),
            )}

            {/* ── ALTERNATE DESTINATION ROUTES ── */}
            {showAlternateDestinations &&
              !alternatesDismissed &&
              alternateDestinations.map((alt, idx) => {
                const isHovered = hoveredAlternate === idx;
                const useCoords =
                  alt.routeCoords && alt.routeCoords.length >= 2
                    ? alt.routeCoords
                    : [
                        [loc[0], loc[1]],
                        [alt.lat, alt.lng],
                      ];

                const handleSelect = () => {
                  setSelectedAlternate(alt);
                  setShowAlternateComparison(true);
                };

                return (
                  <React.Fragment key={`alt-dest-${idx}`}>
                    {isHovered && (
                      <Polyline
                        positions={useCoords}
                        pathOptions={{
                          color: ALTERNATE_COLORS.ALT_DEST.halo,
                          weight: 16,
                          opacity: 0.18,
                          lineCap: "round",
                          lineJoin: "round",
                        }}
                      />
                    )}
                    <Polyline
                      positions={useCoords}
                      pathOptions={{
                        color: "#000000",
                        weight: isHovered ? 10 : 7,
                        opacity: isHovered ? 0.3 : 0.15,
                        lineCap: "round",
                        lineJoin: "round",
                      }}
                    />
                    <Polyline
                      positions={useCoords}
                      eventHandlers={{
                        mouseover: () => setHoveredAlternate(idx),
                        mouseout: () => setHoveredAlternate(null),
                        click: handleSelect,
                      }}
                      pathOptions={{
                        color: ALTERNATE_COLORS.ALT_DEST.line,
                        weight: isHovered ? 5 : 3.5,
                        opacity: isHovered ? 1 : 0.8,
                        dashArray: isHovered ? "10,6" : "7,8",
                        dashOffset: "0",
                        lineCap: "round",
                        lineJoin: "round",
                      }}
                    />
                    <CircleMarker
                      center={[alt.lat, alt.lng]}
                      radius={isHovered ? 13 : 9}
                      pathOptions={{
                        color: ALTERNATE_COLORS.ALT_DEST.line,
                        fillColor: isHovered
                          ? ALTERNATE_COLORS.ALT_DEST.line
                          : "rgba(16,8,3,0.9)",
                        fillOpacity: 1,
                        weight: 3,
                      }}
                      eventHandlers={{
                        mouseover: () => setHoveredAlternate(idx),
                        mouseout: () => setHoveredAlternate(null),
                        click: handleSelect,
                      }}
                    >
                      <Popup>
                        <div className="popup-segment-label">
                          <div className="popup-alt-name">
                            Alt Destination: {alt.name}
                          </div>
                          <div className="popup-sub">
                            {alt.routeDistance} · {alt.routeDuration}
                          </div>
                          <div className="popup-alt-safe">
                            ✓{" "}
                            {alt.hazardCount === 0
                              ? "No hazards on route"
                              : `${alt.hazardCount} hazard(s) — safer than original`}
                          </div>
                          <button
                            className="popup-compare-btn"
                            onClick={handleSelect}
                          >
                            Compare →
                          </button>
                        </div>
                      </Popup>
                    </CircleMarker>
                    {isHovered &&
                      useCoords.length > 2 &&
                      (() => {
                        const midIdx = Math.floor(useCoords.length / 2);
                        const midPt = useCoords[midIdx];
                        const labelHtml = makeAltRouteLabel(
                          alt.name,
                          alt.routeDistance,
                          alt.hazardCount,
                          ALTERNATE_COLORS.ALT_DEST.line,
                          true,
                        );
                        const icon = L.divIcon({
                          className: "alt-route-label",
                          html: labelHtml,
                          iconAnchor: [0, 14],
                          iconSize: null,
                        });
                        return (
                          <Marker
                            position={midPt}
                            icon={icon}
                            interactive={true}
                            eventHandlers={{ click: handleSelect }}
                          />
                        );
                      })()}
                  </React.Fragment>
                );
              })}

            {/* ── ALTERNATE ROUTES TO SAME DESTINATION ── */}
            {alternateRoutes.map((altRoute, idx) => {
              const isHovered = hoveredAlternateRoute === idx;
              if (!altRoute.routeCoords || altRoute.routeCoords.length < 2)
                return null;

              const handleSelectRoute = () => {
                setSelectedAlternateRoute(altRoute);
                setShowAlternateRouteComparison(true);
              };

              return (
                <React.Fragment key={altRoute.id}>
                  <Polyline
                    positions={altRoute.routeCoords}
                    pathOptions={{
                      color: "#000",
                      weight: isHovered ? 12 : 8,
                      opacity: 0.2,
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                  />
                  {isHovered && (
                    <Polyline
                      positions={altRoute.routeCoords}
                      pathOptions={{
                        color: altRoute.color,
                        weight: 20,
                        opacity: 0.12,
                        lineCap: "round",
                        lineJoin: "round",
                      }}
                    />
                  )}
                  <Polyline
                    positions={altRoute.routeCoords}
                    eventHandlers={{
                      mouseover: () => setHoveredAlternateRoute(idx),
                      mouseout: () => setHoveredAlternateRoute(null),
                      click: handleSelectRoute,
                    }}
                    pathOptions={{
                      color: altRoute.color,
                      weight: isHovered ? 7 : 4,
                      opacity: isHovered ? 1 : 0.85,
                      dashArray: "11,7",
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                  />
                  {dest && isValidLatLngArray(dest) && (
                    <CircleMarker
                      center={dest}
                      radius={isHovered ? 11 : 8}
                      pathOptions={{
                        color: altRoute.color,
                        fillColor: isHovered
                          ? altRoute.color
                          : "rgba(16,8,3,0.9)",
                        fillOpacity: 1,
                        weight: 2.5,
                      }}
                      eventHandlers={{
                        mouseover: () => setHoveredAlternateRoute(idx),
                        mouseout: () => setHoveredAlternateRoute(null),
                        click: handleSelectRoute,
                      }}
                    />
                  )}
                  {altRoute.routeCoords.length > 2 &&
                    (() => {
                      const midIdx = Math.floor(
                        altRoute.routeCoords.length / 2,
                      );
                      const midPt = altRoute.routeCoords[midIdx];
                      const labelHtml = makeAltRouteLabel(
                        altRoute.label,
                        altRoute.distance,
                        altRoute.hazardCount,
                        altRoute.color,
                        false,
                      );
                      const icon = L.divIcon({
                        className: "alt-route-label",
                        html: labelHtml,
                        iconAnchor: [0, 14],
                        iconSize: null,
                      });
                      return (
                        <Marker
                          position={midPt}
                          icon={icon}
                          interactive={true}
                          eventHandlers={{
                            click: handleSelectRoute,
                            mouseover: () => setHoveredAlternateRoute(idx),
                            mouseout: () => setHoveredAlternateRoute(null),
                          }}
                        />
                      );
                    })()}
                </React.Fragment>
              );
            })}
          </MapContainer>
        </div>

        {/* ═══ 3D NAVIGATION PANEL ═══ */}
        {navigationActive && routePath.length > 0 && (
          <div className="nav-3d-panel">
            <Suspense
              fallback={
                <div className="nav-3d-loading">Loading 3D View...</div>
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
                onTestPositionUpdate={(newPos) => setWalkerPosition(newPos)}
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

        {/* ═══ RAIL NAVIGATION ═══ */}
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

        {/* ═══ SIDE PANELS ═══ */}
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
                  <div className="p-list">
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
                        <div className="p-item-text">
                          <div className="p-name">{d.name}</div>
                          <div className="p-sub">
                            <Accessibility size={10} className="p-sub-icon" />{" "}
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
                  <div className="p-list">
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
                        <div className="p-item-text">
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
                  <div className="p-list">
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
                        <div className="p-item-text">
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
                  <div className="p-list">
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
                            <span className="p-arr-active">
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

        {/* ═══ SEARCH CARD ═══ */}
        <div
          ref={searchCardRef}
          className={`sc${searchPanelCollapsed ? " collapsed" : ""}`}
          role="search"
          aria-label="Route planner"
        >
          <div className="sc-head">
            <Route size={16} className="sc-head-icon" />
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
            className={`sc-content${searchPanelCollapsed ? " sc-content-collapsed" : ""}`}
          >
            {!searchPanelCollapsed && (
              <>
                <div className="sc-inputs">
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
                        <div className="ri-spinner-wrap">
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
                            <div className="spn" /> Searching…
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
                        <div className="ri-spinner-wrap-right">
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
                            <div className="spn" /> Searching…
                          </div>
                        ) : (
                          memoizedSuggItems
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="sc-modes" role="radiogroup">
                  {[
                    { id: "walk", Icon: PersonStanding, l: "Walk" },
                    { id: "transit", Icon: Bus, l: "Transit" },
                  ].map((t) => (
                    <button
                      key={t.id}
                      className={`mp${mode === t.id ? " on" : ""}`}
                      onClick={() => {
                        setMode(t.id);
                        clearRoute();
                        say(`${t.l} mode`);
                      }}
                      role="radio"
                      aria-checked={mode === t.id}
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
              </>
            )}
          </div>
        </div>

        {/* ═══ DIRECTIONS PANEL ═══ */}
        {showDirections && routeSteps.length > 0 && (
          <div
            className="directions-attached"
            style={{
              top: searchCardBottom,
            }}
          >
            <Suspense
              fallback={<div className="dir-loading">Loading directions…</div>}
            >
              <DirectionsPanel
                steps={routeSteps}
                onClose={() => setShowDirections(false)}
                routeType={routeType}
              />
            </Suspense>
          </div>
        )}

        {/* ═══ ALTERNATE DESTINATIONS PANEL ═══ */}
        {(showAlternateDestinations || alternateRoutes.length > 0) &&
          !alternatesDismissed && (
            <Suspense fallback={null}>
              <AlternateDestinationsPanel
                alternateDestinations={alternateDestinations}
                loading={alternateDestinationsLoading}
                triggerReason={null}
                routeHazardSummary={routeHazardSummary}
                hoveredAlternate={hoveredAlternate}
                selectedAlternate={selectedAlternate}
                showComparison={showAlternateComparison}
                originalDestinationName={toVal}
                originalRouteDistance={routeInfo?.distance || ""}
                originalRouteDuration={routeInfo?.duration || ""}
                originalRouteSteps={routeSteps}
                onHoverAlternate={setHoveredAlternate}
                onSelectAlternate={(alt) => {
                  setSelectedAlternate(alt);
                  setShowAlternateComparison(true);
                }}
                onAcceptAlternate={handleAcceptAlternate}
                onDismiss={() => {
                  setAlternatesDismissed(true);
                  setShowAlternateDestinations(false);
                  say(
                    "Continuing with original route. Hazards present — proceed with caution.",
                  );
                }}
                onCloseComparison={() => {
                  setShowAlternateComparison(false);
                  setSelectedAlternate(null);
                }}
                isMobile={window.innerWidth < 640}
                alternateRoutes={alternateRoutes}
                onSelectAlternateRoute={(route) => {
                  setSelectedAlternateRoute(route);
                  setShowAlternateRouteComparison(true);
                }}
                onHoverAlternateRoute={setHoveredAlternateRoute}
              />
            </Suspense>
          )}

        {/* ═══ ALTERNATE ROUTE COMPARISON DRAWER ═══ */}
        {showAlternateRouteComparison && selectedAlternateRoute && (
          <div
            className="alt-comp-drawer"
            style={{ borderTopColor: selectedAlternateRoute.color }}
          >
            <div className="alt-comp-header">
              <div className="alt-comp-header-row">
                <div
                  className="alt-comp-dot"
                  style={{ background: selectedAlternateRoute.color }}
                />
                <div className="alt-comp-label">
                  {selectedAlternateRoute.label}
                </div>
                <div className="alt-comp-sublabel">
                  Same destination — different path
                </div>
                <button
                  className="alt-comp-close"
                  onClick={() => {
                    setShowAlternateRouteComparison(false);
                    setSelectedAlternateRoute(null);
                  }}
                  aria-label="Close comparison"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
            <div className="alt-comp-stats-grid">
              <div className="alt-comp-stat-col">
                <div
                  className="alt-comp-col-label"
                  style={{ color: "var(--txt3)" }}
                >
                  ORIGINAL
                </div>
                <div className="alt-comp-stat-value">
                  {routeInfo?.distance || "—"}
                </div>
                <div className="alt-comp-stat-sub">
                  {routeInfo?.duration || "—"}
                </div>
              </div>
              <div className="alt-comp-stat-col">
                <div
                  className="alt-comp-col-label"
                  style={{ color: selectedAlternateRoute.color }}
                >
                  THIS ROUTE
                </div>
                <div className="alt-comp-stat-value">
                  {selectedAlternateRoute.distance}
                </div>
                <div className="alt-comp-stat-sub">
                  {selectedAlternateRoute.duration}
                </div>
              </div>
            </div>
            <div
              className={`alt-comp-hazard-banner ${selectedAlternateRoute.hazardCount === 0 ? "safe" : "warn"}`}
            >
              {selectedAlternateRoute.hazardCount === 0
                ? "✓ No hazards detected on this path"
                : `⚠ ${selectedAlternateRoute.hazardCount} hazard(s) still present on this path`}
            </div>
            <div className="alt-comp-action-area">
              <button
                className="alt-comp-accept"
                onClick={() =>
                  handleAcceptAlternateRoute(selectedAlternateRoute)
                }
              >
                Use This Route
              </button>
              <button
                className="alt-comp-decline"
                onClick={() => {
                  setShowAlternateRouteComparison(false);
                  setSelectedAlternateRoute(null);
                }}
              >
                Keep Original Route
              </button>
            </div>
          </div>
        )}

        {/* ═══ MAP TYPE BAR ═══ */}
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

        {/* ═══ ZOOM CONTROLS ═══ */}
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

        {/* ═══ ROUTE INFO BAR ═══ */}
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
              <div className="rs-v rs-v-green">
                <Accessibility size={16} />
              </div>
              <div className="rs-l">Accessible</div>
            </div>
            {constructionZones.length > 0 && (
              <>
                <div className="rs-d" />
                <div className="rs">
                  <div className="rs-v rs-v-red">
                    <Construction size={14} /> {constructionZones.length}
                  </div>
                  <div className="rs-l">Obstructions</div>
                </div>
              </>
            )}
            {nearbyEmergencyCount > 0 && (
              <>
                <div className="rs-d" />
                <div className="rs">
                  <div className="rs-v rs-v-crit">
                    <Siren size={14} /> {nearbyEmergencyCount}
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

        {/* ═══ ROUTE ALERT ═══ */}
        {showRouteAlert && routeAlert && (
          <div className="route-alert">
            <div className="route-alert-header">
              <ShieldAlert size={22} color="#ff7b6b" />
              <div className="route-alert-msg">{routeAlert.message}</div>
              <button
                className="route-alert-close"
                onClick={() => setShowRouteAlert(false)}
                aria-label="Dismiss alert"
              >
                <X size={16} />
              </button>
            </div>
            {routeAlternatives.length > 0 && (
              <div>
                <div className="route-alert-alts-title">
                  Alternative Routes:
                </div>
                <div className="route-alert-alts">
                  {routeAlternatives.slice(0, 3).map((alt, idx) => (
                    <button
                      key={idx}
                      className="route-alert-alt-btn"
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
                    >
                      <div className="route-alert-alt-row">
                        {alt.type === "transit" ? (
                          <Bus size={14} className="icon-wood" />
                        ) : (
                          <PersonStanding size={14} className="icon-green" />
                        )}
                        <span className="route-alert-alt-label">
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

        {/* ═══ TRANSIT INFO MODAL ═══ */}
        {showTransitInfo && transitInfo && (
          <div className="transit-modal">
            <div className="p-head">
              <div className="p-title">Transit Information</div>
              <button
                className="p-close"
                onClick={() => setShowTransitInfo(false)}
                aria-label="Close transit info"
              >
                <X size={14} />
              </button>
            </div>
            <div className="transit-modal-body">
              {transitInfo.map((route, idx) => (
                <div key={idx} className="transit-modal-route">
                  <div className="transit-modal-route-title">
                    Option {idx + 1}:{" "}
                    {route.duration_str || `${route.duration_minutes} min`}
                  </div>
                  <div className="transit-modal-route-meta">
                    🚶 Walk: {route.walking_minutes} min · 🚌 Ride:{" "}
                    {route.transit_minutes} min
                  </div>
                  {route.transit_lines.map((line, li) => (
                    <div key={li} className="transit-modal-line">
                      <div className="transit-modal-line-header">
                        <Bus size={14} color="#4fc3f7" />
                        <strong className="transit-modal-line-name">
                          {line.line}
                        </strong>
                        <span className="transit-modal-line-vehicle">
                          {line.vehicle}
                        </span>
                      </div>
                      <div className="transit-modal-line-stops">
                        <span>
                          From:{" "}
                          <strong className="transit-modal-stop">
                            {line.from_stop}
                          </strong>
                        </span>
                        <br />
                        <span>
                          To:{" "}
                          <strong className="transit-modal-stop">
                            {line.to_stop}
                          </strong>
                        </span>
                      </div>
                      <div className="transit-modal-line-time">
                        Departs {line.departure_time} · Arrives{" "}
                        {line.arrival_time}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <button
              className="transit-modal-close-btn"
              onClick={() => setShowTransitInfo(false)}
            >
              Close
            </button>
          </div>
        )}

        {/* Toast */}
        <div
          className={`toast${toast ? " vis" : ""}`}
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>

        {/* Voice Modal */}
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