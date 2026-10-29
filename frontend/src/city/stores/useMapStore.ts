import { create } from 'zustand';
import { getMap, saveMap, type SceneSettings } from '../api/maps';
import type { HexCell } from '../types/map';
import { DEFAULT_KIT, KITS, type Kit } from '../types/kit';
import { useAnimationStore } from './useAnimationStore';
import { useAssetStore } from './useAssetStore';
import { debug } from '../utils/debug';
import { cellKey as hexKey } from '../utils/gridMath';
import { starterMedievalCells, starterSpaceCells } from '../data/starterScene';

/** Defaults match useAnimationStore's initial state. Used when a scene has no
 *  saved settings, so opening a fresh org resets ambiance to the baseline
 *  rather than carrying over the previous org's. */
const SCENE_DEFAULTS: Required<Omit<SceneSettings, 'kit'>> = {
  windEnabled: true,
  waterEnabled: true,
  dayNightEnabled: false,
  particlesEnabled: true,
  cloudsEnabled: true,
  trafficEnabled: true,
  storagePropsEnabled: true,
  theme: 'default',
};

/** Guards the animation-store subscription so applying loaded settings doesn't
 *  immediately schedule a redundant save. */
let applyingSettings = false;

function currentSceneSettings(): SceneSettings {
  const a = useAnimationStore.getState();
  return {
    windEnabled: a.windEnabled,
    waterEnabled: a.waterEnabled,
    dayNightEnabled: a.dayNightEnabled,
    particlesEnabled: a.particlesEnabled,
    cloudsEnabled: a.cloudsEnabled,
    trafficEnabled: a.trafficEnabled,
    storagePropsEnabled: a.storagePropsEnabled,
    theme: useAssetStore.getState().theme,
    kit: useMapStore.getState().kit ?? undefined,
  };
}

function applySceneSettings(s: SceneSettings | undefined, kit: Kit | null) {
  const m = { ...SCENE_DEFAULTS, ...(s ?? {}) };
  applyingSettings = true;
  useAnimationStore.setState({
    windEnabled: !!m.windEnabled,
    waterEnabled: !!m.waterEnabled,
    dayNightEnabled: !!m.dayNightEnabled,
    particlesEnabled: !!m.particlesEnabled,
    // Space has no weather: clouds stay off regardless of what was saved.
    cloudsEnabled: kit === 'space' ? false : !!m.cloudsEnabled,
    trafficEnabled: !!m.trafficEnabled,
    storagePropsEnabled: !!m.storagePropsEnabled,
  });
  applyingSettings = false;
  // Season texture theme (re-skins the shared atlas). Not part of the animation
  // store, so it doesn't trip the save-subscription. Medieval-only — the asset
  // store ignores it for other kits.
  void useAssetStore.getState().setTheme((s ?? {}).theme ?? 'default');
}

/** Empty-map seed so the user sees a canvas, not a void, after picking a kit:
 *  the kit's hand-composed starter scene (see data/starterScene.ts) with the
 *  central plaza left buildable for auto-placed resources. */
function proceduralBase(kit: Kit): Map<string, HexCell> {
  const cells = new Map<string, HexCell>();
  for (const cell of kit === 'space' ? starterSpaceCells() : starterMedievalCells()) {
    cells.set(hexKey(cell.q, cell.r), cell);
  }
  return cells;
}

function kitFromSettings(s: SceneSettings | undefined): Kit | null {
  const k = (s ?? {}).kit;
  return KITS.includes(k as Kit) ? (k as Kit) : null;
}

/** Result of a relocate attempt, so the caller can surface the reason. */
export type MoveResult = 'ok' | 'occupied' | 'invalid';

interface MapState {
  cells: Map<string, HexCell>;
  selectedCell: string | null;
  /** Hex key currently under the cursor (transient — drives the hover name
   *  tooltip; never persisted). */
  hoveredCell: string | null;
  /** Hex key of a resource cell armed for relocation (builder "move" mode). */
  movingCell: string | null;
  mapName: string;
  currentOrgId: string | null;

