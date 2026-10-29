import type { AssetEntry } from '../types/map';

/** KayKit Space Base Bits — the "space" kit. One shared texture
 *  (`spacebits_texture.png`, applied by the loader like the medieval atlas),
 *  square 2×2-unit terrain blocks as ground tiles, no per-color building
 *  variants (status is shown by the badge sphere + flame particles above).
 *
 *  Ids are prefixed `space_` so they can never collide with medieval ids and
 *  never match `extractColor`/`parseBuildingId` (no id ends in a color suffix).
 *  Files named `space_*` at the source keep their single prefix.
 *
 *  Subcategories:
 *  - tiles/base    — flat ground (surface at y=0, 1-unit body below, like hexes)
 *  - tiles/sculpt  — raised/slope pieces (y −1..+1) for manual terrain shaping
 *  - buildings/space   — resource skins (status badge above)
 *  - buildings/neutral — structures palette (tunnels as roads, lander pad)
 *  - decoration/props  — rocks, cargo, tech props
 *  - units/space       — vehicles
 */
const P = 'assets/gltf/space';

export const SPACE_ASSET_CATALOG: AssetEntry[] = [
  // --- tiles / base ---
  { id: 'space_terrain_low', path: `${P}/terrain_low.gltf`, category: 'tiles', subcategory: 'base' },
  { id: 'space_terrain_mining', path: `${P}/terrain_mining.gltf`, category: 'tiles', subcategory: 'base' },
  // --- tiles / sculpt ---
  { id: 'space_terrain_tall', path: `${P}/terrain_tall.gltf`, category: 'tiles', subcategory: 'sculpt' },
  { id: 'space_terrain_slope', path: `${P}/terrain_slope.gltf`, category: 'tiles', subcategory: 'sculpt' },
  { id: 'space_terrain_slope_inner_corner', path: `${P}/terrain_slope_inner_corner.gltf`, category: 'tiles', subcategory: 'sculpt' },
  { id: 'space_terrain_slope_outer_corner', path: `${P}/terrain_slope_outer_corner.gltf`, category: 'tiles', subcategory: 'sculpt' },
  { id: 'space_terrain_low_curved', path: `${P}/terrain_low_curved.gltf`, category: 'tiles', subcategory: 'sculpt' },
  { id: 'space_terrain_tall_curved', path: `${P}/terrain_tall_curved.gltf`, category: 'tiles', subcategory: 'sculpt' },

  // --- buildings / space (resource skins) ---
  { id: 'space_basemodule_A', path: `${P}/basemodule_A.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_basemodule_B', path: `${P}/basemodule_B.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_basemodule_C', path: `${P}/basemodule_C.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_basemodule_D', path: `${P}/basemodule_D.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_basemodule_E', path: `${P}/basemodule_E.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_basemodule_garage', path: `${P}/basemodule_garage.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_dome', path: `${P}/dome.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_cargodepot_A', path: `${P}/cargodepot_A.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_cargodepot_B', path: `${P}/cargodepot_B.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_cargodepot_C', path: `${P}/cargodepot_C.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_landingpad_small', path: `${P}/landingpad_small.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_landingpad_large', path: `${P}/landingpad_large.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_structure_low', path: `${P}/structure_low.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_structure_tall', path: `${P}/structure_tall.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_drill_structure', path: `${P}/drill_structure.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_eco_module', path: `${P}/eco_module.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_farm_small', path: `${P}/space_farm_small.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_farm_large', path: `${P}/space_farm_large.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_farm_large_sprinkler', path: `${P}/space_farm_large_sprinkler.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_water_storage', path: `${P}/water_storage.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_windturbine_low', path: `${P}/windturbine_low.gltf`, category: 'buildings', subcategory: 'space' },
  { id: 'space_windturbine_tall', path: `${P}/windturbine_tall.gltf`, category: 'buildings', subcategory: 'space' },

  // --- buildings / neutral (structures palette) ---
  { id: 'space_tunnel_straight_A', path: `${P}/tunnel_straight_A.gltf`, category: 'buildings', subcategory: 'neutral' },
  { id: 'space_tunnel_straight_B', path: `${P}/tunnel_straight_B.gltf`, category: 'buildings', subcategory: 'neutral' },
  { id: 'space_tunnel_diagonal_short_A', path: `${P}/tunnel_diagonal_short_A.gltf`, category: 'buildings', subcategory: 'neutral' },
  { id: 'space_tunnel_diagonal_short_B', path: `${P}/tunnel_diagonal_short_B.gltf`, category: 'buildings', subcategory: 'neutral' },
  { id: 'space_tunnel_diagonal_long_A', path: `${P}/tunnel_diagonal_long_A.gltf`, category: 'buildings', subcategory: 'neutral' },
  { id: 'space_tunnel_diagonal_long_B', path: `${P}/tunnel_diagonal_long_B.gltf`, category: 'buildings', subcategory: 'neutral' },
  { id: 'space_lander_base', path: `${P}/lander_base.gltf`, category: 'buildings', subcategory: 'neutral' },

  // --- decoration / props ---
  { id: 'space_rock_A', path: `${P}/rock_A.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_rock_B', path: `${P}/rock_B.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_rocks_A', path: `${P}/rocks_A.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_rocks_B', path: `${P}/rocks_B.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_cargo_A', path: `${P}/cargo_A.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_cargo_A_packed', path: `${P}/cargo_A_packed.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_cargo_A_stacked', path: `${P}/cargo_A_stacked.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_cargo_B', path: `${P}/cargo_B.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_cargo_B_packed', path: `${P}/cargo_B_packed.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_cargo_B_stacked', path: `${P}/cargo_B_stacked.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_containers_A', path: `${P}/containers_A.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_containers_B', path: `${P}/containers_B.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_containers_C', path: `${P}/containers_C.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_containers_D', path: `${P}/containers_D.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_lights', path: `${P}/lights.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_solarpanel', path: `${P}/solarpanel.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_roofmodule_base', path: `${P}/roofmodule_base.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_roofmodule_cargo_A', path: `${P}/roofmodule_cargo_A.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_roofmodule_cargo_B', path: `${P}/roofmodule_cargo_B.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_roofmodule_cargo_C', path: `${P}/roofmodule_cargo_C.gltf`, category: 'decoration', subcategory: 'props' },
  { id: 'space_roofmodule_solarpanels', path: `${P}/roofmodule_solarpanels.gltf`, category: 'decoration', subcategory: 'props' },

  // --- units ---
  { id: 'space_spacetruck', path: `${P}/spacetruck.gltf`, category: 'units', subcategory: 'space' },
  { id: 'space_spacetruck_large', path: `${P}/spacetruck_large.gltf`, category: 'units', subcategory: 'space' },
  { id: 'space_spacetruck_trailer', path: `${P}/spacetruck_trailer.gltf`, category: 'units', subcategory: 'space' },
  { id: 'space_mobile_base_cargo', path: `${P}/mobile_base_cargo.gltf`, category: 'units', subcategory: 'space' },
  { id: 'space_mobile_base_carriage', path: `${P}/mobile_base_carriage.gltf`, category: 'units', subcategory: 'space' },
  { id: 'space_mobile_base_command', path: `${P}/mobile_base_command.gltf`, category: 'units', subcategory: 'space' },
  { id: 'space_mobile_base_frame', path: `${P}/mobile_base_frame.gltf`, category: 'units', subcategory: 'space' },
  { id: 'space_dropship', path: `${P}/dropship.gltf`, category: 'units', subcategory: 'space' },
  { id: 'space_dropship_packed', path: `${P}/dropship_packed.gltf`, category: 'units', subcategory: 'space' },
  { id: 'space_lander_A', path: `${P}/lander_A.gltf`, category: 'units', subcategory: 'space' },
  { id: 'space_lander_B', path: `${P}/lander_B.gltf`, category: 'units', subcategory: 'space' },
];

/** Resource-skin ids (buildings/space) — the space analog of the medieval
 *  type×color skin grid; used by the builder's skin picker and the synthetic
 *  monitor type picker. */
export function getSpaceBuildingIds(): string[] {
  return SPACE_ASSET_CATALOG.filter(
    (a) => a.category === 'buildings' && a.subcategory === 'space',
  ).map((a) => a.id);
}

/** Human label for a space asset id: `space_basemodule_A` → "Basemodule A". */
export function spaceAssetLabel(assetId: string): string {
  const base = assetId.replace(/^space_/, '').replace(/_/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
}
