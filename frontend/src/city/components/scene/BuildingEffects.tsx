import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRealtimeStore } from '../../stores/useRealtimeStore';
import { parseBuildingId } from '../../data/buildingSkins';

/** KayKit buildings are merged single-node meshes, so we can't find a
 *  named `chimney` child. Hand-tuned offsets per building type instead
 *  (local coords inside the hex group, y-up). Tweak these after visually
 *  verifying in the scene. */
const CHIMNEY_OFFSETS: Record<string, [number, number, number]> = {
  home_A: [0.18, 0.85, -0.1],
  home_B: [-0.15, 0.8, 0.12],
  tavern: [0.2, 0.9, -0.15],
  blacksmith: [0.25, 0.9, -0.1],
  workshop: [-0.2, 0.85, -0.1],
  townhall: [0.3, 1.25, 0.1],
};

const MINE_ENTRANCE: [number, number, number] = [0, 0.1, 0.45];
const FORGE_ORIGIN: [number, number, number] = [0.2, 0.45, 0.05];
const FLAG_TOP: Record<string, [number, number, number]> = {
  castle: [0, 1.75, 0],
  townhall: [0, 1.55, 0],
  church: [0, 1.7, 0],
};
const LANTERN_TOP: Record<string, [number, number, number]> = {
  watchtower: [0, 1.7, 0],
  tower_A: [0, 1.65, 0],
  tower_B: [0, 1.75, 0],
  tower_base: [0, 1.5, 0],
  tower_cannon: [0, 1.6, 0],
  tower_catapult: [0, 1.5, 0],
};

/** Mount point for per-building-type ambient + CPU-driven effects.
 *  Nothing here is a hard failure — a new KayKit asset that doesn't match
 *  any known building type just gets the silent default. */
export function BuildingEffects({
  position,
  buildingId,
  appId,
  addonId,
}: {
  position: [number, number, number];
  buildingId: string | undefined;
  appId: string | undefined;
  addonId: string | undefined;
}) {
  const buildingType = buildingId ? parseBuildingId(buildingId)?.type : null;

  const status = useRealtimeStore((s) =>
    appId ? s.apps[appId]?.status ?? null : null,
  );
  const cpuPct = useRealtimeStore((s) =>
    appId ? s.apps[appId]?.cpuPct ?? null : null,
  );

  const running = status === 'running' || (!appId && Boolean(addonId));
  const chimneyOff = buildingType ? CHIMNEY_OFFSETS[buildingType] : undefined;

  return (
    <group position={position}>
      {running && chimneyOff && (
        <ChimneySmoke origin={chimneyOff} cpuPct={cpuPct} />
      )}
      {running && buildingType === 'mine' && (
        <MineDust origin={MINE_ENTRANCE} cpuPct={cpuPct} />
      )}
      {buildingType === 'blacksmith' && (
        <BlacksmithSparks origin={FORGE_ORIGIN} running={running} />
      )}
      {buildingType && FLAG_TOP[buildingType] && (
        <ProceduralFlag origin={FLAG_TOP[buildingType]!} />
      )}
      {buildingType && LANTERN_TOP[buildingType] && (
        <WatchtowerLight origin={LANTERN_TOP[buildingType]!} />
      )}
    </group>
  );
}

// ---------- Chimney smoke ------------------------------------------------

