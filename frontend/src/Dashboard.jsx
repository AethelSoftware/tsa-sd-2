import { useState, useRef, useEffect, useCallback } from "react";
import {
  MapContainer, TileLayer, Marker, Popup, Polyline, useMap, CircleMarker,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const TOMTOM_API_KEY = "pGgvcZ6eZtE6gWrrV7bDZO3ei4XaKOnM";

const destinationIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});
const hazardIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const mapTypes = {
  openstreetmap: { name: "Street",    icon: "🗺️", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",                                                                  attribution: "© OpenStreetMap contributors" },
  tomtom:        { name: "TomTom",    icon: "📍", url: `https://{s}.api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}`,                              attribution: "© TomTom" },
  satellite:     { name: "Satellite", icon: "🛰️", url: `https://{s}.api.tomtom.com/map/1/tile/sat/main/{z}/{x}/{y}.jpg?key=${TOMTOM_API_KEY}`,                              attribution: "© TomTom" },
  night:         { name: "Night",     icon: "🌙", url: `https://{s}.api.tomtom.com/map/1/tile/night/main/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}`,                             attribution: "© TomTom" },
};

function ChangeView({ center, zoom }) {
  const map = useMap();
  useEffect(() => { map.setView(center, zoom); }, [center, zoom, map]);
  return null;
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --rail-w: 56px;
    --surface: rgba(11,16,30,0.97);
    --card: rgba(14,21,42,0.97);
    --border: rgba(56,189,248,0.12);
    --border2: rgba(56,189,248,0.3);
    --cyan: #38bdf8;
    --cyan-g: linear-gradient(135deg,#0ea5e9,#38bdf8);
    --cyan-dim: rgba(56,189,248,0.1);
    --cyan-glow: rgba(56,189,248,0.22);
    --green: #34d399;
    --amber: #fbbf24;
    --red: #f87171;
    --red-dim: rgba(248,113,113,0.1);
    --txt: #e2f0ff;
    --txt2: #5f85a8;
    --txt3: #2d4a65;
    --ff-d: 'Syne', sans-serif;
    --ff-b: 'DM Sans', sans-serif;
    --sh: 0 8px 32px rgba(0,0,0,0.6),0 2px 8px rgba(0,0,0,0.3);
    --sh-lg: 0 20px 60px rgba(0,0,0,0.75),0 4px 20px rgba(0,0,0,0.4);
  }

  .root {
    font-family: var(--ff-b);
    background: #080d18;
    color: var(--txt);
    width: 100vw; height: 100vh;
    overflow: hidden;
    position: relative;
  }
  .hc {
    --surface: #000; --card: #0d0d0d;
    --border: #ff0; --border2: #ff0;
    --cyan: #ff0; --cyan-dim: rgba(255,255,0,.1); --cyan-glow: rgba(255,255,0,.25);
    --txt: #ff0; --txt2: #ff0; --txt3: #cc0;
  }

  /* MAP */
  .map-wrap { position: absolute; inset: 0; z-index: 0; }
  .leaflet-container { background: #07101c !important; }
  .leaflet-tile-pane { filter: saturate(.72) brightness(.85); }
  .leaflet-popup-content-wrapper {
    background: var(--card) !important; border: 1px solid var(--border2) !important;
    border-radius: 12px !important; color: var(--txt) !important;
    box-shadow: var(--sh) !important; font-family: var(--ff-b) !important;
  }
  .leaflet-popup-tip { background: rgba(14,21,42,.97) !important; }
  .leaflet-control-zoom { display: none !important; }
  .leaflet-control-attribution { display: none; }

  /* RAIL */
  .rail {
    position: absolute; left: 0; top: 0; bottom: 0;
    width: var(--rail-w);
    background: var(--surface);
    border-right: 1px solid var(--border);
    backdrop-filter: blur(28px);
    z-index: 60;
    display: flex; flex-direction: column; align-items: center;
    padding: 12px 0 16px; gap: 2px;
  }
  .r-logo {
    width: 34px; height: 34px;
    background: var(--cyan-g); border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; box-shadow: 0 0 18px var(--cyan-glow);
    margin-bottom: 12px; flex-shrink: 0;
  }
  .r-btn {
    width: 40px; height: 40px; border-radius: 10px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 3px; background: transparent; border: 1px solid transparent;
    cursor: pointer; color: var(--txt3); transition: all .17s; position: relative;
    font-size: 17px;
  }
  .r-btn:hover { background: var(--cyan-dim); border-color: var(--border); color: var(--txt2); }
  .r-btn.on  { background: var(--cyan-dim); border-color: var(--border2); color: var(--cyan); }
  .r-lbl { font-size: 9px; font-weight: 600; letter-spacing: .3px; color: inherit; }
  .r-sep { width: 22px; height: 1px; background: var(--border); margin: 5px 0; flex-shrink: 0; }
  .r-space { flex: 1; }
  .r-btn[data-tip]::after {
    content: attr(data-tip);
    position: absolute; left: calc(100% + 10px); top: 50%; transform: translateY(-50%);
    background: var(--card); border: 1px solid var(--border2); border-radius: 8px;
    padding: 5px 11px; font-family: var(--ff-b); font-size: 12px; font-weight: 500;
    color: var(--txt); white-space: nowrap; opacity: 0; pointer-events: none;
    transition: opacity .15s; z-index: 999; box-shadow: var(--sh);
  }
  .r-btn[data-tip]:hover::after { opacity: 1; }

  /* SIDE PANEL */
  .panel {
    position: absolute; left: var(--rail-w); top: 0; bottom: 0;
    width: 276px; background: var(--surface); border-right: 1px solid var(--border);
    backdrop-filter: blur(28px); z-index: 55;
    display: flex; flex-direction: column;
    transform: translateX(-100%);
    transition: transform .27s cubic-bezier(.4,0,.2,1);
    box-shadow: var(--sh-lg);
  }
  .panel.open { transform: translateX(0); }
  .p-head {
    padding: 18px 16px 14px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
  }
  .p-title { font-family: var(--ff-d); font-size: 15px; font-weight: 800; color: var(--txt); }
  .p-close {
    background: rgba(255,255,255,.04); border: 1px solid var(--border);
    border-radius: 7px; width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--txt3); font-size: 13px; transition: all .15s;
  }
  .p-close:hover { color: var(--red); border-color: rgba(248,113,113,.3); background: var(--red-dim); }
  .p-body {
    flex: 1; overflow-y: auto; padding: 14px 14px 20px;
    display: flex; flex-direction: column; gap: 20px;
    scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  }
  .p-sec { font-size: 10px; font-weight: 700; letter-spacing: 1.3px; text-transform: uppercase; color: var(--txt3); margin-bottom: 8px; }

  /* items in panel */
  .p-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 11px; background: rgba(255,255,255,.03);
    border: 1px solid var(--border); border-radius: 11px;
    cursor: pointer; transition: all .15s; width: 100%; text-align: left;
  }
  .p-item:hover { background: var(--cyan-dim); border-color: var(--border2); transform: translateX(2px); }
  .p-item.sel { border-color: var(--cyan); background: var(--cyan-dim); }
  .p-ico {
    width: 30px; height: 30px; font-size: 16px;
    background: rgba(255,255,255,.05); border: 1px solid var(--border);
    border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .p-name { font-size: 13px; font-weight: 500; color: var(--txt); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .p-sub  { font-size: 11px; color: var(--txt3); margin-top: 1px; }
  .p-arr  { margin-left: auto; color: var(--txt3); font-size: 12px; transition: all .15s; }
  .p-item:hover .p-arr { color: var(--cyan); transform: translateX(2px); }
  .p-empty { text-align: center; color: var(--txt3); font-size: 12px; line-height: 1.7; padding: 18px 0; }

  /* a11y grid */
  .ag { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .ab {
    background: rgba(255,255,255,.03); border: 1px solid var(--border);
    border-radius: 10px; padding: 10px 9px;
    display: flex; align-items: center; gap: 7px;
    cursor: pointer; transition: all .15s; width: 100%; text-align: left;
  }
  .ab:hover { border-color: var(--border2); }
  .ab.on { border-color: var(--cyan); background: var(--cyan-dim); }
  .ab-i { font-size: 15px; }
  .ab-l { font-size: 11px; font-weight: 500; color: var(--txt3); flex: 1; line-height: 1.3; }
  .ab.on .ab-l { color: var(--cyan); }
  .ab-c {
    width: 14px; height: 14px; border-radius: 4px;
    border: 1.5px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; flex-shrink: 0; transition: all .15s;
  }
  .ab.on .ab-c { background: var(--cyan); border-color: var(--cyan); color: #060f1e; }

  /* SEARCH CARD */
  .sc {
    position: absolute;
    top: 12px; left: calc(var(--rail-w) + 12px);
    z-index: 50; width: 332px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 18px; backdrop-filter: blur(32px);
    box-shadow: var(--sh-lg);
    transition: border-color .2s, box-shadow .2s;
  }
  .sc:focus-within { border-color: var(--border2); }

  .sc-inputs { padding: 14px 14px 10px; display: flex; flex-direction: column; gap: 7px; }

  /* row */
  .rr { position: relative; }
  .rr-dot {
    position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
    width: 9px; height: 9px; border-radius: 50%; pointer-events: none;
  }
  .rr-dot-g { background: var(--green); box-shadow: 0 0 7px var(--green); animation: blk 2.2s ease infinite; }
  .rr-dot-r { background: var(--red);   box-shadow: 0 0 7px var(--red); }
  @keyframes blk { 0%,100%{opacity:1;transform:translateY(-50%) scale(1)} 50%{opacity:.6;transform:translateY(-50%) scale(1.35)} }

  .ri {
    width: 100%; background: rgba(255,255,255,.04); border: 1px solid var(--border);
    border-radius: 10px; padding: 10px 34px 10px 29px;
    color: var(--txt); font-family: var(--ff-b); font-size: 13.5px;
    outline: none; transition: border-color .18s, box-shadow .18s, background .18s;
  }
  .ri::placeholder { color: var(--txt3); }
  .ri:focus { border-color: var(--cyan); background: rgba(56,189,248,.05); box-shadow: 0 0 0 3px var(--cyan-dim); }

  .ri-side-btn {
    position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
    background: rgba(255,255,255,.05); border: 1px solid var(--border);
    border-radius: 7px; width: 23px; height: 23px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--txt3); font-size: 11px; transition: all .15s;
  }
  .ri-side-btn:hover { background: var(--cyan-dim); border-color: var(--border2); color: var(--cyan); }

  .ri-conn { display: flex; align-items: center; gap: 8px; padding: 0 13px; pointer-events: none; }
  .ri-conn-line { width: 1px; height: 13px; flex-shrink: 0; background: linear-gradient(to bottom,var(--green),var(--red)); opacity: .3; }
  .ri-conn-lbl  { font-size: 11px; color: var(--txt3); }

  /* autocomplete */
  .ac { position: relative; }
  .ac-drop {
    position: absolute; top: calc(100% + 5px); left: 0; right: 0;
    background: var(--card); border: 1px solid var(--border2);
    border-radius: 13px; overflow: hidden; z-index: 300;
    box-shadow: var(--sh-lg); animation: fd .14s ease;
  }
  @keyframes fd { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:translateY(0)} }
  .ac-hd { padding: 7px 12px 5px; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--txt3); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 5px; }
  .ac-row {
    display: flex; align-items: center; gap: 9px; padding: 9px 12px;
    background: transparent; border: none; width: 100%; text-align: left;
    cursor: pointer; transition: background .12s; color: var(--txt);
  }
  .ac-row:hover,.ac-row.hi { background: var(--cyan-dim); }
  .ac-row+.ac-row { border-top: 1px solid rgba(56,189,248,.05); }
  .ac-ico { width: 26px; height: 26px; background: rgba(255,255,255,.05); border: 1px solid var(--border); border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
  .ac-name { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ac-addr { font-size: 11px; color: var(--txt3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
  .ac-tag { margin-left: auto; font-size: 10px; font-weight: 700; letter-spacing: .3px; text-transform: uppercase; color: var(--cyan); background: var(--cyan-dim); border: 1px solid rgba(56,189,248,.2); border-radius: 4px; padding: 2px 6px; white-space: nowrap; flex-shrink: 0; max-width: 70px; overflow: hidden; text-overflow: ellipsis; }
  .ac-wait { display: flex; align-items: center; gap: 8px; padding: 13px; font-size: 12px; color: var(--txt3); }

  @keyframes spin { to{transform:rotate(360deg)} }
  .spn  { width: 12px; height: 12px; border: 2px solid var(--border); border-top-color: var(--cyan); border-radius: 50%; animation: spin .6s linear infinite; flex-shrink: 0; }
  .spn2 { width: 15px; height: 15px; border: 2px solid rgba(6,15,30,.3); border-top-color: #060f1e; border-radius: 50%; animation: spin .65s linear infinite; }

  /* modes */
  .sc-modes { display: flex; gap: 6px; padding: 2px 14px 4px; }
  .mp {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 9px 4px; background: rgba(255,255,255,.04);
    border: 1px solid var(--border); border-radius: 10px;
    cursor: pointer; transition: all .17s; color: var(--txt3); font-family: var(--ff-b);
  }
  .mp:hover { border-color: var(--border2); color: var(--txt2); background: var(--cyan-dim); }
  .mp.on { border-color: var(--cyan); background: var(--cyan-dim); color: var(--cyan); box-shadow: 0 0 12px var(--cyan-glow); }
  .mp-i { font-size: 18px; }
  .mp-l { font-size: 10px; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; }

  /* find btn */
  .sc-find {
    margin: 6px 14px 12px; width: calc(100% - 28px); padding: 13px;
    background: var(--cyan-g); border: none; border-radius: 12px;
    color: #040d1a; font-family: var(--ff-d); font-size: 14px; font-weight: 800;
    cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px;
    transition: all .2s; box-shadow: 0 4px 18px rgba(14,165,233,.32); letter-spacing: .15px;
  }
  .sc-find:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 7px 26px rgba(14,165,233,.48); }
  .sc-find:disabled { background: rgba(255,255,255,.06); color: var(--txt3); box-shadow: none; cursor: not-allowed; }

  /* legend */
  .sc-leg-btn {
    display: flex; align-items: center; justify-content: space-between;
    padding: 9px 14px; border-top: 1px solid var(--border);
    background: transparent; border-left: none; border-right: none; border-bottom: none;
    width: 100%; cursor: pointer; color: var(--txt3); font-family: var(--ff-b); transition: color .15s;
  }
  .sc-leg-btn:hover { color: var(--txt2); }
  .sc-leg-lbl { font-size: 10.5px; font-weight: 600; letter-spacing: .8px; text-transform: uppercase; }
  .sc-leg-chv { font-size: 9px; transition: transform .2s; }
  .sc-leg-chv.open { transform: rotate(180deg); }
  .sc-leg-body { padding: 0 14px 12px; display: flex; flex-direction: column; gap: 7px; }
  .leg-row { display: flex; align-items: center; gap: 10px; }
  .leg-lbl { font-size: 11.5px; color: var(--txt2); }

  /* route info bar */
  .rbar {
    position: absolute; bottom: 20px; left: calc(var(--rail-w) + 12px); z-index: 50;
    background: var(--surface); border: 1px solid var(--border2);
    border-radius: 16px; backdrop-filter: blur(24px);
    padding: 12px 16px; display: flex; align-items: center; gap: 13px;
    box-shadow: var(--sh); animation: su .24s ease;
  }
  @keyframes su { from{opacity:0;transform:translateY(7px)} to{opacity:1;transform:translateY(0)} }
  .rs  { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .rs-v { font-family: var(--ff-d); font-size: 15px; font-weight: 800; color: var(--cyan); }
  .rs-l { font-size: 10px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--txt3); }
  .rs-d { width: 1px; height: 24px; background: var(--border); }
  .rs-cl { background: var(--red-dim); border: 1px solid rgba(248,113,113,.2); border-radius: 8px; padding: 5px 10px; color: var(--red); font-size: 11px; font-weight: 700; cursor: pointer; transition: all .15s; margin-left: 4px; }
  .rs-cl:hover { background: rgba(248,113,113,.18); }

  /* map type bar */
  .mt-bar { position: absolute; top: 14px; right: 14px; z-index: 50; display: flex; gap: 5px; }
  .mt-btn {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 9px; backdrop-filter: blur(20px); padding: 7px 11px;
    display: flex; align-items: center; gap: 5px;
    cursor: pointer; color: var(--txt3); font-family: var(--ff-b); font-size: 12px; font-weight: 500;
    transition: all .15s; white-space: nowrap;
  }
  .mt-btn:hover { color: var(--txt2); border-color: var(--border2); }
  .mt-btn.on { color: var(--cyan); border-color: var(--cyan); background: var(--cyan-dim); }

  /* map ctrl */
  .mctrl { position: absolute; right: 14px; bottom: 80px; z-index: 50; display: flex; flex-direction: column; gap: 5px; }
  .mc {
    width: 38px; height: 38px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 9px; backdrop-filter: blur(20px);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--txt2); font-size: 17px; font-weight: 300; transition: all .15s;
  }
  .mc:hover { border-color: var(--border2); color: var(--cyan); background: var(--cyan-dim); }
  .mc-z { font-size: 10px; font-weight: 700; letter-spacing: .3px; color: var(--txt3); text-align: center; padding: 3px 0; }

  /* toast */
  .toast {
    position: absolute; bottom: 22px; left: 50%; z-index: 200;
    transform: translateX(-50%) translateY(12px);
    background: var(--surface); border: 1px solid var(--border2); border-radius: 50px;
    backdrop-filter: blur(20px); padding: 8px 20px;
    font-size: 12.5px; font-weight: 500; color: var(--cyan);
    white-space: nowrap; opacity: 0; pointer-events: none;
    transition: all .24s; max-width: calc(100vw - 100px);
    text-align: center; overflow: hidden; text-overflow: ellipsis; box-shadow: var(--sh);
  }
  .toast.vis { opacity: 1; transform: translateX(-50%) translateY(0); }

  .sr { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0; }
`;

const A11Y_FEATS = [
  { key: "visionImpaired",  icon: "👁️", label: "Vision Mode" },
  { key: "hearingImpaired", icon: "👂", label: "Hearing Mode" },
  { key: "highContrast",    icon: "◑",  label: "High Contrast" },
  { key: "largeText",       icon: "🔍", label: "Large Text" },
  { key: "reducedMotion",   icon: "⏸", label: "Reduce Motion" },
  { key: "lowEnergy",       icon: "⚡", label: "Low Energy" },
];

const SAVED = [
  { name: "University of Pittsburgh", sub: "Education",  icon: "🎓" },
  { name: "Carnegie Museum",          sub: "Museum",     icon: "🏛️" },
  { name: "Accessible Transit Hub",   sub: "Transport",  icon: "🚌" },
  { name: "City Hospital",            sub: "Medical",    icon: "🏥" },
];

function getCatIco(cat) {
  if (!cat) return "📍";
  const c = cat.toLowerCase();
  if (c.includes("hospital")||c.includes("medical")||c.includes("health")) return "🏥";
  if (c.includes("school")||c.includes("university")||c.includes("college")) return "🎓";
  if (c.includes("restaurant")||c.includes("food")||c.includes("cafe")) return "🍽️";
  if (c.includes("park")||c.includes("garden")) return "🌳";
  if (c.includes("transit")||c.includes("bus")||c.includes("train")||c.includes("station")) return "🚌";
  if (c.includes("museum")||c.includes("gallery")) return "🏛️";
  if (c.includes("shop")||c.includes("store")||c.includes("mall")) return "🛍️";
  if (c.includes("hotel")||c.includes("lodging")) return "🏨";
  if (c.includes("pharmacy")) return "💊";
  return "📍";
}

export default function AccessibleMap() {
  const [mapType, setMapType]     = useState("openstreetmap");
  const [zoom, setZoom]           = useState(13);
  const [loc, setLoc]             = useState([40.472, -79.94]);
  const [routePath, setRoutePath] = useState([]);
  const [dest, setDest]           = useState(null);
  const [hazards]                 = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);

  const [fromVal, setFromVal]     = useState("Current Location");
  const [toVal, setToVal]         = useState("");
  const [mode, setMode]           = useState("wheelchair");

  const [sugg, setSugg]           = useState([]);
  const [suggOpen, setSuggOpen]   = useState(false);
  const [suggLoad, setSuggLoad]   = useState(false);
  const [hiIdx, setHiIdx]         = useState(-1);

  const [panel, setPanel]         = useState(null); // 'saved'|'recents'|'a11y'
  const [legendOpen, setLegendOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast]         = useState("");

  const [a11y, setA11y] = useState({ visionImpaired:false, hearingImpaired:false, lowEnergy:false, highContrast:false, largeText:false, screenReader:false, reducedMotion:false });

  const [recents, setRecents] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ar_recents") || "[]"); } catch { return []; }
  });

  const debRef   = useRef(null);
  const destRef  = useRef(null);
  const suggRef  = useRef(null);
  const panelRef = useRef(null);

  const say = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(""), 3200); }, []);

  useEffect(() => {
    const h = (e) => {
      if (suggRef.current && !suggRef.current.contains(e.target) && e.target !== destRef.current) setSuggOpen(false);
      if (panelRef.current && !panelRef.current.contains(e.target) && !e.target.closest(".rail")) setPanel(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const searchPlaces = (q) => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!q || q.length < 2) { setSugg([]); setSuggOpen(false); return; }
    debRef.current = setTimeout(async () => {
      setSuggLoad(true);
      try {
        const [lat, lng] = loc;
        const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${TOMTOM_API_KEY}&limit=6&lat=${lat}&lon=${lng}&radius=50000&language=en-US`;
        const d = await (await fetch(url)).json();
        const m = (d.results||[]).map(r=>({ id:r.id, name:r.poi?.name||r.address?.freeformAddress, address:r.address?.freeformAddress, category:r.poi?.categories?.[0]||null })).filter(r=>r.name);
        setSugg(m); setSuggOpen(m.length > 0); setHiIdx(-1);
      } catch {/* noop */} finally { setSuggLoad(false); }
    }, 280);
  };

  const pickSugg = (s) => {
    setToVal(s.address || s.name);
    setSugg([]); setSuggOpen(false); setHiIdx(-1);
    destRef.current?.blur();
    say(`Destination: ${s.name}`);
  };

  const destKD = (e) => {
    if (!suggOpen) { if (e.key === "Enter") calcRoute(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHiIdx(p => Math.min(p+1, sugg.length-1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHiIdx(p => Math.max(p-1, -1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (hiIdx >= 0) pickSugg(sugg[hiIdx]); else calcRoute(); }
    else if (e.key === "Escape") { setSuggOpen(false); setHiIdx(-1); }
  };

  const calcRoute = async () => {
    if (!toVal.trim()) { say("Enter a destination first"); return; }
    setIsLoading(true); say("Finding your safe route…");
    try {
      const res = await fetch("http://localhost:5000/api/calculate-route", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ start_location:fromVal, end_location:toVal, accessibility_preferences:{ elevator_access:true, wheelchair:mode==="wheelchair", wellLitAreas:a11y.visionImpaired, avoidStairs:true } }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.success && data.route?.coordinates?.length >= 2) {
        const coords = data.route.coordinates.map(c => [c.lat, c.lng]);
        setRoutePath(coords); setDest(coords[coords.length-1]);
        setRouteInfo({ distance:data.route.distance, duration:data.route.duration });
        const nr = [{ name:toVal }, ...recents.filter(r=>r.name!==toVal)].slice(0,6);
        setRecents(nr);
        try { localStorage.setItem("ar_recents", JSON.stringify(nr)); } catch {}
        say(`Route found · ${data.route.distance} · ${data.route.duration}`);
      } else { say("Couldn't find a route. Try somewhere else."); }
    } catch { say("Connection error. Is the backend running?"); }
    finally { setIsLoading(false); }
  };

  const getGPS = () => {
    if (!navigator.geolocation) return;
    say("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      p => { setLoc([p.coords.latitude, p.coords.longitude]); setFromVal("Current Location"); say("Location updated ✓"); },
      () => say("Couldn't get location. Using default.")
    );
  };

  const hc = a11y.highContrast;
  const lt = a11y.largeText;

  const togglePanel = (name) => setPanel(p => p === name ? null : name);

  return (
    <>
      <style>{CSS}</style>
      <div className={`root${hc?" hc":""}`} style={{fontSize: lt?"1.06rem":"1rem"}} role="application" aria-label="AccessRoute — Accessible Navigation">
        <div aria-live="assertive" aria-atomic="true" className="sr" role="status">{toast}</div>

        {/* MAP */}
        <div className="map-wrap">
          <MapContainer center={loc} zoom={zoom} className="w-full h-full" style={{filter:hc?"contrast(1.4)":"none"}} aria-label="Accessible route map">
            <ChangeView center={loc} zoom={zoom} />
            <TileLayer attribution={mapTypes[mapType].attribution} url={mapTypes[mapType].url} />
            <CircleMarker center={loc} radius={11} pathOptions={{color:"#38bdf8",fillColor:"#38bdf8",fillOpacity:.28,weight:2}}>
              <Popup><strong>You are here</strong></Popup>
            </CircleMarker>
            {dest && (
              <Marker position={dest} icon={destinationIcon}>
                <Popup><strong>Destination</strong><br /><small style={{color:"#5f85a8"}}>{toVal}</small></Popup>
              </Marker>
            )}
            {routePath.length >= 2 && (
              <Polyline positions={routePath} pathOptions={{color:mode==="wheelchair"?"#38bdf8":"#34d399", weight:5, opacity:.9, dashArray:mode==="wheelchair"?"12,8":undefined, lineCap:"round", lineJoin:"round"}} />
            )}
            {hazards.map((h,i) => (
              <Marker key={i} position={h.position} icon={hazardIcon}>
                <Popup><strong style={{color:"#fbbf24"}}>⚠ {h.type}</strong><br /><small>{h.description}</small></Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* RAIL */}
        <nav className="rail" role="navigation" aria-label="Main navigation">
          <div className="r-logo" aria-hidden="true">♿</div>

          <button className={`r-btn${panel==="saved"?" on":""}`} onClick={()=>togglePanel("saved")} data-tip="Saved Places" aria-label="Saved places" aria-pressed={panel==="saved"}>
            <span>🔖</span><span className="r-lbl">Saved</span>
          </button>
          <button className={`r-btn${panel==="recents"?" on":""}`} onClick={()=>togglePanel("recents")} data-tip="Recent Routes" aria-label="Recent routes" aria-pressed={panel==="recents"}>
            <span>🕐</span><span className="r-lbl">Recent</span>
          </button>

          <div className="r-sep" aria-hidden="true" />

          <button className={`r-btn${panel==="a11y"?" on":""}`} onClick={()=>togglePanel("a11y")} data-tip="Accessibility" aria-label="Accessibility settings" aria-pressed={panel==="a11y"}>
            <span>⚙</span><span className="r-lbl">Access</span>
          </button>

          <div className="r-space" aria-hidden="true" />

          <button className="r-btn" onClick={getGPS} data-tip="My Location" aria-label="Go to my location">
            <span>⊙</span>
          </button>
        </nav>

        {/* SIDE PANEL */}
        <aside ref={panelRef} className={`panel${panel?" open":""}`} role="complementary"
          aria-label={panel==="a11y"?"Accessibility":panel==="saved"?"Saved places":"Recent routes"}>
          <div className="p-head">
            <div className="p-title">
              {panel==="saved"?"Saved Places":panel==="recents"?"Recent Routes":"Accessibility"}
            </div>
            <button className="p-close" onClick={()=>setPanel(null)} aria-label="Close panel">✕</button>
          </div>

          <div className="p-body">
            {/* SAVED */}
            {panel==="saved" && (
              <div>
                <div className="p-sec">Accessible Nearby</div>
                <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                  {SAVED.map(d => (
                    <button key={d.name} className="p-item" onClick={()=>{setToVal(d.name);say(`Destination: ${d.name}`);setPanel(null);}} aria-label={`Go to ${d.name}`}>
                      <div className="p-ico">{d.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div className="p-name">{d.name}</div>
                        <div className="p-sub"><span style={{color:"var(--green)",marginRight:"3px"}}>♿</span>{d.sub}</div>
                      </div>
                      <span className="p-arr">›</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* RECENTS */}
            {panel==="recents" && (
              <div>
                <div className="p-sec">Recent</div>
                {recents.length === 0
                  ? <div className="p-empty">No recent routes yet.<br />Routes you calculate appear here.</div>
                  : <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                      {recents.map((r,i) => (
                        <button key={i} className="p-item" onClick={()=>{setToVal(r.name);say(`Destination: ${r.name}`);setPanel(null);}} aria-label={`Recent: ${r.name}`}>
                          <div className="p-ico">🕐</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div className="p-name">{r.name}</div>
                            <div className="p-sub">Recent destination</div>
                          </div>
                          <span className="p-arr">›</span>
                        </button>
                      ))}
                    </div>
                }
              </div>
            )}

            {/* A11Y */}
            {panel==="a11y" && (<>
              <div>
                <div className="p-sec">Navigation Modes</div>
                <div className="ag">
                  {A11Y_FEATS.map(f => (
                    <button key={f.key} className={`ab${a11y[f.key]?" on":""}`} onClick={()=>setA11y(p=>({...p,[f.key]:!p[f.key]}))} aria-pressed={a11y[f.key]} aria-label={f.label}>
                      <span className="ab-i">{f.icon}</span>
                      <span className="ab-l">{f.label}</span>
                      <span className="ab-c" aria-hidden="true">{a11y[f.key]?"✓":""}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="p-sec">Map Style</div>
                <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                  {Object.entries(mapTypes).map(([k,v]) => (
                    <button key={k} className={`p-item${mapType===k?" sel":""}`} onClick={()=>{setMapType(k);say(`${v.name} map`);}} aria-pressed={mapType===k}>
                      <div className="p-ico">{v.icon}</div>
                      <div className="p-name">{v.name}</div>
                      {mapType===k && <span style={{marginLeft:"auto",color:"var(--cyan)",fontSize:"12px"}}>✓</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="p-sec">Route Preferences</div>
                <div className="ag">
                  {[
                    {k:"avoidStairs",i:"🪜",l:"Avoid Stairs"},{k:"elevatorAccess",i:"🛗",l:"Elevator"},
                    {k:"avoidHighways",i:"🛣️",l:"No Highways"},{k:"wellLit",i:"💡",l:"Well-lit"},
                    {k:"quietRoads",i:"🤫",l:"Quiet Roads"},{k:"avoidCrowds",i:"👥",l:"Low Crowds"},
                  ].map(f => (
                    <button key={f.k} className="ab" aria-label={f.l}>
                      <span className="ab-i">{f.i}</span><span className="ab-l">{f.l}</span><span className="ab-c" aria-hidden="true"></span>
                    </button>
                  ))}
                </div>
              </div>
            </>)}
          </div>
        </aside>

        {/* SEARCH CARD */}
        <div className="sc" role="search" aria-label="Route planner">
          <div className="sc-inputs">
            {/* FROM */}
            <div className="rr">
              <span className="rr-dot rr-dot-g" aria-hidden="true" />
              <input type="text" value={fromVal} onChange={e=>setFromVal(e.target.value)} className="ri" placeholder="Your starting point" aria-label="Starting location" autoComplete="off" />
              <button className="ri-side-btn" onClick={getGPS} aria-label="Use my GPS location" title="Use GPS">📍</button>
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
                  ref={destRef} type="text" value={toVal}
                  onChange={e=>{setToVal(e.target.value);searchPlaces(e.target.value);}}
                  className="ri" placeholder="Address, place or business…"
                  aria-label="Destination" aria-autocomplete="list"
                  aria-controls="ac-list" aria-expanded={suggOpen}
                  onKeyDown={destKD} onFocus={()=>sugg.length>0&&setSuggOpen(true)}
                  autoComplete="off"
                />
                {suggLoad && <div style={{position:"absolute",right:"10px",top:"50%",transform:"translateY(-50%)"}}>
                  <div className="spn" aria-hidden="true"/>
                </div>}
                {toVal && !suggLoad && (
                  <button className="ri-side-btn" tabIndex={-1}
                    onClick={()=>{setToVal("");setSugg([]);setSuggOpen(false);destRef.current?.focus();}}
                    aria-label="Clear destination">✕</button>
                )}
              </div>

              {suggOpen && (
                <div ref={suggRef} className="ac-drop" id="ac-list" role="listbox" aria-label="Location suggestions">
                  <div className="ac-hd">📍 Suggestions</div>
                  {suggLoad && sugg.length===0
                    ? <div className="ac-wait"><div className="spn" aria-hidden="true"/>Searching…</div>
                    : sugg.map((s,i) => (
                        <button key={s.id||i} className={`ac-row${hiIdx===i?" hi":""}`}
                          role="option" aria-selected={hiIdx===i}
                          onMouseDown={e=>{e.preventDefault();pickSugg(s);}}
                          onMouseEnter={()=>setHiIdx(i)}
                        >
                          <div className="ac-ico" aria-hidden="true">{getCatIco(s.category)}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div className="ac-name">{s.name}</div>
                            {s.address && s.address!==s.name && <div className="ac-addr">{s.address}</div>}
                          </div>
                          {s.category && <div className="ac-tag">{s.category.split(" ")[0]}</div>}
                        </button>
                      ))
                  }
                </div>
              )}
            </div>
          </div>

          {/* TRAVEL MODES */}
          <div className="sc-modes" role="radiogroup" aria-label="Travel mode">
            {[{id:"walk",i:"🚶",l:"Walk"},{id:"transit",i:"🚌",l:"Transit"},{id:"wheelchair",i:"♿",l:"Access"}].map(t=>(
              <button key={t.id} className={`mp${mode===t.id?" on":""}`}
                onClick={()=>{setMode(t.id);setRoutePath([]);setDest(null);setRouteInfo(null);say(`${t.l} mode`);}}
                aria-pressed={mode===t.id} aria-label={`${t.l} mode`}
              >
                <span className="mp-i">{t.i}</span>
                <span className="mp-l">{t.l}</span>
              </button>
            ))}
          </div>

          {/* FIND ROUTE */}
          <button className="sc-find" onClick={calcRoute} disabled={!toVal.trim()||isLoading} aria-label="Find accessible route">
            {isLoading ? <><div className="spn2" aria-hidden="true"/>Calculating…</> : <><span>🔍</span>Find Safe Route</>}
          </button>

          {/* LEGEND */}
          <button className="sc-leg-btn" onClick={()=>setLegendOpen(o=>!o)} aria-expanded={legendOpen}>
            <span className="sc-leg-lbl">Map Legend</span>
            <span className={`sc-leg-chv${legendOpen?" open":""}`} aria-hidden="true">▼</span>
          </button>
          {legendOpen && (
            <div className="sc-leg-body" role="list">
              {[
                {color:"#38bdf8",label:"Accessible Route",dash:true},
                {color:"#34d399",label:"Walking Route",dash:false},
                {color:"#fbbf24",label:"Hazard / Construction",dot:true},
                {color:"#f87171",label:"Avoid Zone",dot:true},
              ].map(item=>(
                <div key={item.label} className="leg-row" role="listitem">
                  {item.dot
                    ? <div style={{width:"9px",height:"9px",borderRadius:"50%",background:item.color,flexShrink:0,boxShadow:`0 0 5px ${item.color}`}} aria-hidden="true"/>
                    : <div style={{width:"28px",height:"3px",borderRadius:"2px",flexShrink:0,background:item.dash?`repeating-linear-gradient(90deg,${item.color} 0,${item.color} 6px,transparent 6px,transparent 10px)`:item.color}} aria-hidden="true"/>
                  }
                  <span className="leg-lbl">{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* MAP TYPE BAR */}
        <div className="mt-bar" role="radiogroup" aria-label="Map style">
          {Object.entries(mapTypes).map(([k,v])=>(
            <button key={k} className={`mt-btn${mapType===k?" on":""}`} onClick={()=>{setMapType(k);say(`${v.name} map`);}} aria-pressed={mapType===k} title={v.name}>
              {v.icon} {v.name}
            </button>
          ))}
        </div>

        {/* MAP CONTROLS */}
        <div className="mctrl">
          <button className="mc" onClick={()=>setZoom(z=>{const n=Math.min(z+1,18);say(`Zoom ${n}`);return n;})} aria-label="Zoom in">+</button>
          <div className="mc-z" aria-label={`Zoom ${zoom}`}>{zoom}×</div>
          <button className="mc" onClick={()=>setZoom(z=>{const n=Math.max(z-1,10);say(`Zoom ${n}`);return n;})} aria-label="Zoom out">−</button>
        </div>

        {/* ROUTE INFO */}
        {routeInfo && (
          <div className="rbar" role="region" aria-label="Route information">
            <div className="rs"><div className="rs-v">{routeInfo.distance}</div><div className="rs-l">Distance</div></div>
            <div className="rs-d" aria-hidden="true"/>
            <div className="rs"><div className="rs-v">{routeInfo.duration}</div><div className="rs-l">Est. Time</div></div>
            <div className="rs-d" aria-hidden="true"/>
            <div className="rs"><div className="rs-v" style={{color:"var(--green)"}}>♿</div><div className="rs-l">Accessible</div></div>
            <button className="rs-cl" onClick={()=>{setRoutePath([]);setDest(null);setRouteInfo(null);}} aria-label="Clear route">Clear</button>
          </div>
        )}

        {/* TOAST */}
        <div className={`toast${toast?" vis":""}`} role="status" aria-live="polite" aria-atomic="true">{toast}</div>
      </div>
    </>
  );
}