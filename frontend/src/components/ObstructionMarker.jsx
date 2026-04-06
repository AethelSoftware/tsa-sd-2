import React from "react";
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

// Copy the makeLucideIcon function
function makeLucideIcon(IconComponent, color, borderColor, size = 30) {
  const innerSize = Math.max(12, size * 0.55);
  const svg = renderToStaticMarkup(
    <IconComponent size={innerSize} color={color} strokeWidth={2.2} />
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

// Copy getObstructionStyle
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

const ObstructionMarker = React.memo(
  ({ lat, lng, type, iconCategory, description, radius, extra, zoomLevel = 13 }) => {
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
  }
);

export default ObstructionMarker;