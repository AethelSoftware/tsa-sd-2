import React, {
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useState,
  Suspense,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";


// Constants
const SCALE = 1 / 2;
const M_LAT = 111139;
const ROAD_WIDTH = 4.5;
const SIDEWALK_WIDTH = 1.8;
const MAX_BUILDINGS = 40; // desktop
const MOBILE_MAX_BUILDINGS = 20;


// Geo conversion (instance‑scoped, not module‑level)
function useGeoConversion() {
  const originRef = useRef(null);
  const mLngRef = useRef(null);

  const initOrigin = useCallback((lat, lng) => {
    originRef.current = { lat, lng };
    mLngRef.current = M_LAT * Math.cos((lat * Math.PI) / 180);
  }, []);

  const geo2w = useCallback((lat, lng) => {
    if (!originRef.current) return [0, 0];
    const dy = -(lat - originRef.current.lat) * M_LAT * SCALE;
    const dx = (lng - originRef.current.lng) * mLngRef.current * SCALE;
    return [dx, dy];
  }, []);

  const resetOrigin = useCallback(() => {
    originRef.current = null;
    mLngRef.current = null;
  }, []);

  return { initOrigin, geo2w, resetOrigin };
}

// Time-of-day lighting (Patch 1)
function useTimeOfDay() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 10)
    return {
      ambientIntensity: 0.55,
      ambientColor: "#ffd4a0",
      skyColor: "#ffb080",
      groundColor: "#3d2a1a",
      dirColor: "#ffcc88",
      dirIntensity: 0.7,
      fogColor: "#ffb36644",
      label: "dawn",
    };
  if (hour >= 10 && hour < 17)
    return {
      ambientIntensity: 0.85,
      ambientColor: "#e8f4ff",
      skyColor: "#7ec8e3",
      groundColor: "#4a4a3a",
      dirColor: "#fffde0",
      dirIntensity: 1.1,
      fogColor: "#c8e8ff22",
      label: "day",
    };
  if (hour >= 17 && hour < 20)
    return {
      ambientIntensity: 0.45,
      ambientColor: "#ffb080",
      skyColor: "#e07050",
      groundColor: "#2a1a10",
      dirColor: "#ff9966",
      dirIntensity: 0.55,
      fogColor: "#e0704044",
      label: "dusk",
    };
  return {
    ambientIntensity: 0.18,
    ambientColor: "#9090cc",
    skyColor: "#1a2a4a",
    groundColor: "#0a0a18",
    dirColor: "#aabbff",
    dirIntensity: 0.25,
    fogColor: "#1a2a4a88",
    label: "night",
  };
}

const Lighting = React.memo(() => {
  const tod = useTimeOfDay();
  return (
    <>
      <fog attach="fog" args={[tod.fogColor, 60, 220]} />
      <ambientLight intensity={tod.ambientIntensity} color={tod.ambientColor} />
      <hemisphereLight
        skyColor={tod.skyColor}
        groundColor={tod.groundColor}
        intensity={0.7}
      />
      <directionalLight
        position={[30, 25, 20]}
        intensity={tod.dirIntensity}
        color={tod.dirColor}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={150}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      {tod.label === "night" && (
        <pointLight
          position={[0, 4, 0]}
          intensity={0.6}
          color="#ffeeaa"
          distance={80}
          decay={2}
        />
      )}
    </>
  );
});

