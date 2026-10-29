import type { Kit } from '../types/kit';
import {
  generateHexGrid,
  hexDistance,
  hexKey,
  hexRotation,
  hexToWorld,
  neighbors as hexNeighbors,
  parseHexKey,
  worldToHex,
} from './hexMath';
import {
  generateSquareGrid,
  squareDistance,
  squareNeighbors,
  squareRotation,
  squareSpiral,
  squareToWorld,
  worldToSquare,
} from './squareMath';

/**
 * Grid geometry behind one interface so scene/builder code is kit-agnostic:
 * medieval = pointy-top hex grid (6 neighbours, 60° rotation steps),
 * space = square grid of 2×2 terrain blocks (4 neighbours, 90° steps).
 * Cell keys ("q,r") are shared across both grids.
 */
export interface GridAdapter {
  kit: Kit;
  cellToWorld(q: number, r: number): { x: number; z: number };
  worldToCell(x: number, z: number): { q: number; r: number };
  neighbors(q: number, r: number): Array<{ q: number; r: number }>;
  /** Filled grid centered on the origin (procedural seed). */
  generateGrid(radius: number): Array<{ q: number; r: number }>;
  /** Outward ring walk from the origin (auto-placement order). */
  spiral(radius: number): Generator<{ q: number; r: number }>;
  /** Cells within `radius` rings of the origin: the spiral's coverage, used to
   *  size auto-placement search areas. */
  cellCountForRadius(radius: number): number;
  /** How many rings out from the origin a cell sits (used to size searches to
   *  the existing map rather than to a resource count). */
  ringDistance(q: number, r: number): number;
  /** How many discrete rotation steps a placement supports. */
  rotationSteps: number;
  rotationRad(step: number): number;
  /** Center-to-vertex distance of one cell (camera framing margins). */
  cellCircumradius: number;
}

/** Axial hex spiral up to `radius` rings, starting at origin. */
function* hexSpiral(radius: number): Generator<{ q: number; r: number }> {
  yield { q: 0, r: 0 };
  const dirs: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ];
  for (let k = 1; k <= radius; k++) {
    let q = -k;
    let r = k;
    for (let dir = 0; dir < 6; dir++) {
      for (let step = 0; step < k; step++) {
        yield { q, r };
        q += dirs[dir]![0];
        r += dirs[dir]![1];
      }
    }
  }
}

const HEX_ADAPTER: GridAdapter = {
  kit: 'medieval',
  cellToWorld: hexToWorld,
  worldToCell: worldToHex,
  neighbors: hexNeighbors,
  generateGrid: generateHexGrid,
  spiral: hexSpiral,
  cellCountForRadius: (radius) => 3 * radius * (radius + 1) + 1,
  ringDistance: hexDistance,
  rotationSteps: 6,
  rotationRad: hexRotation,
  cellCircumradius: 2 / Math.sqrt(3),
};

const SQUARE_ADAPTER: GridAdapter = {
  kit: 'space',
  cellToWorld: squareToWorld,
  worldToCell: worldToSquare,
  neighbors: squareNeighbors,
  generateGrid: generateSquareGrid,
  spiral: squareSpiral,
  cellCountForRadius: (radius) => (2 * radius + 1) ** 2,
  ringDistance: squareDistance,
  rotationSteps: 4,
  rotationRad: squareRotation,
  cellCircumradius: Math.SQRT2,
};

export function gridFor(kit: Kit): GridAdapter {
  return kit === 'space' ? SQUARE_ADAPTER : HEX_ADAPTER;
}

/** Cell keys are grid-agnostic — re-exported here so kit-agnostic code doesn't
 *  have to import from hexMath. */
export const cellKey = hexKey;
export const parseCellKey = parseHexKey;
