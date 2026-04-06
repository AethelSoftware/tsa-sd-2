// Walking3DView.jsx - Optimized Version
import React, { useRef, useMemo, useCallback, useEffect, useState } from "react";
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
// Ground (dark/black)
// ---------------------------------------------------------------------------
const Ground = React.memo(() => {
  const geometry = useMemo(() => new THREE.PlaneGeometry(600, 600), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0a0a0a", roughness: 0.9, metalness: 0.05 }), []);
  
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow geometry={geometry} material={material} />
  );
});

// ---------------------------------------------------------------------------
// Route Path - Optimized
// ---------------------------------------------------------------------------
const RoutePath = React.memo(({ points, progressIdx }) => {
  const { lineGeometry, remainingGeometry } = useMemo(() => {
    if (points.length < 2) return { lineGeometry: null, remainingGeometry: null };
    
    // Completed path geometry
    const completedPositions = [];
    for (let i = 0; i <= progressIdx; i++) {
      completedPositions.push(points[i][0], 0.05, points[i][1]);
    }
    const completedGeom = new THREE.BufferGeometry();
    completedGeom.setAttribute("position", new THREE.Float32BufferAttribute(completedPositions, 3));
    
    // Remaining path geometry
    const remainingPoints = points.slice(progressIdx);
    let remainingGeom = null;
    if (remainingPoints.length > 1) {
      const remainingPositions = remainingPoints.flatMap(p => [p[0], 0.05, p[1]]);
      remainingGeom = new THREE.BufferGeometry();
      remainingGeom.setAttribute("position", new THREE.Float32BufferAttribute(remainingPositions, 3));
    }
    
    return { lineGeometry: completedGeom, remainingGeometry: remainingGeom };
  }, [points, progressIdx]);

  const completedMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: "#8B7355" }), []);
  const remainingMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: "#D4A574" }), []);

  return (
    <group>
      {lineGeometry && <line geometry={lineGeometry} material={completedMaterial} />}
      {remainingGeometry && <line geometry={remainingGeometry} material={remainingMaterial} />}
    </group>
  );
});

// ---------------------------------------------------------------------------
// Bus Model - Optimized
// ---------------------------------------------------------------------------
const BusModel = React.memo(({ position, rotationY }) => {
  const groupRef = useRef();
  const bodyMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8B4513", roughness: 0.5 }), []);
  const topMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#D2691E" }), []);
  const wheelMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1a0a04" }), []);
  
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.position.y = 0.15 + Math.sin(clock.getElapsedTime() * 3) * 0.015;
    }
  });
  
  const wheels = useMemo(() => {
    const wheelPositions = [];
    for (const x of [-0.5, 0.5]) {
      for (const z of [0.8, -0.8]) {
        wheelPositions.push(
          <mesh key={`${x}-${z}`} position={[x, 0.1, z]} castShadow>
            <cylinderGeometry args={[0.25, 0.25, 0.1, 8]} rotation={[Math.PI / 2, 0, 0]} />
            <primitive object={wheelMaterial} attach="material" />
          </mesh>
        );
      }
    }
    return wheelPositions;
  }, [wheelMaterial]);
  
  return (
    <group ref={groupRef} position={[position[0], 0.15, position[1]]} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.6, 2.2]} />
        <primitive object={bodyMaterial} attach="material" />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[1.1, 0.15, 2.1]} />
        <primitive object={topMaterial} attach="material" />
      </mesh>
      {wheels}
    </group>
  );
});

