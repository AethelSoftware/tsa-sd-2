/**
 * Walking3DView.jsx — fixed
 * - Bright daytime scene (no more black void)
 * - Figure walks along the REAL route passed in via props
 * - No mock data anywhere
 * - userPosition animates along routePath in Dashboard
 */

import React, { useRef, useMemo, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";

// ─── Coordinate helpers ───────────────────────────────────────────────────────

const ORIGIN = { lat: 40.4406, lng: -79.9959 };
const M_LAT = 111_139;
const M_LNG = M_LAT * Math.cos(ORIGIN.lat * (Math.PI / 180));
const W = 1 / 8; // 1 unit = 8 m

function g2v([lat, lng]) {
  return new THREE.Vector3(
    (lng - ORIGIN.lng) * M_LNG * W,
    0,
    -(lat - ORIGIN.lat) * M_LAT * W,
  );
}

function obj2v({ lat, lng }) {
  return g2v([lat, lng]);
}

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

// ─── Constants ────────────────────────────────────────────────────────────────

const ROAD_HW = 0.5;
const WALK_HW = 0.15;

const HAZARD_HEX = {
  crime: 0xef4444,
  fire: 0xf97316,
  disaster: 0x8b5cf6,
  congestion: 0xf59e0b,
  construction: 0xb45309,
  poor_lighting: 0xca8a04,
  accessibility: 0x3b82f6,
};
const HAZARD_CSS = {
  crime: "#ef4444",
  fire: "#f97316",
  disaster: "#8b5cf6",
  congestion: "#f59e0b",
  construction: "#b45309",
  poor_lighting: "#ca8a04",
  accessibility: "#3b82f6",
};
function hcss(type) {
  return HAZARD_CSS[type] || "#ef4444";
}
function hhex(type) {
  return HAZARD_HEX[type] || 0xef4444;
}

// ─── RouteMesh ────────────────────────────────────────────────────────────────

function RouteMesh({ worldPts, safetyScore }) {
  const geoms = useMemo(() => {
    if (worldPts.length < 2) return null;
    const roadPos = [],
      roadIdx = [];
    const swPos = [],
      swIdx = [];

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
      swPos.push(
        SL0.x,
        0.01,
        SL0.z,
        SL1.x,
        0.01,
        SL1.z,
        SR0.x,
        0.01,
        SR0.z,
        SR1.x,
        0.01,
        SR1.z,
      );

      if (i < worldPts.length - 1) {
        const rb = i * 2;
        roadIdx.push(rb, rb + 1, rb + 2, rb + 1, rb + 3, rb + 2);
        const sb = i * 4;
        swIdx.push(sb, sb + 1, sb + 4, sb + 1, sb + 5, sb + 4);
        swIdx.push(sb + 2, sb + 6, sb + 3, sb + 3, sb + 6, sb + 7);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(roadPos, 3),
    );
    roadGeo.setIndex(roadIdx);
    roadGeo.computeVertexNormals();

    const swGeo = new THREE.BufferGeometry();
    swGeo.setAttribute("position", new THREE.Float32BufferAttribute(swPos, 3));
    swGeo.setIndex(swIdx);
    swGeo.computeVertexNormals();

    return { roadGeo, swGeo };
  }, [worldPts]);

  if (!geoms) return null;

  // Bright road colors for daytime scene
  const roadColor =
    safetyScore > 0.7 ? "#9ca3af" : safetyScore > 0.4 ? "#d97706" : "#ef4444";

  return (
    <group>
      <mesh geometry={geoms.swGeo} receiveShadow>
        <meshStandardMaterial color="#e5e7eb" roughness={0.9} />
      </mesh>
      <mesh geometry={geoms.roadGeo} receiveShadow>
        <meshStandardMaterial
          color={roadColor}
          roughness={0.85}
          metalness={0.02}
        />
      </mesh>
    </group>
  );
}

// ─── SafetyLine ───────────────────────────────────────────────────────────────

function SafetyLine({ worldPts, safetyScore }) {
  const color =
    safetyScore > 0.7 ? "#10b981" : safetyScore > 0.4 ? "#f59e0b" : "#ef4444";
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

// ─── AmbientBuildings ─────────────────────────────────────────────────────────

function AmbientBuildings({ worldPts }) {
  const buildings = useMemo(() => {
    if (worldPts.length < 4) return [];
    const result = [];
    const step = Math.max(1, Math.floor(worldPts.length / 40));

    for (let i = 0; i < worldPts.length - step; i += step) {
      const cur = worldPts[i];
      const nxt = worldPts[Math.min(i + step, worldPts.length - 1)];
      const tang = new THREE.Vector3().subVectors(nxt, cur).normalize();
      if (tang.lengthSq() < 1e-6) continue;
      const perp = new THREE.Vector3(-tang.z, 0, tang.x);

      const sx = Math.sin(cur.x * 17.3 + cur.z * 9.1);
      const sz = Math.sin(cur.x * 5.7 + cur.z * 23.4);
      const r = (n) => (((Math.sin(n) * 43758.5453) % 1) + 1) % 1;

      [1, -1].forEach((side) => {
        const setback =
          (ROAD_HW + WALK_HW + 0.3 + r(sx + side * 7) * 0.8) * side;
        const pos = cur.clone().addScaledVector(perp, setback);
        if (Math.abs(pos.x) > 150 || Math.abs(pos.z) > 150) return;

        const h = 0.8 + r(sz + side * 3) * 3.5;
        const bw = 0.4 + r(sx + side * 11) * 0.8;
        const bd = 0.4 + r(sz + side * 13) * 0.8;
        // Bright building colors — beige, white, light grey, cream
        const palette = [
          "#f5f0e8",
          "#e8e0d5",
          "#d6cfc4",
          "#ede8e0",
          "#f0ece6",
          "#ddd8d0",
        ];
        const col = palette[Math.floor(r(sx + side * 23) * palette.length)];
        result.push({ x: pos.x, z: pos.z, h, bw, bd, col });
      });
    }
    return result;
  }, [worldPts]);

  return (
    <group>
      {buildings.map((b, i) => (
        <mesh key={i} position={[b.x, b.h / 2, b.z]} castShadow receiveShadow>
          <boxGeometry args={[b.bw, b.h, b.bd]} />
          <meshStandardMaterial
            color={b.col}
            roughness={0.7}
            metalness={0.05}
          />
        </mesh>
      ))}
    </group>
  );
}

// ─── WalkingFigure ────────────────────────────────────────────────────────────

function WalkingFigure({
  worldPts,
  userWorldPt,
  navState,
  routeSafety,
  onPosUpdate,
}) {
  const root = useRef();
  const lArm = useRef();
  const rArm = useRef();
  const lLeg = useRef();
  const rLeg = useRef();

  const curPos = useRef(new THREE.Vector3());
  const curRot = useRef(0);
  const tick = useRef(0);
  const firstFrame = useRef(true);

  const isWalking = navState === "walking";
  const isArrived = navState === "arrived";

  // Bright jacket colors
  const jacketHex =
    routeSafety > 0.7 ? 0x2563eb : routeSafety > 0.4 ? 0xd97706 : 0xdc2626;

  useFrame((_, dt) => {
    if (!root.current || worldPts.length === 0 || !userWorldPt) return;
    tick.current += dt;

    const idx = nearestIdx(worldPts, userWorldPt);
    const target = worldPts[idx].clone();
    let targetRot = curRot.current;

    if (idx < worldPts.length - 1) {
      const d = new THREE.Vector3().subVectors(
        worldPts[idx + 1],
        worldPts[idx],
      );
      if (d.lengthSq() > 1e-6) targetRot = Math.atan2(d.x, d.z);
    }

    if (firstFrame.current) {
      curPos.current.copy(target);
      curRot.current = targetRot;
      firstFrame.current = false;
    }

    const k = 1 - Math.exp(-7 * dt);
    curPos.current.lerp(target, k);
    let dRot =
      ((((targetRot - curRot.current) % (Math.PI * 2)) + Math.PI * 3) %
        (Math.PI * 2)) -
      Math.PI;
    curRot.current += dRot * k;

    root.current.position.copy(curPos.current);
    root.current.rotation.y = curRot.current;

    if (isWalking) {
      const s = Math.sin(tick.current * 4.2);
      if (lArm.current) lArm.current.rotation.x = s * 0.42;
      if (rArm.current) rArm.current.rotation.x = -s * 0.42;
      if (lLeg.current) lLeg.current.rotation.x = -s * 0.38;
      if (rLeg.current) rLeg.current.rotation.x = s * 0.38;
      root.current.position.y = Math.abs(Math.sin(tick.current * 4.2)) * 0.018;
    } else {
      const relax = (ref) => {
        if (ref.current) ref.current.rotation.x *= 0.85;
      };
      relax(lArm);
      relax(rArm);
      relax(lLeg);
      relax(rLeg);
    }

    if (onPosUpdate) onPosUpdate(curPos.current, curRot.current);
  });

  return (
    <group ref={root}>
      {/* Ground shadow */}
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.36, 20]} />
        <meshBasicMaterial
          color="#00000033"
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </mesh>

      {/* Feet */}
      <mesh position={[0.09, 0.06, 0.05]} castShadow>
        <boxGeometry args={[0.09, 0.06, 0.17]} />
        <meshStandardMaterial color="#1f2937" roughness={0.9} />
      </mesh>
      <mesh position={[-0.09, 0.06, 0.05]} castShadow>
        <boxGeometry args={[0.09, 0.06, 0.17]} />
        <meshStandardMaterial color="#1f2937" roughness={0.9} />
      </mesh>

      {/* Left leg */}
      <group ref={lLeg} position={[0.09, 0.45, 0]}>
        <mesh castShadow>
          <capsuleGeometry args={[0.065, 0.55, 4, 8]} />
          <meshStandardMaterial color="#374151" roughness={0.8} />
        </mesh>
      </group>

      {/* Right leg */}
      <group ref={rLeg} position={[-0.09, 0.45, 0]}>
        <mesh castShadow>
          <capsuleGeometry args={[0.065, 0.55, 4, 8]} />
          <meshStandardMaterial color="#374151" roughness={0.8} />
        </mesh>
      </group>

      {/* Torso */}
      <mesh position={[0, 0.96, 0]} castShadow>
        <boxGeometry args={[0.29, 0.44, 0.19]} />
        <meshStandardMaterial
          color={jacketHex}
          roughness={0.7}
          metalness={0.05}
        />
      </mesh>

      {/* Backpack */}
      <mesh position={[0, 0.97, -0.14]} castShadow>
        <boxGeometry args={[0.18, 0.28, 0.1]} />
        <meshStandardMaterial color="#6b7280" roughness={0.85} />
      </mesh>

      {/* Left arm */}
      <group ref={lArm} position={[0.19, 1.06, 0]}>
        <mesh position={[0, -0.17, 0]} castShadow>
          <capsuleGeometry args={[0.05, 0.28, 4, 6]} />
          <meshStandardMaterial color={jacketHex} roughness={0.72} />
        </mesh>
      </group>

      {/* Right arm */}
      <group ref={rArm} position={[-0.19, 1.06, 0]}>
        <mesh position={[0, -0.17, 0]} castShadow>
          <capsuleGeometry args={[0.05, 0.28, 4, 6]} />
          <meshStandardMaterial color={jacketHex} roughness={0.72} />
        </mesh>
      </group>

      {/* Neck */}
      <mesh position={[0, 1.24, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.065, 0.1, 8]} />
        <meshStandardMaterial color="#d4a87a" roughness={0.7} />
      </mesh>

      {/* Head */}
      <mesh position={[0, 1.41, 0]} castShadow>
        <sphereGeometry args={[0.14, 16, 14]} />
        <meshStandardMaterial color="#d4a87a" roughness={0.65} />
      </mesh>

      {/* Cap */}
      <mesh position={[0, 1.52, 0.01]} castShadow>
        <cylinderGeometry args={[0.09, 0.155, 0.09, 12]} />
        <meshStandardMaterial color="#1e3a5f" roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.52, 0.12]} castShadow>
        <boxGeometry args={[0.18, 0.03, 0.1]} />
        <meshStandardMaterial color="#1e3a5f" roughness={0.7} />
      </mesh>

      {/* Direction arrow */}
      {isWalking && (
        <mesh
          position={[0, 0.02, ROAD_HW * 0.55]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <coneGeometry args={[0.07, 0.22, 6]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.8} />
        </mesh>
      )}

      {/* Arrival gem */}
      {isArrived && (
        <mesh position={[0, 2.0, 0]}>
          <octahedronGeometry args={[0.22, 0]} />
          <meshStandardMaterial
            color="#10b981"
            emissive="#10b981"
            emissiveIntensity={0.7}
            roughness={0.2}
            metalness={0.5}
          />
        </mesh>
      )}
    </group>
  );
}

