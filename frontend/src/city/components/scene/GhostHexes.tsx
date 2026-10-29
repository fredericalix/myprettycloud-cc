import { useMemo } from 'react';
import * as THREE from 'three';
import { defaultBaseTile } from '../../data/appTypeMapping';
import { useGrid } from '../../hooks/useGrid';
import { useMapStore } from '../../stores/useMapStore';
import { useAssetStore } from '../../stores/useAssetStore';
import { useUiModeStore } from '../../stores/useUiModeStore';
import { cellKey } from '../../utils/gridMath';

/**
 * Translucent grass hexes placed at every empty neighbour of the current
 * map, so the builder can click them to grow the map one cell at a time.
 *
 * Click detection is NOT done here — `BuilderLayout` raycasts the ground
 * plane, gets the (q,r), and creates a grass cell if that coord is a
 * ghost slot (neighbour of existing, not already a cell). Keeping the
 * ghosts purely decorative avoids juggling two ray-pick paths.
 */
export function GhostHexes() {
  const cells = useMapStore((s) => s.cells);
  const cloneModel = useAssetStore((s) => s.cloneModel);
  const isLoaded = useAssetStore((s) => s.isLoaded);
  // SceneCanvas receives `mode="builder"` from BuilderLayout unconditionally,
  // so we can't rely on that prop alone — the user may flip `uiMode` (store)
  // to 'view' while the same canvas keeps rendering. Guard here too.
  const uiMode = useUiModeStore((s) => s.mode);
  const grid = useGrid();

  const ghostPositions = useMemo(() => {
    if (cells.size === 0) return [];
    const keys = new Set(cells.keys());
    const ghosts = new Map<string, { q: number; r: number }>();
    for (const cell of cells.values()) {
      for (const n of grid.neighbors(cell.q, cell.r)) {
        const k = cellKey(n.q, n.r);
        if (keys.has(k)) continue;
        if (ghosts.has(k)) continue;
        ghosts.set(k, n);
      }
    }
    return Array.from(ghosts.values());
  }, [cells, grid]);

  // Wait for asset cache so cloneModel returns something; without this the
  // first render shows nothing and we'd have to add an extra re-render path.
  if (!isLoaded) return null;
  // Hide entirely outside of builder mode.
  if (uiMode !== 'builder') return null;

  return (
    <group>
      {ghostPositions.map(({ q, r }) => (
        <GhostHex key={cellKey(q, r)} q={q} r={r} cloneModel={cloneModel} />
      ))}
    </group>
  );
}

function GhostHex({
  q,
  r,
  cloneModel,
}: {
  q: number;
  r: number;
  cloneModel: (id: string) => THREE.Group | null;
}) {
  const grid = useGrid();
  const { x, z } = grid.cellToWorld(q, r);
  const tileId = defaultBaseTile(grid.kit);
  const model = useMemo(() => {
    const m = cloneModel(tileId);
    if (!m) return null;
    // Mute every material so the ghost reads as an inviting outline, not
    // another full-green tile. Clone materials so we don't poison the
    // asset cache shared with real cells.
    m.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mat = child.material;
      const wrap = (m: THREE.Material) => {
        if (!(m instanceof THREE.MeshStandardMaterial)) return m;
        const c = m.clone();
        c.transparent = true;
        c.opacity = 0.25;
        c.depthWrite = false;
        c.emissive = new THREE.Color(0xffffff);
        c.emissiveIntensity = 0.05;
        return c;
      };
      child.material = Array.isArray(mat) ? mat.map(wrap) : wrap(mat);
      child.castShadow = false;
      child.receiveShadow = false;
    });
    // Drop everything slightly so z-fighting with the real grass baseline
    // doesn't flicker at camera angles.
    m.position.y = -0.01;
    return m;
  }, [cloneModel, tileId]);

  if (!model) return null;
  return <primitive object={model} position={[x, 0, z]} />;
}
