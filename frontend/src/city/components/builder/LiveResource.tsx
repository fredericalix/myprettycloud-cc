import { useOrgStore } from '../../stores/useOrgStore';
import { useRealtimeStore } from '../../stores/useRealtimeStore';
import { Sparkline } from '../charts/Sparkline';
import { appTypeLabel, type CcApplication } from '../../types/cc';
import { normaliseAppState, type ResourceStatus } from '../../types/ws';

const STATUS_COLORS: Record<ResourceStatus, string> = {
  running: 'var(--cc-green)',
  deploying: '#4a9eff',
  stopped: '#f5c518',
  failed: 'var(--cc-red-1)',
  warning: 'var(--cc-orange)',
  unknown: '#f5c518',
  created: '#d9c89b',
};

function consoleUrl(kind: 'app' | 'addon', orgId: string, resourceId: string): string {
  return kind === 'app'
    ? `https://console.clever-cloud.com/organisations/${orgId}/applications/${resourceId}`
    : `https://console.clever-cloud.com/organisations/${orgId}/addons/${resourceId}`;
}

export type LiveResourceData = {
  id: string;
  name: string;
  type?: string | null;
  provider?: { id?: string | null; name?: string | null } | null;
  state?: string | null;
  last_deploy?: number | null;
};

/**
 * The live-resource card: status dot, CPU/RAM gauges, dependency warning,
 * CC console link. Optionally includes sparklines (used by FloatingInspector
 * in view mode). All store reads follow the "selector returns a primitive or
 * a direct store reference" rule to avoid infinite Zustand loops.
 */
export function LiveResource({
  kind,
  data,
  orgId,
  onUnbind,
  showSparklines = false,
}: {
  kind: 'app' | 'addon';
  data: LiveResourceData;
  orgId: string | null;
  onUnbind?: () => void;
  showSparklines?: boolean;
}) {
  const snapshot = useRealtimeStore((s) =>
    kind === 'app' ? s.apps[data.id] ?? null : s.addons[data.id] ?? null,
  );
  const linkedAddonIds = useOrgStore((s) =>
    kind === 'app' ? s.appDependencies[data.id] ?? null : null,
  );
  const brokenDepId = useRealtimeStore((s) => {
    if (!linkedAddonIds) return null;
    return linkedAddonIds.find((id) => s.addons[id]?.healthy === false) ?? null;
  });

  const baseStatus: ResourceStatus =
    kind === 'app'
      ? (snapshot && 'status' in snapshot ? snapshot.status : null) ??
        (data.state ? normaliseAppState(data.state) : 'unknown')
      : snapshot && 'healthy' in snapshot
        ? snapshot.healthy
          ? 'running'
          : 'failed'
        : 'unknown';
  const status: ResourceStatus =
    kind === 'app' && baseStatus === 'running' && brokenDepId
      ? 'warning'
      : baseStatus;

  const typeLabel =
    kind === 'app'
      ? appTypeLabel(data as CcApplication) ?? '—'
      : data.provider?.name ?? data.provider?.id ?? '—';
  // Both AppSnapshot and AddonSnapshot now carry cpuPct / ramPct / histories,
  // so the same reads work for either kind. Addons that don't emit metrics
  // (config-provider, fs-bucket, etc.) leave these as null/empty and the
  // sparkline shows its "waiting…" placeholder.
  const cpu = snapshot && 'cpuPct' in snapshot ? snapshot.cpuPct : null;
  const ram = snapshot && 'ramPct' in snapshot ? snapshot.ramPct : null;
  const cpuHistory =
    snapshot && 'cpuHistory' in snapshot ? snapshot.cpuHistory : null;
  const ramHistory =
    snapshot && 'ramHistory' in snapshot ? snapshot.ramHistory : null;

  return (
    <div
      className="rounded-xl p-3"
      style={{ background: 'rgba(165,16,80,0.15)', border: '1px solid rgba(165,16,80,0.3)' }}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="font-overtitle text-[10px]" style={{ color: 'var(--cc-orange)' }}>
            Live {kind}
          </div>
          <div className="font-semibold truncate">{data.name}</div>
          <div className="cc-muted text-[11px]">{typeLabel}</div>
        </div>
        {onUnbind && (
          <button
            className="text-[10px] cc-muted hover:text-white"
            onClick={onUnbind}
            title="Unbind"
          >
            unbind
          </button>
        )}
      </div>

      <div
        className="mt-2 flex items-center gap-2 text-[11px]"
        title={data.state ? `CC raw state: ${data.state}` : undefined}
      >
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: STATUS_COLORS[status] }}
        />
        <span style={{ color: STATUS_COLORS[status] }}>{status}</span>
      </div>

      {status === 'warning' && brokenDepId && (
        <div
          className="mt-2 text-[11px] rounded px-2 py-1"
          style={{
            background: 'rgba(245,116,97,0.12)',
            color: 'var(--cc-orange)',
          }}
        >
          Linked addon <code>{brokenDepId}</code> is unhealthy.
        </div>
      )}

      {cpu !== null && ram !== null && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <Gauge label="CPU" value={cpu} />
          <Gauge label="RAM" value={ram} />
        </div>
      )}

      {showSparklines && (
        <div className="mt-3 flex flex-col gap-2">
          <Sparkline
            label="CPU"
            data={cpuHistory ?? []}
            color={STATUS_COLORS[status]}
          />
          <Sparkline
            label="RAM"
            data={ramHistory ?? []}
            color="#8ec8f0"
          />
        </div>
      )}

      {orgId && (
        <a
          href={consoleUrl(kind, orgId, data.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block text-center rounded-lg py-1.5 text-[11px] font-medium transition"
          style={{
            background: 'rgba(241,240,251,0.08)',
            color: 'var(--cc-white)',
          }}
        >
          Open in CC Console ↗
        </a>
      )}
    </div>
  );
}

function Gauge({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex justify-between">
        <span className="cc-muted">{label}</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-1 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full"
          style={{ width: `${pct}%`, background: 'var(--cc-gradient-red)' }}
        />
      </div>
    </div>
  );
}
