import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useAssetStore } from '../../stores/useAssetStore';
import { useAnimationContext } from './SceneCanvas';

const CLOUD_CONFIGS = [
  { id: 'cloud_big', x: -6, y: 6, z: -4, vx: 0.15, vz: 0.05, scale: 1.2 },
  { id: 'cloud_small', x: 3, y: 5.5, z: -6, vx: 0.12, vz: 0.08, scale: 1.0 },
  { id: 'cloud_big', x: 8, y: 7, z: 2, vx: 0.1, vz: 0.03, scale: 1.5 },
  { id: 'cloud_small', x: -3, y: 6.5, z: 5, vx: 0.18, vz: 0.06, scale: 0.8 },
  { id: 'cloud_big', x: 0, y: 5.8, z: -8, vx: 0.14, vz: 0.04, scale: 1.1 },
  { id: 'cloud_small', x: -8, y: 6.2, z: 0, vx: 0.16, vz: 0.07, scale: 0.9 },
  { id: 'cloud_big', x: 5, y: 7.5, z: 6, vx: 0.11, vz: 0.05, scale: 1.3 },
];

export function CloudLayer() {
  const groupRef = useRef<THREE.Group>(null);
  const cloneModel = useAssetStore((s) => s.cloneModel);
  const isLoaded = useAssetStore((s) => s.isLoaded);
  const { register, unregister } = useAnimationContext();

  useEffect(() => {
    const group = groupRef.current;
    if (!group || !isLoaded) return;

    const clouds: THREE.Object3D[] = [];

    for (const cfg of CLOUD_CONFIGS) {
      const cloud = cloneModel(cfg.id);
      if (!cloud) continue;

      cloud.position.set(cfg.x, cfg.y, cfg.z);
      cloud.scale.setScalar(cfg.scale);
      cloud.userData.velocity = { x: cfg.vx, z: cfg.vz };
      cloud.userData.phase = Math.random() * Math.PI * 2;

      cloud.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = false;
          child.receiveShadow = false;
        }
      });

      register('clouds', cloud);
      clouds.push(cloud);
      group.add(cloud);
    }

    return () => {
      for (const cloud of clouds) {
        unregister('clouds', cloud);
      }
      while (group.children.length > 0) {
        group.remove(group.children[0]!);
      }
    };
  }, [isLoaded, cloneModel, register, unregister]);

  return <group ref={groupRef} />;
}
