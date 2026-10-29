import { useRef } from 'react';
import type * as THREE from 'three';
import { useAnimationStore } from '../../stores/useAnimationStore';
import { useAssetStore } from '../../stores/useAssetStore';
import { useTraffic } from '../../three/useTraffic';

/** Metric-driven city traffic (carts / spacetrucks between buildings). The
 *  inner component is mounted only when assets are cached and the toggle is
 *  on — unmounting despawns the whole pool via useTraffic's cleanup. */
export function TrafficSystem() {
  const isLoaded = useAssetStore((s) => s.isLoaded);
  const trafficEnabled = useAnimationStore((s) => s.trafficEnabled);
  if (!isLoaded || !trafficEnabled) return null;
  return <TrafficPool />;
}

function TrafficPool() {
  const groupRef = useRef<THREE.Group>(null);
  useTraffic(groupRef);
  return <group ref={groupRef} />;
}
