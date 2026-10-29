import type { Kit } from '../types/kit';

/** One model in a composed vehicle. Offsets are in the vehicle's local frame
 *  (+z = forward): a hitched cart sits at negative dz behind its horse, a
 *  mobile-base module sits at positive dy on its wheeled frame. */
export interface VehiclePart {
  id: string;
  dz?: number;
  dy?: number;
}

export interface VehicleDef {
  parts: VehiclePart[];
  /** Ground vehicles follow the road graph; air vehicles fly straight at
   *  cruise altitude (space shuttles). */
  kind: 'ground' | 'air';
  scale?: number;
  speedMin: number;
  speedMax: number;
  /** Spawn-probability weight within the kit's vehicle pool. */
  weight: number;
}

export interface TrafficKitConfig {
  vehicles: VehicleDef[];
  /** Lift above the tile surface (tile tops sit at y = elevation). */
  yOffset: number;
  /** Added to atan2(tangent.x, tangent.z) — corrects the model's forward axis. */
  facingOffset: number;
  /** Hard cap on simultaneous entities (perf budget at the 30 fps cap). */
  maxEntities: number;
  /** Cruise height above the higher trip endpoint for `kind: 'air'`. */
  airAltitude: number;
  /** Right-hand lane: ground vehicles ride this far to the right of the path
   *  centreline, so opposing traffic passes side by side instead of merging. */
  laneOffset: number;
}

/** Hitched pair: horse in front, cart at the towbar. No combined asset exists
 *  in the KayKit pack, so the attelage is composed at spawn time. */
function attelage(horse: string, cart: string): VehiclePart[] {
  return [
    { id: horse, dz: 0.3 },
    { id: cart, dz: -0.34 },
  ];
}

export const TRAFFIC_CONFIG: Record<Kit, TrafficKitConfig> = {
  medieval: {
    // Scaled down to keep believable proportions against the (super-deformed)
    // buildings: at 1.0 a merchant cart (h 1.18) towers over a house (h 0.93);
    // at ~0.45 a horse stands about a third of a house — reads as life-size.
    vehicles: [
      { parts: attelage('horse_A', 'cart'), kind: 'ground', scale: 0.48, speedMin: 0.55, speedMax: 0.8, weight: 2 },
      { parts: attelage('horse_B', 'cart_merchant'), kind: 'ground', scale: 0.48, speedMin: 0.55, speedMax: 0.8, weight: 2 },
      { parts: attelage('horse_D', 'cart'), kind: 'ground', scale: 0.48, speedMin: 0.55, speedMax: 0.8, weight: 1 },
      // Lone riders — quicker than the freight.
      { parts: [{ id: 'horse_C' }], kind: 'ground', scale: 0.45, speedMin: 1.0, speedMax: 1.4, weight: 1 },
      { parts: [{ id: 'horse_E' }], kind: 'ground', scale: 0.45, speedMin: 1.0, speedMax: 1.4, weight: 1 },
      { parts: [{ id: 'horse_G' }], kind: 'ground', scale: 0.45, speedMin: 1.0, speedMax: 1.4, weight: 1 },
    ],
    yOffset: 0.02,
    facingOffset: 0,
    maxEntities: 8,
    airAltitude: 0, // no flight in the middle ages
    laneOffset: 0.16,
  },
  space: {
    vehicles: [
      // Wheels on regolith. The pack has no compact rover, so the spacetruck
      // is scaled well down to read as a light utility vehicle (the large
      // truck and mobile-base rigs are building-sized — not traffic).
      { parts: [{ id: 'space_spacetruck' }], kind: 'ground', scale: 0.5, speedMin: 0.9, speedMax: 1.3, weight: 2 },
      { parts: [{ id: 'space_spacetruck' }], kind: 'ground', scale: 0.42, speedMin: 1.1, speedMax: 1.5, weight: 1 },
      // Small shuttles cruising above the colony.
      { parts: [{ id: 'space_dropship' }], kind: 'air', scale: 0.55, speedMin: 1.6, speedMax: 2.2, weight: 1 },
      { parts: [{ id: 'space_lander_A' }], kind: 'air', scale: 0.55, speedMin: 1.6, speedMax: 2.2, weight: 1 },
      { parts: [{ id: 'space_lander_B' }], kind: 'air', scale: 0.55, speedMin: 1.6, speedMax: 2.2, weight: 1 },
    ],
    yOffset: 0.02,
    facingOffset: 0,
    maxEntities: 6,
    airAltitude: 3.2,
    laneOffset: 0.18,
  },
};

/** Always-moving ambient population — the city is never dead (requirement:
 *  baseline + net-activity modulation, see useTraffic). */
export const TRAFFIC_BASELINE = 2;

/** Seconds between spawns while below the target population. */
export const TRAFFIC_SPAWN_COOLDOWN = 4;
