import * as THREE from 'three';
import type { SceneMode } from './SceneCanvas';

/**
 * Invisible ground plane. Exists only as a raycasting target
 * for BuilderLayout's screenToHex() which raycasts against Y=0.
 * All mouse interaction is handled at the DOM level in BuilderLayout,
 * NOT via R3F pointer events here — this avoids middle/right click conflicts.
 */
export function GroundPlane({ mode: _mode }: { mode: SceneMode }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.01, 0]}
      visible={false}
    >
      <planeGeometry args={[100, 100]} />
      <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
    </mesh>
  );
}
