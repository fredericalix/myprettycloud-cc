import { useState } from 'react';
import { toast } from 'sonner';
import { useMapStore } from '../../stores/useMapStore';
import { useOrgStore } from '../../stores/useOrgStore';
import { useRealtimeStore } from '../../stores/useRealtimeStore';
import { setMonitorState as apiSetMonitorState } from '../../api/monitors';
import { useGrid } from '../../hooks/useGrid';
import { parseCellKey } from '../../utils/gridMath';
import { useDraggablePanel } from '../../hooks/useDraggablePanel';
import {
  BUILDING_COLORS,
  BUILDING_COLOR_SWATCH,
  BUILDING_TYPES,
  buildingId,
  parseBuildingId,
  buildingTypeLabel,
} from '../../data/buildingSkins';
import { catalogForKit } from '../../data/assetCatalog';
import { getSpaceBuildingIds, spaceAssetLabel } from '../../data/spaceAssetCatalog';
import { defaultBaseTile } from '../../data/appTypeMapping';
import type { Kit } from '../../types/kit';
import type { AssetEntry } from '../../types/map';
import {
  clampElevation,
  elevationLevel,
  MAX_ELEVATION_LEVEL,
} from '../../utils/elevation';
import { cellIsBound, type Decoration } from '../../types/map';
import { AssetPreview } from './AssetPreview';
import { LiveResource } from './LiveResource';

const PANEL_WIDTH = 300;

