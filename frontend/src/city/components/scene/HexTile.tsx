import { useEffect, useRef, useMemo, memo } from 'react';
import * as THREE from 'three';
import type { HexCell } from '../../types/map';
import { useGrid } from '../../hooks/useGrid';
import { useAssetStore } from '../../stores/useAssetStore';
import { useRealtimeStore } from '../../stores/useRealtimeStore';
import { visualForStatus, visualForMonitorState } from '../../utils/statusVisual';
import { skirtCount, skirtAssetFor } from '../../utils/elevation';
import { extractColor } from '../../data/assetCatalog';
import type { ResourceStatus } from '../../types/ws';
import { useAnimationContext, type AnimationRegistry } from './SceneCanvas';
import { StatusBadge } from './StatusBadge';
import { StatusParticles } from './StatusParticles';
import { DeployScaffold } from './DeployScaffold';
import { BuildingEffects } from './BuildingEffects';
import { MetricProps } from './MetricProps';

// Small decorations that don't need to cast shadows (save shadow pass cost)
const NO_SHADOW_DECO = [
  'rock', 'waterlily', 'waterplant', 'barrel', 'crate', 'bucket',
  'haybale', 'flower', 'anchor', 'trough', 'target', 'weaponrack',
  'wheelbarrow', 'boatrack', 'cannonball', 'projectile',
  // space props
  'containers', 'cargo', 'space_lights', 'solarpanel',
];

// Warm village lantern (medieval) vs cold colony light (space). useDayNight
// ramps intensity from 0 at noon to 1.5 at night.
const VILLAGE_LIGHT_COLOR: Record<string, number> = {
  medieval: 0xffaa44,
  space: 0x9fc4ff,
};

interface HexTileProps {
  cell: HexCell;
  registryRef: React.RefObject<AnimationRegistry>;
}

