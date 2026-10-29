import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRealtimeStore } from '../../stores/useRealtimeStore';

/** Deploying = soft grey smoke column. Failed = a proper bonfire: many
 *  volumetric fire particles, pulsing orange point-light, and a faint
 *  halo on the ground so the building screams "on fire" from across
 *  the map. */
const SMOKE_PARTICLES = 30;
const FIRE_PARTICLES = 80;
const MAX_PARTICLES = Math.max(SMOKE_PARTICLES, FIRE_PARTICLES);

/** Red-orange-yellow palette — indexed by particle age, warm at spawn,
 *  cooling to red/smoke as they rise. */
const FIRE_COLOR_HOT = new THREE.Color(0xfff2a1);
const FIRE_COLOR_MID = new THREE.Color(0xff6e1f);
const FIRE_COLOR_COOL = new THREE.Color(0x661a0c);
/** Reusable scratch color for the per-particle flame lerp, so the hot loop
 *  (up to 80 particles × 60fps per burning building) doesn't allocate. */
const _fireScratch = new THREE.Color();

interface StatusParticlesProps {
  position: [number, number, number];
  appId?: string;
  addonId?: string;
  monitorId?: string;
}

/**
 * Smoke / flames floating above a resource-bound building:
 * - `deploying` → light grey smoke, slow rise (indicates "still warming up")
 * - `failed` / unhealthy addon / `critical` monitor → volumetric fire: rising
 *   yellow→red particles + pulsing orange point-light + ground halo
 * - anything else → nothing rendered
 *
 * A single `THREE.Points` backs the particles for both states — their
 * colour attribute and count are swapped based on the active kind.
 */
export function StatusParticles({ position, appId, addonId, monitorId }: StatusParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const haloRef = useRef<THREE.Mesh>(null);

  const appStatus = useRealtimeStore((s) =>
    appId ? (s.apps[appId]?.status ?? null) : null,
  );
  const addonHealthy = useRealtimeStore((s) =>
    addonId ? (s.addons[addonId]?.healthy ?? null) : null,
  );
  const monitorState = useRealtimeStore((s) =>
    monitorId ? (s.monitors[monitorId]?.state ?? null) : null,
  );

  let kind: 'smoke' | 'flame' | null = null;
  if (appStatus === 'deploying') kind = 'smoke';
  else if (appStatus === 'failed') kind = 'flame';
  else if (addonId && addonHealthy === false) kind = 'flame';
  else if (monitorId && monitorState === 'critical') kind = 'flame';

  const { positions, colors, velocities, ages, lifetimes } = useMemo(() => {
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const velocities = new Float32Array(MAX_PARTICLES * 3);
    const ages = new Float32Array(MAX_PARTICLES);
    const lifetimes = new Float32Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      ages[i] = Math.random() * 2;
      lifetimes[i] = 1.5 + Math.random() * 1.5;
      // Initialise to hot colour so the first frame doesn't flash white.
      colors[i * 3] = FIRE_COLOR_HOT.r;
      colors[i * 3 + 1] = FIRE_COLOR_HOT.g;
      colors[i * 3 + 2] = FIRE_COLOR_HOT.b;
    }
    return { positions, colors, velocities, ages, lifetimes };
  }, []);

  useFrame(({ clock }, delta) => {
    if (!kind) return;
    const activeCount = kind === 'flame' ? FIRE_PARTICLES : SMOKE_PARTICLES;

    // Material knobs
    const mat = materialRef.current;
    if (mat) {
      mat.size = kind === 'smoke' ? 0.28 : 0.35;
      mat.opacity = kind === 'smoke' ? 0.55 : 0.92;
      // For smoke we want a uniform grey; disable vertexColors and override.
      mat.vertexColors = kind === 'flame';
      if (kind === 'smoke') mat.color.setHex(0x8a8a8a);
      else mat.color.setHex(0xffffff); // let vertex colors drive
    }

    // Pulsing point light + ground halo, only for fire.
    const t = clock.getElapsedTime();
    const pulse = 0.8 + 0.4 * Math.sin(t * 8);
    if (lightRef.current) {
      lightRef.current.visible = kind === 'flame';
      if (kind === 'flame') lightRef.current.intensity = pulse * 1.6;
    }
    if (haloRef.current) {
      haloRef.current.visible = kind === 'flame';
      if (kind === 'flame') {
        const mat = haloRef.current.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.3 + 0.25 * Math.sin(t * 5);
      }
    }

    // Particle motion
    const geom = pointsRef.current?.geometry as THREE.BufferGeometry | undefined;
    const posAttr = geom?.attributes.position as THREE.BufferAttribute | undefined;
    const colAttr = geom?.attributes.color as THREE.BufferAttribute | undefined;
    if (!geom || !posAttr || !colAttr) return;

    geom.setDrawRange(0, activeCount);

    for (let i = 0; i < activeCount; i++) {
      ages[i]! += delta;
      if (ages[i]! >= lifetimes[i]!) {
        ages[i] = 0;
        lifetimes[i] = kind === 'flame' ? 0.9 + Math.random() * 0.8 : 1.5 + Math.random() * 1.5;
        // Spread spawn points around the base for fire (wider plume).
        const spread = kind === 'flame' ? 0.55 : 0.25;
        positions[i * 3] = (Math.random() - 0.5) * spread;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
        const vy = kind === 'smoke' ? 0.25 + Math.random() * 0.15 : 0.8 + Math.random() * 0.6;
        velocities[i * 3] = (Math.random() - 0.5) * 0.15;
        velocities[i * 3 + 1] = vy;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
      }
      positions[i * 3]! += velocities[i * 3]! * delta;
      positions[i * 3 + 1]! += velocities[i * 3 + 1]! * delta;
      positions[i * 3 + 2]! += velocities[i * 3 + 2]! * delta;

      if (kind === 'flame') {
        // Map age 0..1 → hot → mid → cool (two-segment lerp).
        const p = ages[i]! / lifetimes[i]!;
        const c = _fireScratch;
        if (p < 0.5) c.lerpColors(FIRE_COLOR_HOT, FIRE_COLOR_MID, p * 2);
        else c.lerpColors(FIRE_COLOR_MID, FIRE_COLOR_COOL, (p - 0.5) * 2);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
    }
    posAttr.needsUpdate = true;
    if (kind === 'flame') colAttr.needsUpdate = true;
  });

  if (!kind) return null;

  return (
    <group position={position}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
            count={MAX_PARTICLES}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[colors, 3]}
            count={MAX_PARTICLES}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          ref={materialRef}
          size={0.35}
          transparent
          opacity={0.92}
          depthWrite={false}
          sizeAttenuation
          toneMapped={false}
          vertexColors
        />
      </points>

      {/* Orange point-light flickers above the building. Only visible when
          flaming; `useFrame` toggles `visible` and updates `intensity`. */}
      <pointLight
        ref={lightRef}
        color={0xff7a2a}
        intensity={1.0}
        distance={4.5}
        decay={2}
        position={[0, 0.3, 0]}
        visible={false}
      />

      {/* Flat halo on the ground. Not quite at y=-0.9 so it sits on top of
          the hex tile without z-fighting. */}
      <mesh
        ref={haloRef}
        position={[0, -0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <circleGeometry args={[0.9, 32]} />
        <meshBasicMaterial
          color={0xff2a00}
          transparent
          opacity={0.4}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