function humaniseTileId(id: string): string {
  // "hex_river_A_curvy" → "River A curvy"; "space_terrain_low" → "Terrain low"
  return id
    .replace(/^hex_/, '')
    .replace(/^space_/, '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Friendly labels for the catalog's tile subcategories; `base` always first. */
const TILE_SUB_LABEL: Record<string, string> = {
  base: 'Base',
  coast: 'Coast',
  'coast/waterless': 'Coast (dry)',
  rivers: 'Rivers',
  'rivers/waterless': 'Rivers (dry)',
  roads: 'Roads',
  sculpt: 'Sculpt (slopes)',
};

/** Placeable structural pieces (neutral, no colour). Excludes engine-only
 *  status visuals (medieval scaffolding stages). */
const STRUCTURE_EXCLUDE = new Set([
  'building_stage_A',
  'building_stage_B',
  'building_stage_C',
  'building_scaffolding',
  'projectile_catapult',
]);

function humaniseStructureId(id: string): string {
  // "building_bridge_A" → "Bridge A"; "space_tunnel_straight_A" → "Tunnel straight A"
  return id
    .replace(/^building_/, '')
    .replace(/^space_/, '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

function humaniseDecoId(id: string): string {
  // "mountain_B_grass_trees" → "Mountain B grass trees"
  return id
    .replace(/^space_/, '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Decoration palette buckets per kit, matched by id prefix; clouds are
 *  excluded (the sky CloudLayer owns those). */
const DECOR_GROUP_DEFS: Record<Kit, Array<{ label: string; match: (a: AssetEntry) => boolean }>> = {
  medieval: [
    { label: 'Trees', match: (a) => /^trees?_/.test(a.id) },
    { label: 'Hills', match: (a) => /^hill/.test(a.id) },
    { label: 'Mountains', match: (a) => /^mountain/.test(a.id) },
    { label: 'Rocks', match: (a) => /^rock/.test(a.id) },
    { label: 'Water', match: (a) => /^water(lily|plant)/.test(a.id) },
    { label: 'Props', match: (a) => a.subcategory === 'props' },
  ],
  space: [
    { label: 'Rocks', match: (a) => /^space_rocks?_/.test(a.id) },
    { label: 'Cargo', match: (a) => /^space_(cargo|containers)/.test(a.id) },
    {
      label: 'Tech',
      match: (a) => /^space_(lights|solarpanel|roofmodule)/.test(a.id),
    },
  ],
};

interface Palettes {
  tileGroups: Array<{ label: string; sub: string }>;
  tilesByGroup: Record<string, Array<{ id: string; label: string }>>;
  structureItems: Array<{ id: string; label: string }>;
  decorGroups: Array<{ label: string; items: Array<{ id: string; label: string }> }>;
}

const PALETTE_CACHE = new Map<Kit, Palettes>();

/** Builder palettes for a kit, generated from its catalog so every loaded
 *  variant is exposed. Cached — catalogs are static. */
function palettesFor(kit: Kit): Palettes {
  const cached = PALETTE_CACHE.get(kit);
  if (cached) return cached;
  const catalog = catalogForKit(kit);

  const tileGroups = Array.from(
    new Set(catalog.filter((a) => a.category === 'tiles').map((a) => a.subcategory)),
  )
    .sort((a, b) => (a === 'base' ? -1 : b === 'base' ? 1 : a.localeCompare(b)))
    .map((sub) => ({ label: TILE_SUB_LABEL[sub] ?? humaniseTileId(sub), sub }));

  const tilesByGroup: Palettes['tilesByGroup'] = Object.fromEntries(
    tileGroups.map(({ sub }) => {
      const rows = catalog
        .filter((a) => a.category === 'tiles' && a.subcategory === sub)
        .map((a) => ({ id: a.id, label: humaniseTileId(a.id) }))
        .sort((x, y) => x.label.localeCompare(y.label));
      return [sub, rows];
    }),
  );

  const structureItems = catalog
    .filter(
      (a) =>
        a.category === 'buildings' &&
        a.subcategory === 'neutral' &&
        !STRUCTURE_EXCLUDE.has(a.id),
    )
    .map((a) => ({ id: a.id, label: humaniseStructureId(a.id) }))
    .sort((x, y) => x.label.localeCompare(y.label));

  const decorGroups = DECOR_GROUP_DEFS[kit]
    .map(({ label, match }) => ({
      label,
      items: catalog
        .filter((a) => a.category === 'decoration' && !a.id.startsWith('cloud') && match(a))
        .map((a) => ({ id: a.id, label: humaniseDecoId(a.id) }))
        .sort((x, y) => x.label.localeCompare(y.label)),
    }))
    .filter((g) => g.items.length > 0);

  const palettes = { tileGroups, tilesByGroup, structureItems, decorGroups };
  PALETTE_CACHE.set(kit, palettes);
  return palettes;
}

/** Space resource skins (model picker, no colour column). */
const SPACE_BUILDING_ID_SET = new Set(getSpaceBuildingIds());

/** Selectable states for a custom monitored building, with swatches matching
 *  the in-city building colours (ok=green, warning=yellow, critical=red,
 *  unknown=grey/scaffolding). */
const MONITOR_STATES: Array<{ id: string; color: string }> = [
  { id: 'ok', color: 'var(--cc-green)' },
  { id: 'warning', color: '#d9b54b' },
  { id: 'critical', color: 'var(--cc-red-1)' },
  { id: 'unknown', color: 'var(--cc-gray)' },
];

/**
 * Docked inspector for builder mode. Draggable by its header; position is
 * persisted to localStorage across page reloads.
 */
export function Inspector() {
  const selectedCell = useMapStore((s) => s.selectedCell);
  const cells = useMapStore((s) => s.cells);
  const clearResource = useMapStore((s) => s.clearResource);
  const setBuilding = useMapStore((s) => s.setBuilding);
  const setCell = useMapStore((s) => s.setCell);
  const movingCell = useMapStore((s) => s.movingCell);
  const beginMove = useMapStore((s) => s.beginMove);
  const cancelMove = useMapStore((s) => s.cancelMove);

  const apps = useOrgStore((s) => s.apps);
  const addons = useOrgStore((s) => s.addons);
  const monitors = useOrgStore((s) => s.monitors);
  const loadMonitors = useOrgStore((s) => s.loadMonitors);
  const monStates = useRealtimeStore((s) => s.monitors);
  const setMonStateLocal = useRealtimeStore((s) => s.setMonitorState);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);

  const { pos, dragging, dragProps } = useDraggablePanel(
    'mycctown.inspectorPos',
    { x: 86, y: 12 },
    PANEL_WIDTH,
  );

  const grid = useGrid();
  const kit = grid.kit;
  const { tileGroups, tilesByGroup, structureItems, decorGroups } = palettesFor(kit);

  // Track the palette button we're hovering so the 3D preview up top can
  // mirror it. Falling back to the cell's current building/tile keeps the
  // preview useful even when no hover is active.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (!selectedCell) return null;
  const cell = cells.get(selectedCell);
  if (!cell) return null;

  const { q, r } = parseCellKey(selectedCell);
  // A monitored building is "bound" too — its colour is driven by the monitor
  // state, so we lock the colour picker and hide the scenery editors like a
  // CC resource cell.
  const hasResource = cellIsBound(cell);
  const previewId = hoveredId ?? cell.building ?? cell.tile ?? null;

  const resource = cell.appId
    ? { kind: 'app' as const, data: apps.find((a) => a.id === cell.appId) }
    : cell.addonId
      ? { kind: 'addon' as const, data: addons.find((a) => a.id === cell.addonId) }
      : null;

  const monitor = cell.monitorId
    ? monitors.find((m) => m.id === cell.monitorId)
    : null;
  const monitorState = cell.monitorId
    ? monStates[cell.monitorId]?.state ?? monitor?.current_state ?? 'unknown'
    : null;

  const setTile = (tileId: string) => {
    setCell({ ...cell, tile: tileId });
  };

  const changeMonitorState = async (next: string) => {
    if (!currentOrgId || !cell.monitorId) return;
    setMonStateLocal(cell.monitorId, next); // optimistic recolour
    try {
      await apiSetMonitorState(currentOrgId, cell.monitorId, next);
      void loadMonitors();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to set state');
    }
  };

  const addDecoration = (decoId: string) => {
    // Random jitter within the cell so multiple decorations don't stack on
    // the centre — looks more organic at a glance.
    const deco: Decoration = {
      id: decoId,
      dx: (Math.random() - 0.5) * 0.6,
      dz: (Math.random() - 0.5) * 0.6,
      rotation: Math.floor(Math.random() * grid.rotationSteps),
    };
    setCell({
      ...cell,
      decorations: [...(cell.decorations ?? []), deco],
    });
  };

  const removeDecoration = (idx: number) => {
    const next = (cell.decorations ?? []).filter((_, i) => i !== idx);
    setCell({ ...cell, decorations: next.length > 0 ? next : undefined });
  };

  const rotateDecoration = (idx: number, rotation: number) => {
    const next = (cell.decorations ?? []).map((d, i) =>
      i === idx ? { ...d, rotation } : d,
    );
    setCell({ ...cell, decorations: next });
  };

  const resetCell = () => {
    // Keep the cell visible (base ground tile) but wipe everything on it.
    setCell({ q, r, tile: defaultBaseTile(kit) });
  };

  return (
    <aside
      className="cc-panel absolute z-10 rounded-2xl text-[13px] pointer-events-auto flex flex-col"
      style={{
        left: pos.x,
        top: pos.y,
        width: PANEL_WIDTH,
        // Cap against the panel's own positioning context (<main>, which already
        // sits below the ~50px TopBar) — using 100vh here overshot by the TopBar
        // height and pushed the scroll container's bottom (and the red delete
        // button) off-screen, unreachable even by scrolling. Subtracting pos.y
        // keeps the bottom in view when the panel is dragged down; +12 = gutter.
        maxHeight: `calc(100% - ${pos.y + 12}px)`,
      }}
    >
      {/* Pinned header + preview — always visible while the body scrolls. */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        <div
          className="flex items-center justify-between mb-3 select-none"
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
          {...dragProps}
        >
          <div>
            <div className="font-overtitle text-[10px]" style={{ color: 'var(--cc-orange)' }}>
              Selected cell
            </div>
            <div className="font-semibold">
              ({q}, {r})
            </div>
          </div>
          <button
            data-no-drag
            className="cc-muted hover:text-white"
            onClick={() => useMapStore.getState().selectCell(null)}
            title="Close"
          >
            ✕
          </button>
        </div>

        <AssetPreview assetId={previewId} />
      </div>

      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">

      {/* Elevation — raise/lower the whole cell by discrete steps to sculpt
          plains, hills and mountains. Available for any cell. */}
      <div className="mb-3">
        <div className="font-overtitle text-[10px] cc-muted mb-1">Elevation</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              setCell({ ...cell, elevation: clampElevation(elevationLevel(cell.elevation) - 1) })
            }
            disabled={elevationLevel(cell.elevation) <= 0}
            className="rounded-lg px-3 py-1 text-sm transition hover:bg-white/10 disabled:opacity-40"
            style={{ background: 'rgba(241,240,251,0.06)', color: 'var(--cc-white)' }}
            title="Lower one step"
          >
            −
          </button>
          <span className="flex-1 text-center text-[12px] cc-muted">
            Level {elevationLevel(cell.elevation)} / {MAX_ELEVATION_LEVEL}
          </span>
          <button
            onClick={() =>
              setCell({ ...cell, elevation: clampElevation(elevationLevel(cell.elevation) + 1) })
            }
            disabled={elevationLevel(cell.elevation) >= MAX_ELEVATION_LEVEL}
            className="rounded-lg px-3 py-1 text-sm transition hover:bg-white/10 disabled:opacity-40"
            style={{ background: 'rgba(241,240,251,0.06)', color: 'var(--cc-white)' }}
            title="Raise one step"
          >
            +
          </button>
        </div>
      </div>

      {resource?.data && (
        <LiveResource
          kind={resource.kind}
          data={resource.data}
          orgId={currentOrgId}
          onUnbind={() => clearResource(q, r)}
        />
      )}

      {cell.monitorId && (
        <div className="mb-3 rounded-lg px-3 py-2" style={{ background: 'rgba(241,240,251,0.04)' }}>
          <div className="font-overtitle text-[10px] cc-muted">Custom monitor</div>
          <div className="text-sm font-medium">{monitor?.display_name ?? 'monitor'}</div>
          <div className="font-overtitle text-[10px] cc-muted mt-2 mb-1">
            Default state
          </div>
          <div className="flex items-center gap-1">
            {MONITOR_STATES.map((s) => {
              const selected = monitorState === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => void changeMonitorState(s.id)}
                  className="flex-1 rounded-lg py-1 text-[11px] capitalize transition"
                  style={{
                    background: selected ? s.color : 'rgba(241,240,251,0.06)',
                    color: selected ? '#13172e' : 'var(--cc-white)',
                    fontWeight: selected ? 700 : 400,
                  }}
                  title={`Set state to ${s.id}`}
                >
                  {s.id}
                </button>
              );
            })}
          </div>
          <div className="cc-muted text-[11px] mt-1.5">
            Sets the state now; the rule engine can override it later.
          </div>

          {/* Workflow authoring moved to the global Workflows manager (TopBar →
              Workflows). The rule engine keys conditions on the monitor id, so
              this synthetic monitor is a valid target there. */}
          {currentOrgId && cell.monitorId && (
            <div className="mt-3 pt-3 border-t cc-border-soft">
              <div className="cc-muted text-[11px]">
                Create alerting workflows for this monitor in{' '}
                <span className="text-text font-medium">Workflows</span> (top bar).
              </div>
            </div>
          )}
        </div>
      )}

      {hasResource && (
        <div className="mb-3">
          {movingCell === selectedCell ? (
            <div
              className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[11px]"
              style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--cc-orange)' }}
            >
              <span>Click a destination tile…</span>
              <button
                onClick={cancelMove}
                className="cc-muted hover:text-white ml-2"
                title="Cancel (Esc)"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => selectedCell && beginMove(selectedCell)}
              className="w-full rounded-lg py-1.5 text-[11px] transition hover:bg-white/10"
              style={{ background: 'rgba(241,240,251,0.06)', color: 'var(--cc-white)' }}
              title="Relocate this resource to another tile (shortcut: M)"
            >
              ↔ Move to another tile
            </button>
          )}
        </div>
      )}

      {!hasResource && !cell.building && (
        <div className="cc-muted text-[12px] mb-3">
          No CC resource bound here. Pick one from the Resources panel on the
          right to place it on this hex, or use the Scenery section below to
          dress up the tile.
        </div>
      )}

      {cell.building && (
        <div className="flex flex-col gap-2 mt-3">
          <div className="font-overtitle text-[10px] cc-muted">
            {parseBuildingId(cell.building) || SPACE_BUILDING_ID_SET.has(cell.building)
              ? 'Building'
              : 'Structure'}
          </div>
          {parseBuildingId(cell.building) ? (
            <SkinPicker
              current={cell.building}
              lockColor={hasResource}
              onChange={(id) => setBuilding(q, r, id, cell.buildingRotation ?? 0)}
            />
          ) : SPACE_BUILDING_ID_SET.has(cell.building) ? (
            <SpaceSkinPicker
              current={cell.building}
              onChange={(id) => setBuilding(q, r, id, cell.buildingRotation ?? 0)}
            />
          ) : (
            // Custom/neutral asset (wall, bridge, tunnel…): no colour/type picker.
            <div className="text-sm">{humaniseStructureId(cell.building)}</div>
          )}
          <div className="font-overtitle text-[10px] cc-muted mt-1">
            Rotation
          </div>
          <RotationPicker
            current={cell.buildingRotation ?? 0}
            onChange={(rot) => setBuilding(q, r, cell.building!, rot)}
          />
          {!hasResource && (
            <button
              onClick={() => setBuilding(q, r, null)}
              className="w-full rounded-lg py-1.5 text-[11px] transition"
              style={{ background: 'rgba(230,63,72,0.15)', color: 'var(--cc-red-1)' }}
            >
              Remove building
            </button>
          )}
        </div>
      )}

      {/* Scenery — tile + decorations — only for cells that aren't used
          as a CC resource slot, so the inspector stays focused when live. */}
      {!hasResource && (
        <div className="mt-4 pt-3 border-t cc-border-soft flex flex-col gap-3">
          <div>
            <div className="font-overtitle text-[10px] cc-muted mb-1.5">
              Ground tile
            </div>
            {tileGroups.map(({ label, sub }) => {
              const items = tilesByGroup[sub] ?? [];
              if (items.length === 0) return null;
              // Auto-open the group that contains the current tile so the
              // user lands on it when reopening the inspector.
              const containsCurrent = items.some((t) => t.id === cell.tile);
              return (
                <details
                  key={sub}
                  open={containsCurrent || sub === 'base'}
                  className="mb-2"
                >
                  <summary
                    className="cursor-pointer select-none text-[11px] cc-muted py-1"
                    style={{ color: 'var(--cc-white)' }}
                  >
                    {label}{' '}
                    <span className="cc-muted">({items.length})</span>
                  </summary>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {items.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTile(t.id)}
                        onMouseEnter={() => setHoveredId(t.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        className="rounded-lg px-2 py-1 text-[11px] transition"
                        style={{
                          background:
                            cell.tile === t.id
                              ? 'var(--cc-primary)'
                              : 'rgba(241,240,251,0.06)',
                          color: 'var(--cc-white)',
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </details>
              );
            })}
            <div className="font-overtitle text-[10px] cc-muted mt-2 mb-1">
              Tile rotation
            </div>
            <RotationPicker
              current={cell.rotation ?? 0}
              onChange={(rot) => setCell({ ...cell, rotation: rot })}
            />
          </div>

          <div>
            <div className="font-overtitle text-[10px] cc-muted mb-1.5">
              Structures
            </div>
            <div className="flex flex-wrap gap-1">
              {structureItems.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setBuilding(q, r, s.id, cell.buildingRotation ?? 0)}
                  onMouseEnter={() => setHoveredId(s.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="rounded-lg px-2 py-1 text-[11px] transition hover:bg-white/10"
                  style={{
                    background:
                      cell.building === s.id ? 'var(--cc-primary)' : 'rgba(241,240,251,0.06)',
                    color: 'var(--cc-white)',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="cc-muted text-[11px] mt-1">
              One structure per cell — rotate it in the Structure section above.
            </div>
          </div>

          <div>
            <div className="font-overtitle text-[10px] cc-muted mb-1.5">
              Add decoration
            </div>
            {decorGroups.map((group, gi) => (
              <details key={group.label} open={gi === 0} className="mb-2">
                <summary
                  className="cursor-pointer select-none text-[11px] py-1"
                  style={{ color: 'var(--cc-white)' }}
                >
                  {group.label} <span className="cc-muted">({group.items.length})</span>
                </summary>
                <div className="flex flex-wrap gap-1 mt-1">
                  {group.items.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => addDecoration(d.id)}
                      onMouseEnter={() => setHoveredId(d.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className="rounded-lg px-2 py-1 text-[11px] transition hover:bg-white/10"
                      style={{
                        background: 'rgba(241,240,251,0.06)',
                        color: 'var(--cc-white)',
                      }}
                    >
                      + {d.label}
                    </button>
                  ))}
                </div>
              </details>
            ))}
          </div>

          {(cell.decorations?.length ?? 0) > 0 && (
            <div>
              <div className="font-overtitle text-[10px] cc-muted mb-1.5">
                Placed decorations ({cell.decorations!.length})
              </div>
              <div className="flex flex-col gap-1">
                {cell.decorations!.map((d, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg px-2 py-1.5 text-[11px]"
                    style={{ background: 'rgba(241,240,251,0.04)' }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">{d.id}</span>
                      <button
                        onClick={() => removeDecoration(idx)}
                        className="cc-muted hover:text-white ml-2"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-1">
                      <RotationPicker
                        current={d.rotation ?? 0}
                        onChange={(rot) => rotateDecoration(idx, rot)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={resetCell}
        className="mt-3 w-full rounded-lg py-1.5 text-[11px] transition"
        style={{ background: 'rgba(230,63,72,0.2)', color: 'var(--cc-red-1)' }}
        title="Clear building and decorations; keep a base ground tile so the cell stays visible."
      >
        Reset cell (keep ground)
      </button>
      </div>
    </aside>
  );
}

function SkinPicker({
  current,
  lockColor,
  onChange,
}: {
  current: string;
  /** When a resource is bound to this cell, the color is driven by status.
   *  Hide the color picker and surface that to the user. */
  lockColor: boolean;
  onChange: (id: string) => void;
}) {
  const parsed = parseBuildingId(current);
  const currentType = parsed?.type ?? null;
  const currentColor = parsed?.color ?? 'blue';

  return (
    <div className="flex flex-col gap-2">
      {!lockColor && (
        <div className="flex items-center gap-1.5">
          {BUILDING_COLORS.map((c) => {
            const selected = c === currentColor;
            return (
              <button
                key={c}
                title={c}
                onClick={() =>
                  currentType && onChange(buildingId(currentType, c))
                }
                disabled={!currentType}
                className="h-6 w-6 rounded-full transition"
                style={{
                  background: BUILDING_COLOR_SWATCH[c],
                  outline: selected
                    ? '2px solid var(--cc-white)'
                    : '2px solid transparent',
                  outlineOffset: 1,
                  opacity: currentType ? 1 : 0.4,
                  cursor: currentType ? 'pointer' : 'not-allowed',
                }}
              />
            );
          })}
        </div>
      )}
      {lockColor && (
        <div
          className="text-[10px] cc-muted italic"
          title="Building color is driven by the live status (running=green, deploying=blue, failed=red, unknown=yellow, created/stopped=scaffolding)."
        >
          Color is auto — follows the app/addon status.
        </div>
      )}

      <select
        value={currentType ?? ''}
        onChange={(e) =>
          onChange(
            buildingId(
              e.target.value as (typeof BUILDING_TYPES)[number],
              currentColor,
            ),
          )
        }
        className="w-full rounded-lg px-2 py-2 text-[12px]"
        style={{
          background: 'rgba(241,240,251,0.08)',
          color: 'var(--cc-white)',
          border: '1px solid rgba(241,240,251,0.12)',
        }}
      >
        {currentType === null && <option value="">(custom asset)</option>}
        {BUILDING_TYPES.map((t) => (
          <option key={t} value={t}>
            {buildingTypeLabel(t)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Space resource skin picker: one flat model list — status is shown by the
 *  badge sphere above the building, so there is no colour column. */
function SpaceSkinPicker({
  current,
  onChange,
}: {
  current: string;
  onChange: (id: string) => void;
}) {
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg px-2 py-2 text-[12px]"
      style={{
        background: 'rgba(241,240,251,0.08)',
        color: 'var(--cc-white)',
        border: '1px solid rgba(241,240,251,0.12)',
      }}
    >
      {getSpaceBuildingIds().map((id) => (
        <option key={id} value={id}>
          {spaceAssetLabel(id)}
        </option>
      ))}
    </select>
  );
}

function RotationPicker({
  current,
  onChange,
}: {
  current: number;
  onChange: (rotationStep: number) => void;
}) {
  // 6 steps of 60° on the hex grid, 4 steps of 90° on the square grid.
  const grid = useGrid();
  const degPerStep = 360 / grid.rotationSteps;
  const steps = Array.from({ length: grid.rotationSteps }, (_, i) => i);
  return (
    <div className="flex items-center gap-1">
      {steps.map((step) => {
        const selected = step === current;
        const deg = step * degPerStep;
        return (
          <button
            key={step}
            onClick={() => onChange(step)}
            className="flex-1 rounded-lg py-1 text-[11px] transition"
            style={{
              background: selected
                ? 'var(--cc-primary)'
                : 'rgba(241,240,251,0.06)',
              color: 'var(--cc-white)',
            }}
            title={`Rotate to ${deg}°`}
          >
            {deg}°
          </button>
        );
      })}
    </div>
  );
}