  /** Visual kit of the loaded map; null until known (loading, or awaiting the
   *  first-open kit prompt). Asset loading and grid math key off this. */
  kit: Kit | null;
  /** True when the map is empty and has no kit yet — the kit prompt is shown
   *  instead of the builder, and nothing is seeded or saved until chosen. */
  needsKitChoice: boolean;

  // Persistence status
  loadStatus: 'idle' | 'loading' | 'ready' | 'error';
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  version: number;

  // Mutations — only the ones the auto-placer / inspector need.
  setCell: (cell: HexCell) => void;
  removeCell: (q: number, r: number) => void;
  setBuilding: (q: number, r: number, buildingId: string | null, rotation?: number) => void;
  selectCell: (key: string | null) => void;
  setHoveredCell: (key: string | null) => void;
  clearMap: () => void;
  /** Replace the whole map with a template's cells, then persist. */
  replaceCells: (cells: HexCell[]) => void;
  /** First-open kit pick: set the kit, seed the baseline, persist. */
  chooseKit: (kit: Kit) => void;
  /** Wipe the map AND its kit (placements lost), persist immediately, and show
   *  the kit prompt again — the "change style" escape hatch. */
  resetMap: () => Promise<void>;

  assignResource: (
    q: number,
    r: number,
    kind: 'app' | 'addon',
    resourceId: string,
  ) => void;
  /** Bind a synthetic monitor to a cell (custom monitored building). */
  assignMonitor: (q: number, r: number, monitorId: string) => void;
  clearResource: (q: number, r: number) => void;

  // Builder "move" mode: arm a resource cell, then relocate it to a target.
  beginMove: (key: string) => void;
  cancelMove: () => void;
  /** Relocate the armed resource (binding + building skin/rotation) onto an
   *  existing target cell, leaving the target's tile/decorations intact.
   *  Returns 'occupied' (target already hosts a resource) or 'invalid' without
   *  mutating; clears move mode and selects the target on 'ok'. */
  moveResourceTo: (targetKey: string) => MoveResult;

  // Server sync
  loadFromServer: (orgId: string) => Promise<void>;
  saveToServer: () => Promise<void>;
  /** Schedule a debounced save (keeps server state in sync after mutations). */
  scheduleSave: () => void;
}

function cellsToArray(cells: Map<string, HexCell>): HexCell[] {
  return Array.from(cells.values());
}

function arrayToCells(arr: HexCell[]): Map<string, HexCell> {
  const map = new Map<string, HexCell>();
  for (const cell of arr) {
    map.set(hexKey(cell.q, cell.r), cell);
  }
  return map;
}

const SAVE_DEBOUNCE_MS = 2000;

