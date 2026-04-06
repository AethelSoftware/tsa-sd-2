import React, { useMemo, useCallback } from "react";
import { Marker, Popup } from "react-leaflet";
import { renderToStaticMarkup } from "react-dom/server";
import L from "leaflet";
import { 
  Construction, 
  Siren, 
  CarFront, 
  Flame, 
  TriangleAlert 
} from "lucide-react";

// Cache for generated icons to prevent recreating the same icon
const iconCache = new Map();

function makeLucideIcon(IconComponent, color, borderColor, size = 30) {
  // Create a cache key based on all parameters
  const cacheKey = `${IconComponent.name}-${color}-${borderColor}-${size}`;
  
  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey);
  }
  
  const innerSize = Math.max(12, size * 0.55);
  const svg = renderToStaticMarkup(
    <IconComponent size={innerSize} color={color} strokeWidth={2.2} />
  );
  const html = `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;background:rgba(16,8,3,0.92);border:${Math.max(1, size / 20)}px solid ${borderColor};border-radius:${Math.max(6, size / 4)}px;box-shadow:0 2px 8px rgba(0,0,0,0.45);backdrop-filter:blur(4px);cursor:pointer;">${svg}</div>`;
  const icon = L.divIcon({
    className: "custom-marker-icon",
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
  
  // Cache the result
  iconCache.set(cacheKey, icon);
  return icon;
}

// Pre-define style objects outside component to avoid recreation
const STYLES = {
  construction: {
    Icon: Construction,
    color: "#ff7b6b",
    border: "rgba(255,123,107,0.5)",
    label: "Construction Zone",
  },
  accident: {
    Icon: Siren,
    color: "#ff7b6b",
    border: "rgba(255,123,107,0.5)",
    label: "Accident",
  },
  jam: {
    Icon: CarFront,
    color: "#ffb347",
    border: "rgba(255,179,71,0.5)",
    label: "Traffic Jam",
  },
  flood: {
    Icon: Flame,
    color: "#ffb347",
    border: "rgba(255,179,71,0.5)",
    label: "Flood Risk",
  },
  hazard: {
    Icon: TriangleAlert,
    color: "#ffb347",
    border: "rgba(255,179,71,0.5)",
    label: "Hazard",
  },
};

function getObstructionStyle(type, iconCategory) {
  if (type === "construction" || [7, 8, 9].includes(iconCategory))
    return STYLES.construction;
  if (iconCategory === 1 || type === "accident")
    return STYLES.accident;
  if (iconCategory === 6 || type === "jam")
    return STYLES.jam;
  if (iconCategory === 11 || type === "flooding_risk")
    return STYLES.flood;
  return STYLES.hazard;
}

// Memoized popup content component to prevent recreation
const ObstructionPopup = React.memo(({ style, description, extra, radius }) => (
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
));

const ObstructionMarker = React.memo(
  ({ lat, lng, type, iconCategory, description, radius, extra, zoomLevel = 13 }) => {
    // Early return with memoized validation
    const isValid = useMemo(() => {
      if (lat === undefined || lat === null || lng === undefined || lng === null) {
        return false;
      }
      const validLat = parseFloat(lat);
      const validLng = parseFloat(lng);
      if (isNaN(validLat) || isNaN(validLng)) return false;
      if (!isFinite(validLat) || !isFinite(validLng)) return false;
      if (validLat < -90 || validLat > 90) return false;
      if (validLng < -180 || validLng > 180) return false;
      return { validLat, validLng };
    }, [lat, lng]);

    if (!isValid) return null;

    // Memoize style and size calculations
    const style = useMemo(() => getObstructionStyle(type, iconCategory), [type, iconCategory]);
    const size = useMemo(() => Math.min(40, Math.max(20, 20 + ((zoomLevel - 10) / 8) * 20)), [zoomLevel]);
    
    // Memoize icon creation
    const icon = useMemo(() => 
      makeLucideIcon(style.Icon, style.color, style.border, size),
      [style.Icon, style.color, style.border, size]
    );

    // Memoize position array
    const position = useMemo(() => [isValid.validLat, isValid.validLng], [isValid]);

    return (
      <Marker position={position} icon={icon}>
        <Popup>
          <ObstructionPopup style={style} description={description} extra={extra} radius={radius} />
        </Popup>
      </Marker>
    );
  }
);

export default ObstructionMarker;