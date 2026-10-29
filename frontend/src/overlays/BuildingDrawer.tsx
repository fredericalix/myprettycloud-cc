"use client";

import { useState } from "react";
import { useMapStore } from "@/city/stores/useMapStore";
import { useOrgStore } from "@/city/stores/useOrgStore";
import { useRealtimeStore } from "@/city/stores/useRealtimeStore";
import { MetricsPanel } from "./MetricsPanel";

type Tab = "overview" | "metrics";

/**
 * Docked right-side drawer that opens when a building (a cell bound to a CC
 * app/addon) is selected in the city. A React portal sibling of the canvas —
 * never inside the R3F <Html> projection — so heavy DOM (ECharts) doesn't
 * thrash the scene. Alerting workflows are no longer authored here — use the
 * global Workflows manager (TopBar → Workflows).
 */
export function BuildingDrawer() {
  const selectedKey = useMapStore((s) => s.selectedCell);
  const cell = useMapStore((s) => (s.selectedCell ? s.cells.get(s.selectedCell) : null));
  const selectCell = useMapStore((s) => s.selectCell);
  const orgId = useOrgStore((s) => s.currentOrgId);
  const apps = useOrgStore((s) => s.apps);
  const addons = useOrgStore((s) => s.addons);
  const [tab, setTab] = useState<Tab>("overview");

  const resourceId = cell?.appId ?? cell?.addonId ?? null;
  const kind = cell?.appId ? "app" : cell?.addonId ? "addon" : null;

  if (!selectedKey || !cell || !resourceId || !kind || !orgId) return null;

  // Warp10 keys addon metrics under the addon's realId (e.g. `postgresql_…`),
  // not the `addon_…` id the cell carries. Apps are keyed by their own id.
  // Resolve the realId for addons so the Metrics charts hit the right series.
  const metricsId =
    kind === "addon"
      ? addons.find((a) => a.id === resourceId)?.realId ?? resourceId
      : resourceId;

  // Prefer the real CC app/addon name; fall back to the building skin then the
  // raw id while the org resources are still loading.
  const resourceName =
    (kind === "app"
      ? apps.find((a) => a.id === resourceId)?.name
      : addons.find((a) => a.id === resourceId)?.name) ??
    cell.building ??
    resourceId;

  const tabs: Tab[] = ["overview", "metrics"];
  const activeTab: Tab = tab;

  return (
    <aside className="cc-panel absolute right-0 top-0 z-20 flex h-full w-[420px] max-w-[90vw] flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <div className="text-text-muted text-xs uppercase tracking-wide">{kind}</div>
          <div className="font-semibold">{resourceName}</div>
        </div>
        <button onClick={() => selectCell(null)} className="text-text-muted hover:text-text px-2 text-lg">
          ×
        </button>
      </header>

      <nav className="flex gap-1 px-3 pt-3">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t px-3 py-1.5 text-sm capitalize ${
              activeTab === t ? "bg-white/10 text-text" : "text-text-muted"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "overview" && <Overview resourceId={resourceId} kind={kind} />}
        {activeTab === "metrics" && <MetricsPanel orgId={orgId} appId={metricsId} />}
      </div>
    </aside>
  );
}

function Overview({ resourceId, kind }: { resourceId: string; kind: "app" | "addon" }) {
  const app = useRealtimeStore((s) => (kind === "app" ? s.apps[resourceId] : undefined));
  const addon = useRealtimeStore((s) => (kind === "addon" ? s.addons[resourceId] : undefined));

  const rows: Array<[string, string]> = [];
  if (app) {
    rows.push(["Status", app.status]);
    rows.push(["State", app.rawState]);
    rows.push(["CPU", app.cpuPct != null ? `${app.cpuPct.toFixed(1)}%` : "—"]);
    rows.push(["RAM", app.ramPct != null ? `${app.ramPct.toFixed(1)}%` : "—"]);
    rows.push(["Last deploy", app.lastDeploy ? new Date(app.lastDeploy * 1000).toLocaleString() : "—"]);
  } else if (addon) {
    rows.push(["Health", addon.healthy ? "healthy" : "unreachable"]);
    rows.push(["CPU", addon.cpuPct != null ? `${addon.cpuPct.toFixed(1)}%` : "—"]);
    rows.push(["RAM", addon.ramPct != null ? `${addon.ramPct.toFixed(1)}%` : "—"]);
  }

  if (rows.length === 0) {
    return <div className="cc-muted text-sm">Waiting for the first live reading…</div>;
  }
  return (
    <dl className="space-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between border-b border-white/5 pb-1 text-sm">
          <dt className="text-text-muted">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

