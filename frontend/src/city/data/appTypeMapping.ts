/**
 * Maps Clever Cloud app types and addon providers to building asset IDs, per
 * kit. Medieval defaults use the blue colour variant (the inspector can swap
 * colours later); space models never recolour — the badge sphere shows status.
 */

import type { Kit } from '../types/kit';

type Kind = 'app' | 'addon';

/** CC `type` field on applications → building asset id. */
const APP_TYPE_TO_ASSET: Record<string, string> = {
  // Node
  node: 'building_home_A_blue',
  'node-lts': 'building_home_A_blue',
  // PHP
  php: 'building_home_B_blue',
  // Python
  python: 'building_shrine_blue',
  // Ruby
  ruby: 'building_tavern_blue',
  // Java family → forge
  java: 'building_blacksmith_blue',
  'java-war': 'building_blacksmith_blue',
  'java-jar': 'building_blacksmith_blue',
  maven: 'building_blacksmith_blue',
  gradle: 'building_blacksmith_blue',
  scala: 'building_blacksmith_blue',
  sbt: 'building_blacksmith_blue',
  // Compiled natives → watchtower
  rust: 'building_watchtower_blue',
  go: 'building_watchtower_blue',
  // Containers → castle
  docker: 'building_castle_blue',
  // Static → market
  'static-apache': 'building_market_blue',
  static: 'building_market_blue',
  // Functional
  elixir: 'building_church_blue',
  erlang: 'building_church_blue',
  // .NET
  dotnet: 'building_townhall_blue',
  // Misc
  haskell: 'building_workshop_blue',
};

const APP_DEFAULT_ASSET = 'building_tent_blue';

/** CC addon `provider.id` (slug) → building asset id. */
const ADDON_PROVIDER_TO_ASSET: Record<string, string> = {
  'postgresql-addon': 'building_watermill_blue',
  'mysql-addon': 'building_watermill_blue',
  'mongodb-addon': 'building_watermill_blue',
  'redis-addon': 'building_tower_A_blue',
  'es-addon': 'building_tower_B_blue',
  jenkins: 'building_stables_blue',
  'fs-bucket': 'building_docks_blue',
  'cellar-addon': 'building_docks_blue',
  pulsar: 'building_lumbermill_blue',
  kafka: 'building_lumbermill_blue',
  'addon-pulsar': 'building_lumbermill_blue',
  mailpace: 'building_shipyard_blue',
  'config-provider': 'building_well_blue',
  metabase: 'building_townhall_blue',
  matomo: 'building_townhall_blue',
  keycloak: 'building_tower_cannon_blue',
  heptapod: 'building_workshop_blue',
};

const ADDON_DEFAULT_ASSET = 'building_mine_blue';

/** CC `type` field on applications → space building asset id. */
const SPACE_APP_TYPE_TO_ASSET: Record<string, string> = {
  node: 'space_basemodule_A',
  'node-lts': 'space_basemodule_A',
  php: 'space_basemodule_B',
  python: 'space_dome',
  ruby: 'space_basemodule_D',
  // Java family
  java: 'space_basemodule_E',
  'java-war': 'space_basemodule_E',
  'java-jar': 'space_basemodule_E',
  maven: 'space_basemodule_E',
  gradle: 'space_basemodule_E',
  scala: 'space_basemodule_E',
  sbt: 'space_basemodule_E',
  // Compiled natives
  rust: 'space_structure_tall',
  go: 'space_structure_tall',
  // Containers
  docker: 'space_cargodepot_A',
  // Static
  'static-apache': 'space_basemodule_garage',
  static: 'space_basemodule_garage',
  // Functional
  elixir: 'space_eco_module',
  erlang: 'space_eco_module',
  // .NET
  dotnet: 'space_farm_large',
  // Misc
  haskell: 'space_farm_small',
};

const SPACE_APP_DEFAULT_ASSET = 'space_basemodule_C';

/** CC addon `provider.id` (slug) → space building asset id. */
const SPACE_ADDON_PROVIDER_TO_ASSET: Record<string, string> = {
  'postgresql-addon': 'space_water_storage',
  'mysql-addon': 'space_water_storage',
  'mongodb-addon': 'space_water_storage',
  'redis-addon': 'space_structure_low',
  'es-addon': 'space_drill_structure',
  jenkins: 'space_basemodule_garage',
  'fs-bucket': 'space_cargodepot_B',
  'cellar-addon': 'space_cargodepot_B',
  pulsar: 'space_windturbine_tall',
  kafka: 'space_windturbine_tall',
  'addon-pulsar': 'space_windturbine_tall',
  mailpace: 'space_landingpad_small',
  'config-provider': 'space_structure_low',
  metabase: 'space_dome',
  matomo: 'space_dome',
  keycloak: 'space_structure_tall',
  heptapod: 'space_farm_large_sprinkler',
};

const SPACE_ADDON_DEFAULT_ASSET = 'space_cargodepot_C';

export function autoAssetFor(kit: Kit, kind: Kind, type: string | null | undefined): string {
  const key = (type ?? '').toLowerCase();
  if (kit === 'space') {
    if (kind === 'app') return SPACE_APP_TYPE_TO_ASSET[key] ?? SPACE_APP_DEFAULT_ASSET;
    return SPACE_ADDON_PROVIDER_TO_ASSET[key] ?? SPACE_ADDON_DEFAULT_ASSET;
  }
  if (kind === 'app') return APP_TYPE_TO_ASSET[key] ?? APP_DEFAULT_ASSET;
  return ADDON_PROVIDER_TO_ASSET[key] ?? ADDON_DEFAULT_ASSET;
}

/** Default ground tile used when we auto-drop a building on an empty cell
 *  (and for ghost-growth placements). */
export function defaultBaseTile(kit: Kit): string {
  return kit === 'space' ? 'space_terrain_low' : 'hex_grass';
}
