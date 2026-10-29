import { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useMapStore } from '../../stores/useMapStore';
import { DEFAULT_KIT } from '../../types/kit';
import { gridFor } from '../../utils/gridMath';
import { createParticleData, useParticleAnimation, type ParticleData } from '../../three/useParticles';

const SMOKE_BUILDINGS = ['tavern', 'blacksmith', 'home_A', 'home_B'];

interface Props {
  daylightRef: React.RefObject<number>;
}

export function ParticleEffects({ daylightRef }: Props) {
  const cells = useMapStore((s) => s.cells);
  const dataRef = useRef<ParticleData | null>(null);

  // Stable signature of the smoke emitters. `cells` gets a new Map reference on
  // *every* edit (tile/decoration/move), but the particle buffers only depend on
  // which smoke buildings exist and where — so key the (expensive) ParticleData
  // on this signature to avoid reallocating geometries on unrelated edits.
  const smokeKey = useMemo(() => {
    const parts: string[] = [];
    for (const cell of cells.values()) {
      if (cell.building && SMOKE_BUILDINGS.some((name) => cell.building!.includes(name))) {
        parts.push(`${cell.q},${cell.r},${cell.elevation ?? 0}`);
      }
    }
    return parts.sort().join('|');
  }, [cells]);

  // Create particle data, keyed on the smoke signature (reads cells via getState
  // so the only dependency is smokeKey — keeps geometries stable across edits).
  const particleData = useMemo(() => {
    const emitters: THREE.Vector3[] = [];
    const grid = gridFor(useMapStore.getState().kit ?? DEFAULT_KIT);
    for (const cell of useMapStore.getState().cells.values()) {
      if (cell.building && SMOKE_BUILDINGS.some((name) => cell.building!.includes(name))) {
        const { x, z } = grid.cellToWorld(cell.q, cell.r);
        emitters.push(new THREE.Vector3(x, (cell.elevation ?? 0) + 0.6, z));
      }
    }
    return createParticleData(emitters);
  }, [smokeKey]);

  // R3F does NOT auto-dispose geometries/materials passed as props, so dispose
  // the previous ParticleData when it changes and on unmount — otherwise every
  // smoke-building edit leaks 3 BufferGeometries + 1 material on the GPU.
  useEffect(() => {
    dataRef.current = particleData;
    return () => {
      particleData.leafGeometry.dispose();
      particleData.smokeGeometry.dispose();
      particleData.fireflyGeometry.dispose();
      particleData.fireflyMaterial.dispose();
    };
  }, [particleData]);

  useParticleAnimation(dataRef, daylightRef);

  return (
    <>
      <points geometry={particleData.leafGeometry}>
        <pointsMaterial
          size={0.06}
          vertexColors
          transparent
          opacity={0.8}
          depthWrite={false}
        />
      </points>
      <points geometry={particleData.smokeGeometry}>
        <pointsMaterial
          size={0.08}
          color={0x999999}
          transparent
          opacity={0.4}
          depthWrite={false}
        />
      </points>
      <points
        geometry={particleData.fireflyGeometry}
        material={particleData.fireflyMaterial}
      />
    </>
  );
}
