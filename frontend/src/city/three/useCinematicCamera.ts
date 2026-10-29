import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type CameraControlsImpl from 'camera-controls';
import { useCinematicStore } from '../stores/useCinematicStore';
import { useMapStore } from '../stores/useMapStore';
import { useUiModeStore } from '../stores/useUiModeStore';
import { DEFAULT_KIT } from '../types/kit';
import { gridFor } from '../utils/gridMath';

// Radians per second. Full revolution ≈ 2π / 0.05 ≈ 125 s — half the speed of
// the v1 cinematic, so the eye has time to settle on each side of the city.
const AZIMUTH_SPEED = 0.05;
// Tight framing: radius * 1.55 fills the viewport with the city and lets the
// recoil peak (~1.18 × base) stay well inside the comfortable zone.
const DISTANCE_FACTOR = 1.55;
const MIN_DISTANCE = 5;
const MAX_DISTANCE = 40;

// Continuous "breathing" of the distance around the framed value. ±15 % with
// a 30 s period — gentle approach + recoil without ever pulling the camera
// far from the city.
const DISTANCE_OSC_PERIOD_S = 30;
const DISTANCE_OSC_OMEGA = (2 * Math.PI) / DISTANCE_OSC_PERIOD_S;
const DISTANCE_OSC_AMPLITUDE = 0.15;
// Seconds spent easing from the user's current distance into the oscillating
// curve. Avoids a visible snap when toggling cinematic on.
const SETTLE_DURATION_S = 2.5;

interface Bounds {
  cx: number;
  cz: number;
  distance: number;
}

function computeBounds(cells: Iterable<{ q: number; r: number }>): Bounds {
  // Cell circumradius (vertex-to-center) pads the bounding sphere so corner
  // tiles aren't clipped by the frustum edge.
  const grid = gridFor(useMapStore.getState().kit ?? DEFAULT_KIT);
  let sumX = 0;
  let sumZ = 0;
  let count = 0;
  const positions: Array<{ x: number; z: number }> = [];
  for (const { q, r } of cells) {
    const { x, z } = grid.cellToWorld(q, r);
    positions.push({ x, z });
    sumX += x;
    sumZ += z;
    count += 1;
  }
  if (count === 0) {
    return { cx: 0, cz: 0, distance: MIN_DISTANCE };
  }
  const cx = sumX / count;
  const cz = sumZ / count;
  let maxR2 = 0;
  for (const { x, z } of positions) {
    const dx = x - cx;
    const dz = z - cz;
    const r2 = dx * dx + dz * dz;
    if (r2 > maxR2) maxR2 = r2;
  }
  const radius = Math.sqrt(maxR2) + grid.cellCircumradius;
  const distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, radius * DISTANCE_FACTOR));
  return { cx, cz, distance };
}

/** Drives a slow horizontal orbit around the city centre when
 *  `useCinematicStore.active` is true. Mounted inside SceneInner so it
 *  has access to the R3F frame loop and the canvas DOM element. */
export function useCinematicCamera(
  cameraControlsRef: React.RefObject<CameraControlsImpl | null>,
) {
  const active = useCinematicStore((s) => s.active);
  const { gl } = useThree();
  const prevMaxDistanceRef = useRef<number | null>(null);
  const prevMinDistanceRef = useRef<number | null>(null);
  const orbitStateRef = useRef<{
    elapsed: number;
    startDistance: number;
    baseDistance: number;
  } | null>(null);

  // Activation effect: dolly + setTarget animated, wire stop triggers.
  useEffect(() => {
    if (!active) return;
    const controls = cameraControlsRef.current;
    if (!controls) {
      // Controls not yet mounted — stop and bail.
      useCinematicStore.getState().stop();
      return;
    }

    const cells = useMapStore.getState().cells;
    const { cx, cz, distance } = computeBounds(cells.values());

    // Headroom for the ±25 % distance oscillation peaks + a bit of slack.
    prevMaxDistanceRef.current = controls.maxDistance;
    controls.maxDistance = Math.max(controls.maxDistance, distance * 1.3 + 5);
    prevMinDistanceRef.current = controls.minDistance;
    controls.minDistance = Math.min(controls.minDistance, Math.max(2, distance * 0.7));

    orbitStateRef.current = {
      elapsed: 0,
      startDistance: controls.distance,
      baseDistance: distance,
    };

    void controls.setTarget(cx, 0, cz, true);

    const stop = () => useCinematicStore.getState().stop();

    // Mouse / touch drag — fires before the gesture changes the camera.
    controls.addEventListener('controlstart', stop);

    // Mouse wheel does not emit 'controlstart' (see camera-controls docs);
    // listen on the canvas DOM in capture so we catch it pre-zoom.
    const canvas = gl.domElement;
    const onWheel = () => stop();
    canvas.addEventListener('wheel', onWheel, { passive: true });

    // Leaving View mode (e.g., user switches to Builder) also stops.
    const unsubMode = useUiModeStore.subscribe((state, prev) => {
      if (state.mode !== 'view' && prev.mode === 'view') stop();
    });

    return () => {
      controls.removeEventListener('controlstart', stop);
      canvas.removeEventListener('wheel', onWheel);
      unsubMode();
      if (prevMaxDistanceRef.current !== null) {
        controls.maxDistance = prevMaxDistanceRef.current;
        prevMaxDistanceRef.current = null;
      }
      if (prevMinDistanceRef.current !== null) {
        controls.minDistance = prevMinDistanceRef.current;
        prevMinDistanceRef.current = null;
      }
      orbitStateRef.current = null;
    };
  }, [active, cameraControlsRef, gl]);

  // Per-frame orbit + breathing zoom. Both `azimuthAngle` and `distance` are
  // mutable on CameraControls (see CameraControls.d.ts:349, :355).
  useFrame((_, delta) => {
    if (!active) return;
    const controls = cameraControlsRef.current;
    const state = orbitStateRef.current;
    if (!controls || !state) return;

    state.elapsed += delta;
    controls.azimuthAngle += AZIMUTH_SPEED * delta;

    // Smoothstep ease-in so the oscillation fades in from 0 and the distance
    // smoothly transitions from the user's current value to the curve.
    const settleT = Math.min(1, state.elapsed / SETTLE_DURATION_S);
    const settled = settleT * settleT * (3 - 2 * settleT);
    const oscillation = 1 + DISTANCE_OSC_AMPLITUDE * Math.sin(DISTANCE_OSC_OMEGA * state.elapsed) * settled;
    const targetDistance = state.baseDistance * oscillation;
    controls.distance = state.startDistance + (targetDistance - state.startDistance) * settled;
  });
}
