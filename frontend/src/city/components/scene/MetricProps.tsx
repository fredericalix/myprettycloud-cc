import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import { useRealtimeStore } from '../../stores/useRealtimeStore';
import { useAnimationStore } from '../../stores/useAnimationStore';
import { useAssetStore } from '../../stores/useAssetStore';
import { useGrid } from '../../hooks/useGrid';
import {
  DISK_PROPS,
  RAM_PROPS,
  diskTierFor,
  ramTierFor,
  type PropSlot,
} from '../../data/metricPropAssets';

interface MetricPropsProps {
  position: [number, number, number];
  appId?: string;
  addonId?: string;
}

/**
 * Physical metric readout around a bound building: crates/cargo accumulate as
 * RAM fills (overflowing at ≥90%), a resource depot grows with disk usage.
 * Lives beside BuildingEffects in HexTile — deliberately NOT inside the
 * building-clone effect, so status flips never rebuild the props. Quantized to
 * tiers so the clone set only changes when a 20%/25% boundary is crossed.
 */
export function MetricProps({ position, appId, addonId }: MetricPropsProps) {
  const groupRef = useRef<THREE.Group>(null);
  const kit = useGrid().kit;
  const enabled = useAnimationStore((s) => s.storagePropsEnabled);
  const isLoaded = useAssetStore((s) => s.isLoaded);

  const ramTier = useRealtimeStore((s) => {
    const snap = appId ? s.apps[appId] : addonId ? s.addons[addonId] : undefined;
    return ramTierFor(snap?.ramPct);
  });
  const diskTier = useRealtimeStore((s) => {
    const snap = appId ? s.apps[appId] : addonId ? s.addons[addonId] : undefined;
    return diskTierFor(snap?.diskPct);
  });

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clear();
    if (!enabled || !isLoaded || (ramTier === 0 && diskTier === 0)) return;

    const { cloneModel } = useAssetStore.getState();
    const place = (slot: PropSlot) => {
      const model = cloneModel(slot.id);
      if (!model) return;
      model.position.set(slot.dx, slot.dy ?? 0, slot.dz);
      if (slot.rotY) model.rotation.y = slot.rotY;
      if (slot.rotZ) model.rotation.z = slot.rotZ;
      model.traverse((child) => {
        child.castShadow = false;
        child.receiveShadow = false;
      });
      model.matrixAutoUpdate = false;
      model.updateMatrix();
      group.add(model);
    };

    const ram = RAM_PROPS[kit];
    for (let i = 0; i < Math.min(ramTier, ram.slots.length); i++) place(ram.slots[i]!);
    if (ramTier >= 5) for (const slot of ram.overflow) place(slot);
    const disk = DISK_PROPS[kit];
    for (let i = 0; i < Math.min(diskTier, disk.length); i++) place(disk[i]!);
  }, [ramTier, diskTier, kit, enabled, isLoaded]);

  return <group ref={groupRef} position={position} />;
}