// ---------------------------------------------------------------------------
// User Marker - Optimized
// ---------------------------------------------------------------------------
const UserMarker = React.memo(({ posRef, isOnBus = false }) => {
  const groupRef = useRef();
  const walkCycle = useRef(0);
  const shadowMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.2 }), []);
  const bodyMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#D4A574" }), []);
  const headMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#E8C99B" }), []);
  
  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    g.position.x = damp(g.position.x, posRef.current[0], 12, dt);
    g.position.z = damp(g.position.z, posRef.current[1], 12, dt);
    if (!isOnBus) {
      walkCycle.current += dt * 8;
      g.position.y = 0.1 + Math.sin(walkCycle.current * 2) * 0.03;
    } else {
      g.position.y = 0.1;
    }
  });

  if (isOnBus) return null;
  
  return (
    <group ref={groupRef}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <circleGeometry args={[0.5, 8]} />
        <primitive object={shadowMaterial} attach="material" />
      </mesh>
      <mesh position={[0, 0.5, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.5, 4, 6]} />
        <primitive object={bodyMaterial} attach="material" />
      </mesh>
      <mesh position={[0, 0.85, 0]} castShadow>
        <sphereGeometry args={[0.2, 8, 8]} />
        <primitive object={headMaterial} attach="material" />
      </mesh>
    </group>
  );
});

// ---------------------------------------------------------------------------
// Destination marker - Optimized
// ---------------------------------------------------------------------------
const DestinationMarker = React.memo(({ worldX, worldZ }) => {
  const ref = useRef();
  const ringMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: "#8B7355", transparent: true, opacity: 0.3 }), []);
  const poleMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8B7355" }), []);
  const topMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#D4A574", emissive: "#D4A574", emissiveIntensity: 0.2 }), []);
  
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 2;
  });
  
  return (
    <group position={[worldX, 0, worldZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.8, 1.2, 16]} />
        <primitive object={ringMaterial} attach="material" />
      </mesh>
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.08, 0.12, 2.4, 6]} />
        <primitive object={poleMaterial} attach="material" />
      </mesh>
      <mesh ref={ref} position={[0, 2.5, 0]}>
        <octahedronGeometry args={[0.5, 0]} />
        <primitive object={topMaterial} attach="material" />
      </mesh>
    </group>
  );
});

// ---------------------------------------------------------------------------
// Camera - Optimized
// ---------------------------------------------------------------------------
const NavCamera = React.memo(({ posRef }) => {
  const { camera } = useThree();
  const targetPos = useRef({ x: 0, z: 0 });
  const ready = useRef(false);
  
  useFrame((_, dt) => {
    const px = posRef.current[0];
    const pz = posRef.current[1];
    
    targetPos.current.x = damp(targetPos.current.x || px, px, 4, dt);
    targetPos.current.z = damp(targetPos.current.z || pz, pz, 4, dt);
    
    const targetX = targetPos.current.x + 12;
    const targetZ = targetPos.current.z + 12;
    
    if (!ready.current) {
      camera.position.set(targetX, 14, targetZ);
      camera.lookAt(px, 0, pz);
      ready.current = true;
      return;
    }
    
    camera.position.x = damp(camera.position.x, targetX, 4, dt);
    camera.position.z = damp(camera.position.z, targetZ, 4, dt);
    camera.lookAt(targetPos.current.x, 0, targetPos.current.z);
  });
  
  return null;
});

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const Scene = React.memo(({ routeW, destW, posRef, progressIdx, busPosition, busRotation, isOnBus, showBus }) => {
  const ambientLight = useMemo(() => new THREE.AmbientLight(0xffffff, 0.5), []);
  const directionalLight = useMemo(() => {
    const light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(20, 30, 10);
    light.castShadow = true;
    return light;
  }, []);
  
  return (
    <>
      <primitive object={ambientLight} />
      <primitive object={directionalLight} />
      <Ground />
      {routeW.length > 1 && <RoutePath points={routeW} progressIdx={progressIdx} />}
      {destW && <DestinationMarker worldX={destW[0]} worldZ={destW[1]} />}
      {showBus && busPosition && <BusModel position={busPosition} rotationY={busRotation} />}
      <UserMarker posRef={posRef} isOnBus={isOnBus} />
      <NavCamera posRef={posRef} />
    </>
  );
});

