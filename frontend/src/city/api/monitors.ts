import { api } from './client';
import type { Monitor } from '@/features/monitor/types';

/** Monitors for an org (CC-backed + synthetic). The backend syncs CC ones and
 *  returns synthetic ones unchanged. */
export function listMonitors(orgId: string): Promise<Monitor[]> {
  return api<Monitor[]>(`/api/orgs/${encodeURIComponent(orgId)}/monitors`);
}

/** Create a synthetic monitor (a custom monitored building). `building` is the
 *  base building asset id, kept in metadata for re-placement. */
export function createMonitor(
  orgId: string,
  displayName: string,
  building?: string,
): Promise<Monitor> {
  return api<Monitor>(`/api/orgs/${encodeURIComponent(orgId)}/monitors`, {
    method: 'POST',
    body: JSON.stringify({ display_name: displayName, building }),
  });
}

export function deleteMonitor(orgId: string, monitorId: string): Promise<void> {
  return api<void>(
    `/api/orgs/${encodeURIComponent(orgId)}/monitors/${encodeURIComponent(monitorId)}`,
    { method: 'DELETE' },
  );
}

/** Manually set a monitor's state (e.g. the default state of a custom building).
 *  The backend broadcasts a monitor_state frame so the city recolours live. */
export function setMonitorState(
  orgId: string,
  monitorId: string,
  state: string,
): Promise<Monitor> {
  return api<Monitor>(
    `/api/orgs/${encodeURIComponent(orgId)}/monitors/${encodeURIComponent(monitorId)}/state`,
    { method: 'POST', body: JSON.stringify({ state }) },
  );
}
