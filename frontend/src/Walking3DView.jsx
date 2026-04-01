/**
 * Walking3DView.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time 3D pedestrian navigation for Tryver.
 *
 * Props (all wired straight to your existing LiveNavigation state):
 *   route          – [[lat, lng], …]  decoded TomTom / backend polyline
 *   hazards        – [{position:{lat,lng}, type, severity, radius, description}, …]
 *   userPosition   – [lat, lng]  live GPS position
 *   navigationState – 'idle' | 'walking' | 'rerouting' | 'arrived'
 *   routeSafety    – 0–1 safety score
 *
 * Coordinate system
 *   Pittsburgh reference: 40.4406 N, 79.9959 W
 *   WORLD_SCALE = 1/8  → 1 Three.js unit ≈ 8 real metres
 *   Figure is rendered at "hero scale" (~1.5 units ≈ 12 m) so it stays
 *   visible from the follow camera. Every other measurement (road width,
 *   hazard radius, building offsets) uses the same WORLD_SCALE so the
 *   spatial relationships are accurate.
 *
 * No mock data.  All geometry is derived from real route + hazard arrays.
 * When route is empty the scene just shows the user's dot on the ground.
 */

import React, {
    useRef,
    useMemo,
    useEffect,
    useState,
    useCallback,
  } from 'react';
  import { Canvas, useFrame, useThree } from '@react-three/fiber';
  import * as THREE from 'three';
  import { Html } from '@react-three/drei';
  
  // ─── Coordinate helpers ───────────────────────────────────────────────────────
  
  const ORIGIN   = { lat: 40.4406, lng: -79.9959 };
  const M_LAT    = 111_139;
  const M_LNG    = M_LAT * Math.cos(ORIGIN.lat * (Math.PI / 180)); // ≈ 84 766 m/°
  const W        = 1 / 8; // world scale: 1 unit = 8 m
  
  /** [lat, lng] → THREE.Vector3  (y = 0) */
  function g2v([lat, lng]) {
    return new THREE.Vector3(
      (lng - ORIGIN.lng) * M_LNG * W,
      0,
      -(lat - ORIGIN.lat) * M_LAT * W,
    );
  }
  
  /** lat/lng object → THREE.Vector3 */
  function obj2v({ lat, lng }) {
    return g2v([lat, lng]);
  }
  
  /** Index of the closest point in an array of Vector3 to `target` */
  function nearestIdx(pts, target) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = pts[i].distanceToSquared(target);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  
  // ─── Constants ────────────────────────────────────────────────────────────────
  
  const ROAD_HW   = 0.5;  // road half-width  = 4 m each side  → 8 m total lane
  const WALK_HW   = 0.15; // sidewalk half-width = 1.2 m
  
  const HAZARD_HEX = {
    crime:         0xef4444,
    fire:          0xf97316,
    disaster:      0x8b5cf6,
    congestion:    0xf59e0b,
    construction:  0xb45309,
    poor_lighting: 0xca8a04,
    accessibility: 0x3b82f6,
  };
  const HAZARD_CSS = {
    crime:         '#ef4444',
    fire:          '#f97316',
    disaster:      '#8b5cf6',
    congestion:    '#f59e0b',
    construction:  '#b45309',
    poor_lighting: '#ca8a04',
    accessibility: '#3b82f6',
  };
  function hcss(type) { return HAZARD_CSS[type] || '#ef4444'; }
  function hhex(type) { return HAZARD_HEX[type] || 0xef4444; }
  
  // ─── RouteMesh ────────────────────────────────────────────────────────────────
  // Builds a flat road ribbon + kerbs + sidewalks from world-space points.
  
  function RouteMesh({ worldPts, safetyScore }) {
    const geoms = useMemo(() => {
      if (worldPts.length < 2) return null;
  
      const roadPos = [], roadIdx = [];
      const swPos   = [], swIdx   = [];
  
      for (let i = 0; i < worldPts.length; i++) {
        const cur = worldPts[i];
        const prv = worldPts[Math.max(0, i - 1)];
        const nxt = worldPts[Math.min(worldPts.length - 1, i + 1)];
  
        // tangent along path
        const tang = new THREE.Vector3().subVectors(nxt, prv);
        if (tang.lengthSq() < 1e-8) tang.set(1, 0, 0);
        tang.normalize();
  
        // perpendicular (xz plane)
        const perp = new THREE.Vector3(-tang.z, 0, tang.x);
  
        const t = i / (worldPts.length - 1);
  
        // Road: left / right at y=0.015
        const RL = cur.clone().addScaledVector(perp,  ROAD_HW);
        const RR = cur.clone().addScaledVector(perp, -ROAD_HW);
        roadPos.push(RL.x, 0.015, RL.z, RR.x, 0.015, RR.z);
  
        // Sidewalk strip (left side)
        const SL0 = cur.clone().addScaledVector(perp,  ROAD_HW);
        const SL1 = cur.clone().addScaledVector(perp,  ROAD_HW + WALK_HW);
        // Sidewalk strip (right side)
        const SR0 = cur.clone().addScaledVector(perp, -ROAD_HW);
        const SR1 = cur.clone().addScaledVector(perp, -(ROAD_HW + WALK_HW));
        swPos.push(
          SL0.x, 0.01, SL0.z,
          SL1.x, 0.01, SL1.z,
          SR0.x, 0.01, SR0.z,
          SR1.x, 0.01, SR1.z,
        );
  
        if (i < worldPts.length - 1) {
          const rb = i * 2;
          roadIdx.push(rb, rb+1, rb+2,  rb+1, rb+3, rb+2);
  
          const sb = i * 4;
          // left sidewalk
          swIdx.push(sb,   sb+1, sb+4,  sb+1, sb+5, sb+4);
          // right sidewalk
          swIdx.push(sb+2, sb+6, sb+3,  sb+3, sb+6, sb+7);
        }
      }
  
      const roadGeo = new THREE.BufferGeometry();
      roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
      roadGeo.setIndex(roadIdx);
      roadGeo.computeVertexNormals();
  
      const swGeo = new THREE.BufferGeometry();
      swGeo.setAttribute('position', new THREE.Float32BufferAttribute(swPos, 3));
      swGeo.setIndex(swIdx);
      swGeo.computeVertexNormals();
  
      return { roadGeo, swGeo };
    }, [worldPts]);
  
    if (!geoms) return null;
  
    const roadColor = safetyScore > 0.7 ? '#252520' : safetyScore > 0.4 ? '#2e2010' : '#2e1010';
  
    return (
      <group>
        {/* Sidewalk */}
        <mesh geometry={geoms.swGeo} receiveShadow>
          <meshStandardMaterial color="#3a3830" roughness={0.97} />
        </mesh>
        {/* Road */}
        <mesh geometry={geoms.roadGeo} receiveShadow>
          <meshStandardMaterial color={roadColor} roughness={0.96} metalness={0.02} />
        </mesh>
      </group>
    );
  }
  
  // ─── SafetyLine ───────────────────────────────────────────────────────────────
  // Coloured strip painted on the road surface showing safety gradient.
  
  function SafetyLine({ worldPts, safetyScore }) {
    const color = safetyScore > 0.7 ? '#10b981' : safetyScore > 0.4 ? '#f59e0b' : '#ef4444';
  
    return (
      <group>
        {worldPts.slice(0, -1).map((p, i) => {
          const q   = worldPts[i + 1];
          const mid = new THREE.Vector3().addVectors(p, q).multiplyScalar(0.5);
          const len = p.distanceTo(q);
          const dir = new THREE.Vector3().subVectors(q, p);
          const ang = Math.atan2(dir.x, dir.z);
          return (
            <mesh key={i} position={[mid.x, 0.022, mid.z]} rotation={[0, ang, 0]}>
              <boxGeometry args={[0.05, 0.003, len]} />
              <meshBasicMaterial color={color} />
            </mesh>
          );
        })}
      </group>
    );
  }
  
  // ─── AmbientBuildings ─────────────────────────────────────────────────────────
  // Procedural low-poly building silhouettes placed along the route sides.
  // These are pure environmental context — they do NOT represent real Pittsburgh
  // buildings and are clearly distinct from the actual route / hazard data.
  
  function AmbientBuildings({ worldPts }) {
    const buildings = useMemo(() => {
      if (worldPts.length < 4) return [];
      const result = [];
      // Sample every N points so we don't generate thousands of buildings
      const step = Math.max(1, Math.floor(worldPts.length / 40));
  
      for (let i = 0; i < worldPts.length - step; i += step) {
        const cur = worldPts[i];
        const nxt = worldPts[Math.min(i + step, worldPts.length - 1)];
        const tang = new THREE.Vector3().subVectors(nxt, cur).normalize();
        if (tang.lengthSq() < 1e-6) continue;
        const perp = new THREE.Vector3(-tang.z, 0, tang.x);
  
        // Deterministic pseudo-random driven by position (not index) so
        // buildings don't shuffle when the route is trimmed.
        const sx = Math.sin(cur.x * 17.3 + cur.z * 9.1);
        const sz = Math.sin(cur.x * 5.7  + cur.z * 23.4);
        const r  = (n) => (((Math.sin(n) * 43758.5453) % 1) + 1) % 1;
  
        [1, -1].forEach((side) => {
          const setback = (ROAD_HW + WALK_HW + 0.25 + r(sx + side * 7) * 0.6) * side;
          const pos = cur.clone().addScaledVector(perp, setback);
          // Clamp to reasonable range so far-flung GPS outliers don't place
          // buildings at ±infinity.
          if (Math.abs(pos.x) > 150 || Math.abs(pos.z) > 150) return;
  
          const h  = 0.5 + r(sz + side * 3)  * 2.5;
          const bw = 0.35 + r(sx + side * 11) * 0.7;
          const bd = 0.35 + r(sz + side * 13) * 0.7;
          const g  = Math.round(28 + r(sx + side * 19) * 38);
          result.push({ x: pos.x, z: pos.z, h, bw, bd, g });
        });
      }
      return result;
    }, [worldPts]);
  
    return (
      <group>
        {buildings.map((b, i) => {
          const lum = b.g;
          const col = `rgb(${lum},${lum},${Math.round(lum * 1.06)})`;
          return (
            <mesh key={i} position={[b.x, b.h / 2, b.z]} castShadow receiveShadow>
              <boxGeometry args={[b.bw, b.h, b.bd]} />
              <meshStandardMaterial color={col} roughness={0.88} metalness={0.06} />
            </mesh>
          );
        })}
      </group>
    );
  }
  
  // ─── WalkingFigure ────────────────────────────────────────────────────────────
  // Animated 3-part humanoid that snaps to the nearest point on the route and
  // faces the direction of travel.  The figure is rendered at hero scale.
  
  const FIGURE_H = 1.5; // visual height in world units
  
  function WalkingFigure({ worldPts, userWorldPt, navState, routeSafety, onPosUpdate }) {
    const root    = useRef();
    const lArm    = useRef();
    const rArm    = useRef();
    const lLeg    = useRef();
    const rLeg    = useRef();
    const glow    = useRef();
  
    const curPos  = useRef(new THREE.Vector3());
    const curRot  = useRef(0);
    const tick    = useRef(0);
    const firstFrame = useRef(true);
  
    const isWalking  = navState === 'walking';
    const isReroute  = navState === 'rerouting';
    const isArrived  = navState === 'arrived';
  
    // Jacket color reflects safety
    const jacketHex  = routeSafety > 0.7 ? 0x1d4ed8 : routeSafety > 0.4 ? 0xb45309 : 0x991b1b;
    const glowColor  = isArrived  ? 0x10b981
                     : isReroute  ? 0xf59e0b
                     : isWalking  ? 0x3b82f6
                     : 0x6b7280;
  
    useFrame((_, dt) => {
      if (!root.current || worldPts.length === 0 || !userWorldPt) return;
  
      tick.current += dt;
  
      // Snap to nearest route point
      const idx    = nearestIdx(worldPts, userWorldPt);
      const target = worldPts[idx].clone();
      let   targetRot = curRot.current;
  
      if (idx < worldPts.length - 1) {
        const d = new THREE.Vector3().subVectors(worldPts[idx + 1], worldPts[idx]);
        if (d.lengthSq() > 1e-6) targetRot = Math.atan2(d.x, d.z);
      }
  
      // Initialise without lerp on first frame
      if (firstFrame.current) {
        curPos.current.copy(target);
        curRot.current = targetRot;
        firstFrame.current = false;
      }
  
      // Smooth position + rotation lerp
      const k = 1 - Math.exp(-7 * dt);
      curPos.current.lerp(target, k);
  
      // Shortest-path angle lerp
      let dRot = ((targetRot - curRot.current) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      curRot.current += dRot * k;
  
      root.current.position.copy(curPos.current);
      root.current.rotation.y = curRot.current;
  
      // Walk cycle
      if (isWalking) {
        const s = Math.sin(tick.current * 4.2);
        if (lArm.current) lArm.current.rotation.x =  s * 0.42;
        if (rArm.current) rArm.current.rotation.x = -s * 0.42;
        if (lLeg.current) lLeg.current.rotation.x = -s * 0.38;
        if (rLeg.current) rLeg.current.rotation.x =  s * 0.38;
        // Body bob
        root.current.position.y = Math.abs(Math.sin(tick.current * 4.2)) * 0.018;
      } else {
        // Relax limbs
        const relax = (ref) => {
          if (!ref.current) return;
          ref.current.rotation.x *= 0.85;
        };
        relax(lArm); relax(rArm); relax(lLeg); relax(rLeg);
      }
  
      // Glow pulse
      if (glow.current) {
        glow.current.color.setHex(glowColor);
        glow.current.intensity = 2.5 + Math.sin(tick.current * 2.8) * 0.6;
      }
  
      // Bubble updated position up so FollowCamera can use it
      if (onPosUpdate) onPosUpdate(curPos.current, curRot.current);
    });
  
    return (
      <group ref={root}>
        {/* Status glow */}
        <pointLight ref={glow} color={glowColor} intensity={2.5} distance={6} decay={2} />
  
        {/* Ground shadow */}
        <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.36, 20]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.4} depthWrite={false} />
        </mesh>
  
        {/* ── Body ── */}
  
        {/* Feet */}
        <mesh position={[ 0.09, 0.06, 0.05]} castShadow>
          <boxGeometry args={[0.09, 0.06, 0.17]} />
          <meshStandardMaterial color="#111827" roughness={0.9} />
        </mesh>
        <mesh position={[-0.09, 0.06, 0.05]} castShadow>
          <boxGeometry args={[0.09, 0.06, 0.17]} />
          <meshStandardMaterial color="#111827" roughness={0.9} />
        </mesh>
  
        {/* Left leg */}
        <group ref={lLeg} position={[0.09, 0.45, 0]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.065, 0.55, 4, 8]} />
            <meshStandardMaterial color="#1e293b" roughness={0.82} />
          </mesh>
        </group>
  
        {/* Right leg */}
        <group ref={rLeg} position={[-0.09, 0.45, 0]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.065, 0.55, 4, 8]} />
            <meshStandardMaterial color="#1e293b" roughness={0.82} />
          </mesh>
        </group>
  
        {/* Torso */}
        <mesh position={[0, 0.96, 0]} castShadow>
          <boxGeometry args={[0.29, 0.44, 0.19]} />
          <meshStandardMaterial color={jacketHex} roughness={0.76} metalness={0.08} />
        </mesh>
  
        {/* Backpack */}
        <mesh position={[0, 0.97, -0.14]} castShadow>
          <boxGeometry args={[0.18, 0.28, 0.1]} />
          <meshStandardMaterial color="#374151" roughness={0.87} />
        </mesh>
  
        {/* Left arm */}
        <group ref={lArm} position={[0.19, 1.06, 0]}>
          <mesh position={[0, -0.17, 0]} castShadow>
            <capsuleGeometry args={[0.05, 0.28, 4, 6]} />
            <meshStandardMaterial color={jacketHex} roughness={0.78} metalness={0.06} />
          </mesh>
        </group>
  
        {/* Right arm */}
        <group ref={rArm} position={[-0.19, 1.06, 0]}>
          <mesh position={[0, -0.17, 0]} castShadow>
            <capsuleGeometry args={[0.05, 0.28, 4, 6]} />
            <meshStandardMaterial color={jacketHex} roughness={0.78} metalness={0.06} />
          </mesh>
        </group>
  
        {/* Neck */}
        <mesh position={[0, 1.24, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.065, 0.1, 8]} />
          <meshStandardMaterial color="#d4a87a" roughness={0.72} />
        </mesh>
  
        {/* Head */}
        <mesh position={[0, 1.41, 0]} castShadow>
          <sphereGeometry args={[0.14, 16, 14]} />
          <meshStandardMaterial color="#d4a87a" roughness={0.7} />
        </mesh>
  
        {/* Cap / helmet */}
        <mesh position={[0, 1.52, 0.01]} castShadow>
          <cylinderGeometry args={[0.09, 0.155, 0.09, 12]} />
          <meshStandardMaterial color="#1e3a5f" roughness={0.7} />
        </mesh>
        <mesh position={[0, 1.52, 0.12]} castShadow>
          <boxGeometry args={[0.18, 0.03, 0.1]} />
          <meshStandardMaterial color="#1e3a5f" roughness={0.7} />
        </mesh>
  
        {/* Direction arrow (shown while walking) */}
        {isWalking && (
          <mesh position={[0, 0.02, ROAD_HW * 0.55]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.07, 0.22, 6]} />
            <meshBasicMaterial color="#60a5fa" transparent opacity={0.75} />
          </mesh>
        )}
  
        {/* Arrived star burst */}
        {isArrived && (
          <mesh position={[0, FIGURE_H + 0.35, 0]}>
            <octahedronGeometry args={[0.18, 0]} />
            <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.9}
              roughness={0.2} metalness={0.6} />
          </mesh>
        )}
      </group>
    );
  }
  
  // ─── HazardMarker ─────────────────────────────────────────────────────────────
  // 3D obstacle: spinning octahedron + ground radius ring + warning pillar.
  // radius is real metres → converted with WORLD_SCALE W.
  
  function HazardMarker({ hazard }) {
    const { position, type, severity = 0.5, radius = 50, description } = hazard;
  
    const wPos    = useMemo(() => obj2v(position), [position.lat, position.lng]);
    const wRadius = (radius || 50) * W;          // world-space radius
    const hexCol  = hhex(type);
    const cssCol  = hcss(type);
  
    const spinRef  = useRef();
    const ringRef  = useRef();
    const pLight   = useRef();
  
    useFrame(({ clock }) => {
      const t = clock.getElapsedTime();
      if (spinRef.current) {
        spinRef.current.rotation.y = t * 1.0;
        spinRef.current.rotation.x = t * 0.4;
        spinRef.current.position.y = 0.7 + Math.sin(t * 1.8) * 0.1;
      }
      if (ringRef.current) {
        const p = 0.8 + Math.sin(t * 2.4) * 0.2;
        ringRef.current.scale.setScalar(p);
        ringRef.current.material.opacity = 0.12 + Math.sin(t * 2.4) * 0.06;
      }
      if (pLight.current) {
        pLight.current.intensity = 2 + Math.sin(t * 3.5) * 0.8;
      }
    });
  
    const pillarH = 0.5 + severity * 0.8;
  
    return (
      <group position={[wPos.x, 0, wPos.z]}>
        {/* Radius disc (very faint fill) */}
        <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[wRadius, 52]} />
          <meshBasicMaterial color={hexCol} transparent opacity={0.06} depthWrite={false} />
        </mesh>
  
        {/* Pulsing radius ring */}
        <mesh ref={ringRef} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[wRadius * 0.87, wRadius, 52]} />
          <meshBasicMaterial color={hexCol} transparent opacity={0.14}
            side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
  
        {/* Base plinth */}
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.16, 0.22, 0.1, 10]} />
          <meshStandardMaterial color={hexCol} roughness={0.45} metalness={0.5} />
        </mesh>
  
        {/* Pillar */}
        <mesh position={[0, 0.1 + pillarH / 2, 0]}>
          <cylinderGeometry args={[0.045, 0.12, pillarH, 8]} />
          <meshStandardMaterial color={hexCol} roughness={0.38} metalness={0.55}
            emissive={hexCol} emissiveIntensity={0.18} />
        </mesh>
  
        {/* Spinning warning diamond */}
        <mesh ref={spinRef} position={[0, 0.7, 0]}>
          <octahedronGeometry args={[0.26, 0]} />
          <meshStandardMaterial color={hexCol} roughness={0.25} metalness={0.75}
            emissive={hexCol} emissiveIntensity={0.55} />
        </mesh>
  
        {/* Warning stripes on pillar */}
        {Array.from({ length: Math.ceil(pillarH / 0.14) }).map((_, i) => (
          <mesh key={i} position={[0, 0.12 + i * 0.14, 0]}>
            <cylinderGeometry args={[0.052, 0.052, 0.04, 8]} />
            <meshStandardMaterial color="#000000" roughness={0.9} />
          </mesh>
        ))}
  
        {/* Status light */}
        <pointLight ref={pLight} color={hexCol} intensity={2} distance={wRadius * 1.5} decay={2} />
  
        {/* HTML label */}
        <Html position={[0, pillarH + 0.85, 0]} center distanceFactor={14}
          zIndexRange={[10, 20]} style={{ pointerEvents: 'none' }}>
          <div style={{
            background: 'rgba(0,0,0,0.88)',
            border: `1.5px solid ${cssCol}`,
            borderRadius: 6,
            padding: '3px 9px',
            color: cssCol,
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(6px)',
            fontFamily: 'system-ui, sans-serif',
          }}>
            ⚠ {(type || 'hazard').replace(/_/g, ' ')}
            <div style={{
              color: '#9ca3af', fontSize: 8.5, fontWeight: 400,
              marginTop: 1, textTransform: 'none',
            }}>
              {Math.round((severity || 0) * 100)}% · r={radius}m
            </div>
          </div>
        </Html>
      </group>
    );
  }
  
  // ─── DestinationMarker ────────────────────────────────────────────────────────
  
  function DestinationMarker({ worldPos }) {
    const pin  = useRef();
    const ring = useRef();
  
    useFrame(({ clock }) => {
      const t = clock.getElapsedTime();
      if (pin.current)  pin.current.position.y  = 0.6 + Math.sin(t * 2.2) * 0.12;
      if (ring.current) ring.current.material.opacity = 0.25 + Math.sin(t * 2.2) * 0.1;
    });
  
    return (
      <group position={[worldPos.x, 0, worldPos.z]}>
        {/* Ground ring */}
        <mesh ref={ring} position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.4, 0.55, 28]} />
          <meshBasicMaterial color="#10b981" transparent opacity={0.3} depthWrite={false} />
        </mesh>
  
        {/* Pin */}
        <mesh ref={pin} position={[0, 0.6, 0]}>
          <coneGeometry args={[0.18, 0.55, 8]} />
          <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.65}
            roughness={0.3} metalness={0.4} />
        </mesh>
  
        <pointLight color="#10b981" intensity={3} distance={4} decay={2} />
  
        <Html position={[0, 1.5, 0]} center distanceFactor={14} zIndexRange={[5, 15]}
          style={{ pointerEvents: 'none' }}>
          <div style={{
            background: 'rgba(0,0,0,0.85)', border: '1.5px solid #10b981',
            borderRadius: 6, padding: '3px 9px', color: '#10b981',
            fontSize: 10, fontWeight: 700, fontFamily: 'system-ui, sans-serif',
            backdropFilter: 'blur(6px)', whiteSpace: 'nowrap',
          }}>
            DESTINATION
          </div>
        </Html>
      </group>
    );
  }
  
  // ─── FollowCamera ─────────────────────────────────────────────────────────────
  // Third-person follow camera.  Reads the latest figure position + rotation
  // through shared refs written by WalkingFigure's onPosUpdate callback.
  
  function FollowCamera({ figPosRef, figRotRef, navState }) {
    const { camera } = useThree();
    const camPos = useRef(new THREE.Vector3(0, 8, 12));
    const lookAt = useRef(new THREE.Vector3());
    const init   = useRef(false);
  
    useFrame((_, dt) => {
      const pos = figPosRef.current;
      const rot = figRotRef.current;
      const isWalking = navState === 'walking';
  
      // Behind / above offset based on state
      const back = isWalking ? 4.5 : 7;
      const up   = isWalking ? 3.5 : 8;
  
      const desire = new THREE.Vector3(
         pos.x - Math.sin(rot) * back,
         pos.y + up,
         pos.z + Math.cos(rot) * back,
      );
  
      if (!init.current) { camPos.current.copy(desire); init.current = true; }
  
      camPos.current.lerp(desire, 1 - Math.exp(-3.5 * dt));
      camera.position.copy(camPos.current);
  
      // Look slightly ahead of the figure
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
        <meshStandardMaterial color="#0f0f0c" roughness={1} />
      </mesh>
    );
  }
  
  // ─── PittsburghScene ──────────────────────────────────────────────────────────
  // Assembles all scene elements.
  
  function PittsburghScene({ route, hazards, userPosition, navigationState, routeSafety }) {
    // Convert route [[lat,lng],…] → world-space Vector3 array
    // Thin the array: keep every other point to avoid GPU overload on long routes.
    const worldPts = useMemo(() => {
      const pts = route.map(g2v);
      return pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
    }, [route]);
  
    // User world position
    const userWorldPt = useMemo(() =>
      userPosition ? g2v(userPosition) : null,
    [userPosition]);
  
    // Shared refs written by WalkingFigure, read by FollowCamera
    const figPosRef = useRef(userWorldPt ? userWorldPt.clone() : new THREE.Vector3());
    const figRotRef = useRef(0);
  
    const handlePosUpdate = useCallback((pos, rot) => {
      figPosRef.current.copy(pos);
      figRotRef.current = rot;
    }, []);
  
    const destPt = worldPts.length > 0 ? worldPts[worldPts.length - 1] : null;
    const isArrived = navigationState === 'arrived';
  
    return (
      <>
        {/* ── Lights ── */}
        <ambientLight intensity={0.55} color="#b8cce8" />
        <directionalLight
          position={[10, 18, 12]} intensity={1.9} color="#fff5e0"
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
        <directionalLight position={[-8, 10, -10]} intensity={0.35} color="#6080b8" />
  
        {/* Atmospheric fog */}
        <fog attach="fog" args={['#0a0c14', 25, 110]} />
  
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
  
        {/* ── Hazard obstacles ── */}
        {hazards.map((hz, i) => (
          <HazardMarker key={hz.id || `hz-${i}`} hazard={hz} />
        ))}
  
        {/* ── Destination pin ── */}
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
  
        {/* Fallback dot when no route yet */}
        {userWorldPt && worldPts.length === 0 && (
          <group position={[userWorldPt.x, 0, userWorldPt.z]}>
            <mesh position={[0, 0.3, 0]}>
              <sphereGeometry args={[0.25, 14, 14]} />
              <meshStandardMaterial color="#3b82f6" emissive="#3b82f6" emissiveIntensity={0.5} />
            </mesh>
            <pointLight color="#3b82f6" intensity={3} distance={5} decay={2} />
          </group>
        )}
  
        {/* ── Follow camera ── */}
        <FollowCamera
          figPosRef={figPosRef}
          figRotRef={figRotRef}
          navState={navigationState}
        />
      </>
    );
  }
  
  // ─── HUD overlay ──────────────────────────────────────────────────────────────
  // DOM overlay drawn on top of the Canvas so it stays legible.
  
  function HUDOverlay({ navigationState, routeSafety, remainingDistance, estimatedTime, hazardCount }) {
    const safetyColor = routeSafety > 0.7 ? '#10b981' : routeSafety > 0.4 ? '#f59e0b' : '#ef4444';
    const stateLabel  = {
      idle:      'READY',
      walking:   '▶ NAVIGATING',
      rerouting: '↻ REROUTING',
      arrived:   '✓ ARRIVED',
    }[navigationState] || navigationState.toUpperCase();
  
    return (
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        pointerEvents: 'none', zIndex: 10,
        padding: '12px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {/* Left: status + distance */}
        <div style={{
          background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
          padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6,
          minWidth: 140,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', color: safetyColor }}>
            {stateLabel}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', lineHeight: 1 }}>
            {Math.round(remainingDistance || 0)}
            <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8', marginLeft: 3 }}>m</span>
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>
            ~{Math.round((estimatedTime || 0) / 60)} min remaining
          </div>
        </div>
  
        {/* Right: safety + hazards */}
        <div style={{
          background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
          padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6,
          alignItems: 'flex-end',
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', color: '#94a3b8' }}>
            ROUTE SAFETY
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: safetyColor, lineHeight: 1 }}>
            {Math.round((routeSafety || 0) * 100)}%
          </div>
          {hazardCount > 0 && (
            <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>
              ⚠ {hazardCount} hazard{hazardCount !== 1 ? 's' : ''} on route
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // ─── Walking3DView (default export) ──────────────────────────────────────────
  
  export default function Walking3DView({
    route            = [],
    hazards          = [],
    userPosition     = null,
    navigationState  = 'idle',
    routeSafety      = 0.8,
    remainingDistance = 0,
    estimatedTime    = 0,
    style            = {},
  }) {
    return (
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: '#0a0c14', borderRadius: 12, overflow: 'hidden',
        ...style,
      }}>
        <Canvas
          shadows
          gl={{
            antialias: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.15,
            powerPreference: 'high-performance',
          }}
          camera={{ fov: 55, near: 0.1, far: 600 }}
          style={{ width: '100%', height: '100%' }}
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
          hazardCount={hazards.length}
        />
  
        {/* Legend / orientation hint */}
        <div style={{
          position: 'absolute', bottom: 10, right: 12,
          fontSize: 8.5, color: 'rgba(148,163,184,0.4)',
          fontFamily: 'system-ui, sans-serif',
          pointerEvents: 'none',
        }}>
          3D WALKING VIEW · Pittsburgh
        </div>
      </div>
    );
  }