// ─── HazardMarker ─────────────────────────────────────────────────────────────

function HazardMarker({ hazard }) {
  // Defensive: skip if position is missing/invalid
  if (
    !hazard ||
    !hazard.position ||
    typeof hazard.position.lat !== "number" ||
    typeof hazard.position.lng !== "number"
  )
    return null;

  const { position, type, severity = 0.5, radius = 50 } = hazard;
  const wPos = useMemo(() => obj2v(position), [position.lat, position.lng]);
  const wRadius = Math.min((radius || 50) * W, 8); // cap radius so it doesn't go huge
  const hexCol = hhex(type);
  const cssCol = hcss(type);

  const spinRef = useRef();
  const pLight = useRef();

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (spinRef.current) {
      spinRef.current.rotation.y = t * 1.0;
      spinRef.current.position.y = 0.7 + Math.sin(t * 1.8) * 0.1;
    }
    if (pLight.current)
      pLight.current.intensity = 1.5 + Math.sin(t * 3.5) * 0.5;
  });

  const pillarH = 0.5 + severity * 0.8;

  return (
    <group position={[wPos.x, 0, wPos.z]}>
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[wRadius, 32]} />
        <meshBasicMaterial
          color={hexCol}
          transparent
          opacity={0.08}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.16, 0.22, 0.1, 10]} />
        <meshStandardMaterial color={hexCol} roughness={0.45} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.1 + pillarH / 2, 0]}>
        <cylinderGeometry args={[0.045, 0.12, pillarH, 8]} />
        <meshStandardMaterial
          color={hexCol}
          roughness={0.4}
          metalness={0.5}
          emissive={hexCol}
          emissiveIntensity={0.15}
        />
      </mesh>
      <mesh ref={spinRef} position={[0, 0.7, 0]}>
        <octahedronGeometry args={[0.26, 0]} />
        <meshStandardMaterial
          color={hexCol}
          roughness={0.2}
          metalness={0.7}
          emissive={hexCol}
          emissiveIntensity={0.4}
        />
      </mesh>
      <pointLight
        ref={pLight}
        color={hexCol}
        intensity={1.5}
        distance={wRadius * 2}
        decay={2}
      />
      <Html
        position={[0, pillarH + 0.85, 0]}
        center
        distanceFactor={14}
        zIndexRange={[10, 20]}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.92)",
            border: `1.5px solid ${cssCol}`,
            borderRadius: 6,
            padding: "3px 9px",
            color: cssCol,
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            fontFamily: "system-ui, sans-serif",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          ⚠ {(type || "hazard").replace(/_/g, " ")}
        </div>
      </Html>
    </group>
  );
}

