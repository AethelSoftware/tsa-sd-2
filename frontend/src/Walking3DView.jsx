import React, { useRef, useMemo, useCallback, useEffect, useState, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Geo → World coordinate conversion (cached)
// ---------------------------------------------------------------------------
const SCALE = 1 / 2;
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

const damp = (current, target, speed, dt) => 
  current + (target - current) * (1 - Math.exp(-speed * dt));

// ---------------------------------------------------------------------------
// Lighting (hemisphere + directional + teal fill)
// ---------------------------------------------------------------------------
const Lighting = React.memo(() => (
  <>
    <ambientLight intensity={0.3} color="#b0c8e8" />
    <hemisphereLight skyColor="#2a3a50" groundColor="#0a0604" intensity={0.6} />
    <directionalLight
      position={[30, 25, 20]} intensity={0.9} color="#ffd580"
      castShadow
      shadow-mapSize-width={2048} shadow-mapSize-height={2048}
      shadow-camera-far={200} shadow-camera-left={-80}
      shadow-camera-right={80} shadow-camera-top={80} shadow-camera-bottom={-80}
    />
    <directionalLight position={[-20, 10, -15]} intensity={0.18} color="#0d9488" />
    <pointLight position={[0, 5, 0]} intensity={0.35} color="#e8a870" distance={60} decay={2} />
  </>
));

// ---------------------------------------------------------------------------
// EnhancedGround (4 layers)
// ---------------------------------------------------------------------------
const EnhancedGround = React.memo(({ routeW }) => {
  const farPlaneGeo = useMemo(() => new THREE.PlaneGeometry(600, 600), []);
  const farPlaneMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#080a0e", roughness: 0.98, metalness: 0.02 }), []);
  
  // Build road strip and sidewalk dynamically based on route orientation
  const { roadStrip, leftSidewalk, rightSidewalk, dashes } = useMemo(() => {
    if (!routeW.length) return { roadStrip: null, leftSidewalk: null, rightSidewalk: null, dashes: [] };
    // Approximate road direction using first and last point
    const p0 = routeW[0];
    const p1 = routeW[routeW.length-1];
    const angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const perp = angle + Math.PI / 2;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const midX = (p0[0] + p1[0]) / 2;
    const midZ = (p0[1] + p1[1]) / 2;
    const width = 12;
    const roadGeo = new THREE.BoxGeometry(len, 0.1, width);
    const roadMat = new THREE.MeshStandardMaterial({ color: "#131313", roughness: 0.7 });
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: "#1c1c1c", roughness: 0.8 });
    const dashMat = new THREE.MeshStandardMaterial({ color: "#2a2a1a" });
    const dashesArr = [];
    const dashCount = Math.floor(len / 3);
    for (let i = 0; i <= dashCount; i++) {
      const t = i / dashCount;
      const x = p0[0] + (p1[0] - p0[0]) * t;
      const z = p0[1] + (p1[1] - p0[1]) * t;
      const dashGeo = new THREE.BoxGeometry(0.5, 0.05, 1.5);
      dashesArr.push(<mesh key={`dash-${i}`} position={[x, 0.03, z]} rotation={[0, angle, 0]} geometry={dashGeo} material={dashMat} />);
    }
    return {
      roadStrip: <mesh position={[midX, 0, midZ]} rotation={[0, angle, 0]} geometry={roadGeo} material={roadMat} receiveShadow castShadow />,
      leftSidewalk: <mesh position={[midX + Math.cos(perp)*3.5, 0.05, midZ + Math.sin(perp)*3.5]} rotation={[0, angle, 0]} geometry={new THREE.BoxGeometry(len, 0.1, 2)} material={sidewalkMat} receiveShadow castShadow />,
      rightSidewalk: <mesh position={[midX - Math.cos(perp)*3.5, 0.05, midZ - Math.sin(perp)*3.5]} rotation={[0, angle, 0]} geometry={new THREE.BoxGeometry(len, 0.1, 2)} material={sidewalkMat} receiveShadow castShadow />,
      dashes: dashesArr
    };
  }, [routeW]);
  
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]} receiveShadow geometry={farPlaneGeo} material={farPlaneMat} />
      {roadStrip}
      {leftSidewalk}
      {rightSidewalk}
      {dashes}
    </group>
  );
});

