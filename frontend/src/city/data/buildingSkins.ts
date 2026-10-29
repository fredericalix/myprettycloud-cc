/**
 * Catalog of swappable building skins for an app/addon. KayKit's Medieval
 * Hexagon Pack ships 26 building families, each in four colours — the user
 * picks any of those ~104 combinations from the Inspector to reskin a
 * placed resource.
 */

export const BUILDING_TYPES = [
  'home_A',
  'home_B',
  'castle',
  'townhall',
  'church',
  'shrine',
  'tavern',
  'market',
  'blacksmith',
  'workshop',
  'stables',
  'barracks',
  'archeryrange',
  'watchtower',
  'tower_A',
  'tower_B',
  'tower_base',
  'tower_cannon',
  'tower_catapult',
  'docks',
  'shipyard',
  'watermill',
  'windmill',
  'lumbermill',
  'mine',
  'well',
  'tent',
] as const;

export type BuildingType = (typeof BUILDING_TYPES)[number];

export const BUILDING_COLORS = ['blue', 'green', 'red', 'yellow'] as const;
export type BuildingColor = (typeof BUILDING_COLORS)[number];

/** CSS swatch for each color — approximate match of the GLTF vertex colors. */
export const BUILDING_COLOR_SWATCH: Record<BuildingColor, string> = {
  blue: '#4a7fb8',
  green: '#5ea64b',
  red: '#c9483a',
  yellow: '#d9b54b',
};

/** Build an asset id from (type, color): `building_<type>_<color>`. */
export function buildingId(type: BuildingType, color: BuildingColor): string {
  return `building_${type}_${color}`;
}

/** Parse an asset id into its (type, color) tuple, or null if the id doesn't
 *  match a known skin (custom assets, legacy entries, etc.). */
export function parseBuildingId(
  id: string,
): { type: BuildingType; color: BuildingColor } | null {
  if (!id.startsWith('building_')) return null;
  for (const color of BUILDING_COLORS) {
    const suffix = `_${color}`;
    if (!id.endsWith(suffix)) continue;
    const type = id.slice('building_'.length, id.length - suffix.length) as BuildingType;
    if ((BUILDING_TYPES as readonly string[]).includes(type)) {
      return { type, color };
    }
  }
  return null;
}

/** Humanise a type slug for display: `tower_cannon` → `Tower cannon`. */
export function buildingTypeLabel(type: BuildingType): string {
  const words = type.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
