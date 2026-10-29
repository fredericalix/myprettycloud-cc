import type { ResourceStatus } from '../types/ws';
import {
  BUILDING_COLORS,
  buildingId,
  parseBuildingId,
  type BuildingColor,
} from '../data/buildingSkins';
import type { Kit } from '../types/kit';

/**
 * Status → asset variant mapping.
 *
 * The KayKit Medieval Hexagon Pack ships colored copies of every building
 * (blue/green/red/yellow) — swapping the whole GLTF at status change is
 * visually richer than tinting a shared material (distinct textures, baked
 * lighting variations) and keeps the art style consistent. For `created`
 * and `stopped` we override with `building_stage_B` (scaffolding) to
 * communicate "not in production" regardless of the building type.
 *
 *   running    → _green
 *   deploying  → _blue
 *   failed     → _red
 *   warning    → _red   (app up but linked addon unhealthy)
 *   unknown    → _yellow
 *   stopped    → building_stage_B  (always, overrides color)
 *   created    → building_stage_B  (always, overrides color)
 *
 * Buildings without a color variant (bridges, stage_A/C, destroyed, dirt,
 * grain, scaffolding) stay visually unchanged for every status EXCEPT
 * `created`/`stopped` where we still swap to building_stage_B.
 */

const STATUS_COLOR: Partial<Record<ResourceStatus, BuildingColor>> = {
  running: 'green',
  deploying: 'blue',
  failed: 'red',
  warning: 'red',
  unknown: 'yellow',
};

const STAGE_B = 'building_stage_B';

export function assetIdForStatus(
  baseAssetId: string,
  status: ResourceStatus,
): string {
  // Under-construction states force the scaffolding building.
  if (status === 'created' || status === 'stopped') return STAGE_B;

  const parsed = parseBuildingId(baseAssetId);
  const targetColor = STATUS_COLOR[status];
  // Not a colored building (e.g. bridge, stage_A) or status has no color
  // mapping → keep the authored asset as-is.
  if (!parsed || !targetColor) return baseAssetId;

  return buildingId(parsed.type, targetColor);
}

/**
 * Synthetic-monitor state → asset variant. Distinct mapping from CC resources:
 *   ok       → _green
 *   warning  → _yellow
 *   critical → _red
 *   unknown  → building_stage_B (scaffolding — "state not known yet")
 * Rules may set arbitrary state strings; anything unrecognised reads as unknown.
 */
const MONITOR_STATE_COLOR: Record<string, BuildingColor> = {
  ok: 'green',
  warning: 'yellow',
  critical: 'red',
};

export function assetIdForMonitorState(
  baseAssetId: string,
  state: string,
): string {
  const targetColor = MONITOR_STATE_COLOR[state];
  if (!targetColor) return STAGE_B; // unknown / custom → scaffolding
  const parsed = parseBuildingId(baseAssetId);
  if (!parsed) return baseAssetId;
  return buildingId(parsed.type, targetColor);
}

/**
 * Kit-aware status asset: which GLTF a bound cell shows. Medieval swaps to the
 * status-coloured variant (or scaffolding); space keeps the authored model
 * untouched — status is carried by the StatusBadge sphere + StatusParticles
 * flames above the building, never by recolouring the asset.
 */
export function visualForStatus(
  kit: Kit,
  baseAssetId: string,
  status: ResourceStatus,
): { assetId: string } {
  if (kit === 'space') return { assetId: baseAssetId };
  return { assetId: assetIdForStatus(baseAssetId, status) };
}

export function visualForMonitorState(
  kit: Kit,
  baseAssetId: string,
  state: string,
): { assetId: string } {
  if (kit === 'space') return { assetId: baseAssetId };
  return { assetId: assetIdForMonitorState(baseAssetId, state) };
}

export { BUILDING_COLORS };
