import { useState, useRef, useEffect, useCallback } from "react";
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
import {
  Bookmark,
  Clock,
  Settings,
  Crosshair,
  Search,
  ChevronDown,
  X,
  ArrowRight,
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
  TreePine,
  Building2,
  Stethoscope,
  GraduationCap,
  ShoppingBag,
  Waves,
  Dumbbell,
  Coffee,
  ChevronRight,
  Route,
  LocateFixed,
} from "lucide-react";

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

function ChangeView({ center, zoom, routeBounds }) {
  const map = useMap();
  useEffect(() => {
    if (routeBounds && routeBounds.length >= 2) {
      const bounds = L.latLngBounds(routeBounds);
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 16 });
    } else {
      map.setView(center, zoom);
    }
  }, [center, zoom, map, routeBounds]);
  return null;
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --rail-w: 64px;
    --panel-w: 310px;

    /* Wood palette - enhanced contrast */
    --bg:       #110a04;
    --surface:  rgba(28, 17, 8, 0.97);
    --card:     rgba(42, 26, 12, 0.98);
    --inset:    rgba(255,255,255,0.035);

    --border:   rgba(180, 120, 60, 0.16);
    --border2:  rgba(200, 140, 70, 0.38);

    --wood:     #e8a870;  /* Lighter for better contrast */
    --wood-lt:  #ffc89c;  /* Much lighter */
    --wood-g:   linear-gradient(135deg, #c06c30, #e89c60);
    --wood-dim: rgba(232, 168, 112, 0.18);
    --wood-glow:rgba(232, 168, 112, 0.3);

    --green:    #8cd69c;  /* Lighter green */
    --green-dim:rgba(140,214,156,0.15);
    --amber:    #ffb347;  /* Lighter amber */
    --red:      #ff7b6b;  /* Lighter red */
    --red-dim:  rgba(255,123,107,0.15);

    --txt:  #ffffff;      /* Pure white for maximum contrast */
    --txt2: #e0c8b0;      /* Very light beige */
    --txt3: #b09878;      /* Medium-light brown */

    --ff-d: 'Playfair Display', Georgia, serif;
    --ff-b: 'DM Sans', system-ui, sans-serif;

    --sh:    0 6px 28px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3);
    --sh-lg: 0 18px 56px rgba(0,0,0,0.72), 0 4px 18px rgba(0,0,0,0.4);
    --sh-w:  0 4px 20px rgba(232,168,112,0.25);
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .root {
    font-family: var(--ff-b);
    background: var(--bg);
    color: var(--txt);
    width: 100vw; height: 100vh;
    overflow: hidden;
    position: relative;
  }

  /* ── MAP ─────────────────────────────────────────── */
  .map-wrap { position: absolute; inset: 0; z-index: 0; }
  .leaflet-container { background: #0e0804 !important; }
  .leaflet-tile-pane { filter: saturate(.7) brightness(.82) sepia(.08); }
  .leaflet-popup-content-wrapper {
    background: var(--card) !important;
    border: 1px solid var(--border2) !important;
    border-radius: 12px !important;
    color: var(--txt) !important;
    box-shadow: var(--sh) !important;
    font-family: var(--ff-b) !important;
  }
  .leaflet-popup-tip { background: rgba(42,26,12,.98) !important; }
  .leaflet-control-zoom { display: none !important; }
  .leaflet-control-attribution { display: none; }

  /* ── RAIL ────────────────────────────────────────── */
  .rail {
    position: absolute; left: 0; top: 0; bottom: 0;
    width: var(--rail-w);
    background: var(--surface);
    border-right: 1px solid var(--border);
    backdrop-filter: blur(28px);
    z-index: 60;
    display: flex; flex-direction: column; align-items: center;
    padding: 14px 0 18px; gap: 3px;
  }

  .r-logo {
    width: 38px; height: 38px;
    background: var(--wood-g);
    border-radius: 11px;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 14px; flex-shrink: 0;
    box-shadow: var(--sh-w), 0 0 16px var(--wood-glow);
    color: #fff8f0;
  }

  .r-btn {
    width: 44px; height: 44px; border-radius: 11px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 3px; background: transparent; border: 1px solid transparent;
    cursor: pointer; color: var(--txt3); transition: all .18s; position: relative;
  }
  .r-btn:hover { background: var(--wood-dim); border-color: var(--border); color: var(--txt2); }
  .r-btn.on    { background: var(--wood-dim); border-color: var(--border2); color: var(--wood); }
  .r-lbl { font-size: 9px; font-weight: 600; letter-spacing: .3px; color: inherit; font-family: var(--ff-b); }

  .r-sep   { width: 26px; height: 1px; background: var(--border); margin: 5px 0; flex-shrink: 0; }
  .r-space { flex: 1; }

  /* Rail tooltip */
  .r-btn[data-tip]::after {
    content: attr(data-tip);
    position: absolute; left: calc(100% + 11px); top: 50%; transform: translateY(-50%);
    background: var(--card); border: 1px solid var(--border2); border-radius: 8px;
    padding: 5px 12px; font-family: var(--ff-b); font-size: 12px; font-weight: 500;
    color: var(--txt); white-space: nowrap; opacity: 0; pointer-events: none;
    transition: opacity .15s; z-index: 999; box-shadow: var(--sh);
  }
  .r-btn[data-tip]:hover::after { opacity: 1; }

  /* ── SIDE PANEL ───────────────────────────────────── */
  .panel {
    position: absolute; left: var(--rail-w); top: 0; bottom: 0;
    width: var(--panel-w);
    background: var(--surface); border-right: 1px solid var(--border);
    backdrop-filter: blur(28px); z-index: 55;
    display: flex; flex-direction: column;
    transform: translateX(-100%);
    transition: transform .28s cubic-bezier(.4,0,.2,1);
    box-shadow: var(--sh-lg);
  }
  .panel.open { transform: translateX(0); }

  .p-head {
    padding: 20px 18px 16px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
  }
  .p-title { font-family: var(--ff-d); font-size: 17px; font-weight: 700; color: var(--txt); letter-spacing: .2px; }

  .p-close {
    background: var(--inset); border: 1px solid var(--border);
    border-radius: 8px; width: 30px; height: 30px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--txt2); transition: all .15s;
  }
  .p-close:hover { color: var(--red); border-color: rgba(255,123,107,.3); background: var(--red-dim); }

  .p-body {
    flex: 1; overflow-y: auto; padding: 16px 16px 24px;
    display: flex; flex-direction: column; gap: 22px;
    scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  }
  .p-body::-webkit-scrollbar { width: 4px; }
  .p-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .p-sec {
    font-size: 10px; font-weight: 700; letter-spacing: 1.4px;
    text-transform: uppercase; color: var(--txt2); margin-bottom: 9px;
    display: flex; align-items: center; gap: 6px;
  }
  .p-sec::after { content: ''; flex: 1; height: 1px; background: var(--border); }

  .p-item {
    display: flex; align-items: center; gap: 11px;
    padding: 10px 12px; background: var(--inset);
    border: 1px solid var(--border); border-radius: 12px;
    cursor: pointer; transition: all .16s; width: 100%; text-align: left;
  }
  .p-item:hover { background: var(--wood-dim); border-color: var(--border2); transform: translateX(3px); }
  .p-item.sel   { border-color: var(--wood); background: var(--wood-dim); }

  .p-ico {
    width: 32px; height: 32px;
    background: rgba(180,120,60,0.1); border: 1px solid var(--border);
    border-radius: 9px; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; color: var(--wood);
  }
  .p-ico.green { color: var(--green); background: var(--green-dim); }
  .p-ico.amber { color: var(--amber); background: rgba(255,179,71,0.1); }

  .p-name { font-size: 13px; font-weight: 500; color: var(--txt); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .p-sub  { font-size: 11px; color: var(--txt2); margin-top: 2px; display: flex; align-items: center; gap: 4px; }
  .p-arr  { margin-left: auto; color: var(--txt2); flex-shrink: 0; transition: all .15s; }
  .p-item:hover .p-arr { color: var(--wood); transform: translateX(2px); }

  .p-empty { text-align: center; color: var(--txt2); font-size: 12.5px; line-height: 1.7; padding: 20px 0; }

  /* a11y grid */
  .ag  { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .ab  {
    background: var(--inset); border: 1px solid var(--border); border-radius: 10px;
    padding: 10px 10px; display: flex; align-items: center; gap: 8px;
    cursor: pointer; transition: all .16s; width: 100%; text-align: left;
  }
  .ab:hover { border-color: var(--border2); }
  .ab.on    { border-color: var(--wood); background: var(--wood-dim); }
  .ab-i { color: var(--txt2); flex-shrink: 0; transition: color .15s; }
  .ab.on .ab-i { color: var(--wood); }
  .ab-l { font-size: 11px; font-weight: 500; color: var(--txt2); flex: 1; line-height: 1.3; }
  .ab.on .ab-l { color: var(--txt); }
  .ab-c {
    width: 15px; height: 15px; border-radius: 4px; border: 1.5px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; transition: all .15s; color: transparent;
  }
  .ab.on .ab-c { background: var(--wood); border-color: var(--wood); color: #1a0c04; }

  /* ── SEARCH CARD ─────────────────────────────────── */
  .sc {
    position: absolute;
    top: 14px; left: calc(var(--rail-w) + 14px);
    z-index: 50; width: 348px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 20px; backdrop-filter: blur(32px);
    box-shadow: var(--sh-lg), var(--sh-w);
    transition: border-color .2s;
  }
  .sc:focus-within { border-color: var(--border2); }

  .sc-head {
    padding: 14px 16px 6px;
    display: flex; align-items: center; gap: 10px;
    border-bottom: 1px solid var(--border);
  }
  .sc-brand { font-family: var(--ff-d); font-size: 15px; font-weight: 700; color: var(--txt); letter-spacing: .2px; flex: 1; }
  .sc-brand span { color: var(--wood); }

  .sc-inputs { padding: 12px 14px 8px; display: flex; flex-direction: column; gap: 6px; }

  /* input rows */
  .rr { position: relative; }
  .rr-dot {
    position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
    width: 8px; height: 8px; border-radius: 50%; pointer-events: none; z-index: 1;
  }
  .rr-dot-g { background: var(--green); box-shadow: 0 0 6px var(--green); animation: blk 2.4s ease infinite; }
  .rr-dot-r { background: var(--red);   box-shadow: 0 0 6px var(--red); }
  @keyframes blk { 0%,100%{opacity:1;transform:translateY(-50%) scale(1)} 50%{opacity:.55;transform:translateY(-50%) scale(1.4)} }

  .ri {
    width: 100%; background: var(--inset); border: 1px solid var(--border);
    border-radius: 10px; padding: 10px 34px 10px 28px;
    color: var(--txt); font-family: var(--ff-b); font-size: 13.5px;
    outline: none; transition: border-color .18s, box-shadow .18s, background .18s;
  }
  .ri::placeholder { color: var(--txt2); }
  .ri:focus { border-color: var(--wood); background: rgba(232,168,112,.06); box-shadow: 0 0 0 3px var(--wood-dim); }

  .ri-btn {
    position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
    background: var(--inset); border: 1px solid var(--border); border-radius: 7px;
    width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--txt2); transition: all .15s;
  }
  .ri-btn:hover { background: var(--wood-dim); border-color: var(--border2); color: var(--wood); }

  .ri-conn { display: flex; align-items: center; gap: 8px; padding: 0 12px; pointer-events: none; }
  .ri-conn-line { width: 1px; height: 12px; flex-shrink: 0; background: linear-gradient(to bottom,var(--green),var(--red)); opacity: .3; }
  .ri-conn-lbl  { font-size: 11px; color: var(--txt2); }

  /* autocomplete */
  .ac { position: relative; }
  .ac-drop {
    position: absolute; top: calc(100% + 6px); left: 0; right: 0;
    background: var(--card); border: 1px solid var(--border2); border-radius: 14px;
    overflow: hidden; z-index: 300; box-shadow: var(--sh-lg); animation: fd .14s ease;
  }
  @keyframes fd { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:translateY(0)} }

  .ac-hd {
    padding: 8px 13px 6px; font-size: 10px; font-weight: 700; letter-spacing: 1px;
    text-transform: uppercase; color: var(--txt2);
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 6px;
  }
  .ac-row {
    display: flex; align-items: center; gap: 10px; padding: 9px 13px;
    background: transparent; border: none; width: 100%; text-align: left;
    cursor: pointer; transition: background .12s; color: var(--txt);
  }
  .ac-row:hover, .ac-row.hi { background: var(--wood-dim); }
  .ac-row + .ac-row { border-top: 1px solid rgba(232,168,112,.1); }

  .ac-ico {
    width: 28px; height: 28px; background: var(--inset); border: 1px solid var(--border);
    border-radius: 8px; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; color: var(--wood);
  }
  .ac-name { font-size: 13px; font-weight: 500; color: var(--txt); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ac-addr { font-size: 11px; color: var(--txt2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
  .ac-tag  {
    margin-left: auto; font-size: 10px; font-weight: 700; letter-spacing: .3px; text-transform: uppercase;
    color: var(--txt); background: var(--wood-dim); border: 1px solid rgba(232,168,112,.3);
    border-radius: 4px; padding: 2px 7px; white-space: nowrap; flex-shrink: 0;
    max-width: 72px; overflow: hidden; text-overflow: ellipsis;
  }
  .ac-wait { display: flex; align-items: center; gap: 8px; padding: 14px; font-size: 12px; color: var(--txt2); }

  @keyframes spin { to{transform:rotate(360deg)} }
  .spn  { width: 12px; height: 12px; border: 2px solid var(--border); border-top-color: var(--wood); border-radius: 50%; animation: spin .6s linear infinite; flex-shrink: 0; }
  .spn2 { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.15); border-top-color: var(--wood); border-radius: 50%; animation: spin .65s linear infinite; }

  /* mode pills */
  .sc-modes { display: flex; gap: 6px; padding: 2px 14px 4px; }
  .mp {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 9px 4px; background: var(--inset); border: 1px solid var(--border);
    border-radius: 11px; cursor: pointer; transition: all .17s; color: var(--txt2); font-family: var(--ff-b);
  }
  .mp:hover { border-color: var(--border2); color: var(--txt); background: var(--wood-dim); }
  .mp.on    { border-color: var(--wood); background: var(--wood-dim); color: var(--wood); box-shadow: 0 0 12px var(--wood-glow); }
  .mp-i { flex-shrink: 0; }
  .mp-l { font-size: 10px; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; color: inherit; }

  /* find btn */
  .sc-find {
    margin: 6px 14px 12px; width: calc(100% - 28px); padding: 13px;
    background: var(--wood-g); border: none; border-radius: 13px;
    color: #ffffff; font-family: var(--ff-d); font-size: 14px; font-weight: 700;
    cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: all .2s; box-shadow: var(--sh-w); letter-spacing: .2px;
  }
  .sc-find:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 28px rgba(232,168,112,.5); filter: brightness(1.1); }
  .sc-find:disabled { background: var(--inset); color: var(--txt2); box-shadow: none; cursor: not-allowed; filter: none; }

  /* legend */
  .sc-leg-btn {
    display: flex; align-items: center; justify-content: space-between;
    padding: 9px 14px; border-top: 1px solid var(--border);
    background: transparent; border-left: none; border-right: none; border-bottom: none;
    width: 100%; cursor: pointer; color: var(--txt2); font-family: var(--ff-b); transition: color .15s;
  }
  .sc-leg-btn:hover { color: var(--txt); }
  .sc-leg-lbl { font-size: 10.5px; font-weight: 600; letter-spacing: .8px; text-transform: uppercase; color: inherit; }
  .leg-chv { transition: transform .2s; }
  .leg-chv.open { transform: rotate(180deg); }
  .sc-leg-body { padding: 4px 14px 14px; display: flex; flex-direction: column; gap: 8px; }
  .leg-row { display: flex; align-items: center; gap: 10px; }
  .leg-lbl { font-size: 12px; color: var(--txt2); }

  /* route bar */
  .rbar {
    position: absolute; bottom: 22px; left: calc(var(--rail-w) + 14px); z-index: 50;
    background: var(--surface); border: 1px solid var(--border2);
    border-radius: 16px; backdrop-filter: blur(24px);
    padding: 13px 18px; display: flex; align-items: center; gap: 14px;
    box-shadow: var(--sh), var(--sh-w); animation: su .24s ease;
  }
  @keyframes su { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  .rs   { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .rs-v { font-family: var(--ff-d); font-size: 15px; font-weight: 700; color: var(--wood); }
  .rs-l { font-size: 10px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--txt2); }
  .rs-d { width: 1px; height: 24px; background: var(--border); }
  .rs-cl {
    background: var(--red-dim); border: 1px solid rgba(255,123,107,.3);
    border-radius: 8px; padding: 5px 10px; color: var(--red);
    font-size: 11px; font-weight: 700; cursor: pointer; transition: all .15s; margin-left: 4px;
  }
  .rs-cl:hover { background: rgba(255,123,107,.25); color: #ff9b8b; }
  .rs-bus {
    background: var(--wood-dim); border: 1px solid var(--wood);
    border-radius: 8px; padding: 5px 10px; color: var(--wood);
    font-size: 11px; font-weight: 700; cursor: pointer; transition: all .15s;
  }
  .rs-bus:hover { background: var(--wood-dim); color: var(--wood-lt); }

  /* map type bar */
  .mt-bar { position: absolute; top: 16px; right: 14px; z-index: 50; display: flex; gap: 5px; }
  .mt-btn {
    background: var(--surface); border: 1px solid var(--border); border-radius: 9px;
    backdrop-filter: blur(20px); padding: 7px 12px;
    display: flex; align-items: center; gap: 6px;
    cursor: pointer; color: var(--txt2); font-family: var(--ff-b); font-size: 12px; font-weight: 500;
    transition: all .15s; white-space: nowrap;
  }
  .mt-btn:hover { color: var(--txt); border-color: var(--border2); }
  .mt-btn.on    { color: var(--wood); border-color: var(--wood); background: var(--wood-dim); }

  /* map controls */
  .mctrl { position: absolute; right: 14px; bottom: 80px; z-index: 50; display: flex; flex-direction: column; gap: 5px; }
  .mc {
    width: 40px; height: 40px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; backdrop-filter: blur(20px);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--txt2); transition: all .15s;
  }
  .mc:hover { border-color: var(--border2); color: var(--wood); background: var(--wood-dim); }
  .mc-z { font-size: 10px; font-weight: 700; letter-spacing: .3px; color: var(--txt2); text-align: center; padding: 3px 0; }

  /* toast */
  .toast {
    position: absolute; bottom: 24px; left: 50%; z-index: 200;
    transform: translateX(-50%) translateY(12px);
    background: var(--surface); border: 1px solid var(--border2); border-radius: 50px;
    backdrop-filter: blur(20px); padding: 9px 22px;
    font-size: 12.5px; font-weight: 500; color: var(--txt);
    white-space: nowrap; opacity: 0; pointer-events: none;
    transition: all .24s; max-width: calc(100vw - 100px);
    text-align: center; overflow: hidden; text-overflow: ellipsis; box-shadow: var(--sh);
  }
  .toast.vis { opacity: 1; transform: translateX(-50%) translateY(0); }

  .sr { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0; }
`;

// ── DATA ────────────────────────────────────────────────────────────────────

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
  if (c.includes("hospital") || c.includes("medical") || c.includes("health"))
    return Stethoscope;
  if (c.includes("school") || c.includes("university") || c.includes("college"))
    return GraduationCap;
  if (c.includes("restaurant") || c.includes("food") || c.includes("cafe"))
    return Coffee;
  if (c.includes("park") || c.includes("garden")) return TreePine;
  if (
    c.includes("transit") ||
    c.includes("bus") ||
    c.includes("train") ||
    c.includes("station")
  )
    return Bus;
  if (c.includes("museum") || c.includes("gallery")) return Building2;
  if (c.includes("shop") || c.includes("store") || c.includes("mall"))
    return ShoppingBag;
  if (c.includes("pharmacy")) return Stethoscope;
  return MapPin;
}

// ── COMPONENT ───────────────────────────────────────────────────────────────

export default function AccessibleMap() {
  const [mapType, setMapType] = useState("openstreetmap");
  const [zoom, setZoom] = useState(13);
  const [loc, setLoc] = useState([40.472, -79.94]);
  const [routePath, setRoutePath] = useState([]);
  const [dest, setDest] = useState(null);
  const [hazards] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [showRouteAlert, setShowRouteAlert] = useState(false);
  const [routeAlert, setRouteAlert] = useState(null);
  const [routeAlternatives, setRouteAlternatives] = useState([]);
  const [transitInfo, setTransitInfo] = useState(null);
  const [showTransitInfo, setShowTransitInfo] = useState(false);

  const [fromVal, setFromVal] = useState("Current Location");
  const [fromCoords, setFromCoords] = useState(null);
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

  const say = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }, []);

  useEffect(() => {
    const h = (e) => {
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
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

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
        const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${TOMTOM_API_KEY}&limit=6&lat=${lat}&lon=${lng}&radius=50000&language=en-US`;
        const d = await (await fetch(url)).json();
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
        /* noop */
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
        const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${TOMTOM_API_KEY}&limit=6&lat=${lat}&lon=${lng}&radius=50000&language=en-US`;
        const d = await (await fetch(url)).json();
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
        /* noop */
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

  const checkRouteForObstructions = async (routeCoords) => {
    try {
      const res = await fetch("http://localhost:5000/api/check-obstructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route_coords: routeCoords })
      });
      const data = await res.json();
      
      if (data.success && data.obstructions.has_obstruction) {
        const constructionZones = data.obstructions.construction_zones;
        const hazards = data.obstructions.hazards;
        
        let message = "";
        if (constructionZones.length > 0) {
          message = `⚠️ ${constructionZones.length} construction zone(s) detected on your route!`;
        } else if (hazards.length > 0) {
          message = `⚠️ ${hazards.length} hazard(s) detected on your route!`;
        }
        
        setRouteAlert({
          type: "obstruction",
          message: message,
          constructionZones: constructionZones,
          hazards: hazards
        });
        setShowRouteAlert(true);
        
        // Also get alternatives
        await getRouteAlternatives();
      }
    } catch (error) {
      console.error("Error checking obstructions:", error);
    }
  };
  
  const getRouteAlternatives = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/route-alternatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_lat: loc[0],
          start_lng: loc[1],
          end_lat: dest?.[0] || loc[0],
          end_lng: dest?.[1] || loc[1],
          accessibility_preferences: {
            wheelchair: mode === "wheelchair",
            blind: a11y.visionImpaired
          }
        })
      });
      const data = await res.json();
      
      if (data.success && data.alternatives.length > 0) {
        setRouteAlternatives(data.alternatives);
      }
    } catch (error) {
      console.error("Error getting alternatives:", error);
    }
  };
  
  const getTransitInfo = async () => {
    if (!dest) return;
    
    try {
      const res = await fetch("http://localhost:5000/api/transit-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_lat: loc[0],
          start_lng: loc[1],
          end_lat: dest[0],
          end_lng: dest[1]
        })
      });
      const data = await res.json();
      
      if (data.success && data.routes && data.routes.length > 0) {
        setTransitInfo(data.routes);
        setShowTransitInfo(true);
      }
    } catch (error) {
      console.error("Error getting transit info:", error);
    }
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

  const pickSugg = (s) => {
    setToVal(s.address || s.name);
    setSugg([]);
    setSuggOpen(false);
    setHiIdx(-1);
    destRef.current?.blur();
    say(`Destination set — ${s.name}`);
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

  const calcRoute = async () => {
    if (!toVal.trim()) {
      say("Please enter a destination");
      return;
    }
    setIsLoading(true);
    say("Finding your safe, accessible route…");

    try {
      // Geocode the destination to get coordinates
      const geoRes = await fetch(
        `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(toVal)}.json?key=${TOMTOM_API_KEY}&limit=1`,
      );
      const geoData = await geoRes.json();

      if (!geoData.results || geoData.results.length === 0) {
        say("Couldn't find that location");
        setIsLoading(false);
        return;
      }

      const destPos = geoData.results[0].position;
      const destCoords = { lat: destPos.lat, lng: destPos.lon };

      // Use current location or geocode "Current Location"
      let startCoords;
      if (fromVal === "Current Location") {
        // Use the current GPS position from state
        startCoords = { lat: loc[0], lng: loc[1] };
      } else {
        // Geocode the custom start location
        const startGeoRes = await fetch(
          `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(fromVal)}.json?key=${TOMTOM_API_KEY}&limit=1`,
        );
        const startGeoData = await startGeoRes.json();
        if (startGeoData.results && startGeoData.results.length > 0) {
          const startPos = startGeoData.results[0].position;
          startCoords = { lat: startPos.lat, lng: startPos.lon };
        } else {
          startCoords = { lat: loc[0], lng: loc[1] }; // Fallback to current location
        }
      }

      // Now calculate the route with actual coordinates
      const routeRes = await fetch(
        "http://localhost:5000/api/calculate-route",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start_lat: startCoords.lat,
            start_lng: startCoords.lng,
            end_lat: destCoords.lat,
            end_lng: destCoords.lng,
            travel_mode: mode === "transit" ? "transit" : "pedestrian",
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
        setRouteInfo({
          distance: data.route.distance,
          duration: data.route.duration,
        });

        const nr = [
          {
            name: toVal,
            address: geoData.results[0].address?.freeformAddress || toVal,
          },
          ...recents.filter((r) => r.name !== toVal),
        ].slice(0, 6);
        setRecents(nr);
        try {
          localStorage.setItem("ar_recents", JSON.stringify(nr));
        } catch {}

        say(`Route found · ${data.route.distance} · ${data.route.duration}`);
        
        // Check for obstructions after route is set
        setTimeout(() => {
          checkRouteForObstructions(coords);
        }, 500);
      } else {
        say("Couldn't find a route. Try a different destination.");
      }
    } catch (error) {
      console.error("Route calculation error:", error);
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
        setFromCoords({ lat: p.coords.latitude, lng: p.coords.longitude });
        say("Location updated ✓");
      },
      () => say("Couldn't get location. Using default."),
    );
  };

  const togglePanel = (name) => setPanel((p) => (p === name ? null : name));
  const hc = a11y.highContrast;
  const lt = a11y.largeText;
  
  const RouteAlertComponent = () => {
    if (!showRouteAlert) return null;
    
    return (
      <div style={{
        position: "absolute",
        top: "100px",
        left: "calc(var(--rail-w) + 14px)",
        right: "14px",
        maxWidth: "400px",
        background: "var(--surface)",
        border: `1px solid ${routeAlert?.type === 'construction' ? '#ff7b6b' : '#ffb347'}`,
        borderRadius: "16px",
        padding: "16px",
        zIndex: 100,
        backdropFilter: "blur(24px)",
        boxShadow: "var(--sh-lg)",
        animation: "slideDown 0.3s ease"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
          <div style={{ color: "#ff7b6b", fontSize: "24px" }}>⚠️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: "bold", color: "var(--txt)" }}>{routeAlert?.message}</div>
            {routeAlert?.constructionZones?.length > 0 && (
              <div style={{ fontSize: "12px", color: "var(--txt2)", marginTop: "4px" }}>
                {routeAlert.constructionZones.map(z => z.description).join(", ")}
              </div>
            )}
            {routeAlert?.hazards?.length > 0 && (
              <div style={{ fontSize: "12px", color: "var(--txt2)", marginTop: "4px" }}>
                {routeAlert.hazards.map(h => h.description).join(", ")}
              </div>
            )}
          </div>
          <button onClick={() => setShowRouteAlert(false)} style={{
            background: "transparent",
            border: "none",
            color: "var(--txt2)",
            cursor: "pointer",
            fontSize: "16px"
          }}>✕</button>
        </div>
        
        {routeAlternatives.length > 0 && (
          <div>
            <div style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "8px", color: "var(--wood)" }}>
              Alternative Routes:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {routeAlternatives.slice(0, 3).map((alt, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    // Apply alternative route
                    const waypoints = alt.waypoints;
                    setRoutePath(waypoints);
                    setDest(waypoints[waypoints.length - 1]);
                    setRouteInfo({
                      distance: `${(alt.distance_meters / 1000).toFixed(1)} km`,
                      duration: `${alt.duration_minutes} min`
                    });
                    setShowRouteAlert(false);
                    say(`Switched to ${alt.type} route, ${alt.duration_minutes} minutes`);
                    
                    // If transit, show bus info
                    if (alt.type === 'transit' && alt.transit_lines?.length > 0) {
                      const busInfo = alt.transit_lines.map(l => l.line).join(", ");
                      say(`Taking ${busInfo} bus. ${alt.walking_minutes} min walk, ${alt.transit_minutes} min ride`);
                    }
                  }}
                  style={{
                    background: "var(--inset)",
                    border: "1px solid var(--border)",
                    borderRadius: "12px",
                    padding: "10px",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    width: "100%"
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "var(--wood)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {alt.type === 'transit' ? <Bus size={14} style={{ color: "var(--wood)" }} /> : <PersonStanding size={14} style={{ color: "var(--green)" }} />}
                    <span style={{ fontWeight: "500", fontSize: "13px" }}>
                      {alt.type === 'transit' ? 'Transit' : 'Walking'} • {alt.duration_minutes} min
                    </span>
                    {alt.has_obstruction && (
                      <span style={{ fontSize: "10px", color: "#ff7b6b", marginLeft: "auto" }}>
                        ⚠️ has obstruction
                      </span>
                    )}
                  </div>
                  {alt.type === 'transit' && alt.transit_lines && alt.transit_lines.length > 0 && (
                    <div style={{ fontSize: "11px", color: "var(--txt2)", marginTop: "4px" }}>
                      {alt.transit_lines.map(l => `${l.line} ${l.vehicle}`).join(" • ")}
                    </div>
                  )}
                  {alt.type === 'transit' && alt.walking_minutes && (
                    <div style={{ fontSize: "10px", color: "var(--txt2)", marginTop: "4px" }}>
                      Walk: {alt.walking_minutes} min • Ride: {alt.transit_minutes} min
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };
  
  const TransitInfoModal = () => {
    if (!showTransitInfo || !transitInfo) return null;
    
    return (
      <div style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "90%",
        maxWidth: "500px",
        maxHeight: "80vh",
        background: "var(--surface)",
        border: "1px solid var(--border2)",
        borderRadius: "20px",
        zIndex: 200,
        backdropFilter: "blur(32px)",
        boxShadow: "var(--sh-lg)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}>
        <div className="p-head" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="p-title">Transit Information</div>
          <button className="p-close" onClick={() => setShowTransitInfo(false)}>
            <X size={14} />
          </button>
        </div>
        
        <div style={{ overflowY: "auto", padding: "16px" }}>
          {transitInfo.map((route, idx) => (
            <div key={idx} style={{ marginBottom: "20px", borderBottom: "1px solid var(--border)", paddingBottom: "12px" }}>
              <div style={{ fontWeight: "bold", color: "var(--wood)", marginBottom: "8px" }}>
                Option {idx + 1}: {route.duration_minutes} min total
              </div>
              <div style={{ fontSize: "12px", color: "var(--txt2)", marginBottom: "8px" }}>
                🚶 Walk: {route.walking_minutes} min • 🚌 Ride: {route.transit_minutes} min
              </div>
              {route.transit_lines.map((line, li) => (
                <div key={li} style={{ background: "var(--inset)", padding: "8px", borderRadius: "8px", marginBottom: "6px" }}>
                  <strong style={{ color: "var(--wood)" }}>{line.line}</strong> - {line.vehicle}
                  {line.direction && <div style={{ fontSize: "11px" }}>Direction: {line.direction}</div>}
                </div>
              ))}
              <div style={{ fontSize: "11px", color: "var(--txt2)", marginTop: "8px" }}>
                {route.steps.map((step, si) => (
                  <div key={si} style={{ marginTop: "4px" }}>
                    • {step.instruction}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        
        <button
          onClick={() => setShowTransitInfo(false)}
          style={{
            margin: "12px 16px 16px",
            padding: "10px",
            background: "var(--wood-g)",
            border: "none",
            borderRadius: "12px",
            color: "white",
            fontWeight: "bold",
            cursor: "pointer"
          }}
        >
          Close
        </button>
      </div>
    );
  };
  
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

        {/* ── MAP ──────────────────────────────── */}
        <div className="map-wrap">
          <MapContainer
            center={loc}
            zoom={zoom}
            className="w-full h-full"
            style={{ filter: hc ? "contrast(1.35)" : "none" }}
            aria-label="Interactive accessible route map"
          >
            <ChangeView
              center={loc}
              zoom={zoom}
              routeBounds={routePath.length >= 2 ? routePath : null}
            />
            <TileLayer
              attribution={mapTypes[mapType].attribution}
              url={mapTypes[mapType].url}
            />
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
                <strong
                  style={{ fontFamily: "DM Sans,sans-serif", color: "#ffffff" }}
                >
                  You are here
                </strong>
              </Popup>
            </CircleMarker>
            {dest && (
              <Marker position={dest} icon={destinationIcon}>
                <Popup>
                  <strong
                    style={{
                      fontFamily: "DM Sans,sans-serif",
                      color: "#ffffff",
                    }}
                  >
                    Destination
                  </strong>
                  <br />
                  <small
                    style={{
                      color: "#e0c8b0",
                      fontFamily: "DM Sans,sans-serif",
                    }}
                  >
                    {toVal}
                  </small>
                </Popup>
              </Marker>
            )}
            {routePath.length >= 2 && (
              <>
                {/* Glow layer */}
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
                {/* Outer stroke */}
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
                {/* Main route */}
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
            )}
            {hazards.map((h, i) => (
              <Marker key={i} position={h.position} icon={hazardIcon}>
                <Popup>
                  <strong
                    style={{
                      color: "#ffb347",
                      fontFamily: "DM Sans,sans-serif",
                    }}
                  >
                    ⚠ {h.type}
                  </strong>
                  <br />
                  <small
                    style={{
                      fontFamily: "DM Sans,sans-serif",
                      color: "#ffffff",
                    }}
                  >
                    {h.description}
                  </small>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* ── RAIL ─────────────────────────────── */}
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
            aria-label="Get transit information"
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

        {/* ── SIDE PANEL ───────────────────────── */}
        <aside
          ref={panelRef}
          className={`panel${panel ? " open" : ""}`}
          role="complementary"
          aria-label={
            panel === "a11y"
              ? "Accessibility settings"
              : panel === "saved"
                ? "Saved places"
                : "Recent routes"
          }
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
            {/* SAVED */}
            {panel === "saved" && (
              <>
                <div>
                  <div className="p-sec">Pinned</div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
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
                        aria-label={`Go to ${d.name}`}
                      >
                        <div className={`p-ico ${d.color}`}>
                          <d.Icon size={15} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="p-name">{d.name}</div>
                          <div className="p-sub">
                            <Accessibility
                              size={10}
                              style={{ color: "var(--green)", flexShrink: 0 }}
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
                      gap: "6px",
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
                        aria-label={`Navigate to ${d.name}`}
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

            {/* RECENTS */}
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
                      gap: "6px",
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
                        aria-label={`Recent: ${r.name}`}
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

            {/* A11Y */}
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
                        aria-label={f.label}
                      >
                        <span className="ab-i">
                          <f.Icon size={14} />
                        </span>
                        <span className="ab-l">{f.label}</span>
                        <span className="ab-c" aria-hidden="true">
                          {a11y[f.key] ? "✓" : ""}
                        </span>
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
                      gap: "6px",
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
                          aria-pressed={mapType === k}
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
                        aria-pressed={!!prefs[f.k]}
                        aria-label={f.l}
                      >
                        <span className="ab-i">
                          <f.Icon size={14} />
                        </span>
                        <span className="ab-l">{f.l}</span>
                        <span className="ab-c" aria-hidden="true">
                          {prefs[f.k] ? "✓" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>

        {/* ── SEARCH CARD ──────────────────────── */}
        <div className="sc" role="search" aria-label="Route planner">
          <div className="sc-head">
            <Route size={16} style={{ color: "var(--wood)", flexShrink: 0 }} />
            <div className="sc-brand">
              Access<span>Route</span>
            </div>
          </div>

          <div className="sc-inputs">
            {/* FROM */}
            <div className="ac">
              <div className="rr">
                <span className="rr-dot rr-dot-g" aria-hidden="true" />
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
                  aria-autocomplete="list"
                  aria-expanded={fromSuggOpen}
                  onKeyDown={fromKD}
                  onFocus={() => fromSugg.length > 0 && setFromSuggOpen(true)}
                  autoComplete="off"
                />
                {fromSuggLoad && (
                  <div
                    style={{
                      position: "absolute",
                      right: "34px",
                      top: "50%",
                      transform: "translateY(-50%)",
                    }}
                  >
                    <div className="spn" aria-hidden="true" />
                  </div>
                )}
                <button
                  className="ri-btn"
                  onClick={getGPS}
                  aria-label="Use GPS location"
                  title="Use my location"
                >
                  <Crosshair size={12} />
                </button>
              </div>

              {fromSuggOpen && (
                <div
                  className="ac-drop"
                  role="listbox"
                  aria-label="Starting location suggestions"
                >
                  <div className="ac-hd">
                    <MapPin size={10} /> Suggestions
                  </div>
                  {fromSuggLoad && fromSugg.length === 0 ? (
                    <div className="ac-wait">
                      <div className="spn" aria-hidden="true" />
                      Searching…
                    </div>
                  ) : (
                    fromSugg.map((s, i) => {
                      const CIcon = getCatIcon(s.category);
                      return (
                        <button
                          key={s.id || i}
                          className={`ac-row${fromHiIdx === i ? " hi" : ""}`}
                          role="option"
                          aria-selected={fromHiIdx === i}
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

            <div className="ri-conn" aria-hidden="true">
              <div className="ri-conn-line" />
              <span className="ri-conn-lbl">to</span>
            </div>

            {/* TO + AUTOCOMPLETE */}
            <div className="ac">
              <div className="rr">
                <span className="rr-dot rr-dot-r" aria-hidden="true" />
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
                  aria-autocomplete="list"
                  aria-controls="ac-list"
                  aria-expanded={suggOpen}
                  onKeyDown={destKD}
                  onFocus={() => sugg.length > 0 && setSuggOpen(true)}
                  autoComplete="off"
                />
                {suggLoad && (
                  <div
                    style={{
                      position: "absolute",
                      right: "9px",
                      top: "50%",
                      transform: "translateY(-50%)",
                    }}
                  >
                    <div className="spn" aria-hidden="true" />
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
                    aria-label="Clear destination"
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
                  aria-label="Location suggestions"
                >
                  <div className="ac-hd">
                    <MapPin size={10} /> Suggestions
                  </div>
                  {suggLoad && sugg.length === 0 ? (
                    <div className="ac-wait">
                      <div className="spn" aria-hidden="true" />
                      Searching…
                    </div>
                  ) : (
                    sugg.map((s, i) => {
                      const CIcon = getCatIcon(s.category);
                      return (
                        <button
                          key={s.id || i}
                          className={`ac-row${hiIdx === i ? " hi" : ""}`}
                          role="option"
                          aria-selected={hiIdx === i}
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

          {/* TRAVEL MODES */}
          <div className="sc-modes" role="radiogroup" aria-label="Travel mode">
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
                  setRoutePath([]);
                  setDest(null);
                  setRouteInfo(null);
                  say(`${t.l} mode`);
                }}
                aria-pressed={mode === t.id}
                aria-label={`${t.l} mode`}
              >
                <span className="mp-i">
                  <t.Icon size={18} />
                </span>
                <span className="mp-l">{t.l}</span>
              </button>
            ))}
          </div>

          {/* FIND ROUTE BUTTON */}
          <button
            className="sc-find"
            onClick={calcRoute}
            disabled={!toVal.trim() || isLoading}
            aria-label="Find accessible route"
          >
            {isLoading ? (
              <>
                <div className="spn2" aria-hidden="true" /> Calculating…
              </>
            ) : (
              <>
                <Search size={15} /> Find Safe Route
              </>
            )}
          </button>

          {/* LEGEND */}
          <button
            className="sc-leg-btn"
            onClick={() => setLegendOpen((o) => !o)}
            aria-expanded={legendOpen}
          >
            <span className="sc-leg-lbl">Map Legend</span>
            <ChevronDown
              size={13}
              className={`leg-chv${legendOpen ? " open" : ""}`}
              aria-hidden="true"
            />
          </button>
          {legendOpen && (
            <div className="sc-leg-body" role="list">
              {[
                { color: "#e8a870", label: "Accessible Route", dash: true },
                { color: "#8cd69c", label: "Walking Route", dash: false },
                { color: "#ffb347", label: "Hazard / Construction", dot: true },
                { color: "#ff7b6b", label: "Avoid Zone", dot: true },
              ].map((item) => (
                <div key={item.label} className="leg-row" role="listitem">
                  {item.dot ? (
                    <div
                      style={{
                        width: "9px",
                        height: "9px",
                        borderRadius: "50%",
                        background: item.color,
                        flexShrink: 0,
                        boxShadow: `0 0 5px ${item.color}`,
                      }}
                      aria-hidden="true"
                    />
                  ) : (
                    <div
                      style={{
                        width: "28px",
                        height: "3px",
                        borderRadius: "2px",
                        flexShrink: 0,
                        background: item.dash
                          ? `repeating-linear-gradient(90deg,${item.color} 0,${item.color} 6px,transparent 6px,transparent 10px)`
                          : item.color,
                      }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="leg-lbl">{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── MAP TYPE BAR ─────────────────────── */}
        <div className="mt-bar" role="radiogroup" aria-label="Map style">
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
                aria-pressed={mapType === k}
                title={v.name}
              >
                <MIcon size={12} /> {v.name}
              </button>
            );
          })}
        </div>

        {/* ── MAP CONTROLS ─────────────────────── */}
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
          <div className="mc-z" aria-label={`Zoom level ${zoom}`}>
            {zoom}×
          </div>
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

        {/* ── ROUTE INFO BAR ───────────────────── */}
        {routeInfo && (
          <div className="rbar" role="region" aria-label="Route information">
            <div className="rs">
              <div className="rs-v">{routeInfo.distance}</div>
              <div className="rs-l">Distance</div>
            </div>
            <div className="rs-d" aria-hidden="true" />
            <div className="rs">
              <div className="rs-v">{routeInfo.duration}</div>
              <div className="rs-l">Est. Time</div>
            </div>
            <div className="rs-d" aria-hidden="true" />
            <div className="rs">
              <div className="rs-v" style={{ color: "var(--green)" }}>
                <Accessibility size={16} />
              </div>
              <div className="rs-l">Accessible</div>
            </div>
            {mode === 'transit' && (
              <>
                <div className="rs-d" aria-hidden="true" />
                <button
                  className="rs-bus"
                  onClick={getTransitInfo}
                  aria-label="View transit details"
                >
                  <Bus size={14} /> Bus Info
                </button>
              </>
            )}
            <button
              className="rs-cl"
              onClick={() => {
                setRoutePath([]);
                setDest(null);
                setRouteInfo(null);
                setShowRouteAlert(false);
              }}
              aria-label="Clear route"
            >
              Clear
            </button>
          </div>
        )}

        {/* ── ALERTS AND MODALS ────────────────── */}
        <RouteAlertComponent />
        <TransitInfoModal />

        {/* ── TOAST ────────────────────────────── */}
        <div
          className={`toast${toast ? " vis" : ""}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {toast}
        </div>
      </div>
    </>
  );
}