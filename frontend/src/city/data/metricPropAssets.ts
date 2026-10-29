import type { Kit } from '../types/kit';

/** One prop placement around a bound building. Offsets are polar picks at
 *  radius 0.40–0.85 from the cell centre — strictly inside the cell (hex
 *  inradius 1.0, square half-extent 1.0) so neighbouring cells never collide.
 *  The RAM cluster sits on the +x side, the disk depot on the -x side. */
export interface PropSlot {
  id: string;
  dx: number;
  dz: number;
  dy?: number;
  rotY?: number;
  /** Toppled-on-its-side look for the ≥90% RAM overflow barrels. */
  rotZ?: number;
}

interface RamPropSet {
  /** Tier N (1–5) shows the first N slots. */
  slots: PropSlot[];
  /** Added on top at tier 5 (RAM ≥ 90%): the "overflowing at the door" look. */
  overflow: PropSlot[];
}

export const RAM_PROPS: Record<Kit, RamPropSet> = {
  medieval: {
    slots: [
      { id: 'barrel', dx: 0.62, dz: 0.28 },
      { id: 'sack', dx: 0.74, dz: 0.0, rotY: 0.6 },
      { id: 'crate_A_small', dx: 0.55, dz: 0.52, rotY: 0.3 },
      { id: 'crate_B_big', dx: 0.76, dz: -0.28, rotY: -0.4 },
      { id: 'crate_long_A', dx: 0.4, dz: 0.7, rotY: 0.9 },
    ],
    overflow: [
      { id: 'crate_open', dx: 0.24, dz: 0.76, rotY: 1.4 },
      { id: 'barrel', dx: 0.06, dz: 0.8, dy: 0.1, rotZ: Math.PI / 2, rotY: 0.7 },
      { id: 'barrel', dx: 0.85, dz: 0.18, dy: 0.1, rotZ: Math.PI / 2, rotY: 2.3 },
    ],
  },
  space: {
    slots: [
      { id: 'space_cargo_A', dx: 0.62, dz: 0.28 },
      { id: 'space_cargo_A_packed', dx: 0.74, dz: 0.0, rotY: 0.6 },
      { id: 'space_cargo_A_stacked', dx: 0.55, dz: 0.52, rotY: 0.3 },
      { id: 'space_containers_A', dx: 0.76, dz: -0.28, rotY: -0.4 },
      { id: 'space_containers_B', dx: 0.4, dz: 0.7, rotY: 0.9 },
    ],
    overflow: [
      { id: 'space_containers_D', dx: 0.24, dz: 0.76, rotY: 1.4 },
      { id: 'space_cargo_B', dx: 0.06, dz: 0.8, rotY: 0.7 },
      { id: 'space_cargo_B', dx: 0.85, dz: 0.18, rotY: 2.3 },
    ],
  },
};

/** Disk depot: tier N (1–4) shows the first N slots; reads as a filling pile. */
export const DISK_PROPS: Record<Kit, PropSlot[]> = {
  medieval: [
    { id: 'resource_lumber', dx: -0.62, dz: -0.3 },
    { id: 'resource_stone', dx: -0.72, dz: 0.05, rotY: 0.5 },
    { id: 'pallet', dx: -0.48, dz: -0.6, rotY: 0.2 },
    { id: 'pallet', dx: -0.48, dz: -0.6, dy: 0.16, rotY: 0.5 },
  ],
  space: [
    { id: 'space_cargo_B', dx: -0.62, dz: -0.3 },
    { id: 'space_cargo_B_packed', dx: -0.72, dz: 0.05, rotY: 0.5 },
    { id: 'space_cargo_B_stacked', dx: -0.48, dz: -0.6, rotY: 0.2 },
    { id: 'space_containers_C', dx: -0.3, dz: -0.72, rotY: 1.1 },
  ],
};

/** RAM% → 0–5. Tier 5 (≥90%) adds the overflow cluster. */
export function ramTierFor(ramPct: number | null | undefined): number {
  if (ramPct == null) return 0;
  if (ramPct >= 90) return 5;
  return Math.max(0, Math.min(4, Math.floor(ramPct / 20)));
}

/** Disk% → 0–4 (one slot per 25%). */
export function diskTierFor(diskPct: number | null | undefined): number {
  if (diskPct == null) return 0;
  return Math.max(0, Math.min(4, Math.floor(diskPct / 25)));
}
