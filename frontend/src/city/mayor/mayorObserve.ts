import { useMayorStore } from '../stores/useMayorStore';
import { useOrgStore } from '../stores/useOrgStore';
import { useRealtimeStore } from '../stores/useRealtimeStore';
import { normaliseAppState, type WsFrame } from '../types/ws';
import { mayorMessages } from './mayorMessages';

/**
 * The mayor reacts to lifecycle *transitions*, not to the steady stream of
 * status/metrics frames. The tricky case is the connection burst: when a
 * WebSocket opens (or the org changes), the backend replays an `app_status`
 * for every existing app. None of those have a previous snapshot, so we must
 * not mistake them for "a new app just appeared".
 *
 * Strategy:
 *  - A genuine *transition* (prev snapshot exists AND status changed) is always
 *    safe to announce — the connection burst has no prev, so it's filtered out
 *    naturally, and steady re-emissions (same status every poll tick) are equal
 *    and skipped.
 *  - A *first sighting* (no prev snapshot) is only treated as "app created" /
 *    "addon created" once we're past a short warm-up window after the `hello`
 *    frame, which is what swallows the initial burst.
 */
const WARMUP_MS = 4_000;

/** Past this instant, first-sighting frames are real arrivals, not the burst. */
let warmupUntil = Number.POSITIVE_INFINITY;

function appNameById(appId: string): string | null {
  return useOrgStore.getState().apps.find((a) => a.id === appId)?.name ?? null;
}

function addonNameById(addonId: string): string | null {
  return useOrgStore.getState().addons.find((a) => a.id === addonId)?.name ?? null;
}

/**
 * Inspect an incoming WS frame against the *current* realtime store (which is
 * still the pre-frame state because this runs before `push`) and enqueue a
 * mayor announcement on a notable transition. No-op when the mayor is muted.
 */
export function mayorObserve(frame: WsFrame): void {
  const mayor = useMayorStore.getState();
  if (!mayor.enabled) return;

  const rt = useRealtimeStore.getState();
  const now = Date.now();

  switch (frame.type) {
    case 'hello': {
      // New connection (or org switch): swallow the replay burst that follows.
      warmupUntil = now + WARMUP_MS;
      return;
    }

    case 'app_status': {
      const prev = rt.apps[frame.app_id];
      const newStatus = normaliseAppState(frame.state);
      const name = appNameById(frame.app_id);

      if (prev) {
        // Genuine transition only.
        if (prev.status === newStatus) return;
        switch (newStatus) {
          case 'running':
            mayor.notify(mayorMessages.deploySuccess(name));
            return;
          case 'failed':
            mayor.notify(mayorMessages.deployFail(name));
            return;
          case 'stopped':
            mayor.notify(mayorMessages.appStopped(name));
            return;
          case 'created':
            mayor.notify(mayorMessages.appCreated(name));
            return;
          // 'deploying' is transient and precedes success/fail — too noisy to
          // announce. 'warning'/'unknown' carry no clear good/bad news.
          default:
            return;
        }
      }

      // First sighting: only an arrival after the warm-up burst is news.
      if (now > warmupUntil && newStatus !== 'unknown') {
        mayor.notify(mayorMessages.appCreated(name));
      }
      return;
    }

    case 'app_removed': {
      mayor.notify(mayorMessages.appRemoved(appNameById(frame.app_id)));
      return;
    }

    case 'addon_added': {
      // Suppress during the connection burst; a real creation comes later.
      if (now > warmupUntil) {
        mayor.notify(mayorMessages.addonAdded(frame.provider));
      }
      return;
    }

    case 'addon_removed': {
      mayor.notify(mayorMessages.addonRemoved(addonNameById(frame.addon_id)));
      return;
    }

    case 'addon_status': {
      const prev = rt.addons[frame.addon_id];
      // No prev → baseline at connect, no announcement.
      if (!prev || prev.healthy === frame.healthy) return;
      const name = addonNameById(frame.addon_id);
      mayor.notify(
        frame.healthy
          ? mayorMessages.addonRecovered(name)
          : mayorMessages.addonUnhealthy(name),
      );
      return;
    }

    // Metrics, session_expired, error: not the mayor's business.
    default:
      return;
  }
}
