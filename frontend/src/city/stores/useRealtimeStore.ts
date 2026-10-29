import { create } from 'zustand';
import { WsFrame, ResourceStatus, normaliseAppState } from '../types/ws';

export interface MetricPoint {
  t: number;
  v: number;
}

/** How many CPU/RAM points we retain per app. At 15s/tick this is ~15min. */
const METRIC_HISTORY_MAX = 60;

export interface AppSnapshot {
  status: ResourceStatus;
  rawState: string;
  lastDeploy: number | null;
  cpuPct: number | null;
  ramPct: number | null;
  ts: number;
  /** Disk used %, or null until a backend that ships it sends a frame. */
  diskPct: number | null;
  /** Smoothed network activity in [0,1] (log-normalised net_in+net_out),
   *  or null for resources Warp10 has no net metrics for. Drives traffic. */
  netActivity: number | null;
  /** Rolling CPU% history (oldest first). Shared reference when unchanged so
   *  Zustand selectors don't see a "changed" state on every getSnapshot. */
  cpuHistory: MetricPoint[];
  ramHistory: MetricPoint[];
}

export interface AddonSnapshot {
  healthy: boolean;
  ts: number;
  /** Current CPU/RAM percents, or null until first metrics frame. */
  cpuPct: number | null;
  ramPct: number | null;
  diskPct: number | null;
  netActivity: number | null;
  /** Rolling history, same shape as apps. Empty for addons CC doesn't
   *  expose CPU/RAM for (config-provider, fs-bucket, etc.). */
  cpuHistory: MetricPoint[];
  ramHistory: MetricPoint[];
}

/** Live state of a (synthetic or CC) monitor, keyed by monitor id. Drives the
 *  colour of custom monitored buildings. */
export interface MonitorSnapshot {
  state: string;
  message: string | null;
  since: string | null;
}

interface RealtimeState {
  apps: Record<string, AppSnapshot>;
  addons: Record<string, AddonSnapshot>;
  monitors: Record<string, MonitorSnapshot>;
  connected: boolean;
  lastError: string | null;

  push: (frame: WsFrame) => void;
  /** Seed monitor states from the REST monitors list (so custom buildings are
   *  coloured on load, before any WS frame arrives). */
  seedMonitors: (rows: { id: string; current_state: string; current_message: string | null }[]) => void;
  /** Set one monitor's state directly (optimistic update after a manual change;
   *  the broadcast monitor_state frame confirms it shortly after). */
  setMonitorState: (id: string, state: string, message?: string | null) => void;
  setConnected: (connected: boolean) => void;
  clear: () => void;
}

/** Shared empty arrays so first-value snapshots don't allocate fresh [] each
 *  time the store rebuilds a missing-app entry. */
const EMPTY_HISTORY: MetricPoint[] = [];

function trimHistory(prev: MetricPoint[], next: MetricPoint): MetricPoint[] {
  const arr = prev === EMPTY_HISTORY ? [next] : [...prev, next];
  if (arr.length > METRIC_HISTORY_MAX) {
    arr.splice(0, arr.length - METRIC_HISTORY_MAX);
  }
  return arr;
}

/** Byte/s rate at which netActivity saturates to 1.0. Log-normalised so any
 *  traffic is visible and heavy traffic flattens out; being off by a constant
 *  factor only shifts the curve, it doesn't break the mapping. */
const NET_REF_BPS = 5_000_000;
const NET_REF_LOG = Math.log10(1 + NET_REF_BPS);

/** Fold one metrics frame's net rates into the smoothed [0,1] activity.
 *  EMA over the 60s poll ticks so traffic ramps rather than steps. */
