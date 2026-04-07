import React, { useMemo } from "react";
import { List, Bus, X, CircleDot, Flag, Footprints, ArrowUp, CornerUpLeft, CornerUpRight, CornerDownLeft, CornerDownRight, ArrowLeft, ArrowRight, Navigation2 } from "lucide-react";

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

/* ── Single step row — extracted to avoid re-renders ── */
const StepRow = React.memo(({ step, idx, total }) => {
  const isFirst = idx === 0;
  const isLast = idx === total - 1;
  const isTransit = step.type === "transit" || step.travel_mode === "TRANSIT" || step.travel_mode === "BUS";
  const isWalk = step.type === "walk" || step.travel_mode === "WALKING" || step.travel_mode === "WALK";

  const cleanStop = (name) => (name || "stop").trim();

  const instruction = useMemo(() => {
    if (isFirst) return "Depart from your location";
    if (isLast) return `Arrive at ${step.instruction?.replace("Arrive at ", "") || "your destination"}`;
    if (isTransit) {
      const rn = step.route_short_name || "";
      const rl = step.route_long_name || "";
      const from = cleanStop(step.departure_stop || step.start_stop);
      const to = cleanStop(step.arrival_stop || step.end_stop);
      const label = rl ? `Bus ${rn} (${rl})` : `Bus ${rn}`;
      return `Take ${label} from ${from} to ${to}`;
    }
    if (isWalk) {
      const dist = step.distance_meters
        ? step.distance_meters < 1000
          ? `${Math.round(step.distance_meters)} m`
          : `${(step.distance_meters / 1000).toFixed(1)} km`
        : "";
      const toName = cleanStop(step.to_stop || step.instruction?.replace("Walk to ", ""));
      return `Walk ${dist ? `${dist} ` : ""}to ${toName}`;
    }
    return stripHtml(step.instruction || "Continue");
  }, [step, isFirst, isLast, isTransit, isWalk]);

  const StepIcon = isFirst ? CircleDot : isLast ? Flag : isTransit ? Bus : getStepIcon(instruction, step.travel_mode);
  const iconClass = isFirst ? "start-icon" : isLast ? "end-icon" : isTransit ? "transit-icon" : isWalk ? "walk-icon" : "turn-icon";
  const stepClass = `dir-step${isTransit ? " transit-step" : isWalk ? " walk-step" : ""}${isFirst ? " first-step" : ""}${isLast ? " last-step" : ""}`;

  return (
    <div className={stepClass} role="listitem">
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
});

const DirectionsPanel = React.memo(({ steps, onClose, routeType }) => {
  if (!steps || steps.length === 0) return null;

  return (
    <div className="dir-panel" role="region" aria-label="Turn-by-turn directions">
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
        <button
          className="dir-close"
          onClick={onClose}
          aria-label="Close directions"
        >
          <X size={12} />
        </button>
      </div>
      <div className="dir-list" role="list">
        {steps.map((step, idx) => (
          <StepRow key={idx} step={step} idx={idx} total={steps.length} />
        ))}
      </div>
    </div>
  );
});

export default DirectionsPanel;