// ─── DestinationMarker ────────────────────────────────────────────────────────

function DestinationMarker({ worldPos }) {
  const pin = useRef();
  const ring = useRef();

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (pin.current) pin.current.position.y = 0.7 + Math.sin(t * 2.2) * 0.15;
    if (ring.current)
      ring.current.material.opacity = 0.3 + Math.sin(t * 2.2) * 0.12;
  });

  return (
    <group position={[worldPos.x, 0, worldPos.z]}>
      <mesh ref={ring} position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 0.6, 28]} />
        <meshBasicMaterial
          color="#10b981"
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={pin} position={[0, 0.7, 0]}>
        <coneGeometry args={[0.2, 0.6, 8]} />
        <meshStandardMaterial
          color="#10b981"
          emissive="#10b981"
          emissiveIntensity={0.5}
          roughness={0.3}
          metalness={0.3}
        />
      </mesh>
      <pointLight color="#10b981" intensity={2} distance={5} decay={2} />
      <Html
        position={[0, 1.7, 0]}
        center
        distanceFactor={14}
        zIndexRange={[5, 15]}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.92)",
            border: "1.5px solid #10b981",
            borderRadius: 6,
            padding: "3px 10px",
            color: "#059669",
            fontSize: 10,
            fontWeight: 700,
            fontFamily: "system-ui, sans-serif",
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          ✓ DESTINATION
        </div>
      </Html>
    </group>
  );
}

