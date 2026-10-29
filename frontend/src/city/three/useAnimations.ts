import { useRef } from 'react';
import type * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useAnimationStore } from '../stores/useAnimationStore';
import { useRealtimeStore } from '../stores/useRealtimeStore';

// Clouds wrap around a square of ±CLOUD_BOUNDS metres centred on the
// origin. The camera's far plane is 100, the fog ends at 45, so 20 is
// comfortably outside view — they fade into the fog before wrapping and
// emerge from the opposite side already occluded.
const CLOUD_BOUNDS = 20;
const WATER_UPDATE_INTERVAL = 1 / 20;

/**
 * Picks a rotation-speed multiplier for a building animatable (windmill fan
 * or watermill wheel) based on the live CC status + CPU of the resource it's
 * bound to. `userData.resourceId` is attached in HexTile when the cell has an
 * appId / addonId.
 *
 * Reads `useRealtimeStore.getState()` imperatively (no subscribe) — this
 * function runs inside useFrame, we don't want a store subscribe to trigger
 * re-renders.
 */
function animationSpeedFor(obj: THREE.Object3D, elapsed: number): number {
  const resourceId = obj.userData.resourceId as string | null | undefined;
  if (!resourceId) return 1; // unmapped building: default spin

  const rt = useRealtimeStore.getState();
  const app = rt.apps[resourceId];
  const addon = rt.addons[resourceId];
  const monitor = rt.monitors[resourceId];

  // Synthetic monitor: critical freezes the building's animations (it's "on
  // fire" — StatusParticles), warning labours, ok spins normally.
  if (monitor && !app && !addon) {
    if (monitor.state === 'critical') return 0;
    if (monitor.state === 'warning') return 0.7;
    return 1;
  }

  // Addon: binary healthy → 1, unhealthy → 0.
  if (addon && !app) {
    return addon.healthy ? 1 : 0;
  }

  if (!app) return 1;
  switch (app.status) {
    case 'stopped':
    case 'failed':
      return 0;
    case 'deploying': {
      // Irregular "priming" stutter: mostly on, small stops.
      const flicker = Math.sin(elapsed * 6) > 0.4 ? 0.6 : 0.15;
      return flicker;
    }
    case 'warning':
      return 0.7;
    case 'running': {
      if (app.cpuPct == null) return 1;
      // Non-linear ramp: gentle at idle, aggressive past 80% so a
      // saturated app reads as "full throttle" at a glance.
      //   0%   → 0.3    (barely turning)
      //   50%  → ~1.6
      //   80%  → ~3.4
      //   90%  → ~4.4
      //   100% → 5.0    (windmill clearly ripping)
      const norm = Math.min(1, Math.max(0, app.cpuPct / 100));
      return 0.3 + Math.pow(norm, 1.8) * 4.7;
    }
    default:
      return 1;
  }
}

interface AnimationRegistry {
  windmillFans: THREE.Object3D[];
  watermillWheels: THREE.Object3D[];
  clouds: THREE.Object3D[];
  trees: THREE.Object3D[];
  boats: THREE.Object3D[];
  flags: THREE.Object3D[];
  waterTiles: THREE.Object3D[];
}

export function useAnimations(registry: React.RefObject<AnimationRegistry | null>) {
  const prevTimeRef = useRef(performance.now());
  const waterAccRef = useRef(0);

  useFrame(() => {
    const now = performance.now();
    const delta = (now - prevTimeRef.current) / 1000;
    const elapsed = now / 1000;
    prevTimeRef.current = now;

    const reg = registry.current;
    if (!reg) return;

    const { windEnabled, waterEnabled } = useAnimationStore.getState();
    if (!windEnabled && !waterEnabled) return;

    if (windEnabled) {
      for (const fan of reg.windmillFans) {
        fan.rotation.z += 1.0 * delta * animationSpeedFor(fan, elapsed);
      }
      for (const wheel of reg.watermillWheels) {
        wheel.rotation.z += 0.8 * delta * animationSpeedFor(wheel, elapsed);
      }
      for (const cloud of reg.clouds) {
        const vel = cloud.userData.velocity as { x: number; z: number };
        const phase = cloud.userData.phase as number;
        cloud.position.x += vel.x * delta;
        cloud.position.z += vel.z * delta;
        // 0.002 was a per-frame increment tuned at 60 fps — normalise by
        // delta so the bobbing speed survives the 30 fps render cap.
        cloud.position.y += Math.sin(elapsed * 0.3 + phase) * 0.002 * (delta * 60);
        // Wrap on both axes in both directions. Previously only x > B and
        // z > B were wrapped, so clouds with negative velocity or at a
        // diagonal drifted to +∞ and never came back.
        if (cloud.position.x > CLOUD_BOUNDS) cloud.position.x = -CLOUD_BOUNDS;
        else if (cloud.position.x < -CLOUD_BOUNDS) cloud.position.x = CLOUD_BOUNDS;
        if (cloud.position.z > CLOUD_BOUNDS) cloud.position.z = -CLOUD_BOUNDS;
        else if (cloud.position.z < -CLOUD_BOUNDS) cloud.position.z = CLOUD_BOUNDS;
      }
      for (const tree of reg.trees) {
        const phase = tree.userData.phase as number;
        tree.rotation.z = Math.sin(elapsed * 0.5 + phase) * 0.015;
        tree.rotation.x = Math.sin(elapsed * 0.7 + phase * 1.3) * 0.01;
      }
      for (const boat of reg.boats) {
        const baseY = (boat.userData.baseY as number) ?? 0;
        const phase = boat.userData.phase as number;
        boat.position.y = baseY + Math.sin(elapsed * 0.8 + phase) * 0.03;
        boat.rotation.z = Math.sin(elapsed * 0.6 + phase) * 0.04;
        boat.rotation.x = Math.sin(elapsed * 0.4 + phase * 0.7) * 0.02;
      }
      for (const flag of reg.flags) {
        const phase = flag.userData.phase as number;
        flag.rotation.z = Math.sin(elapsed * 2.0 + phase) * 0.08;
        flag.rotation.x = Math.sin(elapsed * 1.5 + phase * 1.2) * 0.04;
      }
    }

    if (waterEnabled) {
      waterAccRef.current += delta;
      if (waterAccRef.current >= WATER_UPDATE_INTERVAL) {
        waterAccRef.current = 0;
        for (const tile of reg.waterTiles) {
          const baseY = (tile.userData.baseY as number) ?? 0;
          const px = tile.position.x;
          const pz = tile.position.z;
          tile.position.y = baseY + Math.sin(elapsed * 0.6 + px * 0.5 + pz * 0.3) * 0.02;
        }
      }
    }
  });
}