function HexTileImpl({ cell, registryRef }: HexTileProps) {
  const groupRef = useRef<THREE.Group>(null);
  const cloneModel = useAssetStore((s) => s.cloneModel);
  const ensureColorLoaded = useAssetStore((s) => s.ensureColorLoaded);
  const { register, unregister, villageLightsRef } = useAnimationContext();
  const grid = useGrid();
  const kit = grid.kit;

  const { x, z } = useMemo(() => grid.cellToWorld(cell.q, cell.r), [grid, cell.q, cell.r]);
  const y = cell.elevation ?? 0;
  const isWater = cell.tile === 'hex_water';

  // Live status drives which colored GLTF we load: green/blue/red/yellow
  // variants for run/deploy/fail/unknown, and `building_stage_B` for
  // `created`/`stopped` to show a scaffolded construction site. Addons don't
  // report status granularity — healthy → running, unhealthy → failed.
  const appStatus = useRealtimeStore((s) =>
    cell.appId ? s.apps[cell.appId]?.status ?? null : null,
  );
  const addonHealthy = useRealtimeStore((s) =>
    cell.addonId ? s.addons[cell.addonId]?.healthy ?? null : null,
  );
  // Custom monitored buildings (synthetic monitor, no app/addon) take their
  // colour straight from the monitor's rule-driven state.
  const monitorState = useRealtimeStore((s) =>
    cell.monitorId ? s.monitors[cell.monitorId]?.state ?? 'unknown' : null,
  );
  const buildingStatus: ResourceStatus = cell.appId
    ? appStatus ?? 'unknown'
    : cell.addonId
      ? addonHealthy === null
        ? 'unknown'
        : addonHealthy
          ? 'running'
          : 'failed'
      : 'running';

  // The exact GLTF id this cell should show given its live status / monitor
  // state (medieval id-swap; space keeps the authored model — status lives in
  // the badge sphere + flame particles). Computed in the body (not inside the
  // placement effect) so we can subscribe *narrowly* to just this cell's color
  // readiness below, instead of the whole store-wide `loadedColors` Set —
  // otherwise every lazy color batch that lands re-runs the placement effect
  // (full re-clone) for EVERY tile in the city, a multi-hundred-ms stall right
  // as the city colours in.
  const activeBuildingId = useMemo(() => {
    if (!cell.building) return null;
    const isBoundResource = Boolean(cell.appId || cell.addonId);
    if (cell.monitorId)
      return visualForMonitorState(kit, cell.building, monitorState ?? 'unknown').assetId;
    return isBoundResource
      ? visualForStatus(kit, cell.building, buildingStatus).assetId
      : cell.building;
  }, [kit, cell.building, cell.appId, cell.addonId, cell.monitorId, monitorState, buildingStatus]);

  const wantedColor = useMemo(
    () => (activeBuildingId ? extractColor(activeBuildingId) : null),
    [activeBuildingId],
  );
  // True when this cell needs no lazy color, or when its color batch has landed.
  // Only tiles waiting on the just-arrived color see this flip and re-run.
  const wantedColorReady = useAssetStore((s) =>
    wantedColor ? s.loadedColors.has(wantedColor) : true,
  );

  // Track registered objects for cleanup
  const registeredRef = useRef<Array<{ type: 'windmillFans' | 'watermillWheels' | 'trees' | 'boats' | 'flags' | 'waterTiles'; obj: THREE.Object3D }>>([]);
  const lightRef = useRef<THREE.PointLight | null>(null);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    // Clear previous children
    while (group.children.length > 0) {
      group.remove(group.children[0]!);
    }

    // Cleanup previous registrations
    for (const { type, obj } of registeredRef.current) {
      unregister(type, obj);
    }
    registeredRef.current = [];

    // Remove previous village light
    if (lightRef.current && villageLightsRef.current) {
      const idx = villageLightsRef.current.indexOf(lightRef.current);
      if (idx >= 0) villageLightsRef.current.splice(idx, 1);
      lightRef.current.parent?.remove(lightRef.current);
      lightRef.current.dispose();
      lightRef.current = null;
    }

    // Place tile
    const tileModel = cloneModel(cell.tile);
    if (tileModel) {
      tileModel.rotation.y = grid.rotationRad(cell.rotation ?? 0);

      if (isWater) {
        tileModel.userData.baseY = 0;
        register('waterTiles', tileModel);
        registeredRef.current.push({ type: 'waterTiles', obj: tileModel });
      }

      // Tiles receive shadows but don't cast them
      tileModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = false;
          child.receiveShadow = true;
        }
      });

      // Static tile: freeze matrix (water animates its y position, keep auto)
      if (!isWater) {
        tileModel.matrixAutoUpdate = false;
        tileModel.updateMatrix();
      }

      group.add(tileModel);
    }

    // Plateau skirt: under a raised tile, stack base columns so it reads as a
    // solid cliff instead of a floating tile. The group already sits at world
    // y = elevation; each skirt fills one unit lower.
    const skirts = skirtCount(cell.elevation);
    const skirtAsset = skirtAssetFor(kit);
    for (let i = 0; i < skirts; i++) {
      const skirt = cloneModel(skirtAsset);
      if (!skirt) break;
      skirt.position.y = -(i + 1);
      skirt.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = false;
          child.receiveShadow = true;
        }
      });
      skirt.matrixAutoUpdate = false;
      skirt.updateMatrix();
      group.add(skirt);
    }

    // Place building. For resource-bound cells, medieval swaps the GLTF to the
    // color variant that matches the live status (running=green,
    // created/stopped=building_stage_B scaffolding); space keeps the authored
    // model — the badge sphere + flame particles carry the status.
    if (cell.building && activeBuildingId) {
      // Lazy color load (medieval): if the wanted variant isn't cached yet,
      // kick off the fetch and fall back to the neutral scaffolding while it
      // arrives.
      if (!cloneModel(activeBuildingId)) {
        const color = extractColor(activeBuildingId);
        if (color) ensureColorLoaded(color);
      }

      const buildingModel =
        cloneModel(activeBuildingId) ??
        cloneModel('building_stage_B') ??
        cloneModel(cell.building);
      if (buildingModel) {
        buildingModel.rotation.y = grid.rotationRad(cell.buildingRotation ?? 0);

        // Find animatable parts. Stamp the bound resource id on each so
        // useAnimations can modulate the rotation speed per-cell based on the
        // live CPU / status of the app/addon — or freeze it when a monitor
        // goes critical. Space wind turbines reuse the windmill registry
        // (same spin semantics).
        const boundResourceId = cell.appId ?? cell.addonId ?? cell.monitorId ?? null;
        buildingModel.traverse((child) => {
          if (
            child.name.includes('windmill_top_fan') ||
            (child.name.includes('windturbine') && child.name.includes('fan'))
          ) {
            child.userData.resourceId = boundResourceId;
            register('windmillFans', child);
            registeredRef.current.push({ type: 'windmillFans', obj: child });
          }
          if (child.name.includes('watermill_wheel')) {
            child.userData.resourceId = boundResourceId;
            register('watermillWheels', child);
            registeredRef.current.push({ type: 'watermillWheels', obj: child });
          }
        });

        // Every building gets a village light — useDayNight ramps its
        // intensity from 0 at noon to 1.5 at night so nothing stays in the
        // dark. No per-type gating (earlier list missed mines, docks,
        // workshops, shrines, stables, …).
        {
          const light = new THREE.PointLight(
            VILLAGE_LIGHT_COLOR[kit] ?? VILLAGE_LIGHT_COLOR.medieval!,
            0,
            3.5,
            2,
          );
          light.position.set(0, 0.5, 0);
          group.add(light);
          villageLightsRef.current?.push(light);
          lightRef.current = light;
        }

        // Building root is static (fan/wheel children rotate independently)
        buildingModel.matrixAutoUpdate = false;
        buildingModel.updateMatrix();

        group.add(buildingModel);
      }
    }

    // Place decorations
    if (cell.decorations) {
      for (const deco of cell.decorations) {
        const decoModel = cloneModel(deco.id);
        if (!decoModel) continue;

        decoModel.position.set(deco.dx ?? 0, deco.dy ?? 0, deco.dz ?? 0);
        decoModel.rotation.y = grid.rotationRad(deco.rotation ?? 0);

        // Disable shadow casting for small decorations (keeps receiveShadow)
        if (NO_SHADOW_DECO.some((k) => deco.id.includes(k))) {
          decoModel.traverse((child) => {
            if (child instanceof THREE.Mesh) child.castShadow = false;
          });
        }

        // Track animatable decorations. Only sway actual trees (ids starting
        // with "tree"/"trees") — NOT hills/mountains whose id merely ends in
        // "_trees" (e.g. mountain_B_grass_trees), which made whole massifs rock.
        let animated = false;
        if (deco.id.startsWith('tree')) {
          decoModel.userData.phase = Math.random() * Math.PI * 2;
          register('trees', decoModel);
          registeredRef.current.push({ type: 'trees', obj: decoModel });
          animated = true;
        }
        if (deco.id === 'boat' || deco.id.includes('ship')) {
          decoModel.userData.baseY = 0;
          decoModel.userData.phase = Math.random() * Math.PI * 2;
          register('boats', decoModel);
          registeredRef.current.push({ type: 'boats', obj: decoModel });
          animated = true;
        }
        if (deco.id.includes('flag')) {
          decoModel.userData.phase = Math.random() * Math.PI * 2;
          register('flags', decoModel);
          registeredRef.current.push({ type: 'flags', obj: decoModel });
          animated = true;
        }

        // Static decorations: freeze matrix
        if (!animated) {
          decoModel.matrixAutoUpdate = false;
          decoModel.updateMatrix();
        }

        group.add(decoModel);
      }
    }

    // Parent tile group position is static once placed
    group.matrixAutoUpdate = false;
    group.updateMatrix();

    return () => {
      for (const { type, obj } of registeredRef.current) {
        unregister(type, obj);
      }
      registeredRef.current = [];
      if (lightRef.current && villageLightsRef.current) {
        const idx = villageLightsRef.current.indexOf(lightRef.current);
        if (idx >= 0) villageLightsRef.current.splice(idx, 1);
        lightRef.current.dispose();
        lightRef.current = null;
      }
    };
    // `activeBuildingId` already folds in status/monitorState, so a status
    // change re-clones with the right-colored variant (medieval; space ids
    // never change — the badge/flames carry status). `wantedColorReady` flips
    // (only on tiles waiting for it) when a lazily-fetched color batch lands
    // (scaffold → real), without re-cloning every tile in the city.
  }, [cell, cloneModel, ensureColorLoaded, register, unregister, villageLightsRef, isWater, registryRef, activeBuildingId, wantedColorReady, grid, kit]);

  const badgePos: [number, number, number] = [x, y + 1.3, z];
  const particlesPos: [number, number, number] = [x, y + 1.1, z];
  const scaffoldPos: [number, number, number] = [x, y, z];
  const effectsPos: [number, number, number] = [x, y, z];
  // Monitors get the badge sphere + flame particles too — on the space kit
  // they're the only status visual (the model itself is never recoloured).
  const showExtras = Boolean(
    cell.building && (cell.appId || cell.addonId || cell.monitorId),
  );

  return (
    <>
      <group ref={groupRef} position={[x, y, z]} />
      {/* Per-building-type ambient/CPU effects — decides internally which
          sub-effects to render based on the building id + resource binding. */}
      {cell.building && (
        <BuildingEffects
          position={effectsPos}
          buildingId={cell.building}
          appId={cell.appId}
          addonId={cell.addonId}
        />
      )}
      {/* RAM/disk readout props — monitors have no Warp10 metrics, so apps
          and addons only. */}
      {cell.building && (cell.appId || cell.addonId) && (
        <MetricProps position={effectsPos} appId={cell.appId} addonId={cell.addonId} />
      )}
      {showExtras && (
        <>
          <StatusBadge
            position={badgePos}
            appId={cell.appId}
            addonId={cell.addonId}
            monitorId={cell.monitorId}
          />
          <StatusParticles
            position={particlesPos}
            appId={cell.appId}
            addonId={cell.addonId}
            monitorId={cell.monitorId}
          />
          <DeployScaffold
            position={scaffoldPos}
            appId={cell.appId}
            addonId={cell.addonId}
          />
        </>
      )}
    </>
  );
}

// `cell` references are stable for unchanged cells (only the mutated cell gets a
// new object on a map edit), and `registryRef` is a stable ref — so memoizing
// keeps a single cell's status/color change from re-rendering the whole grid.
export const HexTile = memo(HexTileImpl);
