/**
 * Walking3DView.jsx — Tesla-vision style pedestrian nav
 *
 * What's new vs old version:
 *  1. userPosition drives the figure directly (real GPS from parent/Dashboard)
 *  2. "Advance" button + arrow keys move figure forward along route for testing
 *  3. Real OSM buildings fetched via Overpass API (neighborhood-accurate)
 *     — height determined by building:levels tag, fallback by area type
 *  4. No auto-simulation of position in this component at all
 *  5. Tesla-style: figure is always centred, camera follows from behind
 */

import React, {
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";

// ─────────────────────────────────────────────────────────────────────────────
// Geo ↔ World conversion
// ─────────────────────────────────────────────────────────────────────────────

const M_LAT = 111_139; // metres per degree latitude
const SCALE = 1 / 6; // 1 world unit = 6 m  (bigger = more zoomed in)

let ORIGIN = null; // set lazily from first route point

function setOrigin(lat, lng) {
  ORIGIN = {
    lat,
    lng,
    mLng: M_LAT * Math.cos(lat * (Math.PI / 180)),
  };
}

function geo2world(lat, lng) {
  if (!ORIGIN) return new THREE.Vector3(0, 0, 0);
  return new THREE.Vector3(
    (lng - ORIGIN.lng) * ORIGIN.mLng * SCALE,
    0,
    -(lat - ORIGIN.lat) * M_LAT * SCALE,
  );
}

function arr2world([lat, lng]) {
  return geo2world(lat, lng);
}

// ─────────────────────────────────────────────────────────────────────────────
// OSM Building fetcher
// ─────────────────────────────────────────────────────────────────────────────

async function fetchOSMBuildings(centerLat, centerLng, radiusM = 400) {
  const r = radiusM;
  const query = `
    [out:json][timeout:20];
    (
      way["building"](around:${r},${centerLat},${centerLng});
      relation["building"](around:${r},${centerLat},${centerLng});
    );
    out body geom;
  `;
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
    });
    const data = await res.json();
    return data.elements || [];
  } catch (e) {
    console.warn("OSM fetch failed:", e);
    return [];
  }
}

function osmBuildingHeight(tags = {}) {
  if (tags.height) return Math.min(parseFloat(tags.height) * SCALE, 40);
  if (tags["building:levels"])
    return Math.min(parseInt(tags["building:levels"]) * 3.2 * SCALE, 40);
  // Guess by type
  const type = tags.building || "";
  if (["yes", "house", "detached", "semidetached_house", "terrace"].includes(type))
    return 3 * SCALE; // 1 storey ~3m
  if (["apartments", "residential"].includes(type)) return 12 * SCALE;
  if (["commercial", "retail", "office"].includes(type)) return 10 * SCALE;
  if (["industrial", "warehouse"].includes(type)) return 6 * SCALE;
  if (["church", "cathedral", "chapel"].includes(type)) return 14 * SCALE;
  if (["school", "university"].includes(type)) return 9 * SCALE;
  return 5 * SCALE; // default
}

function osmBuildingColor(tags = {}) {
  const type = tags.building || "";
  const colorMap = {
    house: "#e8ddd0",
    detached: "#ede5d8",
    semidetached_house: "#e5dcd0",
    terrace: "#ddd5c8",
    apartments: "#d0d8e0",
    residential: "#d5dde5",
    commercial: "#c8d0d8",
    retail: "#d8c8c0",
    office: "#c0ccd8",
    industrial: "#c8c8c0",
    warehouse: "#c8c4b8",
    church: "#e0dcd5",
    school: "#ddd8cc",
    university: "#d8d0c8",
  };
  return colorMap[type] || "#ddd8d0";
}

// Convert OSM way geometry to a flat polygon (XZ plane)
function osmWayToPolygon(element) {
  if (!element.geometry || element.geometry.length < 3) return null;
  return element.geometry.map(({ lat, lon }) => geo2world(lat, lon));
}

// Extrude a flat polygon into a box-ish mesh geometry
function extrudePolygon(pts, height) {
  if (pts.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, pts[0].z);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].z);
  shape.closePath();

  const extrudeSettings = {
    depth: height,
    bevelEnabled: false,
  };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  // Rotate so extrusion goes up (Y axis)
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// OSMBuildings component
// ─────────────────────────────────────────────────────────────────────────────