// ---------------------------------------------------------------------------
// CityBlocks (procedural buildings with emissive windows)
// ---------------------------------------------------------------------------
const CityBlocks = React.memo(({ routeW, seed = 42 }) => {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
  const COUNT = isMobile ? 25 : 40;

  const buildings = useMemo(() => {
    const result = [];
    let rng = seed;
    const lcg = () => {
      rng = (rng * 1664525 + 1013904223) & 0xffffffff;
      return (rng >>> 0) / 0xffffffff;
    };
    const mid = routeW.length ? routeW[Math.floor(routeW.length / 2)] : [0, 0];
    for (let i = 0; i < COUNT; i++) {
      const w = 4 + lcg() * 8;
      const d = 4 + lcg() * 8;
      const h = 6 + lcg() * 34;
      const side = lcg() > 0.5 ? 1 : -1;
      const offset = 14 + lcg() * 36;
      const along = (lcg() - 0.5) * 100;
      const gray = Math.floor(10 + lcg() * 12).toString(16).padStart(2, '0');
      const color = `#${gray}${gray}${Math.floor(parseInt(gray,16)*1.4).toString(16).padStart(2,'0')}`;
      const windowColor = lcg() > 0.5 ? "#e8a870" : "#14b8a6";
      result.push({ w, d, h, x: mid[0] + side * offset, z: mid[1] + along, color, windowColor });
    }
    return result;
  }, [routeW, seed, COUNT]);

  const sharedWindowMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.9, emissiveIntensity: 0.45 }), []);
  
  return (
    <group>
      {buildings.map((b, i) => {
        const rowCount = Math.floor(b.h / 4);
        const colCount = Math.floor(b.w / 3);
        return (
          <group key={i} position={[b.x, 0, b.z]}>
            <mesh position={[0, b.h / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[b.w, b.h, b.d]} />
              <meshStandardMaterial color={b.color} roughness={0.85} metalness={0.05} />
            </mesh>
            <mesh position={[0, b.h + 0.25, 0]}>
              <boxGeometry args={[b.w + 0.2, 0.5, b.d + 0.2]} />
              <meshStandardMaterial color="#1a1e26" roughness={0.9} />
            </mesh>
            {Array.from({ length: rowCount }, (_, row) =>
              Array.from({ length: colCount }, (_, col) => {
                const lit = (i * 7 + row * 3 + col) % 5 !== 0;
                if (!lit) return null;
                return (
                  <mesh
                    key={`w-${row}-${col}`}
                    position={[(col - colCount / 2 + 0.5) * 2.5, 2 + row * 4, b.d / 2 + 0.06]}
                  >
                    <boxGeometry args={[0.8, 1.2, 0.05]} />
                    <meshStandardMaterial color={b.windowColor} emissive={b.windowColor} {...sharedWindowMat} />
                  </mesh>
                );
              })
            )}
          </group>
        );
      })}
    </group>
  );
});

// ---------------------------------------------------------------------------
// RouteTube (CatmullRomCurve3 -> TubeGeometry)
// ---------------------------------------------------------------------------
const RouteTube = React.memo(({ points, progressIdx }) => {
  const completedCurve = useMemo(() => {
    if (points.length < 2 || progressIdx < 1) return null;
    const p = points.slice(0, progressIdx+1).map(pt => new THREE.Vector3(pt[0], 0.15, pt[1]));
    return new THREE.CatmullRomCurve3(p);
  }, [points, progressIdx]);
  const remainingCurve = useMemo(() => {
    if (points.length < 2 || progressIdx >= points.length-1) return null;
    const p = points.slice(progressIdx).map(pt => new THREE.Vector3(pt[0], 0.15, pt[1]));
    return new THREE.CatmullRomCurve3(p);
  }, [points, progressIdx]);
  const completedMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8B7355", roughness: 0.6 }), []);
  const remainingMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#14b8a6", emissive: "#0d9488", emissiveIntensity: 0.15, roughness: 0.4 }), []);
  return (
    <group>
      {completedCurve && (
        <mesh>
          <tubeGeometry args={[completedCurve, Math.min(completedCurve.points.length * 4, 200), 0.12, 6, false]} />
          <primitive object={completedMat} attach="material" />
        </mesh>
      )}
      {remainingCurve && (
        <mesh>
          <tubeGeometry args={[remainingCurve, Math.min(remainingCurve.points.length * 4, 200), 0.18, 6, false]} />
          <primitive object={remainingMat} attach="material" />
        </mesh>
      )}
    </group>
  );
});

