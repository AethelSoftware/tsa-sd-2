import React from "react";
import { List, Bus, X, CircleDot, Flag, Footprints, ArrowUp, CornerUpLeft, CornerUpRight, CornerDownLeft, CornerDownRight, ArrowLeft, ArrowRight, Navigation2 } from "lucide-react";

// Copy these helpers that DirectionsPanel needs
function stripHtml(str = "") {
  return str.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function fmtDist(meters) {
  if (!meters) return "";
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function getStepIcon(instruction = "", travelMode = "") {
  const txt = instruction.toLowerCase();
  if (travelMode === "TRANSIT" || travelMode === "BUS") return Bus;
  if (txt.includes("board") || txt.includes("take transit") || txt.includes("take bus")) return Bus;
  if (txt.includes("walk")) return Footprints;
  if (txt.includes("turn left")) return CornerUpLeft;
  if (txt.includes("turn right")) return CornerUpRight;
  if (txt.includes("sharp left")) return CornerDownLeft;
  if (txt.includes("sharp right")) return CornerDownRight;
  if (txt.includes("keep left") || txt.includes("bear left")) return ArrowLeft;
  if (txt.includes("keep right") || txt.includes("bear right")) return ArrowRight;
  if (txt.includes("u-turn")) return Navigation2;
  if (txt.includes("arrive") || txt.includes("destination")) return Flag;
  if (txt.includes("depart") || txt.includes("head") || txt.includes("start")) return CircleDot;
  return ArrowUp;
}

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
          const isTransit = step.type === "transit" || step.travel_mode === "TRANSIT" || step.travel_mode === "BUS";
          const isWalk = step.type === "walk" || step.travel_mode === "WALKING" || step.travel_mode === "WALK";

          let instruction = "";
          if (isFirst) {
            instruction = "Depart from your location";
          } else if (isLast) {
            instruction = `Arrive at ${step.instruction?.replace("Arrive at ", "") || "your destination"}`;
          } else if (isTransit) {
            const routeName = step.route_short_name || "";
            const routeLong = step.route_long_name || "";
            const fromStop = cleanStopName(step.departure_stop || step.start_stop || "stop");
            const toStop = cleanStopName(step.arrival_stop || step.end_stop || "next stop");
            const label = routeLong ? `Bus ${routeName} (${routeLong})` : `Bus ${routeName}`;
            instruction = `Take ${label} from ${fromStop} to ${toStop}`;
          } else if (isWalk) {
            const dist = step.distance_meters ? (step.distance_meters < 1000 ? `${Math.round(step.distance_meters)} m` : `${(step.distance_meters / 1000).toFixed(1)} km`) : "";
            const toName = cleanStopName(step.to_stop || step.instruction?.replace("Walk to ", "") || "next stop");
            instruction = `Walk ${dist ? `${dist} ` : ""}to ${toName}`;
          } else {
            instruction = stripHtml(step.instruction || "Continue");
          }

          const StepIcon = isFirst ? CircleDot : isLast ? Flag : isTransit ? Bus : getStepIcon(instruction, step.travel_mode);
          const iconClass = isFirst ? "start-icon" : isLast ? "end-icon" : isTransit ? "transit-icon" : isWalk ? "walk-icon" : "turn-icon";
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
                    <span className="dir-dist">{step.distance || fmtDist(step.distance_meters)}</span>
                  )}
                  {(step.duration || step.duration_seconds > 0) && (
                    <span className="dir-dur">{step.duration || `${Math.round(step.duration_seconds / 60)} min`}</span>
                  )}
                  {isTransit && (
                    <span className="transit-badge">
                      <Bus size={9} /> {step.route_short_name || "Bus"}
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

export default DirectionsPanel;