import { useEffect } from 'react';
import { toast } from 'sonner';
import { backendHref } from '../api/client';
import { mayorObserve } from '../mayor/mayorObserve';
import { useAuthStore } from '../stores/useAuthStore';
import { useRealtimeStore } from '../stores/useRealtimeStore';
import type { WsFrame } from '../types/ws';
import { debug } from '../utils/debug';

const BACKOFFS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];

function wsUrlFor(orgId: string): string {
  // Same-origin: the Next dev server / prod node server proxies /ws to the backend.
  const base = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
  return `${base}/ws?org=${encodeURIComponent(orgId)}`;
}

/**
 * Maintain a WebSocket to /ws/orgs/:id/stream for the given org. Automatically
 * reconnects with exponential backoff. Frames go into useRealtimeStore.
 *
 * React.StrictMode double-mounts effects in dev: opening a WebSocket directly
 * in the effect body means the immediate cleanup calls `socket.close()` while
 * the handshake is still CONNECTING — the browser then reports "WebSocket is
 * closed before the connection is established" even though the backend
 * accepted the upgrade. We defer the actual connection via a setTimeout(0)
 * so StrictMode's synchronous unmount can abort before the socket is ever
 * opened.
 */
export function useWsClient(orgId: string | null) {
  useEffect(() => {
    if (!orgId) {
      useRealtimeStore.getState().clear();
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;

    const openSocket = () => {
      connectTimer = null;
      if (cancelled) return;
      const url = wsUrlFor(orgId);
      debug.log('ws', 'opening', url);
      const s = new WebSocket(url);
      socket = s;

      s.onopen = () => {
        // The org may have changed (or the component unmounted) while the
        // handshake was still in flight. Abort rather than leak a live socket
        // that keeps pushing the old org's frames into the store.
        if (cancelled) {
          s.close();
          return;
        }
        debug.log('ws', 'open');
        attempts = 0;
        useRealtimeStore.getState().setConnected(true);
      };
      s.onmessage = (event) => {
        if (cancelled) return;
        try {
          const frame = JSON.parse(event.data as string) as WsFrame;
          debug.log('ws', 'frame', frame);
          // Let the mayor inspect the frame against the *pre-push* store state
          // (so it can detect transitions) before we apply it.
          mayorObserve(frame);
          useRealtimeStore.getState().push(frame);
          // Alerting: a fired rule rings the bell in the city. Rule firings are
          // broadcast only on the __system__ channel (one socket subscribes to
          // it), so each firing reaches us exactly once — no dedup needed.
          if (frame.type === 'rule_firing' && frame.outcome === 'matched') {
            toast(`🔔 ${frame.rule_name}`, { description: `Rule fired (${frame.trigger_kind})` });
          }
          if (frame.type === 'session_expired') {
            debug.warn('ws', 'session expired — logging out');
            cancelled = true;
            s.close();
            useAuthStore.getState().logout().finally(() => {
              window.location.href = backendHref('/auth/login');
            });
          }
        } catch (e) {
          debug.warn('ws', 'failed to parse frame', e);
        }
      };
      s.onerror = (e) => {
        debug.warn('ws', 'onerror', e);
      };
      s.onclose = (e) => {
        debug.log('ws', 'onclose', { code: e.code, reason: e.reason, wasClean: e.wasClean });
        if (socket === s) socket = null;
        useRealtimeStore.getState().setConnected(false);
        if (cancelled) return;
        const idx = Math.min(attempts, BACKOFFS_MS.length - 1);
        const delay = BACKOFFS_MS[idx]!;
        attempts++;
        debug.log('ws', `reconnecting in ${delay}ms (attempt ${attempts})`);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          openSocket();
        }, delay);
      };
    };

    connectTimer = setTimeout(openSocket, 0);

    return () => {
      cancelled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      // Always close the socket, even while CONNECTING — closing a connecting
      // socket aborts the handshake (legal), whereas leaving it open leaks a
      // live socket on org switch that keeps pushing the previous org's frames.
      // The StrictMode "closed before established" race is already avoided by
      // deferring openSocket via connectTimer (cleared above before it runs),
      // and onopen now re-checks `cancelled`.
      if (socket) socket.close();
      useRealtimeStore.getState().setConnected(false);
    };
  }, [orgId]);
}