function OSMBuildings({ centerLat, centerLng }) {
  const [buildings, setBuildings] = useState([]);
  const fetchedRef = useRef(null);

  useEffect(() => {
    if (!centerLat || !centerLng) return;
    const key = `${centerLat.toFixed(3)},${centerLng.toFixed(3)}`;
    if (fetchedRef.current === key) return;
    fetchedRef.current = key;

    fetchOSMBuildings(centerLat, centerLng, 350).then((elements) => {
      const parsed = elements
        .map((el) => {
          const pts = osmWayToPolygon(el);
          if (!pts) return null;
          const h = osmBuildingHeight(el.tags);
          const color = osmBuildingColor(el.tags);
          const geo = extrudePolygon(pts, h);
          if (!geo) return null;
          return { id: el.id, geo, color, h };
        })
        .filter(Boolean);
      setBuildings(parsed);
    });
  }, [centerLat, centerLng]);

  return (
    <group>
      {buildings.map((b) => (
        <mesh key={b.id} geometry={b.geo} castShadow receiveShadow>
          <meshStandardMaterial color={b.color} roughness={0.75} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Nearest index helper
// ─────────────────────────────────────────────────────────────────────────────

function nearestIdx(pts, target) {
  let best = 0,
    bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = pts[i].distanceToSquared(target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route road mesh
// ─────────────────────────────────────────────────────────────────────────────

const ROAD_HW = 0.5;
const WALK_HW = 0.18;

function RouteMesh({ worldPts, safetyScore }) {
  const geoms = useMemo(() => {
    if (worldPts.length < 2) return null;
    const roadPos = [], roadIdx = [];
    const swPos = [], swIdx = [];

    for (let i = 0; i < worldPts.length; i++) {
      const cur = worldPts[i];
      const prv = worldPts[Math.max(0, i - 1)];
      const nxt = worldPts[Math.min(worldPts.length - 1, i + 1)];
      const tang = new THREE.Vector3().subVectors(nxt, prv);
      if (tang.lengthSq() < 1e-8) tang.set(1, 0, 0);
      tang.normalize();
      const perp = new THREE.Vector3(-tang.z, 0, tang.x);

      const RL = cur.clone().addScaledVector(perp, ROAD_HW);
      const RR = cur.clone().addScaledVector(perp, -ROAD_HW);
      roadPos.push(RL.x, 0.015, RL.z, RR.x, 0.015, RR.z);

      const SL0 = cur.clone().addScaledVector(perp, ROAD_HW);
      const SL1 = cur.clone().addScaledVector(perp, ROAD_HW + WALK_HW);
      const SR0 = cur.clone().addScaledVector(perp, -ROAD_HW);
      const SR1 = cur.clone().addScaledVector(perp, -(ROAD_HW + WALK_HW));
      swPos.push(SL0.x, 0.01, SL0.z, SL1.x, 0.01, SL1.z, SR0.x, 0.01, SR0.z, SR1.x, 0.01, SR1.z);

      if (i < worldPts.length - 1) {
        const rb = i * 2;
        roadIdx.push(rb, rb + 1, rb + 2, rb + 1, rb + 3, rb + 2);
        const sb = i * 4;
        swIdx.push(sb, sb + 1, sb + 4, sb + 1, sb + 5, sb + 4);
        swIdx.push(sb + 2, sb + 6, sb + 3, sb + 3, sb + 6, sb + 7);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(roadPos, 3));
    roadGeo.setIndex(roadIdx);
    roadGeo.computeVertexNormals();

    const swGeo = new THREE.BufferGeometry();
    swGeo.setAttribute("position", new THREE.Float32BufferAttribute(swPos, 3));
    swGeo.setIndex(swIdx);
    swGeo.computeVertexNormals();

    return { roadGeo, swGeo };
  }, [worldPts]);

  if (!geoms) return null;
  const roadColor = safetyScore > 0.7 ? "#9ca3af" : safetyScore > 0.4 ? "#d97706" : "#ef4444";

  return (
    <group>
      <mesh geometry={geoms.swGeo} receiveShadow>
        <meshStandardMaterial color="#e5e7eb" roughness={0.9} />
      </mesh>
      <mesh geometry={geoms.roadGeo} receiveShadow>
        <meshStandardMaterial color={roadColor} roughness={0.85} metalness={0.02} />
      </mesh>
    </group>
  );
}

// Safety line overlay
function SafetyLine({ worldPts, safetyScore }) {
  const color = safetyScore > 0.7 ? "#10b981" : safetyScore > 0.4 ? "#f59e0b" : "#ef4444";
  return (
    <group>
      {worldPts.slice(0, -1).map((p, i) => {
        const q = worldPts[i + 1];
        const mid = new THREE.Vector3().addVectors(p, q).multiplyScalar(0.5);
        const len = p.distanceTo(q);
        const dir = new THREE.Vector3().subVectors(q, p);
        const ang = Math.atan2(dir.x, dir.z);
        return (
          <mesh key={i} position={[mid.x, 0.025, mid.z]} rotation={[0, ang, 0]}>
            <boxGeometry args={[0.06, 0.004, len]} />
            <meshBasicMaterial color={color} />
          </mesh>
        );
      })}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hazard markers
// ─────────────────────────────────────────────────────────────────────────────

const HAZARD_HEX = {
  crime: 0xef4444, fire: 0xf97316, disaster: 0x8b5cf6,
  congestion: 0xf59e0b, construction: 0xb45309,
  poor_lighting: 0xca8a04, accessibility: 0x3b82f6,
};
const HAZARD_CSS = {
  crime: "#ef4444", fire: "#f97316", disaster: "#8b5cf6",
  congestion: "#f59e0b", construction: "#b45309",
  poor_lighting: "#ca8a04", accessibility: "#3b82f6",
};

function HazardMarker({ hazard }) {
  if (!hazard?.position?.lat || !hazard?.position?.lng) return null;
  const { position, type, severity = 0.5, radius = 50 } = hazard;
  const wPos = useMemo(() => geo2world(position.lat, position.lng), [position.lat, position.lng]);
  const wRadius = Math.min(radius * SCALE, 8);
  const hexCol = HAZARD_HEX[type] || 0xef4444;
  const cssCol = HAZARD_CSS[type] || "#ef4444";
  const spinRef = useRef();
  const pLight = useRef();

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (spinRef.current) {
      spinRef.current.rotation.y = t * 1.0;
      spinRef.current.position.y = 0.7 + Math.sin(t * 1.8) * 0.1;
    }
    if (pLight.current) pLight.current.intensity = 1.5 + Math.sin(t * 3.5) * 0.5;
  });

  const pillarH = 0.5 + severity * 0.8;
  return (
    <group position={[wPos.x, 0, wPos.z]}>
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[wRadius, 32]} />
        <meshBasicMaterial color={hexCol} transparent opacity={0.08} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.16, 0.22, 0.1, 10]} />
        <meshStandardMaterial color={hexCol} roughness={0.45} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.1 + pillarH / 2, 0]}>
        <cylinderGeometry args={[0.045, 0.12, pillarH, 8]} />
        <meshStandardMaterial color={hexCol} roughness={0.4} metalness={0.5} emissive={hexCol} emissiveIntensity={0.15} />
      </mesh>
      <mesh ref={spinRef} position={[0, 0.7, 0]}>
        <octahedronGeometry args={[0.26, 0]} />
        <meshStandardMaterial color={hexCol} roughness={0.2} metalness={0.7} emissive={hexCol} emissiveIntensity={0.4} />
      </mesh>
      <pointLight ref={pLight} color={hexCol} intensity={1.5} distance={wRadius * 2} decay={2} />
      <Html position={[0, pillarH + 0.85, 0]} center distanceFactor={14} zIndexRange={[10, 20]} style={{ pointerEvents: "none" }}>
        <div style={{ background: "rgba(255,255,255,0.92)", border: `1.5px solid ${cssCol}`, borderRadius: 6, padding: "3px 9px", color: cssCol, fontSize: 10, fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap", fontFamily: "system-ui, sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
          ⚠ {(type || "hazard").replace(/_/g, " ")}
        </div>
      </Html>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Destination marker
// ─────────────────────────────────────────────────────────────────────────────

function DestinationMarker({ worldPos }) {
  const pin = useRef();
  const ring = useRef();
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (pin.current) pin.current.position.y = 0.7 + Math.sin(t * 2.2) * 0.15;
    if (ring.current) ring.current.material.opacity = 0.3 + Math.sin(t * 2.2) * 0.12;
  });
  return (
    <group position={[worldPos.x, 0, worldPos.z]}>
      <mesh ref={ring} position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 0.6, 28]} />
        <meshBasicMaterial color="#10b981" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh ref={pin} position={[0, 0.7, 0]}>
        <coneGeometry args={[0.2, 0.6, 8]} />
        <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.5} roughness={0.3} metalness={0.3} />
      </mesh>
      <pointLight color="#10b981" intensity={2} distance={5} decay={2} />
      <Html position={[0, 1.7, 0]} center distanceFactor={14} zIndexRange={[5, 15]} style={{ pointerEvents: "none" }}>
        <div style={{ background: "rgba(255,255,255,0.92)", border: "1.5px solid #10b981", borderRadius: 6, padding: "3px 10px", color: "#059669", fontSize: 10, fontWeight: 700, fontFamily: "system-ui, sans-serif", whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
          ✓ DESTINATION
        </div>
      </Html>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Walking figure
// ─────────────────────────────────────────────────────────────────────────────

function WalkingFigure({ targetWorldPt, navState, routeSafety, onPosUpdate }) {
  const root = useRef();
  const lArm = useRef(); const rArm = useRef();
  const lLeg = useRef(); const rLeg = useRef();
  const curPos = useRef(new THREE.Vector3());
  const curRot = useRef(0);
  const tick = useRef(0);
  const prevTarget = useRef(null);
  const init = useRef(false);

  const isWalking = navState === "walking";
  const isArrived = navState === "arrived";
  const jacketHex = routeSafety > 0.7 ? 0x2563eb : routeSafety > 0.4 ? 0xd97706 : 0xdc2626;

  useFrame((_, dt) => {
    if (!root.current || !targetWorldPt) return;
    tick.current += dt;

    const target = targetWorldPt.clone();

    // Calculate heading from movement direction
    if (prevTarget.current) {
      const d = new THREE.Vector3().subVectors(target, prevTarget.current);
      if (d.lengthSq() > 0.0001) {
        const desiredRot = Math.atan2(d.x, d.z);
        let dRot = ((((desiredRot - curRot.current) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        curRot.current += dRot * (1 - Math.exp(-8 * dt));
      }
    }
    prevTarget.current = target.clone();

    if (!init.current) {
      curPos.current.copy(target);
      init.current = true;
    }

    // Smooth follow
    const k = 1 - Math.exp(-8 * dt);
    curPos.current.lerp(target, k);

    root.current.position.copy(curPos.current);
    root.current.rotation.y = curRot.current;

    // Walk animation
    if (isWalking) {
      const s = Math.sin(tick.current * 4.2);
      if (lArm.current) lArm.current.rotation.x = s * 0.42;
      if (rArm.current) rArm.current.rotation.x = -s * 0.42;
      if (lLeg.current) lLeg.current.rotation.x = -s * 0.38;
      if (rLeg.current) rLeg.current.rotation.x = s * 0.38;
      root.current.position.y = Math.abs(Math.sin(tick.current * 4.2)) * 0.018;
    } else {
      [lArm, rArm, lLeg, rLeg].forEach(r => { if (r.current) r.current.rotation.x *= 0.85; });
    }

    if (onPosUpdate) onPosUpdate(curPos.current, curRot.current);
  });

  return (
    <group ref={root}>
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.36, 20]} />
        <meshBasicMaterial color="#00000033" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      {/* Feet */}
      {[0.09, -0.09].map((x, i) => (
        <mesh key={i} position={[x, 0.06, 0.05]} castShadow>
          <boxGeometry args={[0.09, 0.06, 0.17]} />
          <meshStandardMaterial color="#1f2937" roughness={0.9} />
        </mesh>
      ))}
      {/* Legs */}
      <group ref={lLeg} position={[0.09, 0.45, 0]}>
        <mesh castShadow><capsuleGeometry args={[0.065, 0.55, 4, 8]} /><meshStandardMaterial color="#374151" roughness={0.8} /></mesh>
      </group>
      <group ref={rLeg} position={[-0.09, 0.45, 0]}>
        <mesh castShadow><capsuleGeometry args={[0.065, 0.55, 4, 8]} /><meshStandardMaterial color="#374151" roughness={0.8} /></mesh>
      </group>
      {/* Torso */}
      <mesh position={[0, 0.96, 0]} castShadow>
        <boxGeometry args={[0.29, 0.44, 0.19]} />
        <meshStandardMaterial color={jacketHex} roughness={0.7} metalness={0.05} />
      </mesh>
      {/* Backpack */}
      <mesh position={[0, 0.97, -0.14]} castShadow>
        <boxGeometry args={[0.18, 0.28, 0.1]} />
        <meshStandardMaterial color="#6b7280" roughness={0.85} />
      </mesh>
      {/* Arms */}
      <group ref={lArm} position={[0.19, 1.06, 0]}>
        <mesh position={[0, -0.17, 0]} castShadow><capsuleGeometry args={[0.05, 0.28, 4, 6]} /><meshStandardMaterial color={jacketHex} roughness={0.72} /></mesh>
      </group>
      <group ref={rArm} position={[-0.19, 1.06, 0]}>
        <mesh position={[0, -0.17, 0]} castShadow><capsuleGeometry args={[0.05, 0.28, 4, 6]} /><meshStandardMaterial color={jacketHex} roughness={0.72} /></mesh>
      </group>
      {/* Head */}
      <mesh position={[0, 1.24, 0]} castShadow><cylinderGeometry args={[0.055, 0.065, 0.1, 8]} /><meshStandardMaterial color="#d4a87a" roughness={0.7} /></mesh>
      <mesh position={[0, 1.41, 0]} castShadow><sphereGeometry args={[0.14, 16, 14]} /><meshStandardMaterial color="#d4a87a" roughness={0.65} /></mesh>
      {/* Cap */}
      <mesh position={[0, 1.52, 0.01]} castShadow><cylinderGeometry args={[0.09, 0.155, 0.09, 12]} /><meshStandardMaterial color="#1e3a5f" roughness={0.7} /></mesh>
      <mesh position={[0, 1.52, 0.12]} castShadow><boxGeometry args={[0.18, 0.03, 0.1]} /><meshStandardMaterial color="#1e3a5f" roughness={0.7} /></mesh>

      {isWalking && (
        <mesh position={[0, 0.02, ROAD_HW * 0.55]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.07, 0.22, 6]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.8} />
        </mesh>
      )}
      {isArrived && (
        <mesh position={[0, 2.0, 0]}>
          <octahedronGeometry args={[0.22, 0]} />
          <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.7} roughness={0.2} metalness={0.5} />
        </mesh>
      )}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Follow camera (Tesla-style: always behind figure)
// ─────────────────────────────────────────────────────────────────────────────

function FollowCamera({ figPosRef, figRotRef, navState }) {
  const { camera } = useThree();
  const camPos = useRef(new THREE.Vector3(0, 6, 10));
  const lookAt = useRef(new THREE.Vector3());
  const init = useRef(false);

  useFrame((_, dt) => {
    const pos = figPosRef.current;
    const rot = figRotRef.current;
    const isWalking = navState === "walking";

    const back = isWalking ? 4.5 : 6.5;
    const up = isWalking ? 3.2 : 7.5;

    const desire = new THREE.Vector3(
      pos.x - Math.sin(rot) * back,
      pos.y + up,
      pos.z + Math.cos(rot) * back,
    );

    if (!init.current) { camPos.current.copy(desire); init.current = true; }

    camPos.current.lerp(desire, 1 - Math.exp(-3.5 * dt));
    camera.position.copy(camPos.current);

    const ahead = new THREE.Vector3(
      pos.x + Math.sin(rot) * 3,
      pos.y + 1.2,
      pos.z - Math.cos(rot) * 3,
    );
    lookAt.current.lerp(ahead, 1 - Math.exp(-5 * dt));
    camera.lookAt(lookAt.current);
  });

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ground plane
// ─────────────────────────────────────────────────────────────────────────────

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
      <planeGeometry args={[800, 800, 1, 1]} />
      <meshStandardMaterial color="#c8d5b0" roughness={1} />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main 3D scene
// ─────────────────────────────────────────────────────────────────────────────

function PittsburghScene({
  route, hazards, targetWorldPt, navigationState, routeSafety,
  centerLat, centerLng,
}) {
  const worldPts = useMemo(() => {
    if (!route || route.length === 0) return [];
    // Thin out very dense polylines (keep every 2nd point)
    return route
      .filter((_, i) => i % 2 === 0 || i === route.length - 1)
      .map(arr2world);
  }, [route]);

  const figPosRef = useRef(targetWorldPt ? targetWorldPt.clone() : new THREE.Vector3());
  const figRotRef = useRef(0);

  const handlePosUpdate = useCallback((pos, rot) => {
    figPosRef.current.copy(pos);
    figRotRef.current = rot;
  }, []);

  const destPt = worldPts.length > 0 ? worldPts[worldPts.length - 1] : null;
  const isArrived = navigationState === "arrived";

  const safeHazards = useMemo(
    () => (hazards || []).filter(hz => hz?.position?.lat && hz?.position?.lng),
    [hazards],
  );

  return (
    <>
      {/* Daytime sky lighting */}
      <ambientLight intensity={1.4} color="#fffbe8" />
      <directionalLight position={[12, 22, 15]} intensity={2.2} color="#fff8f0" castShadow
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-near={0.1} shadow-camera-far={300}
        shadow-camera-left={-80} shadow-camera-right={80}
        shadow-camera-top={80} shadow-camera-bottom={-80}
      />
      <directionalLight position={[-10, 12, -8]} intensity={0.6} color="#c8dff0" />
      <hemisphereLight args={["#87ceeb", "#a8c878", 0.5]} />
      <fog attach="fog" args={["#c8e6f5", 50, 180]} />

      <Ground />

      {/* Real OSM buildings around current position */}
      {centerLat && centerLng && (
        <OSMBuildings centerLat={centerLat} centerLng={centerLng} />
      )}

      {worldPts.length > 1 && (
        <>
          <RouteMesh worldPts={worldPts} safetyScore={routeSafety} />
          <SafetyLine worldPts={worldPts} safetyScore={routeSafety} />
        </>
      )}

      {safeHazards.map((hz, i) => (
        <HazardMarker key={hz.id || `hz-${i}`} hazard={hz} />
      ))}

      {destPt && !isArrived && <DestinationMarker worldPos={destPt} />}

      {targetWorldPt && (
        <WalkingFigure
          targetWorldPt={targetWorldPt}
          navState={navigationState}
          routeSafety={routeSafety}
          onPosUpdate={handlePosUpdate}
        />
      )}

      {/* No route fallback dot */}
      {targetWorldPt && worldPts.length === 0 && (
        <group position={[targetWorldPt.x, 0, targetWorldPt.z]}>
          <mesh position={[0, 0.4, 0]}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshStandardMaterial color="#3b82f6" emissive="#3b82f6" emissiveIntensity={0.3} />
          </mesh>
          <pointLight color="#3b82f6" intensity={2} distance={5} decay={2} />
        </group>
      )}

      <FollowCamera figPosRef={figPosRef} figRotRef={figRotRef} navState={navigationState} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD overlay
// ─────────────────────────────────────────────────────────────────────────────

function HUDOverlay({ navigationState, routeSafety, remainingDistance, estimatedTime, hazardCount, testMode, onAdvance }) {
  const safetyColor = routeSafety > 0.7 ? "#059669" : routeSafety > 0.4 ? "#d97706" : "#dc2626";
  const stateLabel = { idle: "READY", walking: "▶ NAVIGATING", rerouting: "↻ REROUTING", arrived: "✓ ARRIVED" }[navigationState] || navigationState.toUpperCase();

  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, pointerEvents: "none", zIndex: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Left: nav status */}
      <div style={{ background: "rgba(255,255,255,0.88)", backdropFilter: "blur(8px)", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "8px 14px", display: "flex", flexDirection: "column", gap: 4, minWidth: 130, boxShadow: "0 2px 12px rgba(0,0,0,0.12)" }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", color: safetyColor }}>{stateLabel}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2937", lineHeight: 1 }}>
          {Math.round(remainingDistance || 0)}
          <span style={{ fontSize: 11, fontWeight: 400, color: "#6b7280", marginLeft: 3 }}>m</span>
        </div>
        <div style={{ fontSize: 10, color: "#6b7280" }}>~{Math.round((estimatedTime || 0) / 60)} min remaining</div>
      </div>

      {/* Right: safety + test controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        <div style={{ background: "rgba(255,255,255,0.88)", backdropFilter: "blur(8px)", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "8px 14px", display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", boxShadow: "0 2px 12px rgba(0,0,0,0.12)" }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", color: "#6b7280" }}>ROUTE SAFETY</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: safetyColor, lineHeight: 1 }}>{Math.round((routeSafety || 0) * 100)}%</div>
          {hazardCount > 0 && <div style={{ fontSize: 10, color: "#dc2626", fontWeight: 600 }}>⚠ {hazardCount} hazard{hazardCount !== 1 ? "s" : ""}</div>}
        </div>

        {/* Test mode: Advance button */}
        {testMode && (
          <button
            onClick={onAdvance}
            style={{ pointerEvents: "auto", background: "rgba(30,58,95,0.9)", backdropFilter: "blur(8px)", border: "1px solid rgba(59,130,246,0.5)", borderRadius: 10, padding: "8px 18px", color: "#93c5fd", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", cursor: "pointer", boxShadow: "0 2px 12px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: 6 }}
          >
            ↑ ADVANCE (↑ key)
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test-mode GPS simulator
// Walks along the route polyline one "step" per button press / arrow key
// ─────────────────────────────────────────────────────────────────────────────

const STEP_M = 8; // metres to advance per keypress

function useTestModeAdvancer({ testMode, route, onPositionUpdate }) {
  const idxRef = useRef(0);

  const advance = useCallback(() => {
    if (!route || route.length === 0) return;
    idxRef.current = Math.min(idxRef.current + 1, route.length - 1);
    onPositionUpdate(route[idxRef.current]);
  }, [route, onPositionUpdate]);

  // Reset when route changes
  useEffect(() => { idxRef.current = 0; }, [route]);

  useEffect(() => {
    if (!testMode) return;
    const handler = (e) => {
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [testMode, advance]);

  return { advance };
}

// ─────────────────────────────────────────────────────────────────────────────
// Walking3DView — public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Props:
 *   route            — array of [lat, lng] pairs (the full polyline)
 *   hazards          — array of hazard objects {position:{lat,lng}, type, severity, radius}
 *   userPosition     — [lat, lng] — the REAL GPS position from parent/Dashboard
 *                      (this drives the figure; null = nothing shown)
 *   navigationState  — "idle" | "walking" | "rerouting" | "arrived"
 *   routeSafety      — 0–1
 *   remainingDistance — metres
 *   estimatedTime    — seconds
 *   testMode         — boolean: show Advance button + enable arrow keys
 *   onTestPositionUpdate — callback([lat,lng]) when test-mode advances position
 *                         (parent should update its userPosition state with this)
 *   style            — extra CSS for the outer div
 */
export default function Walking3DView({
  route = [],
  hazards = [],
  userPosition = null,
  navigationState = "idle",
  routeSafety = 0.8,
  remainingDistance = 0,
  estimatedTime = 0,
  testMode = false,
  onTestPositionUpdate = null,
  style = {},
}) {
  // Set world origin from first route point (or user position)
  useEffect(() => {
    if (route.length > 0) {
      setOrigin(route[0][0], route[0][1]);
    } else if (userPosition) {
      setOrigin(userPosition[0], userPosition[1]);
    }
  }, [route, userPosition]);

  // Convert real GPS userPosition → world coord for the figure
  const targetWorldPt = useMemo(() => {
    if (!userPosition || !ORIGIN) return null;
    return geo2world(userPosition[0], userPosition[1]);
  }, [userPosition]);

  // OSM building fetch centre follows user
  const centerLat = userPosition ? userPosition[0] : route.length > 0 ? route[0][0] : null;
  const centerLng = userPosition ? userPosition[1] : route.length > 0 ? route[0][1] : null;

  // Test-mode advancer
  const { advance } = useTestModeAdvancer({
    testMode,
    route,
    onPositionUpdate: onTestPositionUpdate || (() => {}),
  });

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "linear-gradient(180deg, #87ceeb 0%, #c8e6f5 60%, #c8d5b0 100%)",
        borderRadius: 12,
        overflow: "hidden",
        ...style,
      }}
    >
      <Canvas
        shadows
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0, powerPreference: "high-performance" }}
        camera={{ fov: 55, near: 0.1, far: 800 }}
        style={{ width: "100%", height: "100%" }}
      >
        <PittsburghScene
          route={route}
          hazards={hazards}
          targetWorldPt={targetWorldPt}
          navigationState={navigationState}
          routeSafety={routeSafety}
          centerLat={centerLat}
          centerLng={centerLng}
        />
      </Canvas>

      <HUDOverlay
        navigationState={navigationState}
        routeSafety={routeSafety}
        remainingDistance={remainingDistance}
        estimatedTime={estimatedTime}
        hazardCount={(hazards || []).length}
        testMode={testMode}
        onAdvance={advance}
      />

      <div style={{ position: "absolute", bottom: 8, right: 10, fontSize: 8, color: "rgba(0,0,0,0.3)", fontFamily: "system-ui, sans-serif", pointerEvents: "none" }}>
        3D WALK VIEW · Pittsburgh
      </div>
    </div>
  );
}