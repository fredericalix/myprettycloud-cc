// Per-tile elevation. KayKit hex tiles have a 1.0-unit body (surface at local
// y=0, body down to y=-1), and `hex_grass_bottom` is an identical 1.0-unit
// column meant to stack underneath. One step == 1.0 world unit. Raising a tile
// lifts its whole group by `level` units, so its own footprint (the base
// ground level) is left empty — you'd see daylight under it from the sides.
// To keep the column solid we stack ONE `hex_grass_bottom` per level beneath
// the tile (level 1 ⇒ one base piece flush with the neighbours, level N ⇒ N).

import type { Kit } from '../types/kit';

export const ELEVATION_STEP = 1;
export const MAX_ELEVATION_LEVEL = 4;
export const SKIRT_ASSET = 'hex_grass_bottom';

/** Skirt piece per kit. Space terrain blocks are full-height boxes with the
 *  same surface-at-0 / 1-unit-body convention, so the flat terrain tile is its
 *  own skirt. */
export function skirtAssetFor(kit: Kit): string {
  return kit === 'space' ? 'space_terrain_low' : SKIRT_ASSET;
}

/** Discrete elevation level (0..MAX) for a stored world-y offset. */
export function elevationLevel(elevation: number | undefined): number {
  return Math.round((elevation ?? 0) / ELEVATION_STEP);
}

/** Number of `hex_grass_bottom` skirt pieces to stack under a raised tile —
 *  one per elevation level, so the lifted tile's own footprint is filled down
 *  to the ground (no visible void/daylight under it). */
export function skirtCount(elevation: number | undefined): number {
  return Math.max(0, elevationLevel(elevation));
}

export function clampElevation(level: number): number {
  const clamped = Math.max(0, Math.min(MAX_ELEVATION_LEVEL, level));
  return clamped * ELEVATION_STEP;
}