// Road segments, sidewalks, dashes built from the actual route polyline (with brighter materials)
const RoadNetwork = React.memo(({ routeW }) => {
  const segments = useMemo(() => {
    if (!routeW.length)
      return {
        roadMeshes: [],
        leftSidewalks: [],
        rightSidewalks: [],
        dashGroups: [],
      };

    const roadMat = new THREE.MeshStandardMaterial({
      color: "#2a2a2a",
      roughness: 0.75,
    });
    const sidewalkMat = new THREE.MeshStandardMaterial({
      color: "#3a3530",
      roughness: 0.85,
    });
    const dashMat = new THREE.MeshStandardMaterial({
      color: "#cccc88",
      roughness: 0.5,
    });

    const roadMeshes = [];
    const leftSidewalks = [];
    const rightSidewalks = [];
    const dashGroups = [];

    for (let i = 0; i < routeW.length - 1; i++) {
      const p0 = routeW[i];
      const p1 = routeW[i + 1];
      const dx = p1[0] - p0[0];
      const dz = p1[1] - p0[1];
      const length = Math.hypot(dx, dz);
      if (length < 0.01) continue;

      const angle = Math.atan2(dz, dx);
      const midpoint = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];

      // Road segment
      const roadGeo = new THREE.BoxGeometry(length, 0.1, ROAD_WIDTH);
      roadMeshes.push(
        <mesh
          key={`road-${i}`}
          position={[midpoint[0], 0, midpoint[1]]}
          rotation={[0, angle, 0]}
          geometry={roadGeo}
          material={roadMat}
          receiveShadow
          castShadow
        />,
      );

      // Sidewalks (left and right)
      const perp = angle + Math.PI / 2;
      const offset = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2;
      const leftX = midpoint[0] + Math.cos(perp) * offset;
      const leftZ = midpoint[1] + Math.sin(perp) * offset;
      const sideGeo = new THREE.BoxGeometry(length, 0.1, SIDEWALK_WIDTH);
      leftSidewalks.push(
        <mesh
          key={`side-left-${i}`}
          position={[leftX, 0.05, leftZ]}
          rotation={[0, angle, 0]}
          geometry={sideGeo}
          material={sidewalkMat}
          receiveShadow
          castShadow
        />,
      );
      const rightX = midpoint[0] - Math.cos(perp) * offset;
      const rightZ = midpoint[1] - Math.sin(perp) * offset;
      rightSidewalks.push(
        <mesh
          key={`side-right-${i}`}
          position={[rightX, 0.05, rightZ]}
          rotation={[0, angle, 0]}
          geometry={sideGeo}
          material={sidewalkMat}
          receiveShadow
          castShadow
        />,
      );

      // Center dashes
      const dashCount = Math.max(1, Math.floor(length / 3.5));
      for (let d = 0; d <= dashCount; d++) {
        const t = d / dashCount;
        const x = p0[0] + dx * t;
        const z = p0[1] + dz * t;
        const dashGeo = new THREE.BoxGeometry(0.55, 0.05, 1.2);
        dashGroups.push(
          <mesh
            key={`dash-${i}-${d}`}
            position={[x, 0.03, z]}
            rotation={[0, angle, 0]}
            geometry={dashGeo}
            material={dashMat}
          />,
        );
      }
    }

    return { roadMeshes, leftSidewalks, rightSidewalks, dashGroups };
  }, [routeW]);

  return (
    <group>
      {segments.roadMeshes}
      {segments.leftSidewalks}
      {segments.rightSidewalks}
      {segments.dashGroups}
    </group>
  );
});

// Buildings scattered along the full route (procedural)
const CityBlocks = React.memo(({ routeW, seed = 42 }) => {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
  const maxCount = isMobile ? MOBILE_MAX_BUILDINGS : MAX_BUILDINGS;

  const buildings = useMemo(() => {
    if (!routeW.length) return [];

    let rng = seed;
    const lcg = () => {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return (rng >>> 0) / 0xffffffff;
    };

    const buildingList = [];
    // For each segment, scatter N buildings based on segment length
    for (
      let segIdx = 0;
      segIdx < routeW.length - 1 && buildingList.length < maxCount;
      segIdx++
    ) {
      const p0 = routeW[segIdx];
      const p1 = routeW[segIdx + 1];
      const dxSeg = p1[0] - p0[0];
      const dzSeg = p1[1] - p0[1];
      const segLen = Math.hypot(dxSeg, dzSeg);
      if (segLen < 5) continue;
      const buildingsOnSeg = Math.min(Math.ceil(segLen / 35), 4);
      for (
        let b = 0;
        b < buildingsOnSeg && buildingList.length < maxCount;
        b++
      ) {
        const t = lcg(); // random position along segment
        const alongX = p0[0] + dxSeg * t;
        const alongZ = p0[1] + dzSeg * t;
        const side = lcg() > 0.5 ? 1 : -1;
        const offsetDist = 14 + lcg() * 36; // meters offset from road center
        const angleSeg = Math.atan2(dzSeg, dxSeg);
        const perp = angleSeg + Math.PI / 2;
        const offsetX = alongX + Math.cos(perp) * offsetDist * side;
        const offsetZ = alongZ + Math.sin(perp) * offsetDist * side;

        const w = 4 + lcg() * 8;
        const d = 4 + lcg() * 8;
        const h = 6 + lcg() * 34;
        const gray = Math.floor(10 + lcg() * 12)
          .toString(16)
          .padStart(2, "0");
        const color = `#${gray}${gray}${Math.floor(parseInt(gray, 16) * 1.4)
          .toString(16)
          .padStart(2, "0")}`;
        const windowColor = lcg() > 0.5 ? "#e8a870" : "#14b8a6";
        buildingList.push({
          w,
          d,
          h,
          x: offsetX,
          z: offsetZ,
          color,
          windowColor,
        });
      }
    }

    // if still insufficient, fill with random around middle points
    if (buildingList.length < maxCount / 2) {
      const midPt = routeW[Math.floor(routeW.length / 2)];
      for (let i = buildingList.length; i < maxCount; i++) {
        const side = lcg() > 0.5 ? 1 : -1;
        const offset = 18 + lcg() * 42;
        const x = midPt[0] + side * offset;
        const z = midPt[1] + (lcg() - 0.5) * 120;
        const w = 4 + lcg() * 8;
        const d = 4 + lcg() * 8;
        const h = 6 + lcg() * 34;
        const gray = Math.floor(10 + lcg() * 12)
          .toString(16)
          .padStart(2, "0");
        const color = `#${gray}${gray}${Math.floor(parseInt(gray, 16) * 1.4)
          .toString(16)
          .padStart(2, "0")}`;
        const windowColor = lcg() > 0.5 ? "#e8a870" : "#14b8a6";
        buildingList.push({ w, d, h, x, z, color, windowColor });
      }
    }

    return buildingList.slice(0, maxCount);
  }, [routeW, seed, maxCount]);

  const sharedWindowMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 0.9,
        emissiveIntensity: 0.45,
      }),
    [],
  );

  return (
    <group>
      {buildings.map((b, i) => {
        const rowCount = Math.min(3, Math.floor(b.h / 4));
        const colCount = Math.min(2, Math.floor(b.w / 3));
        return (
          <group key={i} position={[b.x, 0, b.z]}>
            <mesh position={[0, b.h / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[b.w, b.h, b.d]} />
              <meshStandardMaterial
                color={b.color}
                roughness={0.85}
                metalness={0.05}
              />
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
                    position={[
                      (col - colCount / 2 + 0.5) * 2.2,
                      2 + row * 4,
                      b.d / 2 + 0.06,
                    ]}
                  >
                    <boxGeometry args={[0.7, 1.1, 0.05]} />
                    <meshStandardMaterial
                      color={b.windowColor}
                      emissive={b.windowColor}
                      {...sharedWindowMat}
                    />
                  </mesh>
                );
              }),
            )}
          </group>
        );
      })}
    </group>
  );
});

