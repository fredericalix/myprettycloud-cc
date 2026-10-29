import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CcAddon, CcApplication, appTypeSlug } from '../../types/cc';
import { useMapStore } from '../../stores/useMapStore';
import { useOrgStore } from '../../stores/useOrgStore';
import { useRealtimeStore } from '../../stores/useRealtimeStore';
import { createMonitor, deleteMonitor } from '../../api/monitors';
import { autoAssetFor, defaultBaseTile } from '../../data/appTypeMapping';
import {
  BUILDING_TYPES,
  buildingId,
  buildingTypeLabel,
  type BuildingType,
} from '../../data/buildingSkins';
import { getSpaceBuildingIds, spaceAssetLabel } from '../../data/spaceAssetCatalog';
import { useGrid } from '../../hooks/useGrid';
import { cellKey as hexKey, parseCellKey as parseHexKey, type GridAdapter } from '../../utils/gridMath';
import { useDraggablePanel } from '../../hooks/useDraggablePanel';
import { cellIsBound, type HexCell } from '../../types/map';

/** monitor state → swatch colour for the custom-monitors list. */
const STATE_DOT: Record<string, string> = {
  ok: 'var(--cc-green)',
  warning: 'var(--cc-orange)',
  critical: 'var(--cc-red-1)',
};

const PANEL_WIDTH = 280;

interface BoundResource {
  kind: 'app' | 'addon';
  id: string;
  name: string;
  type: string | null | undefined;
  cell: HexCell;
}

interface FreeResource {
  kind: 'app' | 'addon';
  id: string;
  name: string;
  type: string | null | undefined;
}