export const useMapStore = create<MapState>((set, get) => {
  // Captured in this closure so the timer is bound to this store instance.
  // Previously this was a module-level `let` which leaked across Vite HMR reloads
  // and could fire a save against a reset store.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelSaveTimer = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };

  return {
  cells: new Map(),
  selectedCell: null,
  hoveredCell: null,
  movingCell: null,
  mapName: 'My City',
  currentOrgId: null,
  kit: null,
  needsKitChoice: false,

  loadStatus: 'idle',
  saveStatus: 'idle',
  version: 0,

  setCell: (cell) => {
    set((state) => {
      const cells = new Map(state.cells);
      cells.set(hexKey(cell.q, cell.r), cell);
      return { cells };
    });
    get().scheduleSave();
  },

  removeCell: (q, r) => {
    set((state) => {
      const cells = new Map(state.cells);
      const key = hexKey(q, r);
      cells.delete(key);
      return {
        cells,
        selectedCell: state.selectedCell === key ? null : state.selectedCell,
      };
    });
    get().scheduleSave();
  },

  setBuilding: (q, r, buildingId, rotation) => {
    set((state) => {
      const cells = new Map(state.cells);
      const key = hexKey(q, r);
      const existing = cells.get(key);
      if (!existing) return state;
      if (buildingId) {
        cells.set(key, {
          ...existing,
          building: buildingId,
          buildingRotation: rotation ?? existing.buildingRotation ?? 0,
        });
      } else {
        const { building: _b, buildingRotation: _br, appId: _a, addonId: _ad, ...rest } =
          existing;
        cells.set(key, rest as HexCell);
      }
      return { cells };
    });
    get().scheduleSave();
  },

  selectCell: (key) => set({ selectedCell: key }),

  setHoveredCell: (key) => {
    if (get().hoveredCell !== key) set({ hoveredCell: key });
  },

  clearMap: () => {
    // Re-seed the same playable baseline a fresh load produces, rather
    // than an empty Map. An empty map is a dead end in the builder: GhostHexes
    // renders nothing (no neighbours to grow from) and BuilderLayout can only
    // place a tile adjacent to an existing one, so the user would otherwise have
    // to refresh the browser before they could place anything again.
    set({
      cells: proceduralBase(get().kit ?? DEFAULT_KIT),
      selectedCell: null,
      hoveredCell: null,
      movingCell: null,
    });
    get().scheduleSave();
  },

  chooseKit: (kit) => {
    set({
      kit,
      needsKitChoice: false,
      cells: proceduralBase(kit),
      selectedCell: null,
      hoveredCell: null,
      movingCell: null,
    });
    get().scheduleSave();
  },

  resetMap: async () => {
    cancelSaveTimer();
    set({
      cells: new Map(),
      kit: null,
      needsKitChoice: true,
      selectedCell: null,
      hoveredCell: null,
      movingCell: null,
    });
    // Persist the wipe right away (no debounce): the kit must not linger in the
    // saved settings, or a reload would resurrect the old style with no cells.
    await get().saveToServer();
  },

  replaceCells: (cells) => {
    set({
      cells: arrayToCells(cells),
      selectedCell: null,
      hoveredCell: null,
      movingCell: null,
    });
    get().scheduleSave();
  },

  assignResource: (q, r, kind, resourceId) => {
    set((state) => {
      const cells = new Map(state.cells);
      const key = hexKey(q, r);
      const existing = cells.get(key);
      if (!existing) return state;
      // Defensive backstop: never silently clobber a *different* resource already
      // bound to this cell (one binding per cell). Placement callers already
      // hard-block occupied cells in the UI; this keeps the store honest if a
      // caller forgets. Re-binding the same id is allowed (idempotent).
      const sameKind = kind === 'app' ? existing.appId : existing.addonId;
      const occupiedByOther =
        existing.monitorId != null ||
        (kind === 'app' ? existing.addonId != null : existing.appId != null) ||
        (sameKind != null && sameKind !== resourceId);
      if (occupiedByOther) return state;
      // Clear other-kind resource to keep one binding per cell.
      const next: HexCell = {
        ...existing,
        appId: kind === 'app' ? resourceId : undefined,
        addonId: kind === 'addon' ? resourceId : undefined,
        monitorId: undefined,
      };
      cells.set(key, next);
      return { cells };
    });
    get().scheduleSave();
  },

  assignMonitor: (q, r, monitorId) => {
    set((state) => {
      const cells = new Map(state.cells);
      const key = hexKey(q, r);
      const existing = cells.get(key);
      if (!existing) return state;
      // Defensive backstop (see assignResource): refuse to overwrite a cell that
      // already holds an app/addon, or a *different* monitor. Re-binding the same
      // monitor is idempotent.
      if (
        existing.appId != null ||
        existing.addonId != null ||
        (existing.monitorId != null && existing.monitorId !== monitorId)
      ) {
        return state;
      }
      const next: HexCell = {
        ...existing,
        monitorId,
        appId: undefined,
        addonId: undefined,
      };
      cells.set(key, next);
      return { cells };
    });
    get().scheduleSave();
  },

  clearResource: (q, r) => {
    set((state) => {
      const cells = new Map(state.cells);
      const key = hexKey(q, r);
      const existing = cells.get(key);
      if (!existing) return state;
      const { appId: _a, addonId: _b, monitorId: _m, ...rest } = existing;
      cells.set(key, rest as HexCell);
      return { cells };
    });
    get().scheduleSave();
  },

  beginMove: (key) => set({ movingCell: key }),
  cancelMove: () => set({ movingCell: null }),

  moveResourceTo: (targetKey) => {
    const state = get();
    const src = state.movingCell;
    if (!src) return 'invalid';
    // Dropping back on the origin is a no-op cancel.
    if (src === targetKey) {
      set({ movingCell: null });
      return 'ok';
    }
    const source = state.cells.get(src);
    const target = state.cells.get(targetKey);
    if (!source || !target) return 'invalid';
    if (target.appId || target.addonId || target.monitorId) return 'occupied';

    const cells = new Map(state.cells);
    // Move the binding + building skin/rotation onto the target, keeping the
    // target's own tile and decorations.
    cells.set(targetKey, {
      ...target,
      appId: source.appId,
      addonId: source.addonId,
      monitorId: source.monitorId,
      building: source.building,
      buildingRotation: source.buildingRotation,
    });
    // Strip the binding + building from the source, leaving its tile behind.
    const {
      appId: _a,
      addonId: _b,
      monitorId: _m,
      building: _c,
      buildingRotation: _d,
      ...rest
    } = source;
    cells.set(src, rest as HexCell);

    set({ cells, movingCell: null, selectedCell: targetKey });
    get().scheduleSave();
    return 'ok';
  },

  loadFromServer: async (orgId) => {
    cancelSaveTimer();
    set({
      loadStatus: 'loading',
      currentOrgId: orgId,
      selectedCell: null,
      movingCell: null,
      kit: null,
      needsKitChoice: false,
    });
    try {
      const resp = await getMap(orgId);
      const loaded = arrayToCells(resp.cells);
      // Resolve the kit: saved setting wins; maps that predate the kit axis
      // (cells but no setting) are medieval; a truly fresh map waits for the
      // kit prompt — nothing is seeded or saved until the user picks.
      const kit = kitFromSettings(resp.settings) ?? (loaded.size > 0 ? DEFAULT_KIT : null);
      set({
        cells: loaded,
        mapName: resp.name,
        version: resp.version,
        kit,
        needsKitChoice: kit === null,
        loadStatus: 'ready',
        saveStatus: 'idle',
      });
      // Restore this scene's ambiance toggles (wind/water/day-night/particles/
      // clouds). Guarded so it doesn't trigger an immediate re-save.
      applySceneSettings(resp.settings, kit);
      // A pre-kit map gets a baseline seed (and its kit stamped) on first open.
      if (kit !== null && loaded.size === 0) {
        set({ cells: proceduralBase(kit) });
        get().scheduleSave();
      }
    } catch (e) {
      debug.error('map', 'loadFromServer failed', e, { orgId });
      set({ loadStatus: 'error', cells: new Map() });
    }
  },

  saveToServer: async () => {
    const { currentOrgId, mapName, cells } = get();
    if (!currentOrgId) return;
    set({ saveStatus: 'saving' });
    try {
      const resp = await saveMap(currentOrgId, {
        name: mapName,
        cells: cellsToArray(cells),
        settings: currentSceneSettings(),
      });
      set({ saveStatus: 'saved', version: resp.version });
    } catch (e) {
      debug.error('map', 'saveToServer failed', e, { orgId: currentOrgId });
      set({ saveStatus: 'error' });
    }
  },

  scheduleSave: () => {
    if (!get().currentOrgId || get().loadStatus !== 'ready') return;
    cancelSaveTimer();
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void get().saveToServer();
    }, SAVE_DEBOUNCE_MS);
  },
  };
});

// Persist scene ambiance toggles with the map: when the user flips wind/water/
// day-night/particles/clouds, debounce-save the current scene. The guard skips
// the programmatic apply done on map load.
useAnimationStore.subscribe(() => {
  if (applyingSettings) return;
  useMapStore.getState().scheduleSave();
});