function ChimneySmoke({
  origin,
  cpuPct,
}: {
  origin: [number, number, number];
  cpuPct: number | null;
}) {
  const COUNT = 40;
  const { positions, ages, lifetimes, seeds } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const ages = new Float32Array(COUNT);
    const lifetimes = new Float32Array(COUNT);
    const seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      ages[i] = Math.random() * 2;
      lifetimes[i] = 2 + Math.random() * 1.5;
      seeds[i] = Math.random();
    }
    return { positions, ages, lifetimes, seeds };
  }, []);

  const pointsRef = useRef<THREE.Points>(null);

  useFrame((_, delta) => {
    // Density scales from ~idle (0.3x) at 0% CPU to 1.0 at 80%+ CPU. When
    // cpuPct is unknown (first connection), show a modest plume so the
    // app still reads as "alive".
    const cpu = cpuPct == null ? 20 : Math.min(100, Math.max(0, cpuPct));
    const densityMul = 0.3 + 0.7 * Math.min(1, cpu / 80);

    const geom = pointsRef.current?.geometry as THREE.BufferGeometry | undefined;
    const posAttr = geom?.attributes.position as THREE.BufferAttribute | undefined;
    if (!geom || !posAttr) return;
    const active = Math.max(6, Math.floor(COUNT * densityMul));
    geom.setDrawRange(0, active);

    for (let i = 0; i < active; i++) {
      ages[i]! += delta;
      if (ages[i]! >= lifetimes[i]!) {
        ages[i] = 0;
        positions[i * 3] = (seeds[i]! - 0.5) * 0.08;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 0.08;
      }
      // Rises, drifts horizontally with a small swirl; particles widen as
      // they age (smoke column → diffusion).
      const agePct = ages[i]! / lifetimes[i]!;
      positions[i * 3 + 1]! += (0.25 + 0.35 * densityMul) * delta;
      positions[i * 3]! += Math.sin(agePct * 3 + seeds[i]! * 10) * 0.02 * delta;
      positions[i * 3 + 2]! += Math.cos(agePct * 3 + seeds[i]! * 10) * 0.02 * delta;
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} position={origin}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={COUNT}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.22}
        color={0xc8c4be}
        transparent
        opacity={0.45}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// ---------- Mine dust ----------------------------------------------------

function MineDust({
  origin,
  cpuPct,
}: {
  origin: [number, number, number];
  cpuPct: number | null;
}) {
  const COUNT = 25;
  const { positions, ages, lifetimes, seeds } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const ages = new Float32Array(COUNT);
    const lifetimes = new Float32Array(COUNT);
    const seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      ages[i] = Math.random() * 2;
      lifetimes[i] = 1.2 + Math.random() * 0.8;
      seeds[i] = Math.random();
    }
    return { positions, ages, lifetimes, seeds };
  }, []);

  const pointsRef = useRef<THREE.Points>(null);

  useFrame((_, delta) => {
    const cpu = cpuPct == null ? 20 : Math.min(100, Math.max(0, cpuPct));
    const densityMul = 0.3 + 0.7 * Math.min(1, cpu / 80);

    const geom = pointsRef.current?.geometry as THREE.BufferGeometry | undefined;
    const posAttr = geom?.attributes.position as THREE.BufferAttribute | undefined;
    if (!geom || !posAttr) return;
    const active = Math.max(4, Math.floor(COUNT * densityMul));
    geom.setDrawRange(0, active);

    for (let i = 0; i < active; i++) {
      ages[i]! += delta;
      if (ages[i]! >= lifetimes[i]!) {
        ages[i] = 0;
        positions[i * 3] = (seeds[i]! - 0.5) * 0.25;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 0;
      }
      // Low, forward-drifting puffs — dust spills out of the entrance,
      // stays close to the ground.
      positions[i * 3 + 1]! += 0.08 * delta;
      positions[i * 3 + 2]! += (0.25 + 0.2 * densityMul) * delta;
      positions[i * 3]! += Math.sin(seeds[i]! * 8 + ages[i]! * 3) * 0.01 * delta;
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} position={origin}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={COUNT}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.16}
        color={0xa5937a}
        transparent
        opacity={0.55}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// ---------- Blacksmith sparks + glow ------------------------------------

function BlacksmithSparks({
  origin,
  running,
}: {
  origin: [number, number, number];
  running: boolean;
}) {
  const COUNT = 20;
  const { positions, ages, lifetimes, velocities } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const ages = new Float32Array(COUNT);
    const lifetimes = new Float32Array(COUNT);
    const velocities = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      ages[i] = Math.random() * 1.2;
      lifetimes[i] = 0.6 + Math.random() * 0.6;
    }
    return { positions, ages, lifetimes, velocities };
  }, []);

  const pointsRef = useRef<THREE.Points>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    // Simulated hammer beats: bursts at roughly 1.3 s interval; the strike
    // flashes the forge light.
    const beat = Math.abs(Math.sin(t * 2.4));
    const intensity = running ? 0.8 + 2.2 * beat : 0.35 + 0.15 * beat;
    if (lightRef.current) {
      lightRef.current.intensity = intensity;
    }

    const geom = pointsRef.current?.geometry as THREE.BufferGeometry | undefined;
    const posAttr = geom?.attributes.position as THREE.BufferAttribute | undefined;
    if (!geom || !posAttr) return;

    for (let i = 0; i < COUNT; i++) {
      ages[i]! += delta;
      if (ages[i]! >= lifetimes[i]!) {
        // Spark bursts correlate with the beat — spawn more when beat > 0.85.
        // The hold probability was a per-frame 0.8 tuned at 60 fps; express it
        // per 60fps-frame-equivalent so the spawn RATE is frame-rate
        // independent (identical at 60 fps, correct at the 30 fps cap).
        if (beat < 0.85 && Math.random() < Math.pow(0.8, delta * 60)) {
          ages[i] = lifetimes[i]! - 0.01;
          continue;
        }
        ages[i] = 0;
        positions[i * 3] = (Math.random() - 0.5) * 0.1;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
        velocities[i * 3] = (Math.random() - 0.5) * 0.6;
        velocities[i * 3 + 1] = 0.5 + Math.random() * 0.6;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
      }
      // Gravity + drag
      velocities[i * 3 + 1]! -= 1.2 * delta;
      positions[i * 3]! += velocities[i * 3]! * delta;
      positions[i * 3 + 1]! += velocities[i * 3 + 1]! * delta;
      positions[i * 3 + 2]! += velocities[i * 3 + 2]! * delta;
    }
    posAttr.needsUpdate = true;
  });

  return (
    <group position={origin}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
            count={COUNT}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.08}
          color={0xffb347}
          transparent
          opacity={0.95}
          depthWrite={false}
          sizeAttenuation
          toneMapped={false}
        />
      </points>
      <pointLight ref={lightRef} color={0xff6a1a} distance={2.5} decay={2} intensity={1.2} />
    </group>
  );
}