// ---------------------------------------------------------------------------
// HazardMarker3D (pulsing ring + pole + octahedron)
// ---------------------------------------------------------------------------
const HazardMarker3D = React.memo(({ worldX, worldZ, severity = 0.7, description = "Hazard" }) => {
  const ringRef = useRef();
  const color = severity >= 0.8 ? "#ff4444" : severity >= 0.6 ? "#ffb347" : "#ffee44";
  useFrame(({ clock }) => {
    if (ringRef.current) {
      const t = (clock.getElapsedTime() % 2) / 2;
      const scale = 0.5 + t * 2.5;
      ringRef.current.scale.setScalar(scale);
      ringRef.current.material.opacity = Math.max(0, 1 - t);
    }
  });
  const poleMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ff4444", emissive: "#ff2222", emissiveIntensity: 0.3 }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }), [color]);
  const topMat = useMemo(() => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 }), [color]);
  return (
    <group position={[worldX, 0, worldZ]}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.5, 0.8, 16]} />
        <primitive object={ringMat} attach="material" />
      </mesh>
      <mesh position={[0, 1.5, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.08, 3, 6]} />
        <primitive object={poleMat} attach="material" />
      </mesh>
      <mesh position={[0, 3.2, 0]}>
        <octahedronGeometry args={[0.35, 0]} />
        <primitive object={topMat} attach="material" />
      </mesh>
    </group>
  );
});

// ---------------------------------------------------------------------------
// WalkerModel (animated humanoid) — NO ellipseGeometry
// ---------------------------------------------------------------------------
const WalkerModel = React.memo(({ posRef }) => {
  const groupRef = useRef();
  const leftArmRef = useRef();
  const rightArmRef = useRef();
  const headRef = useRef();
  const walkCycle = useRef(0);
  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.2 }), []);
  const skinMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#D4A574", roughness: 0.7 }), []);
  const shirtMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0d9488", roughness: 0.6 }), []);
  const pantsMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1a2535", roughness: 0.7 }), []);
  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    g.position.x = damp(g.position.x, posRef.current[0], 12, dt);
    g.position.z = damp(g.position.z, posRef.current[1], 12, dt);
    walkCycle.current += dt * 8;
    const bob = Math.sin(walkCycle.current * 2) * 0.05;
    g.position.y = 0.05 + bob;
    if (leftArmRef.current) leftArmRef.current.rotation.x = Math.sin(walkCycle.current) * 0.4;
    if (rightArmRef.current) rightArmRef.current.rotation.x = -Math.sin(walkCycle.current) * 0.4;
    if (headRef.current) headRef.current.rotation.x = Math.sin(walkCycle.current * 2) * 0.04;
  });
  return (
    <group ref={groupRef}>
      {/* Shadow — circleGeometry scaled to ellipse, NOT ellipseGeometry */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} scale={[1, 0.65, 1]}>
        <circleGeometry args={[0.3, 12]} />
        <primitive object={shadowMat} attach="material" />
      </mesh>
      <mesh position={[-0.12, 0.35, 0]} castShadow><capsuleGeometry args={[0.09, 0.35, 4, 6]} /><primitive object={pantsMat} attach="material" /></mesh>
      <mesh position={[0.12, 0.35, 0]} castShadow><capsuleGeometry args={[0.09, 0.35, 4, 6]} /><primitive object={pantsMat} attach="material" /></mesh>
      <mesh position={[0, 0.78, 0]} castShadow><capsuleGeometry args={[0.18, 0.38, 4, 8]} /><primitive object={shirtMat} attach="material" /></mesh>
      <mesh ref={leftArmRef} position={[-0.28, 0.82, 0]} castShadow><capsuleGeometry args={[0.07, 0.32, 4, 6]} /><primitive object={shirtMat} attach="material" /></mesh>
      <mesh ref={rightArmRef} position={[0.28, 0.82, 0]} castShadow><capsuleGeometry args={[0.07, 0.32, 4, 6]} /><primitive object={shirtMat} attach="material" /></mesh>
      <group ref={headRef} position={[0, 1.15, 0]}>
        <mesh castShadow><sphereGeometry args={[0.18, 12, 12]} /><primitive object={skinMat} attach="material" /></mesh>
      </group>
    </group>
  );
});