// ---------------------------------------------------------------------------
// Directions Panel - Optimized with memo
// ---------------------------------------------------------------------------
const DirectionsPanel = React.memo(({ steps, currentStepIndex, onNext, onPrev, onClose }) => {
  const currentStep = steps?.[currentStepIndex];
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === (steps?.length || 1) - 1;
  
  const getStepIcon = useCallback((step) => {
    if (step?.type === "transit") return "🚌";
    const instr = step?.instruction?.toLowerCase() || "";
    if (instr.includes("left")) return "⬅️";
    if (instr.includes("right")) return "➡️";
    if (instr.includes("walk")) return "🚶";
    if (instr.includes("arrive")) return "🏁";
    return "📍";
  }, []);
  
  const getStepColor = useCallback((step) => {
    if (step?.type === "transit") return "#A0522D";
    if (step?.instruction?.toLowerCase().includes("arrive")) return "#8B7355";
    return "#D4A574";
  }, []);
  
  const handleStepClick = useCallback((idx) => {
    if (idx > currentStepIndex) onNext(idx - currentStepIndex);
    else if (idx < currentStepIndex) onPrev(currentStepIndex - idx);
  }, [currentStepIndex, onNext, onPrev]);
  
  return (
    <div style={{
      position: "absolute",
      bottom: 16,
      left: 16,
      right: 16,
      background: "rgba(0, 0, 0, 0.95)",
      backdropFilter: "blur(16px)",
      borderRadius: 20,
      padding: "10px 16px",
      pointerEvents: "auto",
      border: "1px solid rgba(210, 165, 115, 0.2)",
      zIndex: 30,
    }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ height: 2, background: "rgba(210, 165, 115, 0.2)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            width: `${((currentStepIndex + 1) / (steps?.length || 1)) * 100}%`,
            height: "100%",
            background: getStepColor(currentStep),
            transition: "width 0.2s ease",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, color: "rgba(210, 165, 115, 0.5)" }}>
          <span>Step {currentStepIndex + 1} / {steps?.length || 1}</span>
        </div>
      </div>
      
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 20,
          background: getStepColor(currentStep),
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20,
        }}>
          {getStepIcon(currentStep)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#F5E6D3", lineHeight: 1.3 }}>
            {currentStep?.instruction || "Follow the route"}
          </div>
          {currentStep?.distance && (
            <div style={{ fontSize: 10, color: "rgba(210, 165, 115, 0.7)", marginTop: 1 }}>
              {currentStep.distance}
            </div>
          )}
        </div>
      </div>
      
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onPrev} disabled={isFirst} style={{
          flex: 1, padding: "6px", borderRadius: 16,
          background: isFirst ? "rgba(210, 165, 115, 0.1)" : "rgba(210, 165, 115, 0.2)",
          border: "none", color: isFirst ? "rgba(210, 165, 115, 0.3)" : "#F5E6D3",
          fontSize: 11, fontWeight: 600, cursor: isFirst ? "not-allowed" : "pointer",
        }}>←</button>
        <button onClick={onNext} disabled={isLast} style={{
          flex: 1, padding: "6px", borderRadius: 16,
          background: isLast ? "rgba(210, 165, 115, 0.1)" : getStepColor(currentStep),
          border: "none", color: isLast ? "rgba(210, 165, 115, 0.3)" : "#0a0a0a",
          fontSize: 11, fontWeight: 600, cursor: isLast ? "not-allowed" : "pointer",
        }}>{isLast ? "🏁" : "→"}</button>
      </div>
      
      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 9, color: "rgba(210, 165, 115, 0.4)", cursor: "pointer", textAlign: "center", padding: "4px" }}>
          All steps
        </summary>
        <div style={{ marginTop: 8, maxHeight: 120, overflowY: "auto" }}>
          {steps?.map((step, idx) => (
            <div key={idx} onClick={() => handleStepClick(idx)} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", marginBottom: 4,
              borderRadius: 12, background: idx === currentStepIndex ? "rgba(210, 165, 115, 0.15)" : "rgba(255,255,255,0.02)",
              cursor: "pointer",
            }}>
              <div style={{ width: 24, height: 24, borderRadius: 12, background: getStepColor(step), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>
                {getStepIcon(step)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#F5E6D3" }}>{step.instruction?.substring(0, 35)}</div>
              </div>
              {idx === currentStepIndex && <div style={{ fontSize: 8, color: "#D4A574" }}>●</div>}
            </div>
          ))}
        </div>
      </details>
      
      <button onClick={onClose} style={{
        position: "absolute", top: 8, right: 8, width: 24, height: 24, borderRadius: 12,
        background: "rgba(210, 165, 115, 0.15)", border: "none", color: "#D4A574", fontSize: 12, cursor: "pointer",
      }}>✕</button>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.currentStepIndex === nextProps.currentStepIndex &&
         prevProps.steps?.length === nextProps.steps?.length;
});

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------
class ErrBoundary extends React.Component {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() {
    if (this.state.err) return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#000", color: "#D4A574" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🗺️</div>
          <div>Loading 3D view...</div>
          <button onClick={() => this.setState({ err: false })} style={{ marginTop: 16, padding: "8px 24px", background: "#D4A574", border: "none", borderRadius: 20, color: "#000", cursor: "pointer" }}>Retry</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Main Export - Optimized
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
}) {
  const [isOnBus, setIsOnBus] = useState(false);
  const [busPosition, setBusPosition] = useState(null);
  const [busRotation, setBusRotation] = useState(0);
  const [showBus, setShowBus] = useState(false);
  const [localStepIndex, setLocalStepIndex] = useState(currentStepIndex);
  const animationRef = useRef(null);
  const posRef = useRef([0, 0]);
  const [progressIdx, setProgressIdx] = useState(0);
  const positionUpdateTimeout = useRef(null);
  
  // Initialize origin
  useEffect(() => {
    _origin = null;
    _mLng = null;
    if (route.length) initOrigin(route[0][0], route[0][1]);
    else if (userPosition) initOrigin(userPosition[0], userPosition[1]);
  }, [route, userPosition]);

  // Compute world coordinates with proper dependencies
  const routeW = useMemo(() => {
    if (!_origin && route.length) initOrigin(route[0][0], route[0][1]);
    return route.map(([lat, lng]) => geo2w(lat, lng));
  }, [route]);
  
  const destW = useMemo(() => routeW.length ? routeW[routeW.length - 1] : null, [routeW]);
  
  // Throttled position updates
  useEffect(() => {
    if (!userPosition) return;
    
    if (positionUpdateTimeout.current) {
      clearTimeout(positionUpdateTimeout.current);
    }
    
    positionUpdateTimeout.current = setTimeout(() => {
      posRef.current = geo2w(userPosition[0], userPosition[1]);
    }, 16);
    
    return () => {
      if (positionUpdateTimeout.current) {
        clearTimeout(positionUpdateTimeout.current);
      }
    };
  }, [userPosition]);

  // Optimized progress index calculation
  useEffect(() => {
    if (!userPosition || !route.length) return;
    
    let best = 0, minD = Infinity;
    for (let i = 0; i < route.length; i++) {
      const d = Math.abs(route[i][0] - userPosition[0]) + Math.abs(route[i][1] - userPosition[1]);
      if (d < minD) { minD = d; best = i; }
    }
    setProgressIdx(best);
  }, [userPosition, route]);

  const currentStep = routeSteps[localStepIndex];
  const isTransitStep = currentStep?.type === "transit";
  
  // Create spatial index for route points
  const routeIndex = useMemo(() => {
    const index = new Map();
    routeW.forEach((point, idx) => {
      const key = `${Math.round(point[0] / 5)}_${Math.round(point[1] / 5)}`;
      index.set(key, { point, idx });
    });
    return index;
  }, [routeW]);
  
  // Find nearest route point
  const findNearestRoutePoint = useCallback((targetW) => {
    const key = `${Math.round(targetW[0] / 5)}_${Math.round(targetW[1] / 5)}`;
    if (routeIndex.has(key)) return routeIndex.get(key).point;
    
    // Fallback to linear search if not found in index
    let nearest = null;
    let minDist = Infinity;
    for (const point of routeW) {
      const dist = Math.hypot(point[0] - targetW[0], point[1] - targetW[1]);
      if (dist < minDist) {
        minDist = dist;
        nearest = point;
      }
    }
    return nearest;
  }, [routeIndex, routeW]);
  
  // Bus animation effect
  useEffect(() => {
    if (isTransitStep && !isOnBus && currentStep?.start_location && currentStep?.end_location) {
      setIsOnBus(true);
      setShowBus(true);
      
      const fromStop = currentStep.start_location;
      const toStop = currentStep.end_location;
      
      const fromPointW = geo2w(fromStop.lat, fromStop.lon);
      const toPointW = geo2w(toStop.lat, toStop.lon);
      
      const fromPoint = findNearestRoutePoint(fromPointW) || routeW[Math.min(progressIdx + 5, routeW.length - 1)];
      const toPoint = findNearestRoutePoint(toPointW) || routeW[Math.min(progressIdx + 30, routeW.length - 1)];
      
      if (fromPoint && toPoint) {
        setBusPosition([fromPoint[0], fromPoint[1]]);
        setBusRotation(Math.atan2(toPoint[0] - fromPoint[0], toPoint[1] - fromPoint[1]));
        
        const startPos = [...fromPoint];
        const endPos = [...toPoint];
        const startTime = performance.now();
        const duration = 2000;
        let animationFrameId = null;
        
        const animate = () => {
          if (!animationRef.current) return;
          const now = performance.now();
          const t = Math.min(1, (now - startTime) / duration);
          setBusPosition([
            startPos[0] + (endPos[0] - startPos[0]) * t,
            startPos[1] + (endPos[1] - startPos[1]) * t
          ]);
          
          if (t < 1) {
            animationFrameId = requestAnimationFrame(animate);
            animationRef.current = animationFrameId;
          } else {
            setShowBus(false);
            if (onTestPositionUpdate) onTestPositionUpdate([toStop.lat, toStop.lon]);
            setTimeout(() => setIsOnBus(false), 300);
            animationRef.current = null;
          }
        };
        
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
        animationFrameId = requestAnimationFrame(animate);
        animationRef.current = animationFrameId;
      }
    }
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isTransitStep, localStepIndex, findNearestRoutePoint, routeW, progressIdx, onTestPositionUpdate, isOnBus]);

  const handleNextStep = useCallback(() => {
    if (localStepIndex < (routeSteps?.length || 1) - 1) {
      setLocalStepIndex(prev => prev + 1);
    }
  }, [localStepIndex, routeSteps?.length]);

  const handlePrevStep = useCallback(() => {
    if (localStepIndex > 0) {
      setLocalStepIndex(prev => prev - 1);
    }
  }, [localStepIndex]);

  const testIdxRef = useRef(0);
  const advanceTest = useCallback(() => {
    if (!route.length || isOnBus) return;
    const next = testIdxRef.current + 1;
    if (next >= route.length) return;
    testIdxRef.current = next;
    const pt = route[next];
    if (onTestPositionUpdate) onTestPositionUpdate(pt);
    posRef.current = geo2w(pt[0], pt[1]);
    setProgressIdx(next);
  }, [route, onTestPositionUpdate, isOnBus]);

  useEffect(() => {
    if (!testMode) return;
    const handler = (e) => {
      if ((e.key === "ArrowUp" || e.key === "w" || e.key === "W") && !isOnBus) {
        e.preventDefault();
        advanceTest();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [testMode, advanceTest, isOnBus]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#000", borderRadius: 16, overflow: "hidden", ...style }}>
      <ErrBoundary>
        <Canvas 
          shadows 
          dpr={[1, 1.5]} 
          frameloop="always"
          performance={{ min: 0.5 }}
          camera={{ fov: 45, near: 0.5, far: 300 }}
          style={{ width: "100%", height: "100%" }}
        >
          <Scene 
            routeW={routeW} 
            destW={destW} 
            posRef={posRef} 
            progressIdx={progressIdx} 
            busPosition={busPosition} 
            busRotation={busRotation} 
            isOnBus={isOnBus} 
            showBus={showBus} 
          />
        </Canvas>
      </ErrBoundary>
      <DirectionsPanel 
        steps={routeSteps} 
        currentStepIndex={localStepIndex} 
        onNext={handleNextStep} 
        onPrev={handlePrevStep} 
        onClose={onClose} 
      />
    </div>
  );
}