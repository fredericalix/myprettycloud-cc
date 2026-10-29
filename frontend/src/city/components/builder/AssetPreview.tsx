import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAssetStore } from '../../stores/useAssetStore';
import { parseBuildingId } from '../../data/buildingSkins';

/**
 * Small 3D preview rendered inside the Inspector. Lives in its own R3F
 * Canvas so the main scene's animation registry isn't perturbed. Orbits
 * slowly so the user can see the asset from all sides; follows the
 * hovered-or-selected asset id.
 */
export function AssetPreview({ assetId }: { assetId: string | null }) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        width: '100%',
        aspectRatio: '1 / 1',
        background:
          'radial-gradient(circle at 50% 30%, rgba(241,240,251,0.08), rgba(0,0,0,0.35))',
      }}
    >
      {assetId ? (
        <Canvas camera={{ position: [1.6, 1.6, 1.6], fov: 40 }} shadows={false}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[3, 5, 2]} intensity={0.8} />
          <OrbitingAsset assetId={assetId} />
        </Canvas>
      ) : (
        <div className="w-full h-full flex items-center justify-center cc-muted text-[11px]">
          No asset selected
        </div>
      )}
    </div>
  );
}

function OrbitingAsset({ assetId }: { assetId: string }) {
  const cloneModel = useAssetStore((s) => s.cloneModel);
  const ensureColorLoaded = useAssetStore((s) => s.ensureColorLoaded);
  // Subscribe to loadedColors so we re-clone once a lazily-fetched building
  // color arrives in the cache.
  const loadedColors = useAssetStore((s) => s.loadedColors);
  const groupRef = useRef<THREE.Group>(null);

  // Building color variants are lazy-loaded: a placed resource may store a
  // skin color (e.g. building_home_A_blue) that was never fetched because the
  // scene renders a status-colored variant instead. Kick off the load so the
  // preview can show the asset rather than an empty square.
  useEffect(() => {
    if (cloneModel(assetId)) return;
    const parsed = parseBuildingId(assetId);
    if (parsed) ensureColorLoaded(parsed.color);
  }, [assetId, cloneModel, ensureColorLoaded, loadedColors]);

  // Re-clone whenever the target asset (or the set of loaded colors) changes.
  // The clone is memoised so a stable hover doesn't retraverse the GLTF on
  // every frame.
  const model = useMemo(
    () => cloneModel(assetId),
    [cloneModel, assetId, loadedColors],
  );

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.4;
    }
  });

  if (!model) return null;

  // Auto-frame the asset roughly: KayKit tiles/buildings live near unit
  // scale, so a fixed camera at (1.6, 1.6, 1.6) already looks balanced.
  // The center of the asset isn't always at origin, so we re-center it
  // using its bounding box once.
  return (
    <group ref={groupRef}>
      <CenteredModel model={model} />
    </group>
  );
}

function CenteredModel({ model }: { model: THREE.Group }) {
  const { centred, scale } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    // Fit the asset's longest dimension to ≈1.6 units so it fills the canvas.
    return {
      centred: center,
      scale: 1.6 / maxDim,
    };
  }, [model]);

  return (
    <group position={[-centred.x, -centred.y, -centred.z]} scale={scale}>
      <primitive object={model} />
    </group>
  );
}
