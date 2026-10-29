export interface Decoration {
  id: string;
  dx?: number;
  /** Vertical offset — e.g. a lander resting on a landing pad's deck. */
  dy?: number;
  dz?: number;
  rotation?: number;
}

export interface HexCell {
  q: number;
  r: number;
  tile: string;
  rotation?: number;
  elevation?: number;
  building?: string;
  buildingRotation?: number;
  decorations?: Decoration[];
  /** Clever Cloud application id (if this cell represents an app). */
  appId?: string;
  /** Clever Cloud addon id (if this cell represents an addon). */
  addonId?: string;
  /** Synthetic monitor id (if this cell is a custom monitored building, not
   *  backed by a CC app/addon). Its colour is driven by the monitor's state. */
  monitorId?: string;
}

/** Canonical "this cell already hosts a resource" predicate — one binding per
 *  cell (an app, an addon, or a synthetic monitor). Used to hard-block placing
 *  a new resource onto an occupied cell. */
export function cellIsBound(cell: HexCell | undefined | null): boolean {
  return Boolean(cell && (cell.appId || cell.addonId || cell.monitorId));
}

export type AssetCategory = 'tiles' | 'buildings' | 'decoration' | 'units';

export interface AssetEntry {
  id: string;
  path: string;
  category: AssetCategory;
  subcategory: string;
}