// ─── FollowCamera ─────────────────────────────────────────────────────────────

function FollowCamera({ figPosRef, figRotRef, navState }) {
  const { camera } = useThree();
  const camPos = useRef(new THREE.Vector3(0, 6, 10));
  const lookAt = useRef(new THREE.Vector3());
  const init = useRef(false);

  useFrame((_, dt) => {
    const pos = figPosRef.current;
    const rot = figRotRef.current;
    const isWalking = navState === "walking";

    const back = isWalking ? 4.0 : 6;
    const up = isWalking ? 3.0 : 7;

    const desire = new THREE.Vector3(
      pos.x - Math.sin(rot) * back,
      pos.y + up,
      pos.z + Math.cos(rot) * back,
    );

    if (!init.current) {
      camPos.current.copy(desire);
      init.current = true;
    }

    camPos.current.lerp(desire, 1 - Math.exp(-3.5 * dt));
    camera.position.copy(camPos.current);

    const ahead = new THREE.Vector3(
      pos.x + Math.sin(rot) * 2,
      pos.y + 1.2,
      pos.z - Math.cos(rot) * 2,
    );
    lookAt.current.lerp(ahead, 1 - Math.exp(-4.5 * dt));
    camera.lookAt(lookAt.current);
  });

  return null;
}