// ---------- Procedural flag ---------------------------------------------

function ProceduralFlag({ origin }: { origin: [number, number, number] }) {
  // A thin cloth quad on a pole. Waves via vertex displacement in a
  // vertex shader emulated with a three-material onBeforeCompile? Overkill.
  // Cheaper: rotate the flag mesh in sinus + skew its scale x to fake wave.
  const flagRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (flagRef.current) {
      flagRef.current.rotation.y = 0.1 + 0.15 * Math.sin(t * 2);
      flagRef.current.scale.x = 1 + 0.1 * Math.sin(t * 3);
    }
  });

  // Rendered geometry: pole (thin cylinder) + flag plane attached at the top
  return (
    <group position={origin}>
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.4, 6]} />
        <meshStandardMaterial color={0x6e4a2a} />
      </mesh>
      <mesh ref={flagRef} position={[0.12, 0.28, 0]}>
        <planeGeometry args={[0.22, 0.14, 4, 2]} />
        <meshStandardMaterial color={0xa51050} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ---------- Watchtower spotlight ---------------------------------------

function WatchtowerLight({ origin }: { origin: [number, number, number] }) {
  const pivotRef = useRef<THREE.Group>(null);
  const spotRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);

  // Wire the spotlight's target imperatively: on first render `targetRef.current`
  // is still null, and a later ref assignment doesn't re-render — so passing it
  // as a prop left the light aiming at its default origin target instead of down
  // the +x sweep.
  useEffect(() => {
    if (spotRef.current && targetRef.current) {
      spotRef.current.target = targetRef.current;
    }
  }, []);

  useFrame(({ clock }) => {
    if (pivotRef.current) {
      pivotRef.current.rotation.y = clock.getElapsedTime() * 0.8;
    }
  });

  return (
    <group ref={pivotRef} position={origin}>
      <object3D ref={targetRef} position={[3, -0.5, 0]} />
      <spotLight
        ref={spotRef}
        color={0xffd58a}
        intensity={2.5}
        distance={6}
        angle={0.45}
        penumbra={0.3}
        decay={1.5}
        position={[0, 0, 0]}
      />
    </group>
  );
}
