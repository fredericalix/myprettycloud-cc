import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useAnimationStore } from '../stores/useAnimationStore';

// Leaves
const LEAF_COUNT = 60;
const LEAF_BOUNDS = 10;
const LEAF_Y_MIN = 0;
const LEAF_Y_MAX = 4;

// Smoke
const SMOKE_PER_EMITTER = 12;
const SMOKE_Y_MAX = 3.0;

// Fireflies
const FIREFLY_COUNT = 40;
const FIREFLY_BOUNDS = 8;

function resetLeaf(positions: Float32Array, velocities: Float32Array, i: number) {
  const i3 = i * 3;
  positions[i3] = (Math.random() - 0.5) * LEAF_BOUNDS * 2;
  positions[i3 + 1] = LEAF_Y_MIN + Math.random() * (LEAF_Y_MAX - LEAF_Y_MIN);
  positions[i3 + 2] = (Math.random() - 0.5) * LEAF_BOUNDS * 2;
  velocities[i3] = (Math.random() - 0.3) * 0.3;
  velocities[i3 + 1] = -(0.15 + Math.random() * 0.2);
  velocities[i3 + 2] = (Math.random() - 0.5) * 0.2;
}

function resetSmoke(
  positions: Float32Array,
  lifetimes: Float32Array,
  origins: THREE.Vector3[],
  i: number,
) {
  const emitterIdx = Math.floor(i / SMOKE_PER_EMITTER);
  const origin = origins[emitterIdx];
  if (!origin) return;
  const i3 = i * 3;
  positions[i3] = origin.x + (Math.random() - 0.5) * 0.08;
  positions[i3 + 1] = origin.y;
  positions[i3 + 2] = origin.z + (Math.random() - 0.5) * 0.08;
  lifetimes[i] = Math.random();
}

export interface ParticleData {
  leafPositions: Float32Array;
  leafVelocities: Float32Array;
  leafColors: Float32Array;
  leafGeometry: THREE.BufferGeometry;
  smokePositions: Float32Array;
  smokeLifetimes: Float32Array;
  smokeGeometry: THREE.BufferGeometry;
  smokeCount: number;
  smokeOrigins: THREE.Vector3[];
  fireflyPositions: Float32Array;
  fireflyPhases: Float32Array;
  fireflyGeometry: THREE.BufferGeometry;
  fireflyMaterial: THREE.PointsMaterial;
}

