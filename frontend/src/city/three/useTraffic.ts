import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useAnimationStore } from '../stores/useAnimationStore';
import { useRealtimeStore } from '../stores/useRealtimeStore';
import { useMapStore } from '../stores/useMapStore';
import { useAssetStore } from '../stores/useAssetStore';
import { useGrid } from '../hooks/useGrid';
import { cellIsBound, type HexCell } from '../types/map';
import { buildRoadGraph, endpointNode, findPath, type RoadGraph } from '../utils/roadGraph';
import type { GridAdapter } from '../utils/gridMath';
import {
  TRAFFIC_BASELINE,
  TRAFFIC_CONFIG,
  TRAFFIC_SPAWN_COOLDOWN,
  type VehicleDef,
} from '../data/trafficAssets';

interface TrafficEntity {
  obj: THREE.Group;
  curve: THREE.CatmullRomCurve3;
  length: number;
  progress: number;
  speed: number;
  phase: number;
  kind: 'ground' | 'air';
  /** Forward direction on the ground plane, refreshed each frame — used for
   *  the "someone ahead of me" vehicle-vehicle slowdown check. */
  heading: THREE.Vector2;
}

/** Baseline destination weight so idle buildings still get the odd visit. */
const IDLE_WEIGHT = 0.15;
/** How many origin/destination pairs to try per spawn tick before giving up
 *  (route may be blocked — buildings/water/decorations are unpathable). */
const SPAWN_ATTEMPTS = 3;
/** Vehicle-vehicle avoidance, two rings: ease off when another ground vehicle
 *  is ahead within SLOW_DISTANCE, hold short when within STOP_DISTANCE. The
 *  "ahead" test is a cone (dot > threshold) so opposing traffic on the other
 *  lane doesn't trigger it, and the pool-order priority makes exactly one of
 *  two crossing vehicles yield — no mutual deadlock. */
const AVOID_SLOW_DISTANCE = 0.8;
const AVOID_STOP_DISTANCE = 0.38;
const AVOID_SLOWDOWN = 0.35;

function netActivityFor(cell: HexCell): number {
  const rt = useRealtimeStore.getState();
  if (cell.appId) return rt.apps[cell.appId]?.netActivity ?? 0;
  if (cell.addonId) return rt.addons[cell.addonId]?.netActivity ?? 0;
  return 0;
}

/** Weighted pick over bound cells — busy apps see deliveries converge. */
function pickDestination(bound: HexCell[]): HexCell | null {
  if (bound.length === 0) return null;
  const weights = bound.map((c) => IDLE_WEIGHT + netActivityFor(c));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < bound.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return bound[i]!;
  }
  return bound[bound.length - 1]!;
}

/** Origin: another building cell. Trips only ever run building → building —
 *  a vehicle may not materialise (or evaporate) in open country. */
function pickOrigin(buildings: HexCell[], dest: HexCell): HexCell | null {
  const others = buildings.filter((c) => c !== dest);
  if (others.length === 0) return null;
  return others[Math.floor(Math.random() * others.length)]!;
}

function pickVehicle(defs: VehicleDef[]): VehicleDef {
  const total = defs.reduce((sum, d) => sum + d.weight, 0);
  let roll = Math.random() * total;
  for (const def of defs) {
    roll -= def.weight;
    if (roll <= 0) return def;
  }
  return defs[defs.length - 1]!;
}

function worldPoint(grid: GridAdapter, q: number, r: number, y: number): THREE.Vector3 {
  const { x, z } = grid.cellToWorld(q, r);
  return new THREE.Vector3(x, y, z);
}

/** Ground route: graph nodes plus a "doorstep" point at each end — the
 *  midpoint between the building cell and its adjacent traversable cell. The
 *  vehicle visibly pulls out of the origin building and vanishes right at the
 *  destination's door — never in open country, never through anything (cells
 *  holding buildings/decorations/water are not in the graph at all). */
