import { useEffect } from 'react';
import { useAssetStore } from '../stores/useAssetStore';
import { useMapStore } from '../stores/useMapStore';
import { useMayorStore } from '../stores/useMayorStore';
import { useRealtimeStore } from '../stores/useRealtimeStore';
import { visualForStatus, visualForMonitorState } from '../utils/statusVisual';
import { extractColor } from '../data/assetCatalog';
import { DEFAULT_KIT } from '../types/kit';
import { mayorTipMessages } from './mayorMessages';

/**
 * Scene-loading "stocktake": when an org's map opens, its buildings start grey
 * ("unknown") and only colour once the backend's live-city poll broadcasts each
 * resource's status (now kicked immediately on WS connect — see realtime
 * handler). This hook pins the Mayor with a progress notice that rides until
 * every resource-bound building is status-known AND showing its true colour,
 * then resolves to a happy "all clear" (or, if any app has fallen, a trouble
 * verdict; or a soft "partial" verdict at the safety timeout). It also owns the
 * per-org city-health verdict that useMayorTips used to fire on a fixed timer.
 *
 * Readiness gate = status + colour for ALL bound buildings. Live CPU/RAM is NOT
 * gated on: a running app with no Warp10 series never emits metrics, which would
 * otherwise force every visit to the safety timeout. Mount once near the app
 * root and feed it the current org id.
 */

/** Delay before pinning — lets a warm/cached scene resolve without a flash, and
 *  React StrictMode's mount→unmount→remount tear down before any pin exists. */
const GRACE_MS = 700;
/** How often we recompute progress + prime colour variants while pinned. */
const TICK_MS = 500;
/** Hard backstop: resolve even if some holdings never answer. */
const SAFETY_MS = 25_000;
/** Cap on grace re-arms while waiting for map+assets to be ready (~28s). */
const MAX_GRACE_ATTEMPTS = 40;

type BoundId = { kind: 'app' | 'addon' | 'monitor'; id: string; building: string };
type RtState = ReturnType<typeof useRealtimeStore.getState>;

/** Resource cells, mirroring HexTile's variant precedence: a monitor binding
 *  wins over app/addon (HexTile checks `cell.monitorId` first), then app, then
 *  addon. These are mutually exclusive in valid maps; the order only matters for
 *  hand-edited data, but it must match HexTile so we wait for the same asset the
 *  scene actually renders. */
function collectBoundIds(): BoundId[] {
  const out: BoundId[] = [];
  for (const c of useMapStore.getState().cells.values()) {
    if (!c.building) continue;
    if (c.monitorId) out.push({ kind: 'monitor', id: c.monitorId, building: c.building });
    else if (c.appId) out.push({ kind: 'app', id: c.appId, building: c.building });
    else if (c.addonId) out.push({ kind: 'addon', id: c.addonId, building: c.building });
  }
  return out;
}

/** The asset a bound cell should display given live state, mirroring HexTile.
 *  `known` is whether a frame has arrived (key present) — NOT
 *  status !== 'unknown', because unknown → yellow is itself a real colour.
 *  On the space kit the asset id never changes (status lives in the badge
 *  sphere/flames), so the gate reduces to "a status frame arrived" — the right
 *  semantics there. */
function targetAsset(b: BoundId, rt: RtState): { known: boolean; assetId: string | null } {
  const kit = useMapStore.getState().kit ?? DEFAULT_KIT;
  if (b.kind === 'app') {
    const s = rt.apps[b.id];
    return s
      ? { known: true, assetId: visualForStatus(kit, b.building, s.status).assetId }
      : { known: false, assetId: null };
  }
  if (b.kind === 'addon') {
    const s = rt.addons[b.id];
    return s
      ? {
          known: true,
          assetId: visualForStatus(kit, b.building, s.healthy ? 'running' : 'failed').assetId,
        }
      : { known: false, assetId: null };
  }
  const s = rt.monitors[b.id];
  return s
    ? { known: true, assetId: visualForMonitorState(kit, b.building, s.state).assetId }
    : { known: false, assetId: null };
}

