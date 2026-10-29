import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { toast } from 'sonner';
import { SceneCanvas } from '../scene/SceneCanvas';
import { LeftSidebar } from './LeftSidebar';
import { Inspector } from './Inspector';
import { MappingPanel } from './MappingPanel';
import { useMapStore } from '../../stores/useMapStore';
import { useOrgStore } from '../../stores/useOrgStore';
import { useUiModeStore } from '../../stores/useUiModeStore';
import { defaultBaseTile } from '../../data/appTypeMapping';
import { useGrid } from '../../hooks/useGrid';
import { cellKey as hexKey } from '../../utils/gridMath';

const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _intersection = new THREE.Vector3();

/**
 * Top-level city view: full-screen 3D canvas with overlay panels. Dropped the
 * medicity2 free-form placement loop (ghost preview, raycasted setBuilding/
 * setTile/addDecoration, keyboard rotation) — resources now arrive on the
 * map via the MappingPanel. The only click interaction that remains here is
 * select-to-inspect.
 */
export function BuilderLayout() {
  const cameraRef = useRef<THREE.Camera | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  const selectCell = useMapStore((s) => s.selectCell);
  const setHoveredCell = useMapStore((s) => s.setHoveredCell);
  const setCell = useMapStore((s) => s.setCell);
  const cells = useMapStore((s) => s.cells);
  const movingCell = useMapStore((s) => s.movingCell);
  const beginMove = useMapStore((s) => s.beginMove);
  const cancelMove = useMapStore((s) => s.cancelMove);
  const uiMode = useUiModeStore((s) => s.mode);
  const grid = useGrid();
  const baseTile = defaultBaseTile(grid.kit);

  const screenToHex = useCallback(
    (clientX: number, clientY: number) => {
      const camera = cameraRef.current;
      const wrapper = canvasWrapperRef.current;
      if (!camera || !wrapper) return null;
      const canvas = wrapper.querySelector('canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      _mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_mouse, camera);
      const hit = _raycaster.ray.intersectPlane(_plane, _intersection);
      if (!hit) return null;
      return grid.worldToCell(hit.x, hit.z);
    },
    [grid],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // left-click only
      const hex = screenToHex(e.clientX, e.clientY);
      if (!hex) return;
      const key = hexKey(hex.q, hex.r);

      // Move mode (builder): a resource is armed, so this click chooses the
      // destination tile rather than (re)selecting.
      if (uiMode === 'builder' && movingCell) {
        if (!cells.has(key)) {
          // Allow dropping onto a ghost-neighbour to grow the map, like normal
          // placement; a click into the void cancels the move.
          const isGhostNeighbour = grid.neighbors(hex.q, hex.r).some((n) =>
            cells.has(hexKey(n.q, n.r)),
          );
          if (isGhostNeighbour) {
            setCell({ q: hex.q, r: hex.r, tile: baseTile });
          } else {
            cancelMove();
            return;
          }
        }
        const res = useMapStore.getState().moveResourceTo(key);
        if (res === 'occupied') {
          toast.error('This tile already hosts a resource — pick another.');
        }
        return;
      }

      if (cells.has(key)) {
        // In view mode only resource-bound cells are inspectable — clicking
        // bare scenery just closes any open popup (an empty "No CC resource"
        // card serves no purpose). Builder mode selects any cell to edit it.
        if (uiMode === 'view') {
          const c = cells.get(key);
          if (!c?.appId && !c?.addonId) {
            selectCell(null);
            return;
          }
        }
        selectCell(key);
        return;
      }
      // Empty coord: in builder, a click on a ghost-neighbour of an existing
      // cell adds a grass tile there (growing the map). Clicks on coords
      // far from any cell do nothing — avoids accidental placements while
      // panning the camera.
      if (uiMode === 'builder') {
        const isGhostNeighbour = grid.neighbors(hex.q, hex.r).some((n) =>
          cells.has(hexKey(n.q, n.r)),
        );
        if (isGhostNeighbour) {
          setCell({ q: hex.q, r: hex.r, tile: baseTile });
          selectCell(key);
          return;
        }
      }
      selectCell(null);
    },
    [screenToHex, selectCell, setCell, cells, uiMode, movingCell, cancelMove, grid, baseTile],
  );

  // Hover → name tooltip: only over cells that actually carry a building.
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const hex = screenToHex(e.clientX, e.clientY);
      if (!hex) {
        setHoveredCell(null);
        return;
      }
      const key = hexKey(hex.q, hex.r);
      setHoveredCell(cells.get(key)?.building ? key : null);
    },
    [screenToHex, cells, setHoveredCell],
  );

  // Keyboard: Esc cancels an armed move; M arms the selected resource cell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (useMapStore.getState().movingCell) cancelMove();
        return;
      }
      if ((e.key === 'm' || e.key === 'M') && uiMode === 'builder') {
        const sel = useMapStore.getState().selectedCell;
        if (!sel) return;
        const c = useMapStore.getState().cells.get(sel);
        if (c && (c.appId || c.addonId)) beginMove(sel);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [uiMode, beginMove, cancelMove]);

  return (
    <div className="w-full h-full relative">
      <div
        ref={canvasWrapperRef}
        className="absolute inset-0"
        style={{ cursor: movingCell ? 'crosshair' : undefined }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredCell(null)}
      >
        <SceneCanvas mode="builder" cameraRef={cameraRef} />
      </div>

      {movingCell && <MoveBanner movingKey={movingCell} onCancel={cancelMove} />}

      <LeftSidebar />
      {uiMode === 'builder' && (
        <>
          <MappingPanel />
          <Inspector />
        </>
      )}
    </div>
  );
}

/** Top-centre prompt shown while a resource is armed for relocation. */
function MoveBanner({
  movingKey,
  onCancel,
}: {
  movingKey: string;
  onCancel: () => void;
}) {
  const cell = useMapStore((s) => s.cells.get(movingKey));
  const apps = useOrgStore((s) => s.apps);
  const addons = useOrgStore((s) => s.addons);

  const name = cell?.appId
    ? apps.find((a) => a.id === cell.appId)?.name ?? 'app'
    : cell?.addonId
      ? addons.find((a) => a.id === cell.addonId)?.name ?? 'addon'
      : 'resource';

  return (
    <div className="absolute top-3 left-1/2 z-30 -translate-x-1/2 pointer-events-auto">
      <div className="cc-panel flex items-center gap-3 rounded-full px-4 py-2 text-[13px] shadow-lg">
        <span>
          Moving <span className="font-semibold">{name}</span> — click a
          destination tile
        </span>
        <button
          onClick={onCancel}
          className="rounded-full px-2.5 py-1 text-[11px] transition"
          style={{ background: 'rgba(241,240,251,0.1)', color: 'var(--cc-white)' }}
          title="Cancel (Esc)"
        >
          Cancel (Esc)
        </button>
      </div>
    </div>
  );
}
