/**
 * Square grid utilities for the space kit.
 *
 * KayKit Space Base Bits terrain blocks are 2×2 world units (X/Z: [-1, 1]),
 * surface at y=0 with a 1-unit body below — the same vertical convention as
 * the medieval hexes, so elevation skirts stack identically. Cells reuse the
 * HexCell (q, r) fields as (column, row).
 */

export const SQUARE_CELL_SIZE = 2;

/** Center of a cell in world space. */
export function squareToWorld(q: number, r: number): { x: number; z: number } {
  return { x: SQUARE_CELL_SIZE * q, z: SQUARE_CELL_SIZE * r };
}

/** Nearest cell for a world position. */
export function worldToSquare(x: number, z: number): { q: number; r: number } {
  return { q: Math.round(x / SQUARE_CELL_SIZE), r: Math.round(z / SQUARE_CELL_SIZE) };
}

/** Convert rotation step (0-3) to radians. Each step = 90 degrees. */
export function squareRotation(step: number): number {
  return step * (Math.PI / 2);
}

/** Filled square grid centered on the origin: (2·radius+1)² cells. */
export function generateSquareGrid(radius: number): Array<{ q: number; r: number }> {
  const cells: Array<{ q: number; r: number }> = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      cells.push({ q, r });
    }
  }
  return cells;
}

/** The 4 orthogonal neighbours (right, down, left, up) — diagonal adjacency
 *  is intentionally excluded so ghost growth matches the hex behaviour of
 *  "expand across a shared edge". */
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export function squareNeighbors(q: number, r: number): Array<{ q: number; r: number }> {
  return NEIGHBOR_OFFSETS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

/** Ring distance from the origin (Chebyshev distance). */
export function squareDistance(q: number, r: number): number {
  return Math.max(Math.abs(q), Math.abs(r));
}

/** Square ring spiral up to `radius` rings (Chebyshev distance), starting at
 *  the origin — auto-placement order. */
export function* squareSpiral(radius: number): Generator<{ q: number; r: number }> {
  yield { q: 0, r: 0 };
  for (let k = 1; k <= radius; k++) {
    // Walk the ring clockwise from the top-left corner.
    for (let q = -k; q < k; q++) yield { q, r: -k }; // top edge →
    for (let r = -k; r < k; r++) yield { q: k, r }; // right edge ↓
    for (let q = k; q > -k; q--) yield { q, r: k }; // bottom edge ←
    for (let r = k; r > -k; r--) yield { q: -k, r }; // left edge ↑
  }
}
