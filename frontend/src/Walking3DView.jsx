import React, { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Geo ↔ World helpers
// ---------------------------------------------------------------------------
const SCALE = 1 / 4; // 1 world unit = 4 meters
const M_LAT = 111139;
let _origin = null;
let _mLng = null;

function initOrigin(lat, lng) {
  if (_origin) return;
  _origin = { lat, lng };
  _mLng = M_LAT * Math.cos(lat * (Math.PI / 180));
}

function geo2w(lat, lng) {
  if (!_origin) return [0, 0];
  return [
    (lng - _origin.lng) * _mLng * SCALE,
    -(lat - _origin.lat) * M_LAT * SCALE,
  ];
}

// ---------------------------------------------------------------------------
// Procedural city blocks (no network, instant, lightweight)
// ---------------------------------------------------------------------------
function ProceduralCity({ centerX, centerZ }) {
  const meshRef = useRef();
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = [];
    const normals = [];
    const colors = [];
    const rng = (seed) => {
      let s = seed;
      return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
    };

    const palette = [
      [0.82, 0.78, 0.73], [0.78, 0.75, 0.71], [0.85, 0.81, 0.76],
      [0.75, 0.77, 0.80], [0.80, 0.76, 0.72], [0.77, 0.74, 0.70],
    ];

    const gridSize = 12;
    const spacing = 14;
    const offset = (gridSize * spacing) / 2;

    for (let gx = 0; gx < gridSize; gx++) {
      for (let gz = 0; gz < gridSize; gz++) {
        const rand = rng(gx * 1000 + gz * 37 + 7);
        // Skip some cells for streets
        if (rand() < 0.25) continue;

        const bx = gx * spacing - offset + rand() * 4 - 2;
        const bz = gz * spacing - offset + rand() * 4 - 2;
        const bw = 4 + rand() * 7;
        const bd = 4 + rand() * 7;
        const bh = 2 + rand() * 12;
        const col = palette[Math.floor(rand() * palette.length)];
        const shade = 0.85 + rand() * 0.15;

        // Box faces (6 faces, 2 tris each = 36 verts)
        const addFace = (v0, v1, v2, v3, nx, ny, nz, dark) => {
          const f = dark ? 0.7 : 1.0;
          const r = col[0] * shade * f, g = col[1] * shade * f, b = col[2] * shade * f;
          positions.push(...v0, ...v1, ...v2, ...v0, ...v2, ...v3);
          for (let i = 0; i < 6; i++) { normals.push(nx, ny, nz); colors.push(r, g, b); }
        };

        const x0 = bx - bw / 2, x1 = bx + bw / 2;
        const z0 = bz - bd / 2, z1 = bz + bd / 2;
        const y0 = 0, y1 = bh;

        // Top
        addFace([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], 0, 1, 0, false);
        // Front
        addFace([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, false);
        // Back
        addFace([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, true);
        // Left
        addFace([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, true);
        // Right
        addFace([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, false);
        // Bottom (skip — never seen)
      }
    }

    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, []);

  return (
    <mesh ref={meshRef} geometry={geometry} position={[centerX || 0, 0, centerZ || 0]} castShadow receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.88} metalness={0.02} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[500, 500]} />
      <meshStandardMaterial color="#a8b898" roughness={0.95} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Route ribbon (single merged geometry, no per-frame allocation)
// ---------------------------------------------------------------------------
function RouteRibbon({ points, progress, safety }) {
  const meshRef = useRef();
  const completedRef = useRef();

  const { fullGeo, color } = useMemo(() => {
    if (points.length < 2) return { fullGeo: null, color: "#8cd69c" };
    const c = safety > 0.7 ? "#8cd69c" : safety > 0.4 ? "#ffb347" : "#ff7b6b";
    const pos = [], idx = [], uvs = [];
    for (let i = 0; i < points.length; i++) {
      const cur = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const tx = next[0] - prev[0], tz = next[1] - prev[1];
      const len = Math.sqrt(tx * tx + tz * tz) || 1;
      const px = -tz / len * 1.5, pz = tx / len * 1.5;
      pos.push(cur[0] + px, 0.04, cur[1] + pz, cur[0] - px, 0.04, cur[1] - pz);
      uvs.push(0, i / (points.length - 1), 1, i / (points.length - 1));
      if (i < points.length - 1) {
        const b = i * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return { fullGeo: g, color: c };
  }, [points, safety]);

  if (!fullGeo) return null;

  return (
    <group>
      <mesh ref={meshRef} geometry={fullGeo} receiveShadow>
        <meshStandardMaterial color={color} roughness={0.6} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Walking figure (simplified, no CapsuleGeometry for compat)
// ---------------------------------------------------------------------------
function WalkingFigure({ posRef, headingRef, walking, safety }) {
  const groupRef = useRef();
  const lArmRef = useRef();
  const rArmRef = useRef();
  const lLegRef = useRef();
  const rLegRef = useRef();
  const phaseRef = useRef(0);

  const jacketColor = safety > 0.7 ? "#2563eb" : safety > 0.4 ? "#d97706" : "#dc2626";

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    g.position.set(posRef.current[0], 0, posRef.current[1]);

    // Smooth heading
    const target = headingRef.current;
    let diff = ((target - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    g.rotation.y += diff * Math.min(1, 8 * dt);

    if (walking) {
      phaseRef.current += 5 * dt;
      const s = Math.sin(phaseRef.current);
      if (lArmRef.current) lArmRef.current.rotation.x = s * 0.4;
      if (rArmRef.current) rArmRef.current.rotation.x = -s * 0.4;
      if (lLegRef.current) lLegRef.current.rotation.x = -s * 0.35;
      if (rLegRef.current) rLegRef.current.rotation.x = s * 0.35;
      g.position.y = Math.abs(s) * 0.02;
    } else {
      [lArmRef, rArmRef, lLegRef, rLegRef].forEach((r) => {
        if (r.current) r.current.rotation.x *= 0.85;
      });
    }
  });

  return (
    <group ref={groupRef}>
      {/* Shadow disc */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.35, 10]} />
        <meshBasicMaterial color="#000" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      {/* Legs */}
      <group ref={lLegRef} position={[0.08, 0.45, 0]}>
        <mesh><cylinderGeometry args={[0.055, 0.06, 0.5, 6]} /><meshStandardMaterial color="#374151" /></mesh>
      </group>
      <group ref={rLegRef} position={[-0.08, 0.45, 0]}>
        <mesh><cylinderGeometry args={[0.055, 0.06, 0.5, 6]} /><meshStandardMaterial color="#374151" /></mesh>
      </group>
      {/* Torso */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <boxGeometry args={[0.28, 0.4, 0.18]} />
        <meshStandardMaterial color={jacketColor} roughness={0.7} />
      </mesh>
      {/* Arms */}
      <group ref={lArmRef} position={[0.19, 1.15, 0]}>
        <mesh><cylinderGeometry args={[0.04, 0.04, 0.4, 5]} /><meshStandardMaterial color={jacketColor} /></mesh>
      </group>
      <group ref={rArmRef} position={[-0.19, 1.15, 0]}>
        <mesh><cylinderGeometry args={[0.04, 0.04, 0.4, 5]} /><meshStandardMaterial color={jacketColor} /></mesh>
      </group>
      {/* Head */}
      <mesh position={[0, 1.42, 0]} castShadow>
        <sphereGeometry args={[0.12, 10, 10]} />
        <meshStandardMaterial color="#d4a87a" />
      </mesh>
      {/* Cap */}
      <mesh position={[0, 1.52, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.13, 0.07, 6]} />
        <meshStandardMaterial color="#1e3a5f" />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Hazard pin
// ---------------------------------------------------------------------------
function HazardPin({ worldX, worldZ, type }) {
  const ref = useRef();
  const color = type === "emergency" ? "#ef4444" : type === "construction" ? "#f97316" : "#f59e0b";

  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = 1.0 + Math.sin(clock.getElapsedTime() * 3) * 0.12;
  });

  return (
    <group position={[worldX, 0, worldZ]}>
      {/* Ground ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.8, 1.2, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} />
      </mesh>
      {/* Pole */}
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1, 4]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Diamond */}
      <mesh ref={ref}>
        <octahedronGeometry args={[0.18, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
      <pointLight color={color} intensity={1} distance={5} decay={2} position={[0, 1.2, 0]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Destination marker
// ---------------------------------------------------------------------------
function DestPin({ worldX, worldZ }) {
  const ref = useRef();
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 1.5;
  });
  return (
    <group position={[worldX, 0, worldZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.5, 0.8, 24]} />
        <meshBasicMaterial color="#10b981" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.4, 4]} />
        <meshStandardMaterial color="#10b981" />
      </mesh>
      <mesh ref={ref} position={[0, 1.5, 0]}>
        <octahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.6} />
      </mesh>
      <pointLight color="#10b981" intensity={2} distance={8} decay={2} position={[0, 1.5, 0]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Camera follower — behind-the-shoulder, smooth, zero allocation per frame
// ---------------------------------------------------------------------------
const _camTarget = new THREE.Vector3();
const _camDesired = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

function FollowCamera({ posRef, headingRef, arrived }) {
  const { camera } = useThree();
  const smoothPos = useRef(new THREE.Vector3(0, 14, 12));
  const smoothLook = useRef(new THREE.Vector3());
  const smoothH = useRef(0);

  useFrame((_, dt) => {
    const px = posRef.current[0], pz = posRef.current[1];
    const h = headingRef.current;

    // Smooth heading
    let hd = ((h - smoothH.current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    smoothH.current += hd * Math.min(1, 3 * dt);
    const sh = smoothH.current;

    if (arrived) {
      _camDesired.set(px, 22, pz + 20);
      _lookTarget.set(px, 0, pz);
    } else {
      _camDesired.set(
        px - Math.sin(sh) * 12,
        14,
        pz + Math.cos(sh) * 12
      );
      _lookTarget.set(
        px + Math.sin(sh) * 8,
        1.2,
        pz - Math.cos(sh) * 8
      );
    }

    const t = Math.min(1, 3.5 * dt);
    smoothPos.current.lerp(_camDesired, t);
    smoothLook.current.lerp(_lookTarget, t);
    camera.position.copy(smoothPos.current);
    camera.lookAt(smoothLook.current);
  });

  return null;
}

// ---------------------------------------------------------------------------
// Scene root (inside Canvas)
// ---------------------------------------------------------------------------
function Scene({ routeW, hazardW, destW, posRef, headingRef, navState, safety }) {
  const walking = navState === "walking";
  const arrived = navState === "arrived";
  const cityCenter = routeW.length > 0
    ? [(routeW[0][0] + routeW[routeW.length - 1][0]) / 2, (routeW[0][1] + routeW[routeW.length - 1][1]) / 2]
    : [0, 0];

  return (
    <>
      <ambientLight intensity={1.0} color="#fffce8" />
      <hemisphereLight args={["#87ceeb", "#6b8a4e", 0.4]} />
      <directionalLight
        position={[20, 25, 15]}
        intensity={1.8}
        color="#fff8f0"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.002}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
      <fog attach="fog" args={["#c0d4e8", 60, 200]} />

      <Ground />
      <ProceduralCity centerX={cityCenter[0]} centerZ={cityCenter[1]} />

      {routeW.length > 1 && (
        <RouteRibbon points={routeW} progress={0} safety={safety} />
      )}

      {hazardW.map((h, i) => (
        <HazardPin key={i} worldX={h[0]} worldZ={h[1]} type={h[2]} />
      ))}

      {destW && <DestPin worldX={destW[0]} worldZ={destW[1]} />}

      <WalkingFigure posRef={posRef} headingRef={headingRef} walking={walking} safety={safety} />
      <FollowCamera posRef={posRef} headingRef={headingRef} arrived={arrived} />
    </>
  );
}

// ---------------------------------------------------------------------------
// HUD overlay
// ---------------------------------------------------------------------------
function HUD({ navState, safety, remainDist, estTime, stepIdx, steps, turnDist, onAdvance, onClose, testMode }) {
  const safetyPct = Math.round(safety * 100);
  const safetyColor = safety > 0.7 ? "#059669" : safety > 0.4 ? "#d97706" : "#dc2626";
  const safeBg = safety > 0.7
    ? "linear-gradient(135deg, #0d9488, #065f46)"
    : safety > 0.4
      ? "linear-gradient(135deg, #d97706, #78350f)"
      : "linear-gradient(135deg, #dc2626, #7f1d1d)";
  const distStr = remainDist > 1000 ? `${(remainDist / 1000).toFixed(1)} km` : `${Math.round(remainDist)} m`;
  const timeStr = estTime ? `${Math.round(estTime / 60)} min` : "--";
  const instruction = steps?.[stepIdx]?.instruction || "Follow the route";
  const turnDistStr = turnDist != null ? `${Math.round(turnDist)} m` : "";
  const stateLabel = { idle: "READY", walking: "NAVIGATING", stopped: "PAUSED", arrived: "ARRIVED", rerouting: "REROUTING" }[navState] || "—";

  const s = {
    overlay: { position: "absolute", inset: 0, pointerEvents: "none", zIndex: 20, fontFamily: "'SF Pro Display', 'Segoe UI', system-ui, sans-serif" },
    topBar: {
      position: "absolute", top: 8, left: 8, right: 8,
      display: "flex", justifyContent: "space-between", alignItems: "center",
      background: "rgba(10,10,18,0.82)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      borderRadius: 14, padding: "7px 14px",
      border: "1px solid rgba(255,255,255,0.06)", pointerEvents: "auto",
    },
    closeBtn: {
      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 8, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", color: "#94a3b8", fontSize: 13,
    },
    badge: {
      fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase",
      padding: "3px 12px", borderRadius: 999,
      background: `${safetyColor}18`, border: `1px solid ${safetyColor}55`, color: safetyColor,
    },
    instrBar: {
      position: "absolute", bottom: 48, left: 8, right: 8,
      background: safeBg, borderRadius: 14, padding: "10px 14px",
      display: "flex", alignItems: "center", gap: 12, pointerEvents: "auto",
    },
    instrIcon: {
      width: 38, height: 38, background: "rgba(255,255,255,0.15)",
      borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
    },
    instrText: { fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    instrSub: { fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", color: "rgba(255,255,255,0.55)" },
    turnDist: { fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1, textAlign: "right" },
    turnLabel: { fontSize: 9, color: "rgba(255,255,255,0.6)", textAlign: "right" },
    statsBar: {
      position: "absolute", bottom: 0, left: 0, right: 0, height: 48,
      background: "rgba(10,10,18,0.92)", backdropFilter: "blur(12px)",
      borderTop: "1px solid rgba(255,255,255,0.06)",
      display: "grid", gridTemplateColumns: "repeat(4,1fr)", alignItems: "center",
      pointerEvents: "auto",
    },
    statVal: { fontSize: 14, fontWeight: 700, color: "#e2e8f0", textAlign: "center", lineHeight: 1.1 },
    statLabel: { fontSize: 8, fontWeight: 700, textTransform: "uppercase", color: "#64748b", textAlign: "center", marginTop: 1 },
    testBar: {
      position: "absolute", top: 56, left: 8, right: 8,
      background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)",
      borderRadius: 10, padding: "5px 12px",
      display: "flex", alignItems: "center", gap: 10, pointerEvents: "auto",
    },
    testBtn: {
      background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)",
      borderRadius: 7, padding: "4px 14px", fontSize: 11, fontWeight: 700, color: "#fbbf24", cursor: "pointer",
    },
  };

  return (
    <div style={s.overlay}>
      {/* Top bar */}
      <div style={s.topBar}>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
        <div style={s.badge}>{safety > 0.7 ? "SAFE" : safety > 0.4 ? "CAUTION" : "DANGER"}</div>
        <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{stateLabel}</div>
      </div>

      {/* Instruction */}
      <div style={s.instrBar}>
        <div style={s.instrIcon}>{stepIdx >= (steps?.length || 1) - 1 ? "🏁" : "→"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.instrSub}>Step {stepIdx + 1} / {steps?.length || 1}</div>
          <div style={s.instrText}>{instruction}</div>
        </div>
        <div>
          <div style={s.turnDist}>{turnDistStr || "—"}</div>
          <div style={s.turnLabel}>next turn</div>
        </div>
      </div>

      {/* Stats */}
      <div style={s.statsBar}>
        <div><div style={s.statVal}>{distStr}</div><div style={s.statLabel}>remaining</div></div>
        <div><div style={s.statVal}>{timeStr}</div><div style={s.statLabel}>time</div></div>
        <div><div style={{ ...s.statVal, color: safetyColor }}>{safetyPct}%</div><div style={s.statLabel}>safety</div></div>
        <div><div style={s.statVal}>{stateLabel}</div><div style={s.statLabel}>status</div></div>
      </div>

      {/* Test mode */}
      {testMode && (
        <div style={s.testBar}>
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#fbbf24", letterSpacing: "0.12em" }}>Test Mode</span>
          <button style={s.testBtn} onClick={onAdvance}>↑ Advance</button>
          <span style={{ fontSize: 9, color: "#fbbf2488" }}>or press W / ↑</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------
class ErrBoundary extends React.Component {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() {
    if (this.state.err) return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, background: "#111", color: "#888", fontSize: 13 }}>
        <span style={{ fontSize: 28 }}>🗺️</span>
        <div>3D view crashed</div>
        <button onClick={() => this.setState({ err: false })} style={{ background: "#14b8a622", border: "1px solid #14b8a644", borderRadius: 8, padding: "6px 18px", color: "#14b8a6", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Retry</button>
      </div>
    );
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export default function Walking3DView({
  route = [],
  routeSteps = [],
  currentStepIndex = 0,
  distanceToNextTurn = null,
  hazards = [],
  constructionZones = [],
  emergencies = [],
  userPosition = null,
  userHeading = 0,
  navigationState = "idle",
  routeSafety = 0.7,
  remainingDistance = 0,
  estimatedTime = 0,
  routeType = "walking",
  transitSegments = [],
  testMode = false,
  onTestPositionUpdate = null,
  onClose = () => {},
  style = {},
}) {
  // Init geo origin once
  useEffect(() => {
    _origin = null; _mLng = null; // reset on new route
    if (route.length) initOrigin(route[0][0], route[0][1]);
    else if (userPosition) initOrigin(userPosition[0], userPosition[1]);
  }, [route, userPosition]);

  // Pre-compute world coords (memo'd, only recalculates on route change)
  const routeW = useMemo(() => {
    if (!_origin && route.length) initOrigin(route[0][0], route[0][1]);
    return route.map(([lat, lng]) => geo2w(lat, lng));
  }, [route]);

  const allHazards = useMemo(() => [...hazards, ...constructionZones, ...emergencies], [hazards, constructionZones, emergencies]);
  const hazardW = useMemo(() =>
    allHazards.filter(h => h?.position?.lat).map(h => [...geo2w(h.position.lat, h.position.lng), h.type || "default"]),
    [allHazards]
  );

  const destW = useMemo(() => routeW.length ? routeW[routeW.length - 1] : null, [routeW]);

  // Figure position & heading refs (no re-renders on update)
  const posRef = useRef([0, 0]);
  const headingRef = useRef(0);

  useEffect(() => {
    if (userPosition) {
      const [wx, wz] = geo2w(userPosition[0], userPosition[1]);
      posRef.current = [wx, wz];
    }
  }, [userPosition]);

  useEffect(() => {
    headingRef.current = (userHeading * Math.PI) / 180;
  }, [userHeading]);

  // Test mode: advance along route
  const testIdxRef = useRef(0);
  useEffect(() => { testIdxRef.current = 0; }, [route]);

  const advance = useCallback(() => {
    if (!route.length) return;
    testIdxRef.current = Math.min(testIdxRef.current + 1, route.length - 1);
    const pt = route[testIdxRef.current];
    if (onTestPositionUpdate) onTestPositionUpdate(pt);
    // Also update local refs for immediate visual feedback
    const [wx, wz] = geo2w(pt[0], pt[1]);
    posRef.current = [wx, wz];
    // Compute heading from previous point
    if (testIdxRef.current > 0) {
      const prev = route[testIdxRef.current - 1];
      headingRef.current = Math.atan2(
        (pt[1] - prev[1]) * (_mLng || 1),
        (pt[0] - prev[0]) * M_LAT
      );
    }
  }, [route, onTestPositionUpdate]);

  useEffect(() => {
    if (!testMode) return;
    const handler = (e) => {
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") { e.preventDefault(); advance(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [testMode, advance]);

  return (
    <div style={{
      position: "relative", width: "100%", height: "100%",
      background: "linear-gradient(180deg, #87ceeb 0%, #c0d4e8 60%, #b8c8a8 100%)",
      borderRadius: 12, overflow: "hidden", ...style,
    }}>
      <ErrBoundary>
        <Canvas
          shadows
          dpr={Math.min(window.devicePixelRatio, 1.5)}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          camera={{ fov: 50, near: 0.5, far: 400 }}
          frameloop="always"
          style={{ width: "100%", height: "100%" }}
        >
          <Scene
            routeW={routeW}
            hazardW={hazardW}
            destW={destW}
            posRef={posRef}
            headingRef={headingRef}
            navState={navigationState}
            safety={routeSafety}
          />
        </Canvas>
      </ErrBoundary>

      <HUD
        navState={navigationState}
        safety={routeSafety}
        remainDist={remainingDistance}
        estTime={estimatedTime}
        stepIdx={currentStepIndex}
        steps={routeSteps}
        turnDist={distanceToNextTurn}
        onAdvance={advance}
        onClose={onClose}
        testMode={testMode}
      />
    </div>
  );
}