function nextNetActivity(
  prev: number | null,
  netIn: number | null | undefined,
  netOut: number | null | undefined,
): number | null {
  if (netIn == null && netOut == null) return prev;
  const raw = Math.max(0, netIn ?? 0) + Math.max(0, netOut ?? 0);
  const instant = Math.min(1, Math.log10(1 + raw) / NET_REF_LOG);
  return prev == null ? instant : prev * 0.5 + instant * 0.5;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  apps: {},
  addons: {},
  monitors: {},
  connected: false,
  lastError: null,

  push: (frame) =>
    set((state) => {
      switch (frame.type) {
        case 'hello':
          return { lastError: null };
        case 'app_status': {
          const prev = state.apps[frame.app_id];
          return {
            apps: {
              ...state.apps,
              [frame.app_id]: {
                status: normaliseAppState(frame.state),
                rawState: frame.state,
                lastDeploy: frame.last_deploy,
                cpuPct: prev?.cpuPct ?? null,
                ramPct: prev?.ramPct ?? null,
                diskPct: prev?.diskPct ?? null,
                netActivity: prev?.netActivity ?? null,
                ts: frame.ts,
                cpuHistory: prev?.cpuHistory ?? EMPTY_HISTORY,
                ramHistory: prev?.ramHistory ?? EMPTY_HISTORY,
              },
            },
          };
        }
        case 'app_metrics': {
          const prev = state.apps[frame.app_id];
          return {
            apps: {
              ...state.apps,
              [frame.app_id]: {
                status: prev?.status ?? 'unknown',
                rawState: prev?.rawState ?? '',
                lastDeploy: prev?.lastDeploy ?? null,
                cpuPct: frame.cpu_pct,
                ramPct: frame.ram_pct,
                diskPct: frame.disk_pct ?? prev?.diskPct ?? null,
                netActivity: nextNetActivity(
                  prev?.netActivity ?? null,
                  frame.net_in_bps,
                  frame.net_out_bps,
                ),
                ts: frame.ts,
                cpuHistory: trimHistory(prev?.cpuHistory ?? EMPTY_HISTORY, {
                  t: frame.ts,
                  v: frame.cpu_pct,
                }),
                ramHistory: trimHistory(prev?.ramHistory ?? EMPTY_HISTORY, {
                  t: frame.ts,
                  v: frame.ram_pct,
                }),
              },
            },
          };
        }
        case 'addon_status': {
          const prev = state.addons[frame.addon_id];
          return {
            addons: {
              ...state.addons,
              [frame.addon_id]: {
                healthy: frame.healthy,
                ts: frame.ts,
                cpuPct: prev?.cpuPct ?? null,
                ramPct: prev?.ramPct ?? null,
                diskPct: prev?.diskPct ?? null,
                netActivity: prev?.netActivity ?? null,
                cpuHistory: prev?.cpuHistory ?? EMPTY_HISTORY,
                ramHistory: prev?.ramHistory ?? EMPTY_HISTORY,
              },
            },
          };
        }
        case 'addon_metrics': {
          const prev = state.addons[frame.addon_id];
          return {
            addons: {
              ...state.addons,
              [frame.addon_id]: {
                healthy: prev?.healthy ?? true,
                ts: frame.ts,
                cpuPct: frame.cpu_pct,
                ramPct: frame.ram_pct,
                diskPct: frame.disk_pct ?? prev?.diskPct ?? null,
                netActivity: nextNetActivity(
                  prev?.netActivity ?? null,
                  frame.net_in_bps,
                  frame.net_out_bps,
                ),
                cpuHistory: trimHistory(prev?.cpuHistory ?? EMPTY_HISTORY, {
                  t: frame.ts,
                  v: frame.cpu_pct,
                }),
                ramHistory: trimHistory(prev?.ramHistory ?? EMPTY_HISTORY, {
                  t: frame.ts,
                  v: frame.ram_pct,
                }),
              },
            },
          };
        }
        case 'app_removed': {
          if (!(frame.app_id in state.apps)) return {};
          const next = { ...state.apps };
          delete next[frame.app_id];
          return { apps: next };
        }
        case 'addon_added': {
          if (frame.addon_id in state.addons) return {};
          return {
            addons: {
              ...state.addons,
              [frame.addon_id]: {
                healthy: true,
                ts: frame.ts,
                cpuPct: null,
                ramPct: null,
                diskPct: null,
                netActivity: null,
                cpuHistory: EMPTY_HISTORY,
                ramHistory: EMPTY_HISTORY,
              },
            },
          };
        }
        case 'addon_removed': {
          if (!(frame.addon_id in state.addons)) return {};
          const next = { ...state.addons };
          delete next[frame.addon_id];
          return { addons: next };
        }
        case 'monitor_state':
          // Drives custom monitored buildings. (CC-resource buildings still
          // use app_status/addon_status above.)
          return {
            monitors: {
              ...state.monitors,
              [frame.monitor_id]: {
                state: frame.state,
                message: frame.message,
                since: frame.since,
              },
            },
          };
        case 'session_expired':
          // Handled outside the store: useWsClient calls the auth store's
          // logout() + redirects the browser to /auth/login. Here we just
          // surface a user-visible note for the one-frame overlap before
          // the redirect kicks in.
          return { lastError: frame.message };
        case 'error':
          return { lastError: frame.message };
        default:
          // Monitoring frames (monitor_state / metrics_snapshot / webhook_health
          // / rule_firing) are handled by dedicated subscribers (toasts, mayor),
          // not the city resource store.
          return {};
      }
    }),

  seedMonitors: (rows) =>
    set((state) => {
      const monitors = { ...state.monitors };
      for (const m of rows) {
        // Don't clobber a live WS state we may already hold.
        if (!monitors[m.id]) {
          monitors[m.id] = {
            state: m.current_state,
            message: m.current_message,
            since: null,
          };
        }
      }
      return { monitors };
    }),

  setMonitorState: (id, state, message = null) =>
    set((s) => ({
      monitors: { ...s.monitors, [id]: { state, message, since: null } },
    })),

  setConnected: (connected) => set({ connected }),
  clear: () => set({ apps: {}, addons: {}, monitors: {}, connected: false, lastError: null }),
}));