/** Count reported+coloured holdings, and proactively load the colour variants
 *  each implies so N advances even for tiles whose HexTile effect hasn't run. */
function step(boundIds: BoundId[]): { n: number; total: number; done: boolean } {
  const total = boundIds.length;
  const rt = useRealtimeStore.getState();
  const as = useAssetStore.getState();
  let n = 0;
  for (const b of boundIds) {
    const { known, assetId } = targetAsset(b, rt);
    if (!known || !assetId) continue;
    const color = extractColor(assetId);
    if (color) as.ensureColorLoaded(color);
    if (as.hasModel(assetId)) n += 1;
  }
  return { n, total, done: total > 0 && n === total };
}

/** Failed apps among the snapshot — mirrors the old useMayorTips cityTrouble. */
function failedApps(boundIds: BoundId[]): number {
  const rt = useRealtimeStore.getState();
  let failed = 0;
  for (const b of boundIds) {
    if (b.kind === 'app' && rt.apps[b.id]?.status === 'failed') failed += 1;
  }
  return failed;
}

export function useMayorCityLoading(orgId: string | null): void {
  useEffect(() => {
    if (!orgId) return;

    const mayor = useMayorStore.getState(); // action fns are stable for the store's life
    let resolved = false;
    let boundIds: BoundId[] = [];
    let pinId: string | null = null;
    let graceAttempts = 0;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let tickTimer: ReturnType<typeof setInterval> | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (viaTimeout: boolean) => {
      if (resolved) return;
      resolved = true;
      if (tickTimer) clearInterval(tickTimer);
      if (safetyTimer) clearTimeout(safetyTimer);
      tickTimer = null;
      safetyTimer = null;
      const failed = failedApps(boundIds);
      mayor.clearPinned();
      // Terminal verdict through notify() — respects the mute switch (silent
      // when muted), unlike the pinned loading notice which always shows.
      if (failed > 0) mayor.notify(mayorTipMessages.cityTrouble(failed));
      else if (!viaTimeout) mayor.notify(mayorTipMessages.realmTrue());
      else mayor.notify(mayorTipMessages.realmPartial());
    };

    const tick = () => {
      const { n, total, done } = step(boundIds);
      if (pinId) mayor.updatePinned(pinId, `${n} of ${total} holdings have reported.`);
      if (done) finish(false);
    };

    const beginIfReady = () => {
      graceTimer = null;
      const loadStatus = useMapStore.getState().loadStatus;
      if (loadStatus === 'error') return; // the map UI shows the error; nothing to narrate
      if (loadStatus !== 'ready' || !useAssetStore.getState().isLoaded) {
        // Map/assets not ready yet — re-arm a few times; safety caps the wait.
        if (graceAttempts < MAX_GRACE_ATTEMPTS) {
          graceAttempts += 1;
          graceTimer = setTimeout(beginIfReady, GRACE_MS);
        }
        return;
      }

      boundIds = collectBoundIds(); // snapshot — *_removed frames can't drift TOTAL
      const { n, total, done } = step(boundIds);
      if (total === 0) { resolved = true; return; } // nothing to wait for
      if (done) { resolved = true; return; } // already warm → no flash

      pinId = mayor.setPinned(mayorTipMessages.cityLoading(n, total));
      tickTimer = setInterval(tick, TICK_MS);
      safetyTimer = setTimeout(() => finish(true), SAFETY_MS);
    };

    graceTimer = setTimeout(beginIfReady, GRACE_MS);

    return () => {
      if (graceTimer) clearTimeout(graceTimer);
      if (tickTimer) clearInterval(tickTimer);
      if (safetyTimer) clearTimeout(safetyTimer);
      // Drop only the pin THIS run owns (pinId set) on org switch / unmount, so
      // the notice can't bleed across orgs — and a no-pin run (warm cache / 0
      // bound buildings) can't clobber another org's pin.
      if (pinId) mayor.clearPinned();
    };
  }, [orgId]);
}