export function createParticleData(smokeEmitters: THREE.Vector3[]): ParticleData {
  // Leaves
  const leafPositions = new Float32Array(LEAF_COUNT * 3);
  const leafVelocities = new Float32Array(LEAF_COUNT * 3);
  const leafColors = new Float32Array(LEAF_COUNT * 3);
  const leafGeometry = new THREE.BufferGeometry();

  for (let i = 0; i < LEAF_COUNT; i++) {
    resetLeaf(leafPositions, leafVelocities, i);
    const c = new THREE.Color().setHSL(
      0.08 + Math.random() * 0.1,
      0.7,
      0.45 + Math.random() * 0.2,
    );
    leafColors[i * 3] = c.r;
    leafColors[i * 3 + 1] = c.g;
    leafColors[i * 3 + 2] = c.b;
  }
  leafGeometry.setAttribute('position', new THREE.BufferAttribute(leafPositions, 3));
  leafGeometry.setAttribute('color', new THREE.BufferAttribute(leafColors, 3));

  // Smoke
  const smokeCount = smokeEmitters.length * SMOKE_PER_EMITTER;
  const smokePositions = new Float32Array(smokeCount * 3);
  const smokeLifetimes = new Float32Array(smokeCount);
  const smokeGeometry = new THREE.BufferGeometry();

  for (let i = 0; i < smokeCount; i++) {
    resetSmoke(smokePositions, smokeLifetimes, smokeEmitters, i);
  }
  smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));

  // Fireflies
  const fireflyPositions = new Float32Array(FIREFLY_COUNT * 3);
  const fireflyPhases = new Float32Array(FIREFLY_COUNT);
  const fireflyGeometry = new THREE.BufferGeometry();

  for (let i = 0; i < FIREFLY_COUNT; i++) {
    fireflyPositions[i * 3] = (Math.random() - 0.5) * FIREFLY_BOUNDS * 2;
    fireflyPositions[i * 3 + 1] = 0.5 + Math.random() * 2;
    fireflyPositions[i * 3 + 2] = (Math.random() - 0.5) * FIREFLY_BOUNDS * 2;
    fireflyPhases[i] = Math.random() * Math.PI * 2;
  }
  fireflyGeometry.setAttribute('position', new THREE.BufferAttribute(fireflyPositions, 3));

  const fireflyMaterial = new THREE.PointsMaterial({
    size: 0.1,
    color: 0xffee66,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  return {
    leafPositions,
    leafVelocities,
    leafColors,
    leafGeometry,
    smokePositions,
    smokeLifetimes,
    smokeGeometry,
    smokeCount,
    smokeOrigins: smokeEmitters,
    fireflyPositions,
    fireflyPhases,
    fireflyGeometry,
    fireflyMaterial,
  };
}

export function useParticleAnimation(
  data: React.RefObject<ParticleData | null>,
  daylightRef: React.RefObject<number>,
) {
  const prevTimeRef = useRef(performance.now());

  useFrame(() => {
    if (!useAnimationStore.getState().particlesEnabled) return;
    const d = data.current;
    if (!d) return;

    const now = performance.now();
    const delta = (now - prevTimeRef.current) / 1000;
    const elapsed = now / 1000;
    prevTimeRef.current = now;

    // Leaves
    for (let i = 0; i < LEAF_COUNT; i++) {
      const i3 = i * 3;
      const wobble = Math.sin(elapsed * 2 + i * 1.7) * 0.15;
      d.leafPositions[i3]! += (d.leafVelocities[i3]! + wobble) * delta;
      d.leafPositions[i3 + 1]! += d.leafVelocities[i3 + 1]! * delta;
      d.leafPositions[i3 + 2]! += (d.leafVelocities[i3 + 2]! + wobble * 0.5) * delta;

      if (
        d.leafPositions[i3 + 1]! < LEAF_Y_MIN ||
        Math.abs(d.leafPositions[i3]!) > LEAF_BOUNDS ||
        Math.abs(d.leafPositions[i3 + 2]!) > LEAF_BOUNDS
      ) {
        resetLeaf(d.leafPositions, d.leafVelocities, i);
        d.leafPositions[i3 + 1] = LEAF_Y_MAX;
      }
    }
    d.leafGeometry.attributes.position!.needsUpdate = true;

    // Smoke
    for (let i = 0; i < d.smokeCount; i++) {
      const i3 = i * 3;
      d.smokeLifetimes[i]! += delta * 0.3;
      d.smokePositions[i3 + 1]! += delta * 0.25;
      d.smokePositions[i3]! += delta * 0.02;

      const originY = d.smokeOrigins[Math.floor(i / SMOKE_PER_EMITTER)]?.y ?? 0;
      if (d.smokeLifetimes[i]! > 1.0 || d.smokePositions[i3 + 1]! > SMOKE_Y_MAX + originY) {
        resetSmoke(d.smokePositions, d.smokeLifetimes, d.smokeOrigins, i);
      }
    }
    d.smokeGeometry.attributes.position!.needsUpdate = true;

    // Fireflies
    const daylight = daylightRef.current ?? 1;
    const nightness = 1 - daylight;
    const visibility = Math.max(0, (nightness - 0.4) / 0.6);
    d.fireflyMaterial.opacity = visibility * 0.8;

    if (visibility > 0) {
      // The drift constants were tuned per-frame at 60 fps; normalise by
      // delta so the speed is frame-rate independent (30 fps render cap).
      const f = delta * 60;
      for (let i = 0; i < FIREFLY_COUNT; i++) {
        const i3 = i * 3;
        const phase = d.fireflyPhases[i]!;
        d.fireflyPositions[i3]! += Math.sin(elapsed * 0.5 + phase) * 0.005 * f;
        d.fireflyPositions[i3 + 1]! += Math.sin(elapsed * 0.3 + phase * 1.5) * 0.003 * f;
        d.fireflyPositions[i3 + 2]! += Math.cos(elapsed * 0.4 + phase * 0.8) * 0.005 * f;
      }
      d.fireflyGeometry.attributes.position!.needsUpdate = true;
    }
  });
}