// Real buildings from Overpass API (unchanged)
const RealBuildings = React.memo(({ routeW, geo2w }) => {
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!routeW.length) return;
    setLoading(true);
    setError(false);
    const bbox = computeBboxFromRoute(routeW, geo2w);
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=[out:json];way["building"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});out geom;`;
    fetch(overpassUrl)
      .then((res) => res.json())
      .then((data) => {
        if (!data.elements) throw new Error("No buildings");
        const parsed = data.elements.slice(0, 150).map((way) => {
          let minX = Infinity,
            maxX = -Infinity,
            minZ = Infinity,
            maxZ = -Infinity;
          if (way.geometry) {
            way.geometry.forEach((p) => {
              const [wx, wz] = geo2w(p.lat, p.lon);
              minX = Math.min(minX, wx);
              maxX = Math.max(maxX, wx);
              minZ = Math.min(minZ, wz);
              maxZ = Math.max(maxZ, wz);
            });
          }
          const width = Math.max(2, maxX - minX || 4);
          const depth = Math.max(2, maxZ - minZ || 4);
          const centerX = (minX + maxX) / 2;
          const centerZ = (minZ + maxZ) / 2;
          let levels = way.tags?.["building:levels"] || way.tags?.height;
          let height = 5;
          if (levels && !isNaN(parseFloat(levels)))
            height = parseFloat(levels) * 3.2;
          else if (levels && levels.includes(";")) height = 8;
          else height = 4 + Math.random() * 18;
          const color = "#4a4e5c";
          const windowColor = "#f5c27b";
          return {
            w: width,
            d: depth,
            h: height,
            x: centerX,
            z: centerZ,
            color,
            windowColor,
          };
        });
        setBuildings(parsed);
      })
      .catch((err) => {
        console.warn("Overpass fetch failed", err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [routeW, geo2w]);

  if (loading)
    return (
      <group>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[1, 1, 1]}>
            <meshStandardMaterial color="white" />
          </boxGeometry>
        </mesh>
      </group>
    );
  if (error || !buildings.length) return null;

  const sharedMat = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.4 }),
    [],
  );
  return (
    <group>
      {buildings.map((b, i) => (
        <mesh key={i} position={[b.x, b.h / 2, b.z]} castShadow receiveShadow>
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshStandardMaterial
            color={b.color}
            roughness={0.7}
            metalness={0.2}
          />
        </mesh>
      ))}
    </group>
  );
});

function computeBboxFromRoute(routeW, geo2wInv) {
  let minLat = 90,
    maxLat = -90,
    minLng = 180,
    maxLng = -180;
  // dummy - in reality we'd need reverse conversion, but we'll expand from midpoint
  const midX = routeW.reduce((s, p) => s + p[0], 0) / routeW.length;
  const midZ = routeW.reduce((s, p) => s + p[1], 0) / routeW.length;
  const expand = 0.03;
  return {
    minLat: midZ - expand,
    maxLat: midZ + expand,
    minLng: midX - expand,
    maxLng: midX + expand,
  };
}

// RouteTube (unchanged)
const RouteTube = React.memo(({ points, progressIdx }) => {
  const completedCurve = useMemo(() => {
    if (points.length < 2 || progressIdx < 1) return null;
    const p = points
      .slice(0, progressIdx + 1)
      .map((pt) => new THREE.Vector3(pt[0], 0.15, pt[1]));
    return new THREE.CatmullRomCurve3(p);
  }, [points, progressIdx]);
  const remainingCurve = useMemo(() => {
    if (points.length < 2 || progressIdx >= points.length - 1) return null;
    const p = points
      .slice(progressIdx)
      .map((pt) => new THREE.Vector3(pt[0], 0.15, pt[1]));
    return new THREE.CatmullRomCurve3(p);
  }, [points, progressIdx]);
  const completedMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#8B7355", roughness: 0.6 }),
    [],
  );
  const remainingMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#14b8a6",
        emissive: "#0d9488",
        emissiveIntensity: 0.15,
        roughness: 0.4,
      }),
    [],
  );
  return (
    <group>
      {completedCurve && (
        <mesh>
          <tubeGeometry
            args={[
              completedCurve,
              Math.min(completedCurve.points.length * 4, 200),
              0.12,
              6,
              false,
            ]}
          />
          <primitive object={completedMat} attach="material" />
        </mesh>
      )}
      {remainingCurve && (
        <mesh>
          <tubeGeometry
            args={[
              remainingCurve,
              Math.min(remainingCurve.points.length * 4, 200),
              0.18,
              6,
              false,
            ]}
          />
          <primitive object={remainingMat} attach="material" />
        </mesh>
      )}
    </group>
  );
});

// HazardMarker3D (existing)
const HazardMarker3D = React.memo(({ worldX, worldZ, severity = 0.7 }) => {
  const ringRef = useRef();
  const color =
    severity >= 0.8 ? "#ff4444" : severity >= 0.6 ? "#ffb347" : "#ffee44";
  useFrame(({ clock }) => {
    if (ringRef.current) {
      const t = (clock.getElapsedTime() % 2) / 2;
      const scale = 0.5 + t * 2.5;
      ringRef.current.scale.setScalar(scale);
      ringRef.current.material.opacity = Math.max(0, 1 - t);
    }
  });
  const poleMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
      }),
    [color],
  );
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      }),
    [color],
  );
  const topMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
      }),
    [color],
  );
  return (
    <group position={[worldX, 0, worldZ]}>
      <mesh
        ref={ringRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
      >
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

// ConstructionMarker3D (unchanged)
const ConstructionMarker3D = React.memo(({ worldX, worldZ }) => {
  const lightRef = useRef();
  const ringRef = useRef();
  useFrame(({ clock }) => {
    if (lightRef.current) {
      const intensity = 0.6 + Math.sin(clock.getElapsedTime() * 4) * 0.3;
      lightRef.current.intensity = intensity;
    }
    if (ringRef.current) {
      const t = (clock.getElapsedTime() % 1.5) / 1.5;
      ringRef.current.scale.setScalar(0.8 + t * 1.8);
      ringRef.current.material.opacity = 0.5 - t * 0.3;
    }
  });
  const barrierMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#ff7b2e", roughness: 0.4 }),
    [],
  );
  const stripeMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#1a1a1a" }),
    [],
  );
  return (
    <group position={[worldX, 0, worldZ]}>
      <mesh
        ref={ringRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
      >
        <ringGeometry args={[0.6, 1.8, 16]} />
        <meshBasicMaterial
          color="#ff7b2e"
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0.6, 0]} castShadow>
        <boxGeometry args={[2.2, 1.1, 0.4]} />
        <primitive object={barrierMat} attach="material" />
      </mesh>
      <mesh position={[0, 0.6, 0.21]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[2.4, 0.25, 0.05]} />
        <primitive object={stripeMat} attach="material" />
      </mesh>
      <mesh position={[0, 0.6, -0.21]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[2.4, 0.25, 0.05]} />
        <primitive object={stripeMat} attach="material" />
      </mesh>
      <mesh position={[-1.0, 0.6, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 1.1, 6]} />
        <meshStandardMaterial color="#aa5500" />
      </mesh>
      <mesh position={[1.0, 0.6, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 1.1, 6]} />
        <meshStandardMaterial color="#aa5500" />
      </mesh>
      <pointLight
        ref={lightRef}
        position={[0, 1.2, 0]}
        color="#ff7b2e"
        distance={12}
        intensity={0.6}
      />
    </group>
  );
});

// EmergencyMarker3D (unchanged)
const EmergencyMarker3D = React.memo(
  ({ worldX, worldZ, type = "accident" }) => {
    const ringRef = useRef();
    const leftLightRef = useRef();
    const rightLightRef = useRef();
    const pointLightRef = useRef();
    useFrame(({ clock }) => {
      const t = clock.getElapsedTime();
      const flash = Math.sin(t * 8) > 0;
      if (leftLightRef.current && rightLightRef.current) {
        leftLightRef.current.material.emissiveIntensity = flash ? 1.2 : 0.1;
        rightLightRef.current.material.emissiveIntensity = flash ? 0.1 : 1.2;
      }
      if (pointLightRef.current) {
        pointLightRef.current.intensity = flash ? 0.9 : 0.3;
        pointLightRef.current.color.setHex(flash ? 0xff3333 : 0x3366ff);
      }
      if (ringRef.current) {
        const s = 0.6 + Math.sin(t * 6) * 0.4;
        ringRef.current.scale.setScalar(s);
        ringRef.current.material.opacity = 0.4 + Math.sin(t * 12) * 0.2;
      }
    });
    const poleMat = useMemo(
      () => new THREE.MeshStandardMaterial({ color: "#cc0000" }),
      [],
    );
    const sphereMatRed = useMemo(
      () =>
        new THREE.MeshStandardMaterial({
          color: "#ff2222",
          emissive: "#ff2222",
          emissiveIntensity: 0.6,
        }),
      [],
    );
    const sphereMatBlue = useMemo(
      () =>
        new THREE.MeshStandardMaterial({
          color: "#2266ff",
          emissive: "#2266ff",
          emissiveIntensity: 0.6,
        }),
      [],
    );
    return (
      <group position={[worldX, 0, worldZ]}>
        <mesh
          ref={ringRef}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
        >
          <ringGeometry args={[0.7, 2.0, 16]} />
          <meshBasicMaterial
            color="#ff6666"
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 1.5, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.1, 3.0, 6]} />
          <primitive object={poleMat} attach="material" />
        </mesh>
        <mesh ref={leftLightRef} position={[-0.4, 2.8, 0]}>
          <sphereGeometry args={[0.28, 12]} />
          <primitive object={sphereMatRed} attach="material" />
        </mesh>
        <mesh ref={rightLightRef} position={[0.4, 2.8, 0]}>
          <sphereGeometry args={[0.28, 12]} />
          <primitive object={sphereMatBlue} attach="material" />
        </mesh>
        <pointLight
          ref={pointLightRef}
          position={[0, 2.6, 0]}
          distance={15}
          intensity={0.5}
        />
      </group>
    );
  },
);

// WalkerModel (unchanged)
const WalkerModel = React.memo(({ posRef, directionAngle = 0 }) => {
  const groupRef = useRef();
  const leftArmRef = useRef();
  const rightArmRef = useRef();
  const headRef = useRef();
  const walkCycle = useRef(0);
  const shadowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#000",
        transparent: true,
        opacity: 0.2,
      }),
    [],
  );
  const skinMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#D4A574", roughness: 0.7 }),
    [],
  );
  const shirtMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#0d9488", roughness: 0.6 }),
    [],
  );
  const pantsMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#1a2535", roughness: 0.7 }),
    [],
  );
  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    g.position.x += (posRef.current[0] - g.position.x) * 0.25;
    g.position.z += (posRef.current[1] - g.position.z) * 0.25;
    walkCycle.current += dt * 8;
    const bob = Math.sin(walkCycle.current * 2) * 0.045;
    g.position.y = 0.05 + bob;
    if (leftArmRef.current)
      leftArmRef.current.rotation.x = Math.sin(walkCycle.current) * 0.45;
    if (rightArmRef.current)
      rightArmRef.current.rotation.x = -Math.sin(walkCycle.current) * 0.45;
    if (headRef.current)
      headRef.current.rotation.x = Math.sin(walkCycle.current * 2) * 0.04;
    g.rotation.y += (directionAngle - g.rotation.y) * 0.15;
  });
  return (
    <group ref={groupRef}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.04, 0]}
        scale={[1, 0.65, 1]}
      >
        <circleGeometry args={[0.3, 12]} />
        <primitive object={shadowMat} attach="material" />
      </mesh>
      <mesh position={[-0.12, 0.35, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.35, 4, 6]} />
        <primitive object={pantsMat} attach="material" />
      </mesh>
      <mesh position={[0.12, 0.35, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.35, 4, 6]} />
        <primitive object={pantsMat} attach="material" />
      </mesh>
      <mesh position={[0, 0.78, 0]} castShadow>
        <capsuleGeometry args={[0.18, 0.38, 4, 8]} />
        <primitive object={shirtMat} attach="material" />
      </mesh>
      <mesh ref={leftArmRef} position={[-0.28, 0.82, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.32, 4, 6]} />
        <primitive object={shirtMat} attach="material" />
      </mesh>
      <mesh ref={rightArmRef} position={[0.28, 0.82, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.32, 4, 6]} />
        <primitive object={shirtMat} attach="material" />
      </mesh>
      <group ref={headRef} position={[0, 1.15, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.18, 12, 12]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
      </group>
    </group>
  );
});

// DestinationMarker (unchanged)
const DestinationMarker = React.memo(({ worldX, worldZ }) => {
  const ref = useRef();
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#14b8a6",
        transparent: true,
        opacity: 0.3,
      }),
    [],
  );
  const poleMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#14b8a6" }),
    [],
  );
  const topMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#14b8a6",
        emissive: "#0d9488",
        emissiveIntensity: 0.3,
      }),
    [],
  );
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 1.5;
  });
  return (
    <group position={[worldX, 0, worldZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.8, 1.2, 16]} />
        <primitive object={ringMat} attach="material" />
      </mesh>
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.08, 0.12, 2.4, 6]} />
        <primitive object={poleMat} attach="material" />
      </mesh>
      <mesh ref={ref} position={[0, 2.5, 0]}>
        <octahedronGeometry args={[0.5, 0]} />
        <primitive object={topMat} attach="material" />
      </mesh>
    </group>
  );
});

// FollowCamera (unchanged)
const FollowCamera = React.memo(({ posRef }) => {
  const { camera } = useThree();
  const targetPos = useRef({ x: 0, z: 0 });
  const ready = useRef(false);
  useFrame(({ clock }, dt) => {
    const px = posRef.current[0];
    const pz = posRef.current[1];
    targetPos.current.x += (px - targetPos.current.x) * Math.min(1, 6 * dt);
    targetPos.current.z += (pz - targetPos.current.z) * Math.min(1, 6 * dt);
    const targetX = targetPos.current.x + 12;
    const targetZ = targetPos.current.z + 12;
    if (!ready.current) {
      camera.position.set(targetX, 8, targetZ);
      camera.lookAt(px, 0, pz);
      ready.current = true;
      return;
    }
    camera.position.x += (targetX - camera.position.x) * Math.min(1, 5 * dt);
    camera.position.z += (targetZ - camera.position.z) * Math.min(1, 5 * dt);
    camera.position.y = 8 + Math.sin(clock.getElapsedTime() * 1.2) * 0.08;
    camera.lookAt(targetPos.current.x, 0.5, targetPos.current.z);
  });
  return null;
});

// HUDOverlay (fixed mode badge)
const HUDOverlay = React.memo(
  ({
    steps,
    currentStepIndex,
    safetyScore,
    remainingDistance,
    estimatedTime,
    onNext,
    onPrev,
    onClose,
    mode = "live",
  }) => {
    const step = steps?.[currentStepIndex];
    const total = steps?.length || 1;
    const progress = (currentStepIndex + 1) / total;
    const isFirst = currentStepIndex === 0;
    const isLast = currentStepIndex >= total - 1;
    const sc = safetyScore ?? null;
    const safetyColor =
      sc == null
        ? "#8cd69c"
        : sc >= 0.75
          ? "#14b8a6"
          : sc >= 0.5
            ? "#ffb347"
            : "#ff7b6b";
    const fmt = (m) =>
      m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
    const fmtT = (s) =>
      s >= 3600
        ? `${Math.floor(s / 3600)}h${Math.round((s % 3600) / 60)}m`
        : `${Math.round(s / 60)}min`;
    const getIcon = () => {
      if (step?.type === "transit") return "🚌";
      const t = (step?.instruction || "").toLowerCase();
      if (t.includes("left")) return "⬅️";
      if (t.includes("right")) return "➡️";
      if (t.includes("arrive")) return "🏁";
      return "⬆️";
    };
    const modeBadge =
      mode === "live" ? "LIVE GPS" : mode === "demo" ? "DEMO" : "NO GPS";
    const badgeColor =
      mode === "live" ? "#14b8a6" : mode === "demo" ? "#ffb347" : "#f97316";
    return (
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          pointerEvents: "none",
          background:
            "linear-gradient(to top, rgba(4,8,12,0.96) 55%, transparent)",
          padding: "12px 16px 16px",
          fontFamily: "'DM Sans', system-ui, sans-serif",
          zIndex: 30,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 16,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(8px)",
              borderRadius: 20,
              padding: "4px 12px",
              fontSize: 11,
              fontWeight: 700,
              color: badgeColor,
              border: `1px solid ${badgeColor}40`,
            }}
          >
            {modeBadge}
          </div>
        </div>
        <div
          style={{
            height: 2,
            background: "rgba(255,255,255,0.08)",
            borderRadius: 2,
            marginBottom: 10,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: "100%",
              background: "linear-gradient(90deg, #0d9488, #14b8a6)",
              borderRadius: 2,
              transition: "width 0.4s cubic-bezier(0.22,1,0.36,1)",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "#0d9488",
              background: "rgba(13,148,136,0.12)",
              border: "1px solid rgba(13,148,136,0.25)",
              borderRadius: 6,
              padding: "2px 8px",
              letterSpacing: "0.8px",
            }}
          >
            STEP {currentStepIndex + 1}/{total}
          </div>
          <div style={{ flex: 1 }} />
          {sc != null && (
            <div style={{ fontSize: 10, fontWeight: 700, color: safetyColor }}>
              ◉ {Math.round(sc * 100)}% safe
            </div>
          )}
          {remainingDistance > 0 && (
            <div style={{ fontSize: 10, color: "rgba(241,245,249,0.5)" }}>
              {fmt(remainingDistance)} · {fmtT(estimatedTime)}
            </div>
          )}
          <button
            onClick={onClose}
            style={{
              pointerEvents: "auto",
              width: 24,
              height: 24,
              borderRadius: 12,
              border: "none",
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.55)",
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              flexShrink: 0,
              background: "rgba(13,148,136,0.15)",
              border: "1px solid rgba(13,148,136,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            {getIcon()}
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#f1f5f9",
                lineHeight: 1.35,
              }}
            >
              {step?.instruction || "Follow the route"}
            </div>
            {step?.distance && (
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(232,168,112,0.7)",
                  marginTop: 2,
                }}
              >
                {step.distance}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, pointerEvents: "auto" }}>
          <button
            onClick={onPrev}
            disabled={isFirst}
            style={{
              flex: 1,
              padding: "8px",
              borderRadius: 14,
              border: "none",
              background: isFirst
                ? "rgba(255,255,255,0.04)"
                : "rgba(255,255,255,0.08)",
              color: isFirst ? "rgba(255,255,255,0.2)" : "#f1f5f9",
              fontSize: 12,
              fontWeight: 600,
              cursor: isFirst ? "not-allowed" : "pointer",
            }}
          >
            ← Prev
          </button>
          <button
            onClick={onNext}
            disabled={isLast}
            style={{
              flex: 2,
              padding: "8px",
              borderRadius: 14,
              border: "none",
              background: isLast
                ? "rgba(255,255,255,0.04)"
                : "linear-gradient(135deg, #0d9488, #14b8a6)",
              color: isLast ? "rgba(255,255,255,0.2)" : "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: isLast ? "not-allowed" : "pointer",
            }}
          >
            {isLast ? "🏁 Arrived" : "Next →"}
          </button>
        </div>
      </div>
    );
  },
);

// Error boundary (unchanged)
class ErrBoundary extends React.Component {
  state = { err: false };
  static getDerivedStateFromError() {
    return { err: true };
  }
  componentDidCatch(error, info) {
    console.error("Walking3DView error:", error, info);
  }
  render() {
    if (this.state.err)
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0a0d12",
            color: "#e8a870",
            fontFamily: "'DM Sans', system-ui, sans-serif",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
            <div style={{ fontSize: 14, marginBottom: 16 }}>
              3D view encountered an error
            </div>
            <button
              onClick={() => this.setState({ err: false })}
              style={{
                padding: "8px 24px",
                background: "linear-gradient(135deg, #0d9488, #14b8a6)",
                border: "none",
                borderRadius: 20,
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        </div>
      );
    return this.props.children;
  }
}

// Main Component (with routeVersion state)
export default function Walking3DView({
  route = [],
  routeSteps = [],
  currentStepIndex = 0,
  userPosition = null,
  userHeading = 0,
  navigationState = "idle",
  remainingDistance = 0,
  estimatedTime = 0,
  routeType = "walking",
  transitSegments = [],
  hazards = [],
  constructionZones = [],
  emergencies = [],
  safetyScore = null,
  demoMode = false,
  useRealBuildings = false,
  onClose = () => {},
  style = {},
}) {
  const { initOrigin, geo2w, resetOrigin } = useGeoConversion();
  const [routeVersion, setRouteVersion] = useState(0);
  const [progressIdx, setProgressIdx] = useState(0);
  const [internalStepIdx, setInternalStepIdx] = useState(currentStepIndex);
  const posRef = useRef([0, 0]);
  const walkerAngleRef = useRef(0);
  const demoIntervalRef = useRef(null);

  // Reset origin and geometry when route changes (new route[0])
  useEffect(() => {
    resetOrigin();
    if (route.length) {
      initOrigin(route[0][0], route[0][1]);
    } else if (userPosition) {
      initOrigin(userPosition[0], userPosition[1]);
    }
    setRouteVersion((v) => v + 1);
    setProgressIdx(0);
    posRef.current = [0, 0];
  }, [route, userPosition, initOrigin, resetOrigin]);

  // Convert route to world coordinates (keys on routeVersion)
  const routeW = useMemo(() => {
    if (!route.length) return [];
    if (!geo2w) return [];
    return route.map(([lat, lng]) => geo2w(lat, lng));
  }, [route, geo2w, routeVersion]);

  const destW = useMemo(
    () => (routeW.length ? routeW[routeW.length - 1] : null),
    [routeW],
  );

  // Real GPS mode: update posRef directly
  useEffect(() => {
    if (!demoMode && userPosition) {
      const [lat, lng] = userPosition;
      const [x, z] = geo2w(lat, lng);
      posRef.current = [x, z];
    }
  }, [userPosition, demoMode, geo2w]);

  // Demo mode auto-advance
  useEffect(() => {
    if (demoMode && routeW.length > 1) {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
      let idx = progressIdx;
      demoIntervalRef.current = setInterval(() => {
        idx = (idx + 1) % routeW.length;
        setProgressIdx(idx);
        posRef.current = routeW[idx];
        if (idx > 0) {
          const dx = routeW[idx][0] - routeW[idx - 1][0];
          const dz = routeW[idx][1] - routeW[idx - 1][1];
          walkerAngleRef.current = Math.atan2(dz, dx);
        }
      }, 1200);
      return () => {
        if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
      };
    } else {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    }
  }, [demoMode, routeW]);

  // Walker rotation from GPS movement
  useEffect(() => {
    let lastPos = posRef.current;
    const interval = setInterval(() => {
      if (!demoMode && userPosition && routeW.length) {
        const current = posRef.current;
        if (
          lastPos &&
          Math.hypot(current[0] - lastPos[0], current[1] - lastPos[1]) > 0.05
        ) {
          walkerAngleRef.current = Math.atan2(
            current[1] - lastPos[1],
            current[0] - lastPos[0],
          );
        }
        lastPos = [...current];
      }
    }, 200);
    return () => clearInterval(interval);
  }, [demoMode, userPosition, routeW]);

  // Update progressIdx for tube rendering
  useEffect(() => {
    if (demoMode) return;
    if (!userPosition || !routeW.length) return;
    let best = 0,
      bestDist = Infinity;
    for (let i = 0; i < routeW.length; i++) {
      const [rx, rz] = routeW[i];
      const dist = Math.hypot(rx - posRef.current[0], rz - posRef.current[1]);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setProgressIdx(best);
  }, [userPosition, routeW, demoMode, posRef.current]);

  useEffect(() => setInternalStepIdx(currentStepIndex), [currentStepIndex]);

  // Proximity filter for hazards
  const nearbyHazards = useMemo(() => {
    const walkerPos = posRef.current;
    const filter = (items, getPos) =>
      items.filter((item) => {
        const [wx, wz] = getPos(item);
        return Math.hypot(wx - walkerPos[0], wz - walkerPos[1]) < 220;
      });
    const getHazardPos = (h) => {
      const lat = h.position?.lat ?? h.lat;
      const lng = h.position?.lng ?? h.lng;
      return lat != null && lng != null
        ? geo2w(lat, lng)
        : [Infinity, Infinity];
    };
    const getConstPos = (c) => geo2w(c.lat, c.lng);
    const getEmergPos = (e) => geo2w(e.lat, e.lng);
    return {
      hazards: filter(hazards, getHazardPos),
      construction: filter(constructionZones, getConstPos),
      emergencies: filter(emergencies, getEmergPos),
    };
  }, [hazards, constructionZones, emergencies, posRef.current, geo2w]);

  const handleNext = () => {
    if (internalStepIdx < routeSteps.length - 1)
      setInternalStepIdx((prev) => prev + 1);
  };
  const handlePrev = () => {
    if (internalStepIdx > 0) setInternalStepIdx((prev) => prev - 1);
  };
  const modeBadgeType = demoMode ? "demo" : userPosition ? "live" : "no-gps";

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "#0a0e14",
        borderRadius: 16,
        overflow: "hidden",
        ...style,
      }}
    >
      <ErrBoundary>
        <Canvas
          shadows
          dpr={[1, 1.5]}
          frameloop="always"
          performance={{ min: 0.5, max: 1, debounce: 200 }}
          camera={{ fov: 45, near: 0.5, far: 300 }}
          style={{ width: "100%", height: "100%" }}
        >
          <Lighting />
          <RoadNetwork routeW={routeW} />
          {useRealBuildings ? (
            <RealBuildings routeW={routeW} geo2w={geo2w} />
          ) : (
            <CityBlocks routeW={routeW} />
          )}
          {routeW.length > 1 && (
            <RouteTube points={routeW} progressIdx={progressIdx} />
          )}
          {destW && <DestinationMarker worldX={destW[0]} worldZ={destW[1]} />}
          {nearbyHazards.hazards.map((h, i) => (
            <HazardMarker3D
              key={`hz-${i}`}
              worldX={
                geo2w(h.position?.lat ?? h.lat, h.position?.lng ?? h.lng)[0]
              }
              worldZ={
                geo2w(h.position?.lat ?? h.lat, h.position?.lng ?? h.lng)[1]
              }
              severity={h.severity}
            />
          ))}
          {nearbyHazards.construction.map((c, i) => {
            const [wx, wz] = geo2w(c.lat, c.lng);
            return (
              <ConstructionMarker3D key={`con-${i}`} worldX={wx} worldZ={wz} />
            );
          })}
          {nearbyHazards.emergencies.map((e, i) => {
            const [wx, wz] = geo2w(e.lat, e.lng);
            return (
              <EmergencyMarker3D
                key={`em-${i}`}
                worldX={wx}
                worldZ={wz}
                type={e.type}
              />
            );
          })}
          <WalkerModel
            posRef={posRef}
            directionAngle={walkerAngleRef.current}
          />
          <FollowCamera posRef={posRef} />
        </Canvas>
      </ErrBoundary>
      <HUDOverlay
        steps={routeSteps}
        currentStepIndex={internalStepIdx}
        safetyScore={safetyScore}
        remainingDistance={remainingDistance}
        estimatedTime={estimatedTime}
        onNext={handleNext}
        onPrev={handlePrev}
        onClose={onClose}
        mode={modeBadgeType}
      />
    </div>
  );
}