function groundRoute(
  origin: HexCell,
  dest: HexCell,
  graph: RoadGraph,
  grid: GridAdapter,
): THREE.Vector3[] | null {
  const fromKey = endpointNode(graph, grid, origin.q, origin.r);
  const toKey = endpointNode(graph, grid, dest.q, dest.r);
  if (!fromKey || !toKey || fromKey === toKey) return null;
  const path = findPath(graph, grid, fromKey, toKey);
  if (!path || path.length < 2) return null;
  const centers = path.map((key) => {
    const node = graph.nodes.get(key)!;
    return worldPoint(grid, node.q, node.r, node.y);
  });
  const first = graph.nodes.get(path[0]!)!;
  const last = graph.nodes.get(path[path.length - 1]!)!;
  const originDoor = worldPoint(grid, origin.q, origin.r, first.y).lerp(centers[0]!, 0.5);
  const destDoor = worldPoint(grid, dest.q, dest.r, last.y).lerp(
    centers[centers.length - 1]!,
    0.5,
  );
  // Thread the shared-edge midpoints between consecutive cells: the smoothed
  // curve then stays inside the traversed corridor instead of cutting corners
  // through neighbouring cells (which may hold buildings or decorations).
  const waypoints: THREE.Vector3[] = [originDoor, centers[0]!];
  for (let i = 1; i < centers.length; i++) {
    waypoints.push(centers[i - 1]!.clone().lerp(centers[i]!, 0.5), centers[i]!);
  }
  waypoints.push(destDoor);
  return waypoints;
}

/** Air route: take off from the origin building, cruise at altitude (well
 *  above the tallest stack — max elevation 4 + ~2 of building), and land on
 *  the destination building. Shuttles never pop in or out mid-air. */
function airRoute(
  origin: HexCell,
  dest: HexCell,
  grid: GridAdapter,
  altitude: number,
): THREE.Vector3[] {
  const cruiseY = Math.max(origin.elevation ?? 0, dest.elevation ?? 0) + altitude;
  const liftA = worldPoint(grid, origin.q, origin.r, (origin.elevation ?? 0) + 0.7);
  const liftB = worldPoint(grid, dest.q, dest.r, (dest.elevation ?? 0) + 0.7);
  const a = liftA.clone().setY(cruiseY);
  const b = liftB.clone().setY(cruiseY);
  const dir = b.clone().sub(a);
  const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const mid = a.clone().lerp(b, 0.5).add(perp.multiplyScalar(0.8)).setY(cruiseY + 0.3);
  // Climb-out and approach are pulled toward the trip middle so the curve
  // reads as a flight arc rather than a vertical elevator.
  const climb = a.clone().lerp(mid, 0.25);
  const approach = b.clone().lerp(mid, 0.25);
  return [liftA, climb, mid, approach, liftB];
}

/**
 * Metric-driven traffic: an imperative pool of vehicles travelling between
 * buildings — every trip starts at a building's doorstep and ends at
 * another's; nothing ever pops in or out in open country (maps with fewer
 * than two buildings have no traffic). Population = baseline + Σ netActivity
 * (a busy org visibly bustles); destinations are weighted by each resource's
 * network activity. Ground vehicles follow the road graph exclusively
 * (collision-free by construction); space shuttles take off from and land on
 * the buildings they serve. Follows the useAnimations pattern — store reads
 * are imperative inside useFrame, movement is delta-based so the 30 fps
 * FrameLimiter cadence doesn't change speeds.
 */
