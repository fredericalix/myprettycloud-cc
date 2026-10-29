import { Html } from '@react-three/drei';
import { useGrid } from '../../hooks/useGrid';
import { useMapStore } from '../../stores/useMapStore';
import { useOrgStore } from '../../stores/useOrgStore';
import { parseCellKey } from '../../utils/gridMath';
import { LiveResource } from '../builder/LiveResource';

/**
 * Popup that floats in 3D space above the currently-selected building. drei's
 * <Html> projects its position from world → screen coordinates automatically
 * on every frame, so the card follows the building when the camera moves.
 *
 * Rendered inside SceneCanvas (r3f tree) in view mode only.
 */
export function FloatingInspector() {
  const selectedCell = useMapStore((s) => s.selectedCell);
  const cells = useMapStore((s) => s.cells);
  const apps = useOrgStore((s) => s.apps);
  const addons = useOrgStore((s) => s.addons);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const grid = useGrid();

  if (!selectedCell) return null;
  const cell = cells.get(selectedCell);
  if (!cell) return null;
  // Only resource-bound cells get a floating popup — bare scenery has nothing
  // worth showing here.
  if (!cell.appId && !cell.addonId) return null;

  const { q, r } = parseCellKey(selectedCell);
  const { x, z } = grid.cellToWorld(q, r);
  const y = (cell.elevation ?? 0) + 1.8;

  const resource = cell.appId
    ? { kind: 'app' as const, data: apps.find((a) => a.id === cell.appId) }
    : cell.addonId
      ? { kind: 'addon' as const, data: addons.find((a) => a.id === cell.addonId) }
      : null;

  return (
    <Html
      position={[x, y, z]}
      center
      distanceFactor={8}
      style={{ pointerEvents: 'auto' }}
    >
      <div
        className="cc-panel rounded-2xl p-3 text-[13px]"
        style={{ width: 280 }}
      >
        <div className="flex items-center justify-between mb-2">
          <div>
            <div
              className="font-overtitle text-[10px]"
              style={{ color: 'var(--cc-orange)' }}
            >
              Cell ({q}, {r})
            </div>
          </div>
          <button
            className="cc-muted hover:text-white text-sm"
            onClick={() => useMapStore.getState().selectCell(null)}
            title="Close"
          >
            ✕
          </button>
        </div>

        {resource?.data ? (
          <LiveResource
            kind={resource.kind}
            data={resource.data}
            orgId={currentOrgId}
            showSparklines
          />
        ) : (
          <div className="cc-muted text-[12px]">
            No CC resource bound to this cell.
          </div>
        )}
      </div>
    </Html>
  );
}
