import { Html } from '@react-three/drei';
import { useGrid } from '../../hooks/useGrid';
import { useMapStore } from '../../stores/useMapStore';
import { useOrgStore } from '../../stores/useOrgStore';
import { parseCellKey } from '../../utils/gridMath';
import { buildingTypeLabel, parseBuildingId } from '../../data/buildingSkins';
import { spaceAssetLabel } from '../../data/spaceAssetCatalog';

/**
 * Small floating label above the building currently under the cursor, showing
 * its name: the CC app/addon name, the custom monitor's name, or the building
 * type for plain scenery. Rendered in both builder and view modes. Hover is
 * tracked in BuilderLayout (raycast on mousemove) → useMapStore.hoveredCell.
 */
export function HoverTooltip() {
  const hoveredCell = useMapStore((s) => s.hoveredCell);
  const cells = useMapStore((s) => s.cells);
  const apps = useOrgStore((s) => s.apps);
  const addons = useOrgStore((s) => s.addons);
  const monitors = useOrgStore((s) => s.monitors);
  const grid = useGrid();

  if (!hoveredCell) return null;
  const cell = cells.get(hoveredCell);
  if (!cell || !cell.building) return null;

  const parsed = parseBuildingId(cell.building);
  const name = cell.appId
    ? apps.find((a) => a.id === cell.appId)?.name ?? 'app'
    : cell.addonId
      ? addons.find((a) => a.id === cell.addonId)?.name ?? 'addon'
      : cell.monitorId
        ? monitors.find((m) => m.id === cell.monitorId)?.display_name ?? 'monitor'
        : parsed
          ? buildingTypeLabel(parsed.type)
          : cell.building.startsWith('space_')
            ? spaceAssetLabel(cell.building)
            : cell.building;

  const { q, r } = parseCellKey(hoveredCell);
  const { x, z } = grid.cellToWorld(q, r);
  const y = (cell.elevation ?? 0) + 1.6;

  return (
    <Html position={[x, y, z]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
      <div
        className="cc-panel rounded-lg px-2.5 py-1 text-[12px] font-medium whitespace-nowrap"
        style={{ color: 'var(--cc-white)' }}
      >
        {name}
      </div>
    </Html>
  );
}
