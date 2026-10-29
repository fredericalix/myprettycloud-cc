import { useState } from 'react';
import { toast } from 'sonner';
import { ChannelsModal } from '@/features/monitor/ChannelsModal';
import { WorkflowsModal } from '@/features/monitor/WorkflowsModal';
import { TemplatesModal } from '../templates/TemplatesModal';
import { setupWebhook } from '../../api/orgs';
import { useAuthStore } from '../../stores/useAuthStore';
import { useMapStore } from '../../stores/useMapStore';
import { useOrgStore } from '../../stores/useOrgStore';
import { useRealtimeStore } from '../../stores/useRealtimeStore';
import { useUiModeStore } from '../../stores/useUiModeStore';
import { MayorHistory } from '../mayor/MayorHistory';
import { CinematicToggle } from './CinematicToggle';
import { FullscreenToggle } from './FullscreenToggle';
import { MayorToggle } from './MayorToggle';
import { MusicToggle } from './MusicToggle';
import { OrgSelector } from './OrgSelector';
import { VersionToggle } from './VersionToggle';

export function TopBar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const saveStatus = useMapStore((s) => s.saveStatus);
  const wsConnected = useRealtimeStore((s) => s.connected);
  const wsError = useRealtimeStore((s) => s.lastError);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const orgs = useOrgStore((s) => s.orgs);
  const uiMode = useUiModeStore((s) => s.mode);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [workflowsOpen, setWorkflowsOpen] = useState(false);
  const currentOrgName =
    orgs.find((o) => o.id === currentOrgId)?.name ?? 'this org';

  return (
    <header className="cc-panel flex items-center justify-between px-4 py-2 border-b cc-border-soft">
      <div className="flex items-center gap-5">
        <span className="font-brand text-2xl" style={{ color: 'var(--cc-white)' }}>
          myprettycloud
        </span>
        <span className="h-5 w-px bg-white/10" />
        <OrgSelector />
        <SaveIndicator status={saveStatus} />
        {currentOrgId && <LiveIndicator connected={wsConnected} error={wsError} />}
        {currentOrgId && <WebhookButton orgId={currentOrgId} />}
        <a
          href="https://myprettycloud-website.cleverapps.io/docs/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-overtitle text-[10px] flex items-center gap-1.5 rounded px-2 py-1 transition"
          style={{ background: 'rgba(241,240,251,0.06)', color: 'var(--cc-white)' }}
          title="Open the documentation in a new tab"
        >
          <span>📖</span>Docs
        </a>
        {currentOrgId && (
          <button
            onClick={() => setWorkflowsOpen(true)}
            className="font-overtitle text-[10px] flex items-center gap-1.5 rounded px-2 py-1 transition"
            style={{ background: 'rgba(241,240,251,0.06)', color: 'var(--cc-white)' }}
            title="List, edit and diagnose the alerting workflows (rules) for this org"
          >
            <span>⚙️</span>Workflows
          </button>
        )}
        <button
          onClick={() => setChannelsOpen(true)}
          className="font-overtitle text-[10px] flex items-center gap-1.5 rounded px-2 py-1 transition"
          style={{ background: 'rgba(241,240,251,0.06)', color: 'var(--cc-white)' }}
          title="Manage notification channels (email, Slack, Discord, webhook)"
        >
          <span>🔔</span>Channels
        </button>
        <button
          onClick={() => setTemplatesOpen(true)}
          className="font-overtitle text-[10px] flex items-center gap-1.5 rounded px-2 py-1 transition"
          style={{ background: 'rgba(241,240,251,0.06)', color: 'var(--cc-white)' }}
          title="Save the current scene as a template, or apply/share one"
        >
          <span>🗺️</span>Templates
        </button>
        <MusicToggle />
        <MayorToggle />
        <FullscreenToggle />
        <CinematicToggle />
        <VersionToggle />
      </div>
      <MayorHistory />
      {channelsOpen && <ChannelsModal onClose={() => setChannelsOpen(false)} />}
      {templatesOpen && <TemplatesModal onClose={() => setTemplatesOpen(false)} />}
      {workflowsOpen && currentOrgId && (
        <WorkflowsModal
          orgId={currentOrgId}
          orgName={currentOrgName}
          canEdit={uiMode === 'builder'}
          onClose={() => setWorkflowsOpen(false)}
        />
      )}
      <div className="flex items-center gap-3 text-sm">
        <span className="cc-muted">{user?.display_name ?? user?.email ?? user?.cc_user_id}</span>
        <button
          onClick={() => {
            void logout();
          }}
          className="rounded px-3 py-1 text-xs transition"
          style={{ background: 'rgba(241,240,251,0.06)', color: 'var(--cc-white)' }}
        >
          Logout
        </button>
      </div>
    </header>
  );
}

/**
 * Auto-installs the Clever Cloud webhook for the current org (myccmonitor-style):
 * POST /api/orgs/:id/webhook creates it on CC via the user's OAuth token. The
 * org's live `has_webhook` flag (from /api/orgs) drives the label + the
 * "Required" badge.
 */
function WebhookButton({ orgId }: { orgId: string }) {
  const orgs = useOrgStore((s) => s.orgs);
  const loadOrgs = useOrgStore((s) => s.loadOrgs);
  const [busy, setBusy] = useState(false);

  const org = orgs.find((o) => o.id === orgId);
  const installed = org?.has_webhook ?? false;

  const onClick = async () => {
    setBusy(true);
    try {
      await setupWebhook(orgId);
      toast.success('Realtime webhook installed on Clever Cloud');
      await loadOrgs(); // refresh has_webhook
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Failed to install the webhook (check org permissions)',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="font-overtitle text-[10px] flex items-center gap-1.5 rounded px-2 py-1 transition disabled:opacity-50"
      style={{
        background: installed ? 'rgba(241,240,251,0.06)' : 'var(--cc-primary)',
        color: 'var(--cc-white)',
      }}
      title="Install/refresh the real-time webhook for this org on Clever Cloud"
    >
      <span>⚡</span>
      {busy ? 'Hooking up…' : installed ? 'Re-install webhook' : 'Hook up'}
      {!installed && !busy && (
        <span className="ml-1 rounded-full bg-black/30 px-1.5 py-0.5 text-[8px]">Required</span>
      )}
    </button>
  );
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function LiveIndicator({ connected, error }: { connected: boolean; error: string | null }) {
  const color = error ? 'var(--cc-red-1)' : connected ? 'var(--cc-green)' : 'var(--cc-gray)';
  const label = error ? 'ws error' : connected ? 'live' : 'offline';
  return (
    <span
      className="font-overtitle text-[10px] flex items-center gap-1.5"
      style={{ color }}
      title={error ?? (connected ? 'WebSocket connected' : 'Reconnecting…')}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {label}
    </span>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;
  const map: Record<Exclude<SaveStatus, 'idle'>, { label: string; color: string }> = {
    saving: { label: 'Saving…', color: 'var(--cc-gray)' },
    saved: { label: 'Saved', color: 'var(--cc-green)' },
    error: { label: 'Save failed', color: 'var(--cc-red-1)' },
  };
  const { label, color } = map[status];
  return (
    <span className="font-overtitle text-[10px]" style={{ color }}>
      {label}
    </span>
  );
}
