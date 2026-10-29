import type { HexCell } from '../types/map';
import type { GridAdapter } from './gridMath';
import { cellKey } from './gridMath';

/** Traversable cell in the ground-traffic graph. `cost` is the price of
 *  *entering* the cell — vehicles prefer roads/tunnels (cost 1) but can cross
 *  open terrain (cost 3). Cells holding a building, a decoration, or water are
 *  NOT in the graph at all: ground vehicles can never clip through them
 *  (collision avoidance is done here, at route time, not per-frame). */
export interface RoadNode {
  q: number;
  r: number;
  y: number;
  cost: number;
}

export interface RoadGraph {
  nodes: Map<string, RoadNode>;
}

/** Medieval roads are tiles; river crossings are bridges and count too. */
function isMedievalRoad(cell: HexCell): boolean {
  return cell.tile.startsWith('hex_road') || cell.tile.startsWith('hex_river_crossing');
}

/** Open water / rivers / wet coast — no carts in the drink. Waterless coast
 *  variants are dry land and stay traversable. */
function isMedievalWater(cell: HexCell): boolean {
  if (cell.tile === 'hex_water') return true;
  if (cell.tile.startsWith('hex_river_') && !cell.tile.startsWith('hex_river_crossing')) {
    return true;
  }
  return cell.tile.startsWith('hex_coast_') && !cell.tile.endsWith('_waterless');
}

function isSpaceTunnel(cell: HexCell): boolean {
  return Boolean(cell.building?.startsWith('space_tunnel'));
}

/** Bridges are road structures, not obstacles: a bridge building placed on a
 *  river crossing must keep the road traversable. */
function isBridge(cell: HexCell): boolean {
  return Boolean(cell.building?.startsWith('building_bridge'));
}

/** Build the traversable-cell graph for the current map. Pure — callers cache
 *  it with useMemo keyed on the (copy-on-write) cells Map. */
export function buildRoadGraph(cells: Map<string, HexCell>, grid: GridAdapter): RoadGraph {
  const nodes = new Map<string, RoadNode>();
  for (const [key, cell] of cells) {
    const y = cell.elevation ?? 0;
    const decorated = (cell.decorations?.length ?? 0) > 0;
    if (grid.kit === 'space') {
      if (isSpaceTunnel(cell)) {
        nodes.set(key, { q: cell.q, r: cell.r, y, cost: 1 });
      } else if (!cell.building && !decorated) {
        nodes.set(key, { q: cell.q, r: cell.r, y, cost: 3 });
      }
    } else if ((!cell.building || isBridge(cell)) && !decorated && !isMedievalWater(cell)) {
      nodes.set(key, { q: cell.q, r: cell.r, y, cost: isMedievalRoad(cell) ? 1 : 3 });
    }
  }
  return { nodes };
}

/** Admissible distance heuristic: hex distance on the axial grid (6-neighbour),
 *  manhattan on the square grid (4-neighbour). Min edge cost is 1. */
function heuristic(grid: GridAdapter, a: RoadNode, b: RoadNode): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  if (grid.kit === 'space') return Math.abs(dq) + Math.abs(dr);
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Graph node usable as a trip endpoint for a building cell: the cheapest
 *  adjacent traversable cell (vehicles depart/arrive BESIDE buildings, never
 *  from inside them). For a cell that is itself traversable (ambient wandering
 *  endpoints), the cell itself. Null when fully enclosed. */
export function endpointNode(
  graph: RoadGraph,
  grid: GridAdapter,
  q: number,
  r: number,
): string | null {
  let best: string | null = null;
  let bestCost = Infinity;
  for (const n of grid.neighbors(q, r)) {
    const key = cellKey(n.q, n.r);
    const node = graph.nodes.get(key);
    if (node && node.cost < bestCost) {
      best = key;
      bestCost = node.cost;
    }
  }
  if (best) return best;
  const self = cellKey(q, r);
  return graph.nodes.has(self) ? self : null;
}

/** A* over the road graph. Returns the node-key path (inclusive of both
 *  endpoints) or null when disconnected. Slope guard: |Δelevation| ≤ 1 per
 *  step (matches the kits' one-level ramps). */
export function findPath(
  graph: RoadGraph,
  grid: GridAdapter,
  fromKey: string,
  toKey: string,
): string[] | null {
  const start = graph.nodes.get(fromKey);
  const goal = graph.nodes.get(toKey);
  if (!start || !goal) return null;
  if (fromKey === toKey) return [fromKey];

  const gScore = new Map<string, number>([[fromKey, 0]]);
  const cameFrom = new Map<string, string>();
  // Small maps (a few hundred cells): a sorted-insert array beats a heap here.
  const open: Array<{ key: string; f: number }> = [
    { key: fromKey, f: heuristic(grid, start, goal) },
  ];
  const closed = new Set<string>();

  while (open.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.f < open[bestIdx]!.f) bestIdx = i;
    }
    const { key: currentKey } = open.splice(bestIdx, 1)[0]!;
    if (currentKey === toKey) {
      const path = [currentKey];
      let k = currentKey;
      while (cameFrom.has(k)) {
        k = cameFrom.get(k)!;
        path.push(k);
      }
      return path.reverse();
    }
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    const current = graph.nodes.get(currentKey)!;
    for (const nb of grid.neighbors(current.q, current.r)) {
      const nbKey = cellKey(nb.q, nb.r);
      const nbNode = graph.nodes.get(nbKey);
      if (!nbNode || closed.has(nbKey)) continue;
      if (Math.abs(nbNode.y - current.y) > 1) continue;
      const tentative = gScore.get(currentKey)! + nbNode.cost;
      if (tentative < (gScore.get(nbKey) ?? Infinity)) {
        gScore.set(nbKey, tentative);
        cameFrom.set(nbKey, currentKey);
        open.push({ key: nbKey, f: tentative + heuristic(grid, nbNode, goal) });
      }
    }
  }
  return null;
}
