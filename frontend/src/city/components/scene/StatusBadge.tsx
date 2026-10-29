import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRealtimeStore } from '../../stores/useRealtimeStore';
import { useOrgStore } from '../../stores/useOrgStore';
import { normaliseAppState, type ResourceStatus } from '../../types/ws';

const COLORS: Record<ResourceStatus, number> = {
  running: 0x4fd08a,
  deploying: 0x4a9eff,
  stopped: 0xf5c518,
  failed: 0xe63f48,
  warning: 0xf57461,
  unknown: 0xf5c518,
  // Subtle beige — the `building_stage_B` silhouette already signals
  // "under construction", the badge is just a small confirmation.
  created: 0xd9c89b,
};

/** Synthetic-monitor state → the badge status whose colour/pulse matches:
 *  ok behaves like running, warning pulses, critical flashes like failed. */
const MONITOR_STATE_TO_STATUS: Record<string, ResourceStatus> = {
  ok: 'running',
  warning: 'warning',
  critical: 'failed',
};

interface StatusBadgeProps {
  position: [number, number, number];
  appId?: string;
  addonId?: string;
  monitorId?: string;
}

/**
 * A small emissive sphere floating above a resource-bound building. The color
 * reflects the live status, "deploying" pulses.
 *
 * The three useRealtimeStore selectors below all return primitive values
 * (or direct store references) so Zustand's default Object.is comparator
 * works and we don't get stuck in an "infinite update" loop. Synthesising
 * a fresh object inside a selector is what made React bail out here
 * originally.
 */
export function StatusBadge({ position, appId, addonId, monitorId }: StatusBadgeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial | null>(null);

  const wsAppStatus = useRealtimeStore((s) =>
    appId ? (s.apps[appId]?.status ?? null) : null,
  );
  const wsAddonHealthy = useRealtimeStore((s) =>
    addonId ? (s.addons[addonId]?.healthy ?? null) : null,
  );
  const wsMonitorState = useRealtimeStore((s) =>
    monitorId ? (s.monitors[monitorId]?.state ?? null) : null,
  );
  // REST fallback until the first WS monitor frame lands (mirrors restAppStatus).
  const restMonitorState = useOrgStore((s) =>
    monitorId ? s.monitors.find((m) => m.id === monitorId)?.current_state ?? null : null,
  );
  const restAppStatus = useOrgStore((s) => {
    if (!appId) return 'unknown' as ResourceStatus;
    const app = s.apps.find((a) => a.id === appId);
    return app?.state ? normaliseAppState(app.state) : ('unknown' as ResourceStatus);
  });
  // Any linked addon unhealthy? Downgrade the app to 'warning' so a running
  // app with a broken postgres dep stands out in the scene.
  const hasBrokenDep = useBrokenDependency(appId);

  let status: ResourceStatus;
  if (monitorId) {
    const state = wsMonitorState ?? restMonitorState;
    status = state ? MONITOR_STATE_TO_STATUS[state] ?? 'unknown' : 'unknown';
  } else if (addonId) {
    status =
      wsAddonHealthy === null ? 'unknown' : wsAddonHealthy ? 'running' : 'failed';
  } else if (appId) {
    const appStatus = wsAppStatus ?? restAppStatus;
    status = appStatus === 'running' && hasBrokenDep ? 'warning' : appStatus;
  } else {
    status = 'unknown';
  }

  const color = COLORS[status];

  useFrame(({ clock }) => {
    const mat = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;
    const t = clock.getElapsedTime();
    if (status === 'deploying') {
      const k = 0.5 + 0.5 * Math.sin(t * 4);
      mat.emissiveIntensity = 0.5 + 0.8 * k;
      mesh.scale.setScalar(0.9 + 0.1 * k);
    } else if (status === 'warning') {
      // Slow pulse to say "I'm up, but something upstream is off".
      const k = 0.5 + 0.5 * Math.sin(t * 3);
      mat.emissiveIntensity = 0.6 + 0.5 * k;
      mesh.scale.setScalar(0.95 + 0.05 * k);
    } else if (status === 'running') {
      mat.emissiveIntensity = 0.9 + 0.1 * Math.sin(t * 2);
      mesh.scale.setScalar(1);
    } else if (status === 'failed') {
      mat.emissiveIntensity = 0.6 + 0.4 * Math.abs(Math.sin(t * 8));
      mesh.scale.setScalar(1);
    } else if (status === 'created') {
      // Gentle, non-distracting — the building silhouette carries the message.
      mat.emissiveIntensity = 0.2 + 0.1 * Math.sin(t * 1.2);
      mesh.scale.setScalar(0.75);
    } else {
      mat.emissiveIntensity = 0.4;
      mesh.scale.setScalar(0.85);
    }
  });

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[0.18, 16, 16]} />
      <meshStandardMaterial
        ref={matRef}
        color={color}
        emissive={color}
        emissiveIntensity={0.8}
        toneMapped={false}
      />
    </mesh>
  );
}

/** True iff any addon linked to this app is currently marked unhealthy by
 *  the WS addon-status poller. Returns false for addon badges (they already
 *  have their own health dot). */
function useBrokenDependency(appId?: string): boolean {
  const linkedAddonIds = useOrgStore((s) =>
    appId ? s.appDependencies[appId] ?? null : null,
  );
  const anyDown = useRealtimeStore((s) => {
    if (!linkedAddonIds || linkedAddonIds.length === 0) return false;
    return linkedAddonIds.some((id) => s.addons[id]?.healthy === false);
  });
  return anyDown;
}