export function useTraffic(groupRef: React.RefObject<THREE.Group | null>) {
  const grid = useGrid();
  const cells = useMapStore((s) => s.cells);
  const cfg = TRAFFIC_CONFIG[grid.kit];

  // The store replaces `cells` by reference on every map edit, so the graph
  // (and the despawn effect below) invalidate automatically.
  const graph = useMemo(() => buildRoadGraph(cells, grid), [cells, grid]);

  const entities = useRef<TrafficEntity[]>([]);
  const spawnAcc = useRef(TRAFFIC_SPAWN_COOLDOWN); // first spawn without delay

  // Map edits / kit switches / unmount: despawn in-flight entities. Edits only
  // happen in builder mode where the blink is invisible.
  useEffect(() => {
    return () => {
      for (const e of entities.current) e.obj.removeFromParent();
      entities.current = [];
    };
  }, [graph, groupRef]);

  useFrame((state, rawDelta) => {
    if (!useAnimationStore.getState().trafficEnabled) return;
    const group = groupRef.current;
    if (!group) return;
    const delta = Math.min(rawDelta, 0.1);
    const elapsed = state.clock.elapsedTime;

    // --- Move + despawn -------------------------------------------------
    const pool = entities.current;
    for (let i = pool.length - 1; i >= 0; i--) {
      const e = pool[i]!;

      // Vehicle-vehicle avoidance: ease off / hold when another ground
      // vehicle is close and ahead (positions are last frame's — plenty at
      // 30 fps). On a tie (two vehicles seeing each other ahead, e.g. at a
      // crossing), only the later-spawned one yields.
      let speedFactor = 1;
      if (e.kind === 'ground') {
        for (let j = 0; j < pool.length; j++) {
          const other = pool[j]!;
          if (other === e || other.kind !== 'ground') continue;
          const dx = other.obj.position.x - e.obj.position.x;
          const dz = other.obj.position.z - e.obj.position.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > AVOID_SLOW_DISTANCE * AVOID_SLOW_DISTANCE) continue;
          const dist = Math.sqrt(d2) || 1e-4;
          const ahead = (dx * e.heading.x + dz * e.heading.y) / dist;
          if (ahead < 0.5) continue;
          if (dist < AVOID_STOP_DISTANCE && j < i) {
            speedFactor = 0;
            break;
          }
          speedFactor = Math.min(speedFactor, AVOID_SLOWDOWN);
        }
      }

      e.progress += (e.speed * speedFactor * delta) / e.length;
      if (e.progress >= 1) {
        e.obj.removeFromParent();
        pool.splice(i, 1);
        continue;
      }
      const t = e.progress;
      const pos = e.curve.getPointAt(t);
      const tangent = e.curve.getTangentAt(t);
      e.heading.set(tangent.x, tangent.z).normalize();
      const bob =
        e.kind === 'air'
          ? Math.sin(elapsed * 2.2 + e.phase) * 0.06
          : Math.sin(elapsed * 6 + e.phase) * 0.015;
      // Right-hand lane: opposing ground traffic passes side by side.
      const lane = e.kind === 'ground' ? cfg.laneOffset : 0;
      e.obj.position.set(
        pos.x + tangent.z * lane,
        pos.y + cfg.yOffset + bob,
        pos.z - tangent.x * lane,
      );
      e.obj.rotation.y = Math.atan2(tangent.x, tangent.z) + cfg.facingOffset;
      // Ground: cart rock. Air: gentle banking into the curve.
      e.obj.rotation.z =
        e.kind === 'air'
          ? Math.sin(elapsed * 1.4 + e.phase) * 0.05
          : Math.sin(elapsed * 5 + e.phase) * 0.03;
    }

    // --- Spawn toward the target population ------------------------------
    spawnAcc.current += delta;
    if (spawnAcc.current < TRAFFIC_SPAWN_COOLDOWN) return;

    // Trip endpoints are BUILDINGS only — a vehicle always leaves a building
    // and always vanishes at one; it never materialises in open country.
    // Bridges and tunnels are road structures, not stops.
    const buildingCells = Array.from(cells.values()).filter(
      (c) =>
        c.building &&
        !c.building.startsWith('building_bridge') &&
        !c.building.startsWith('space_tunnel'),
    );
    if (buildingCells.length < 2) return;
    const bound = buildingCells.filter(cellIsBound);
    const totalActivity = bound.reduce((sum, c) => sum + netActivityFor(c), 0);
    const target = Math.min(
      cfg.maxEntities,
      Math.max(TRAFFIC_BASELINE, TRAFFIC_BASELINE + Math.round(totalActivity * 2)),
    );
    if (pool.length >= target) return;
    spawnAcc.current = 0;

    const def = pickVehicle(cfg.vehicles);

    // Destination favours busy bound buildings; decorative buildings (farms,
    // towers, …) keep sparse maps alive. Blocked routes (enclosed buildings,
    // disconnected terrain) just retry with another pair.
    let waypoints: THREE.Vector3[] | null = null;
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS && !waypoints; attempt++) {
      const dest =
        pickDestination(bound) ??
        buildingCells[Math.floor(Math.random() * buildingCells.length)]!;
      const origin = pickOrigin(buildingCells, dest);
      if (!origin) return;
      waypoints =
        def.kind === 'air'
          ? airRoute(origin, dest, grid, cfg.airAltitude)
          : groundRoute(origin, dest, graph, grid);
    }
    if (!waypoints) return;

    const curve = new THREE.CatmullRomCurve3(waypoints, false, 'centripetal', 0.5);
    const length = curve.getLength();
    if (length < 1) return;

    const { cloneModel } = useAssetStore.getState();
    const obj = new THREE.Group();
    for (const part of def.parts) {
      const model = cloneModel(part.id);
      if (!model) continue;
      model.position.set(0, part.dy ?? 0, part.dz ?? 0);
      obj.add(model);
    }
    if (obj.children.length === 0) return;
    obj.scale.setScalar(def.scale ?? 1);
    obj.traverse((child) => {
      child.castShadow = false;
      child.receiveShadow = false;
    });
    group.add(obj);
    pool.push({
      obj,
      curve,
      length,
      progress: 0,
      speed: def.speedMin + Math.random() * (def.speedMax - def.speedMin),
      phase: Math.random() * Math.PI * 2,
      kind: def.kind,
      heading: new THREE.Vector2(0, 1),
    });
  });
}
