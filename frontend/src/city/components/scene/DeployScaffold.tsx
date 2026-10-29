import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRealtimeStore } from '../../stores/useRealtimeStore';

interface DeployScaffoldProps {
  position: [number, number, number];
  appId?: string;
  addonId?: string;
}

/**
 * A tiny wooden-looking frame (4 ocre pillars + 2 horizontal beams per side)
 * drawn around the building while it's in the `deploying` status. Oscillates
 * gently so it reads as "work in progress" rather than a permanent element.
 * Renders nothing for anything other than deploying.
 */
export function DeployScaffold({ position, appId }: DeployScaffoldProps) {
  const groupRef = useRef<THREE.Group>(null);

  const isDeploying = useRealtimeStore((s) =>
    appId ? s.apps[appId]?.status === 'deploying' : false,
  );

  useFrame(({ clock }) => {
    if (!isDeploying) return;
    const g = groupRef.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    g.position.y = position[1] + Math.sin(t * 1.8) * 0.05;
    g.rotation.y = t * 0.15;
  });

  if (!isDeploying) return null;

  const R = 0.9; // radius around the building
  const H = 0.9; // pillar height
  const PILLARS: Array<[number, number]> = [
    [R, R],
    [-R, R],
    [-R, -R],
    [R, -R],
  ];

  return (
    <group ref={groupRef} position={position}>
      {PILLARS.map(([x, z], i) => (
        <mesh key={i} position={[x, H / 2, z]}>
          <boxGeometry args={[0.06, H, 0.06]} />
          <meshStandardMaterial color={0xb07a3f} />
        </mesh>
      ))}
      {/* Two stacked horizontal rings */}
      {[0.3, 0.75].map((y) => (
        <group key={y}>
          <mesh position={[0, y, R]}>
            <boxGeometry args={[R * 2, 0.04, 0.04]} />
            <meshStandardMaterial color={0xb07a3f} />
          </mesh>
          <mesh position={[0, y, -R]}>
            <boxGeometry args={[R * 2, 0.04, 0.04]} />
            <meshStandardMaterial color={0xb07a3f} />
          </mesh>
          <mesh position={[R, y, 0]}>
            <boxGeometry args={[0.04, 0.04, R * 2]} />
            <meshStandardMaterial color={0xb07a3f} />
          </mesh>
          <mesh position={[-R, y, 0]}>
            <boxGeometry args={[0.04, 0.04, R * 2]} />
            <meshStandardMaterial color={0xb07a3f} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