// ─── Ground ───────────────────────────────────────────────────────────────────

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
      <planeGeometry args={[600, 600, 1, 1]} />
      {/* Bright grass/pavement color */}
      <meshStandardMaterial color="#c8d5b0" roughness={1} />
    </mesh>
  );
}

// ─── PittsburghScene ──────────────────────────────────────────────────────────

function PittsburghScene({
  route,
  hazards,
  userPosition,
  navigationState,
  routeSafety,
}) {
  const worldPts = useMemo(() => {
    if (!route || route.length === 0) return [];
    const pts = route.map(g2v);
    return pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
  }, [route]);

  const userWorldPt = useMemo(
    () => (userPosition ? g2v(userPosition) : null),
    [userPosition?.[0], userPosition?.[1]],
  );

  const figPosRef = useRef(
    userWorldPt ? userWorldPt.clone() : new THREE.Vector3(),
  );
  const figRotRef = useRef(0);

  const handlePosUpdate = useCallback((pos, rot) => {
    figPosRef.current.copy(pos);
    figRotRef.current = rot;
  }, []);

  const destPt = worldPts.length > 0 ? worldPts[worldPts.length - 1] : null;
  const isArrived = navigationState === "arrived";

  // Safe hazards — filter out any without valid position
  const safeHazards = useMemo(
    () =>
      (hazards || []).filter(
        (hz) =>
          hz &&
          hz.position &&
          typeof hz.position.lat === "number" &&
          typeof hz.position.lng === "number",
      ),
    [hazards],
  );

  return (
    <>
      {/* ── Bright daytime lighting ── */}
      <ambientLight intensity={1.4} color="#fffbe8" />
      <directionalLight
        position={[12, 22, 15]}
        intensity={2.2}
        color="#fff8f0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.1}
        shadow-camera-far={200}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      <directionalLight
        position={[-10, 12, -8]}
        intensity={0.6}
        color="#c8dff0"
      />
      <hemisphereLight args={["#87ceeb", "#a8c878", 0.5]} />

      {/* Light fog for depth — not black, sky blue */}
      <fog attach="fog" args={["#c8e6f5", 40, 140]} />

      {/* ── Environment ── */}
      <Ground />

      {/* ── Route ── */}
      {worldPts.length > 1 && (
        <>
          <RouteMesh worldPts={worldPts} safetyScore={routeSafety} />
          <SafetyLine worldPts={worldPts} safetyScore={routeSafety} />
          <AmbientBuildings worldPts={worldPts} />
        </>
      )}

      {/* ── Hazards ── */}
      {safeHazards.map((hz, i) => (
        <HazardMarker key={hz.id || `hz-${i}`} hazard={hz} />
      ))}

      {/* ── Destination ── */}
      {destPt && !isArrived && <DestinationMarker worldPos={destPt} />}

      {/* ── Walking figure ── */}
      {userWorldPt && worldPts.length > 0 && (
        <WalkingFigure
          worldPts={worldPts}
          userWorldPt={userWorldPt}
          navState={navigationState}
          routeSafety={routeSafety}
          onPosUpdate={handlePosUpdate}
        />
      )}

      {/* Fallback dot when no route */}
      {userWorldPt && worldPts.length === 0 && (
        <group position={[userWorldPt.x, 0, userWorldPt.z]}>
          <mesh position={[0, 0.4, 0]}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshStandardMaterial
              color="#3b82f6"
              emissive="#3b82f6"
              emissiveIntensity={0.3}
            />
          </mesh>
          <pointLight color="#3b82f6" intensity={2} distance={5} decay={2} />
        </group>
      )}

      <FollowCamera
        figPosRef={figPosRef}
        figRotRef={figRotRef}
        navState={navigationState}
      />
    </>
  );
}

