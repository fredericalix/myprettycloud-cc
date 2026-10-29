import * as Sentry from '@/city/utils/sentry-shim';
import type { Monitor } from '@/features/monitor/types';
import { create } from 'zustand';
import { listAddons, listApps, listDependencies, listOrgs } from '../api/orgs';
import { listMonitors } from '../api/monitors';
import { CcAddon, CcApplication, CcOrganisation } from '../types/cc';
import { useRealtimeStore } from './useRealtimeStore';
import { debug } from '../utils/debug';

function tagCurrentOrg(orgId: string | null, orgs: CcOrganisation[]) {
  const scope = Sentry.getIsolationScope();
  scope.setTag('org_id', orgId ?? undefined);
  if (orgId) {
    const org = orgs.find((o) => o.id === orgId);
    scope.setContext('org', org ? { id: org.id, name: org.name } : { id: orgId });
  } else {
    scope.setContext('org', null);
  }
}

interface OrgState {
  orgs: CcOrganisation[];
  orgsStatus: 'idle' | 'loading' | 'ready' | 'error';
  orgsError: string | null;
  currentOrgId: string | null;

  apps: CcApplication[];
  addons: CcAddon[];
  /** All monitors for the current org (CC-backed + synthetic). The synthetic
   *  ones back custom monitored buildings. */
  monitors: Monitor[];
  resourcesStatus: 'idle' | 'loading' | 'ready' | 'error';
  resourcesError: string | null;

  /** Addon ids linked to each app in the current org. Populated lazily
   *  alongside apps/addons; missing = "dependency info not loaded yet". */
  appDependencies: Record<string, string[]>;

  loadOrgs: () => Promise<void>;
  selectOrg: (orgId: string | null) => Promise<void>;
  refreshResources: () => Promise<void>;
  /** Reload monitors and seed their live states into the realtime store. */
  loadMonitors: () => Promise<void>;
  reset: () => void;
}

const STORAGE_KEY = 'mycctown.currentOrgId';

function readStoredOrgId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredOrgId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export const useOrgStore = create<OrgState>((set, get) => ({
  orgs: [],
  orgsStatus: 'idle',
  orgsError: null,
  currentOrgId: readStoredOrgId(),

  apps: [],
  addons: [],
  monitors: [],
  resourcesStatus: 'idle',
  resourcesError: null,
  appDependencies: {},

  loadOrgs: async () => {
    set({ orgsStatus: 'loading', orgsError: null });
    try {
      const orgs = await listOrgs();
      const stored = get().currentOrgId;
      const currentOrgId =
        stored && orgs.some((o) => o.id === stored) ? stored : orgs[0]?.id ?? null;
      writeStoredOrgId(currentOrgId);
      set({ orgs, orgsStatus: 'ready', currentOrgId });
      tagCurrentOrg(currentOrgId, orgs);
      if (currentOrgId) await get().refreshResources();
    } catch (e) {
      set({
        orgsStatus: 'error',
        orgsError: e instanceof Error ? e.message : 'failed to load organisations',
      });
    }
  },

  selectOrg: async (orgId) => {
    writeStoredOrgId(orgId);
    set({
      currentOrgId: orgId,
      apps: [],
      addons: [],
      monitors: [],
      appDependencies: {},
      resourcesStatus: 'idle',
      resourcesError: null,
    });
    tagCurrentOrg(orgId, get().orgs);
    if (orgId) await get().refreshResources();
  },

  refreshResources: async () => {
    const orgId = get().currentOrgId;
    if (!orgId) return;
    set({ resourcesStatus: 'loading', resourcesError: null });
    debug.log('org', `refreshResources start org=${orgId}`);
    try {
      const [apps, addons] = await Promise.all([listApps(orgId), listAddons(orgId)]);
      set({ apps, addons, resourcesStatus: 'ready' });
      debug.log('org', `refreshResources ready apps=${apps.length} addons=${addons.length}`);
      // Dependencies are best-effort: if CC fails for this org we keep
      // apps/addons visible and just leave the graph empty.
      try {
        const appDependencies = await listDependencies(orgId);
        set({ appDependencies });
      } catch (e) {
        debug.warn('org', 'failed to load app dependencies', e);
      }
      // Monitors (incl. synthetic custom buildings) — best-effort.
      await get().loadMonitors();
    } catch (e) {
      debug.warn('org', 'refreshResources failed', e);
      set({
        resourcesStatus: 'error',
        resourcesError: e instanceof Error ? e.message : 'failed to load resources',
      });
    }
  },

  loadMonitors: async () => {
    const orgId = get().currentOrgId;
    if (!orgId) return;
    try {
      const monitors = await listMonitors(orgId);
      set({ monitors });
      useRealtimeStore.getState().seedMonitors(
        monitors.map((m) => ({
          id: m.id,
          current_state: m.current_state,
          current_message: m.current_message,
        })),
      );
    } catch (e) {
      debug.warn('org', 'failed to load monitors', e);
    }
  },

  reset: () => {
    writeStoredOrgId(null);
    set({
      orgs: [],
      orgsStatus: 'idle',
      orgsError: null,
      currentOrgId: null,
      apps: [],
      addons: [],
      monitors: [],
      appDependencies: {},
      resourcesStatus: 'idle',
      resourcesError: null,
    });
    tagCurrentOrg(null, []);
  },
}));