export function MappingPanel() {
  const apps = useOrgStore((s) => s.apps);
  const addons = useOrgStore((s) => s.addons);

  const monitors = useOrgStore((s) => s.monitors);
  const loadMonitors = useOrgStore((s) => s.loadMonitors);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const monStates = useRealtimeStore((s) => s.monitors);

  const cells = useMapStore((s) => s.cells);
  const selectedCell = useMapStore((s) => s.selectedCell);
  const setCell = useMapStore((s) => s.setCell);
  const setBuilding = useMapStore((s) => s.setBuilding);
  const assignResource = useMapStore((s) => s.assignResource);
  const assignMonitor = useMapStore((s) => s.assignMonitor);
  const selectCellAction = useMapStore((s) => s.selectCell);

  const grid = useGrid();
  const kit = grid.kit;
  // Monitor skin choices: medieval = building type (recoloured by state),
  // space = the space-building model id (state shows on the badge sphere).
  const monitorTypeOptions = useMemo(
    () => (kit === 'space' ? getSpaceBuildingIds() : (BUILDING_TYPES as readonly string[])),
    [kit],
  );

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<string>('watchtower');
  const [busy, setBusy] = useState(false);
  // Keep the picked type valid for the current kit (org/kit switches).
  const effectiveType = monitorTypeOptions.includes(newType)
    ? newType
    : monitorTypeOptions[0]!;

  // Anchor right by default; once the user drags, localStorage remembers the new spot.
  const defaultX =
    typeof window !== 'undefined' ? Math.max(0, window.innerWidth - PANEL_WIDTH - 12) : 900;
  const { pos, dragging, dragProps } = useDraggablePanel(
    'mycctown.mappingPanelPos',
    { x: defaultX, y: 64 },
    PANEL_WIDTH,
  );

  const { bound, free } = useMemo(() => buildLists(apps, addons, cells), [
    apps,
    addons,
    cells,
  ]);

  // One resource per cell: when the user has explicitly selected an already-bound
  // cell, placement/creation is hard-blocked (they must pick an empty cell or
  // deselect). With no selection we auto-place on the next free hex.
  const selectedOccupied = useMemo(
    () => (selectedCell ? cellIsBound(cells.get(selectedCell)) : false),
    [selectedCell, cells],
  );

  const placeResource = (kind: 'app' | 'addon', id: string, type: string | null | undefined) => {
    if (selectedCell && cellIsBound(cells.get(selectedCell))) {
      toast.error('That cell is already occupied — select an empty cell first.');
      return;
    }
    const target = selectedCell
      ? parseHexKey(selectedCell)
      : findPlacementCell(grid, cells);
    ensureCellAt(grid, target.q, target.r, cells, setCell);
    const assetId = autoAssetFor(kit, kind, type);
    setBuilding(target.q, target.r, assetId, 0);
    assignResource(target.q, target.r, kind, id);
    // Don't leave the selection on the now-occupied cell, or the next placement
    // would target it and be blocked / overwrite it.
    selectCellAction(null);
  };

  const autoPlaceAll = () => {
    for (const res of [...free]) {
      // Re-read fresh cells each iteration: Zustand mutations are synchronous, so
      // the previous placement is already reflected and findPlacementCell picks
      // the next free spot (no manual skip, no gaps).
      const currentCells = useMapStore.getState().cells;
      const target = findPlacementCell(grid, currentCells);
      ensureCellAt(grid, target.q, target.r, currentCells, setCell);
      const assetId = autoAssetFor(kit, res.kind, res.type);
      setBuilding(target.q, target.r, assetId, 0);
      assignResource(target.q, target.r, res.kind, res.id);
    }
  };

  const locate = (cell: HexCell) => {
    selectCellAction(hexKey(cell.q, cell.r));
  };

  // --- Custom (synthetic) monitored buildings ---
  const synthetic = useMemo(() => monitors.filter((m) => m.kind === 'synthetic'), [monitors]);
  const placedMonitorCell = useMemo(() => {
    const map = new Map<string, HexCell>();
    for (const c of cells.values()) if (c.monitorId) map.set(c.monitorId, c);
    return map;
  }, [cells]);

  /** Place a monitor onto the selected (empty) cell, or the next free hex if
   *  nothing is selected. Returns false (and toasts) if the selected cell is
   *  already occupied, so callers can avoid creating an orphan. */
  const placeMonitor = (monitorId: string, base: string): boolean => {
    if (selectedCell && cellIsBound(cells.get(selectedCell))) {
      toast.error('That cell is already occupied — select an empty cell first.');
      return false;
    }
    const target = selectedCell
      ? parseHexKey(selectedCell)
      : findPlacementCell(grid, cells);
    ensureCellAt(grid, target.q, target.r, cells, setCell);
    setBuilding(target.q, target.r, base, 0);
    assignMonitor(target.q, target.r, monitorId);
    // Clear the selection so a follow-up "+ New" auto-places on the next free
    // hex instead of trapping on (and being blocked by) this now-occupied cell.
    selectCellAction(null);
    return true;
  };

  const createMonitorBuilding = async () => {
    if (!currentOrgId || !newName.trim()) return;
    if (selectedOccupied) {
      toast.error('Selected cell is occupied — pick an empty cell or deselect first.');
      return;
    }
    setBusy(true);
    try {
      // Base skin; the live state recolours it (medieval) or drives the badge
      // sphere above it (space).
      const base =
        kit === 'space' ? effectiveType : buildingId(effectiveType as BuildingType, 'blue');
      const m = await createMonitor(currentOrgId, newName.trim(), base);
      await loadMonitors();
      placeMonitor(m.id, base);
      setCreating(false);
      setNewName('');
      toast.success('Monitored building created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create monitor');
    } finally {
      setBusy(false);
    }
  };

  const removeMonitor = async (id: string, name: string) => {
    if (!currentOrgId) return;
    if (!confirm(`Delete monitored building "${name}"? This removes the monitor and any rule targeting it stops working.`))
      return;
    try {
      await deleteMonitor(currentOrgId, id);
      // Wipe its building cell (keep the underlying tile).
      const c = placedMonitorCell.get(id);
      if (c) setCell({ q: c.q, r: c.r, tile: c.tile });
      await loadMonitors();
      toast.success('Monitor deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete monitor');
    }
  };

  return (
    <aside
      className="cc-panel absolute z-10 rounded-2xl flex flex-col pointer-events-auto"
      style={{
        left: pos.x,
        top: pos.y,
        width: PANEL_WIDTH,
        maxHeight: 'calc(100vh - 120px)',
        overflow: 'hidden',
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b cc-border-soft select-none"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        {...dragProps}
      >
        <div>
          <div className="font-overtitle text-[10px]" style={{ color: 'var(--cc-orange)' }}>
            Resources
          </div>
          <div className="text-sm font-semibold">
            {bound.length} placed · {free.length} to place
          </div>
        </div>
        <button
          data-no-drag
          className="btn-cc text-xs !py-1.5 !px-3"
          onClick={autoPlaceAll}
          disabled={free.length === 0}
          style={{ opacity: free.length === 0 ? 0.4 : 1 }}
        >
          Auto-place
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {free.length > 0 && (
          <Section title={`Unplaced (${free.length})`}>
            {free.map((r) => (
              <ResourceRow
                key={`${r.kind}:${r.id}`}
                name={r.name}
                type={r.type ?? '—'}
                kind={r.kind}
                onClick={() => placeResource(r.kind, r.id, r.type)}
                actionLabel={selectedCell ? 'Place here' : 'Place'}
              />
            ))}
          </Section>
        )}
        {bound.length > 0 && (
          <Section title={`Placed (${bound.length})`}>
            {bound.map((r) => (
              <ResourceRow
                key={`${r.kind}:${r.id}`}
                name={r.name}
                type={r.type ?? '—'}
                kind={r.kind}
                onClick={() => locate(r.cell)}
                actionLabel={`${r.cell.q},${r.cell.r}`}
                muted
              />
            ))}
          </Section>
        )}
        {bound.length === 0 && free.length === 0 && (
          <div className="p-6 text-center cc-muted text-sm">
            No apps or addons in this organisation.
          </div>
        )}

        {/* Custom monitors — buildings not backed by a CC app/addon, whose
            state is driven entirely by the rule engine. */}
        <div className="border-t cc-border-soft mt-1">
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <div className="font-overtitle text-[10px] cc-muted px-1">
              Custom monitors ({synthetic.length})
            </div>
            {!creating && (
              <button
                data-no-drag
                className="font-overtitle text-[10px] rounded px-2 py-1"
                style={{ background: 'var(--cc-primary)', color: 'var(--cc-white)' }}
                onClick={() => setCreating(true)}
              >
                + New
              </button>
            )}
          </div>

          {creating && (
            <div className="flex flex-col gap-2 px-3 pb-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name (e.g. Queue depth)"
                className="rounded-md px-2 py-1.5 text-sm"
                style={{ background: 'rgba(241,240,251,0.08)', color: 'var(--cc-white)', border: '1px solid rgba(241,240,251,0.12)' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createMonitorBuilding();
                  if (e.key === 'Escape') setCreating(false);
                }}
              />
              <select
                value={effectiveType}
                onChange={(e) => setNewType(e.target.value)}
                className="rounded-md px-2 py-1.5 text-sm"
                style={{ background: 'rgba(241,240,251,0.08)', color: 'var(--cc-white)', border: '1px solid rgba(241,240,251,0.12)' }}
              >
                {monitorTypeOptions.map((t) => (
                  <option key={t} value={t}>
                    {kit === 'space' ? spaceAssetLabel(t) : buildingTypeLabel(t as BuildingType)}
                  </option>
                ))}
              </select>
              {selectedOccupied && (
                <div className="text-[10px]" style={{ color: 'var(--cc-orange)' }}>
                  The selected cell already has a resource — pick an empty cell or
                  deselect before creating.
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  className="text-xs cc-muted hover:text-white px-2 py-1"
                  onClick={() => {
                    setCreating(false);
                    setNewName('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn-cc text-xs !py-1.5 !px-3"
                  onClick={() => void createMonitorBuilding()}
                  disabled={busy || !newName.trim() || selectedOccupied}
                  style={{ opacity: busy || !newName.trim() || selectedOccupied ? 0.5 : 1 }}
                >
                  {busy ? 'Creating…' : 'Create & place'}
                </button>
              </div>
            </div>
          )}

          {synthetic.length > 0 && (
            <div className="flex flex-col gap-1 px-3 pb-3">
              {synthetic.map((m) => {
                const placed = placedMonitorCell.get(m.id);
                const state = monStates[m.id]?.state ?? m.current_state ?? 'unknown';
                const base =
                  (m.metadata && typeof (m.metadata as Record<string, unknown>).building === 'string'
                    ? ((m.metadata as Record<string, unknown>).building as string)
                    : null) ??
                  (kit === 'space' ? 'space_structure_tall' : buildingId('watchtower', 'blue'));
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-white/5 transition"
                  >
                    <button
                      className="min-w-0 flex items-center gap-2 text-left flex-1"
                      onClick={() => (placed ? locate(placed) : placeMonitor(m.id, base))}
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ background: STATE_DOT[state] ?? 'var(--cc-gray)' }}
                        title={state}
                      />
                      <span className="min-w-0 flex flex-col">
                        <span className="text-sm truncate">{m.display_name}</span>
                        <span className="text-[10px] cc-muted">
                          synthetic · {placed ? `${placed.q},${placed.r}` : 'unplaced'}
                        </span>
                      </span>
                    </button>
                    <button
                      data-no-drag
                      className="cc-muted hover:text-white px-1.5 text-sm shrink-0"
                      title="Delete this monitored building"
                      onClick={() => void removeMonitor(m.id, m.display_name)}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="font-overtitle text-[10px] cc-muted px-1">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function ResourceRow({
  name,
  type,
  kind,
  onClick,
  actionLabel,
  muted,
}: {
  name: string;
  type: string;
  kind: 'app' | 'addon';
  onClick: () => void;
  actionLabel: string;
  muted?: boolean;
}) {
  return (
    <button
      className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/5 transition"
      onClick={onClick}
      style={{ opacity: muted ? 0.75 : 1 }}
    >
      <div className="min-w-0 flex flex-col">
        <span className="text-sm truncate">{name}</span>
        <span className="text-[10px] cc-muted">
          {kind === 'app' ? 'app' : 'addon'} · {type}
        </span>
      </div>
      <span
        className="font-overtitle text-[10px] rounded px-2 py-1"
        style={{
          background: muted ? 'rgba(222,221,238,0.06)' : 'var(--cc-primary)',
          color: muted ? 'var(--cc-gray-soft)' : 'var(--cc-white)',
        }}
      >
        {actionLabel}
      </span>
    </button>
  );
}

function buildLists(
  apps: CcApplication[],
  addons: CcAddon[],
  cells: Map<string, HexCell>,
): { bound: BoundResource[]; free: FreeResource[] } {
  const placedAppIds = new Set<string>();
  const placedAddonIds = new Set<string>();
  const bound: BoundResource[] = [];

  for (const cell of cells.values()) {
    if (cell.appId) placedAppIds.add(cell.appId);
    if (cell.addonId) placedAddonIds.add(cell.addonId);
  }

  for (const cell of cells.values()) {
    if (cell.appId) {
      const app = apps.find((a) => a.id === cell.appId);
      if (app) {
        bound.push({
          kind: 'app',
          id: app.id,
          name: app.name,
          type: appTypeSlug(app),
          cell,
        });
      }
    }
    if (cell.addonId) {
      const addon = addons.find((a) => a.id === cell.addonId);
      if (addon) {
        bound.push({
          kind: 'addon',
          id: addon.id,
          name: addon.name,
          type: addon.provider?.id ?? addon.provider?.name,
          cell,
        });
      }
    }
  }

  const free: FreeResource[] = [];
  for (const a of apps) {
    if (!placedAppIds.has(a.id)) {
      free.push({ kind: 'app', id: a.id, name: a.name, type: appTypeSlug(a) });
    }
  }
  for (const a of addons) {
    if (!placedAddonIds.has(a.id)) {
      free.push({
        kind: 'addon',
        id: a.id,
        name: a.name,
        type: a.provider?.id ?? a.provider?.name,
      });
    }
  }

  return { bound, free };
}

function ensureCellAt(
  grid: GridAdapter,
  q: number,
  r: number,
  cells: Map<string, HexCell>,
  setCell: (cell: HexCell) => void,
) {
  const existing = cells.get(hexKey(q, r));
  if (existing) return;
  setCell({ q, r, tile: defaultBaseTile(grid.kit) });
}

/** How many rings out the existing map reaches (0 for an empty map). */
function existingMapRadius(grid: GridAdapter, cells: Map<string, HexCell>): number {
  let max = 0;
  for (const c of cells.values()) max = Math.max(max, grid.ringDistance(c.q, c.r));
  return max;
}

/**
 * Pick where to drop a newly-placed resource, preferring the city you already have:
 *
 *  1. Reuse the nearest existing buildable ground — a plain, undecorated base tile
 *     with no building or binding — walking outward from the town centre, so
 *     resources fill the existing footprint compactly.
 *  2. Only when none is left, grow the map by one tile on the frontier (a vacant
 *     cell adjacent to the existing city), again nearest the centre first, so new
 *     ground stays contiguous instead of appearing detached out in the void.
 *
 * Scenery (roads, rivers, coasts, water, slopes, decorated cells) is never built
 * over — the starter landscape and hand-placed decorations stay intact.
 *
 * Relies on the caller passing the current cells: Zustand mutations are
 * synchronous, so placing several resources in a row (auto-place) sees each prior
 * placement and naturally advances — no skip bookkeeping needed.
 */
function findPlacementCell(
  grid: GridAdapter,
  cells: Map<string, HexCell>,
): { q: number; r: number } {
  const baseTile = defaultBaseTile(grid.kit);
  const isReusable = (c: HexCell | undefined) =>
    !!c &&
    c.tile === baseTile &&
    !c.building &&
    !c.appId &&
    !c.addonId &&
    !c.monitorId &&
    !(c.decorations && c.decorations.length > 0);

  const mapRadius = existingMapRadius(grid, cells);

  // PASS 1 — reuse existing buildable ground.
  for (const { q, r } of grid.spiral(mapRadius)) {
    if (isReusable(cells.get(hexKey(q, r)))) return { q, r };
  }
  // PASS 2 — grow the map at the frontier: a vacant cell touching the city.
  for (const { q, r } of grid.spiral(mapRadius + 1)) {
    if (cells.has(hexKey(q, r))) continue;
    if (grid.neighbors(q, r).some((n) => cells.has(hexKey(n.q, n.r)))) return { q, r };
  }
  return { q: 0, r: 0 }; // degenerate: empty map
}