// ─── HUD ──────────────────────────────────────────────────────────────────────

function HUDOverlay({
  navigationState,
  routeSafety,
  remainingDistance,
  estimatedTime,
  hazardCount,
}) {
  const safetyColor =
    routeSafety > 0.7 ? "#059669" : routeSafety > 0.4 ? "#d97706" : "#dc2626";
  const stateLabel =
    {
      idle: "READY",
      walking: "▶ NAVIGATING",
      rerouting: "↻ REROUTING",
      arrived: "✓ ARRIVED",
    }[navigationState] || navigationState.toUpperCase();

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        pointerEvents: "none",
        zIndex: 10,
        padding: "10px 14px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          background: "rgba(255,255,255,0.88)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(0,0,0,0.1)",
          borderRadius: 10,
          padding: "8px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          minWidth: 130,
          boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.15em",
            color: safetyColor,
          }}
        >
          {stateLabel}
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#1f2937",
            lineHeight: 1,
          }}
        >
          {Math.round(remainingDistance || 0)}
          <span
            style={{
              fontSize: 11,
              fontWeight: 400,
              color: "#6b7280",
              marginLeft: 3,
            }}
          >
            m
          </span>
        </div>
        <div style={{ fontSize: 10, color: "#6b7280" }}>
          ~{Math.round((estimatedTime || 0) / 60)} min remaining
        </div>
      </div>

      <div
        style={{
          background: "rgba(255,255,255,0.88)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(0,0,0,0.1)",
          borderRadius: 10,
          padding: "8px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          alignItems: "flex-end",
          boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.15em",
            color: "#6b7280",
          }}
        >
          ROUTE SAFETY
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: safetyColor,
            lineHeight: 1,
          }}
        >
          {Math.round((routeSafety || 0) * 100)}%
        </div>
        {hazardCount > 0 && (
          <div style={{ fontSize: 10, color: "#dc2626", fontWeight: 600 }}>
            ⚠ {hazardCount} hazard{hazardCount !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Walking3DView ────────────────────────────────────────────────────────────

export default function Walking3DView({
  route = [],
  hazards = [],
  userPosition = null,
  navigationState = "idle",
  routeSafety = 0.8,
  remainingDistance = 0,
  estimatedTime = 0,
  style = {},
}) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        // Bright sky background instead of black
        background:
          "linear-gradient(180deg, #87ceeb 0%, #c8e6f5 60%, #c8d5b0 100%)",
        borderRadius: 12,
        overflow: "hidden",
        ...style,
      }}
    >
      <Canvas
        shadows
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          powerPreference: "high-performance",
        }}
        camera={{ fov: 55, near: 0.1, far: 600 }}
        style={{ width: "100%", height: "100%" }}
      >
        <PittsburghScene
          route={route}
          hazards={hazards}
          userPosition={userPosition}
          navigationState={navigationState}
          routeSafety={routeSafety}
        />
      </Canvas>

      <HUDOverlay
        navigationState={navigationState}
        routeSafety={routeSafety}
        remainingDistance={remainingDistance}
        estimatedTime={estimatedTime}
        hazardCount={(hazards || []).length}
      />

      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 10,
          fontSize: 8,
          color: "rgba(0,0,0,0.3)",
          fontFamily: "system-ui, sans-serif",
          pointerEvents: "none",
        }}
      >
        3D WALK VIEW · Pittsburgh
      </div>
    </div>
  );
}