// ---------------------------------------------------------------------------
// DestinationMarker (spinning octahedron on pole)
// ---------------------------------------------------------------------------
const DestinationMarker = React.memo(({ worldX, worldZ }) => {
  const ref = useRef();
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#14b8a6", transparent: true, opacity: 0.3 }), []);
  const poleMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#14b8a6" }), []);
  const topMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#14b8a6", emissive: "#0d9488", emissiveIntensity: 0.3 }), []);
  useFrame(({ clock }) => { if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 1.5; });
  return (
    <group position={[worldX, 0, worldZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}><ringGeometry args={[0.8, 1.2, 16]} /><primitive object={ringMat} attach="material" /></mesh>
      <mesh position={[0, 1.2, 0]}><cylinderGeometry args={[0.08, 0.12, 2.4, 6]} /><primitive object={poleMat} attach="material" /></mesh>
      <mesh ref={ref} position={[0, 2.5, 0]}><octahedronGeometry args={[0.5, 0]} /><primitive object={topMat} attach="material" /></mesh>
    </group>
  );
});

// ---------------------------------------------------------------------------
// FollowCamera (lerp with breathing)
// ---------------------------------------------------------------------------
const FollowCamera = React.memo(({ posRef }) => {
  const { camera } = useThree();
  const targetPos = useRef({ x: 0, z: 0 });
  const ready = useRef(false);
  useFrame(({ clock }, dt) => {
    const px = posRef.current[0];
    const pz = posRef.current[1];
    targetPos.current.x = damp(targetPos.current.x || px, px, 4, dt);
    targetPos.current.z = damp(targetPos.current.z || pz, pz, 4, dt);
    const targetX = targetPos.current.x + 12;
    const targetZ = targetPos.current.z + 12;
    if (!ready.current) {
      camera.position.set(targetX, 8, targetZ);
      camera.lookAt(px, 0, pz);
      ready.current = true;
      return;
    }
    camera.position.x = damp(camera.position.x, targetX, 4, dt);
    camera.position.z = damp(camera.position.z, targetZ, 4, dt);
    camera.position.y = 8 + Math.sin(clock.getElapsedTime() * 1.2) * 0.06;
    camera.lookAt(targetPos.current.x, 0.5, targetPos.current.z);
  });
  return null;
});

// ---------------------------------------------------------------------------
// HUDOverlay (DOM-based, not canvas)
// ---------------------------------------------------------------------------
const HUDOverlay = React.memo(({
  steps, currentStepIndex, safetyScore, remainingDistance,
  estimatedTime, onNext, onPrev, onClose
}) => {
  const step = steps?.[currentStepIndex];
  const total = steps?.length || 1;
  const progress = (currentStepIndex + 1) / total;
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex >= total - 1;
  const sc = safetyScore ?? null;
  const safetyColor = sc == null ? "#8cd69c" : sc >= 0.75 ? "#14b8a6" : sc >= 0.5 ? "#ffb347" : "#ff7b6b";
  const fmt = (m) => m >= 1000 ? `${(m/1000).toFixed(1)}km` : `${Math.round(m)}m`;
  const fmtT = (s) => s >= 3600 ? `${Math.floor(s/3600)}h${Math.round((s%3600)/60)}m` : `${Math.round(s/60)}min`;
  const getIcon = () => {
    if (step?.type === "transit") return "🚌";
    const t = (step?.instruction || "").toLowerCase();
    if (t.includes("left")) return "⬅️";
    if (t.includes("right")) return "➡️";
    if (t.includes("arrive")) return "🏁";
    return "⬆️";
  };
  return (
    <div style={{
      position: "absolute", bottom: 0, left: 0, right: 0,
      pointerEvents: "none",
      background: "linear-gradient(to top, rgba(4,8,12,0.96) 55%, transparent)",
      padding: "12px 16px 16px",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      zIndex: 30,
    }}>
      <div style={{ height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 2, marginBottom: 10, overflow: "hidden" }}>
        <div style={{
          width: `${progress * 100}%`, height: "100%",
          background: "linear-gradient(90deg, #0d9488, #14b8a6)", borderRadius: 2,
          transition: "width 0.4s cubic-bezier(0.22,1,0.36,1)"
        }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{
          fontSize: 9, fontWeight: 700, color: "#0d9488",
          background: "rgba(13,148,136,0.12)", border: "1px solid rgba(13,148,136,0.25)",
          borderRadius: 6, padding: "2px 8px", letterSpacing: "0.8px",
        }}>STEP {currentStepIndex + 1}/{total}</div>
        <div style={{ flex: 1 }} />
        {sc != null && <div style={{ fontSize: 10, fontWeight: 700, color: safetyColor }}>◉ {Math.round(sc * 100)}% safe</div>}
        {remainingDistance > 0 && (
          <div style={{ fontSize: 10, color: "rgba(241,245,249,0.5)" }}>
            {fmt(remainingDistance)} · {fmtT(estimatedTime)}
          </div>
        )}
        <button onClick={onClose} style={{
          pointerEvents: "auto", width: 24, height: 24, borderRadius: 12,
          border: "none", background: "rgba(255,255,255,0.08)",
          color: "rgba(255,255,255,0.55)", fontSize: 12, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>✕</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 20, flexShrink: 0,
          background: "rgba(13,148,136,0.15)", border: "1px solid rgba(13,148,136,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
        }}>{getIcon()}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", lineHeight: 1.35 }}>
            {step?.instruction || "Follow the route"}
          </div>
          {step?.distance && (
            <div style={{ fontSize: 11, color: "rgba(232,168,112,0.7)", marginTop: 2 }}>
              {step.distance}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, pointerEvents: "auto" }}>
        <button onClick={onPrev} disabled={isFirst} style={{
          flex: 1, padding: "8px", borderRadius: 14, border: "none",
          background: isFirst ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)",
          color: isFirst ? "rgba(255,255,255,0.2)" : "#f1f5f9",
          fontSize: 12, fontWeight: 600, cursor: isFirst ? "not-allowed" : "pointer",
        }}>← Prev</button>
        <button onClick={onNext} disabled={isLast} style={{
          flex: 2, padding: "8px", borderRadius: 14, border: "none",
          background: isLast ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg, #0d9488, #14b8a6)",
          color: isLast ? "rgba(255,255,255,0.2)" : "#fff",
          fontSize: 12, fontWeight: 700, cursor: isLast ? "not-allowed" : "pointer",
        }}>{isLast ? "🏁 Arrived" : "Next →"}</button>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// ErrBoundary
// ---------------------------------------------------------------------------
class ErrBoundary extends React.Component {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(error, info) {
    console.error("Walking3DView error:", error, info);
  }
  render() {
    if (this.state.err) return (
      <div style={{
        width: "100%", height: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0a0d12", color: "#e8a870",
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
          <div style={{ fontSize: 14, marginBottom: 16 }}>3D view encountered an error</div>
          <button
            onClick={() => this.setState({ err: false })}
            style={{
              padding: "8px 24px", background: "linear-gradient(135deg, #0d9488, #14b8a6)",
              border: "none", borderRadius: 20, color: "#fff",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >Retry</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function Walking3DView({
  route = [],
  routeSteps = [],
  currentStepIndex = 0,
  userPosition = null,
  navigationState = "idle",
  testMode = false,
  onTestPositionUpdate = null,
  onClose = () => {},
  style = {},
  hazards = [],
  constructionZones = [],
  emergencies = [],
  safetyScore = null,
  remainingDistance = 0,
  estimatedTime = 0,
  routeType = "walking",
  transitSegments = [],
  userHeading = 0,
  routeSafety = null,
}) {
  const posRef = useRef([0, 0]);
  const [progressIdx, setProgressIdx] = useState(0);
  const [internalStepIdx, setInternalStepIdx] = useState(currentStepIndex);
  const positionUpdateTimeout = useRef(null);
  
  useEffect(() => {
    setInternalStepIdx(currentStepIndex);
  }, [currentStepIndex]);
  
  useEffect(() => {
    _origin = null;
    _mLng = null;
    if (route.length) initOrigin(route[0][0], route[0][1]);
    else if (userPosition) initOrigin(userPosition[0], userPosition[1]);
  }, [route, userPosition]);

  const routeW = useMemo(() => {
    if (!_origin && route.length) initOrigin(route[0][0], route[0][1]);
    return route.map(([lat, lng]) => geo2w(lat, lng));
  }, [route]);
  
  const destW = useMemo(() => routeW.length ? routeW[routeW.length-1] : null, [routeW]);
  
  useEffect(() => {
    if (!userPosition) return;
    if (positionUpdateTimeout.current) clearTimeout(positionUpdateTimeout.current);
    positionUpdateTimeout.current = setTimeout(() => {
      posRef.current = geo2w(userPosition[0], userPosition[1]);
    }, 16);
    return () => { if (positionUpdateTimeout.current) clearTimeout(positionUpdateTimeout.current); };
  }, [userPosition]);

  useEffect(() => {
    if (!userPosition || !route.length) return;
    let best = 0, minD = Infinity;
    for (let i = 0; i < route.length; i++) {
      const d = Math.abs(route[i][0]-userPosition[0]) + Math.abs(route[i][1]-userPosition[1]);
      if (d < minD) { minD = d; best = i; }
    }
    setProgressIdx(best);
  }, [userPosition, route]);

  const handleNext = () => {
    if (internalStepIdx < routeSteps.length - 1) setInternalStepIdx(prev => prev + 1);
  };
  const handlePrev = () => {
    if (internalStepIdx > 0) setInternalStepIdx(prev => prev - 1);
  };
  
  return (
    <div style={{ position:"relative", width:"100%", height:"100%", background:"#000", borderRadius:16, overflow:"hidden", ...style }}>
      <ErrBoundary>
        <Canvas
          shadows
          dpr={[1, Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 1.5)]}
          frameloop="always"
          performance={{ min:0.5, max:1, debounce:200 }}
          camera={{ fov:45, near:0.5, far:300 }}
          style={{ width:"100%", height:"100%" }}
        >
          <Lighting />
          <EnhancedGround routeW={routeW} />
          <CityBlocks routeW={routeW} />
          {routeW.length > 1 && <RouteTube points={routeW} progressIdx={progressIdx} />}
          {destW && <DestinationMarker worldX={destW[0]} worldZ={destW[1]} />}
          {hazards.map((h, i) => <HazardMarker3D key={`hz-${i}`} worldX={geo2w(h.lat, h.lng)[0]} worldZ={geo2w(h.lat, h.lng)[1]} severity={h.severity} description={h.description} />)}
          <WalkerModel posRef={posRef} />
          <FollowCamera posRef={posRef} />
        </Canvas>
      </ErrBoundary>
      <HUDOverlay
        steps={routeSteps}
        currentStepIndex={internalStepIdx}
        safetyScore={safetyScore ?? routeSafety}
        remainingDistance={remainingDistance}
        estimatedTime={estimatedTime}
        onNext={handleNext}
        onPrev={handlePrev}
        onClose={onClose}
      />
    </div>
  );
}