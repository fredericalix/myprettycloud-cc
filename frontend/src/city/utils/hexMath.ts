/**
 * Pointy-top hexagonal grid utilities.
 *
 * KayKit Medieval Hexagon Pack models are pointy-top:
 *   X: [-1.0, 1.0]    = 2.0 units (flat edge to flat edge)
 *   Z: [-1.1547, 1.1547] = 2.309 units (vertex to vertex)
 *
 * Circumradius R = 2/sqrt(3) ≈ 1.1547
 * Y is up. Axial coordinates (q, r).
 *
 * Neighbor layout (world space):
 *   dir 0: (q+1, r)   → right       (flat edge)
 *   dir 1: (q, r+1)   → lower-right (diagonal)
 *   dir 2: (q-1, r+1) → lower-left  (diagonal)
 *   dir 3: (q-1, r)   → left        (flat edge)
 *   dir 4: (q, r-1)   → upper-left  (diagonal)
 *   dir 5: (q+1, r-1) → upper-right (diagonal)
 */

const SQRT3 = Math.sqrt(3);

export function hexToWorld(q: number, r: number): { x: number; z: number } {
  return {
    x: 2 * q + r,
    z: SQRT3 * r,
  };
}

/** Convert rotation step (0-5) to radians. Each step = 60 degrees. */
export function hexRotation(step: number): number {
  return step * (Math.PI / 3);
}

/** Convert world coordinates to the nearest hex axial coordinates. */
export function worldToHex(x: number, z: number): { q: number; r: number } {
  // Inverse of: x = 2q + r, z = sqrt(3) * r
  const r = z / SQRT3;
  const q = (x - r) / 2;

  // Round to nearest hex using cube coordinate rounding
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }

  return { q: rq, r: rr };
}

/** Generate hex positions for a filled hexagonal grid with given radius (number of rings). */
export function generateHexGrid(radius: number): Array<{ q: number; r: number }> {
  const cells: Array<{ q: number; r: number }> = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      cells.push({ q, r });
    }
  }
  return cells;
}

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

/** Ring distance from the origin (how many rings out), via cube coordinates. */
export function hexDistance(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

export function parseHexKey(key: string): { q: number; r: number } {
  const [q, r] = key.split(',').map(Number);
  return { q: q!, r: r! };
}

/** The 6 axial neighbours of (q, r), in the order documented at the top
 *  of this file (right, lower-right, lower-left, left, upper-left, upper-right). */
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];
export function neighbors(q: number, r: number): Array<{ q: number; r: number }> {
  return NEIGHBOR_OFFSETS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}
