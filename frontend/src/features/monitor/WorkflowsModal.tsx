"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { AdvancedRuleEditorModal } from "./AdvancedRuleEditorModal";
import type {
  DryRunResult,
  Rule,
  RuleDebugResponse,
  RuleVersion,
  TraceNode,
} from "./types";

const btn =
  "rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50";
const btnGhost =
  "rounded px-2 py-1 text-xs text-text-muted transition hover:bg-white/10 hover:text-white";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Org-wide Workflows manager. Lists the current user's rules ("workflows") for
 * the selected org (`GET /api/orgs/{org}/rules`), and lets you create, edit,
 * enable/disable, delete, and **diagnose** them — surfacing the backend's
 * existing per-rule diagnostics (`/debug`, `/firings`, `/test`, `/versions`)
 * that were never shown anywhere. Creation goes straight to the advanced graph
 * editor (the Quick When/Then form was removed; the natural-language path is
 * disabled in the UI — backend endpoint kept for a possible return). Portalled
 * to document.body so the fixed layer escapes the TopBar's `.cc-panel`
 * backdrop-filter (same pattern as ChannelsModal). Mutations are gated on
 * `canEdit` (builder mode); listing and diagnostics are always available.
 */
export function WorkflowsModal({
  orgId,
  orgName,
  canEdit,
  onClose,
}: {
  orgId: string;
  orgName: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const listKey = useMemo(() => ["rules", "org", orgId], [orgId]);

  const rules = useQuery<Rule[]>({
    queryKey: listKey,
    queryFn: () => apiFetch(`/api/orgs/${encodeURIComponent(orgId)}/rules`),
  });

  const [diagnoseRule, setDiagnoseRule] = useState<Rule | null>(null);
  // null = editor closed; "new" = create; a Rule = edit that rule.
  const [editorRule, setEditorRule] = useState<Rule | "new" | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: listKey });
    qc.invalidateQueries({ queryKey: ["rules"] });
  };

  const toggle = useMutation({
    mutationFn: (r: Rule) =>
      apiFetch(`/api/rules/${encodeURIComponent(r.id)}/enabled`, {
        method: "POST",
        body: JSON.stringify({ is_enabled: !r.is_enabled }),
      }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Toggle failed"),
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/rules/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Workflow deleted");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  // Clone a workflow — created DISABLED so the copy can't double-fire until
  // the user reviews and enables it.
  const clone = useMutation({
    mutationFn: (r: Rule) =>
      apiFetch("/api/rules", {
        method: "POST",
        body: JSON.stringify({
          name: `${r.name} (copy)`,
          is_enabled: false,
          condition: r.condition,
          actions: r.actions,
          cooldown_seconds: r.cooldown_seconds,
          metadata: r.metadata ?? undefined,
          cc_org_id: r.cc_org_id ?? orgId,
        }),
      }),
    onSuccess: () => {
      toast.success("Workflow cloned (disabled — review then enable it)");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Clone failed"),
  });

  // Esc closes the manager — but not while the advanced editor (its own modal)
  // is open on top, which handles its own Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editorRule === null) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editorRule]);

  const header = diagnoseRule
    ? `Diagnose · ${diagnoseRule.name}`
    : `Workflows · ${orgName}`;

  return createPortal(
    <>
      <div className="rule-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
        <div className="rule-modal-panel flex h-[88vh] w-[92vw] max-w-[860px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-warm-lg">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-3">
              {diagnoseRule && (
                <button
                  onClick={() => setDiagnoseRule(null)}
                  className={btnGhost}
                  title="Back to the list"
                >
                  ← Back
                </button>
              )}
              <h2 className="text-lg font-semibold text-white">{header}</h2>
            </div>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-white px-3 text-2xl leading-none"
              aria-label="Close"
              title="Close (Esc)"
            >
              ×
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {diagnoseRule ? (
              <DiagnosePanel rule={diagnoseRule} canEdit={canEdit} onChanged={invalidate} />
            ) : (
              <WorkflowList
                rules={rules.data}
                loading={rules.isLoading}
                error={rules.error}
                canEdit={canEdit}
                onNew={() => setEditorRule("new")}
                onEdit={(r) => setEditorRule(r)}
                onDiagnose={(r) => setDiagnoseRule(r)}
                onClone={(r) => clone.mutate(r)}
                onToggle={(r) => toggle.mutate(r)}
                onDelete={(r) => {
                  if (confirm(`Delete workflow "${r.name}"? This cannot be undone.`)) {
                    del.mutate(r.id);
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>

      {editorRule !== null && (
        <AdvancedRuleEditorModal
          orgId={orgId}
          initialRule={editorRule === "new" ? undefined : editorRule}
          onClose={() => {
            setEditorRule(null);
            invalidate();
          }}
        />
      )}
    </>,
    document.body,
  );
}

function WorkflowList({
  rules,
  loading,
  error,
  canEdit,
  onNew,
  onEdit,
  onDiagnose,
  onClone,
  onToggle,
  onDelete,
}: {
  rules: Rule[] | undefined;
  loading: boolean;
  error: unknown;
  canEdit: boolean;
  onNew: () => void;
  onEdit: (r: Rule) => void;
  onDiagnose: (r: Rule) => void;
  onClone: (r: Rule) => void;
  onToggle: (r: Rule) => void;
  onDelete: (r: Rule) => void;
}) {
  if (loading) return <p className="text-text-muted text-sm">Loading workflows…</p>;
  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--cc-red-1)" }}>
        {error instanceof Error ? error.message : "Failed to load workflows."}
      </p>
    );
  }

  return (
    <>
      {rules && rules.length === 0 && (
        <p className="text-text-muted text-sm">
          No workflows for this org yet. Create one to watch a building and notify
          a channel when something goes wrong.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {rules?.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between rounded-lg border border-border bg-elevated px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: r.is_enabled ? "var(--cc-green)" : "var(--cc-gray)" }}
                  title={r.is_enabled ? "enabled" : "disabled"}
                />
                <span className="truncate text-sm font-medium text-text">{r.name}</span>
              </div>
              <div className="text-text-muted mt-0.5 text-[11px]">
                {r.last_fired_at
                  ? `last: ${r.last_outcome_state ?? "?"} · ${fmtTime(r.last_fired_at)}`
                  : "never fired"}
              </div>
            </div>
            <div className="ml-3 flex shrink-0 items-center gap-1">
              <button onClick={() => onDiagnose(r)} className={btnGhost} title="Why isn't it firing?">
                Diagnose
              </button>
              {canEdit && (
                <>
                  <button onClick={() => onEdit(r)} className={btnGhost}>
                    Edit
                  </button>
                  <button
                    onClick={() => onClone(r)}
                    className={btnGhost}
                    title="Duplicate this workflow (created disabled)"
                  >
                    Clone
                  </button>
                  <button onClick={() => onToggle(r)} className={btnGhost}>
                    {r.is_enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => onDelete(r)}
                    className="rounded px-2 py-1 text-xs transition hover:bg-white/10"
                    style={{ color: "var(--cc-red-1)" }}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {canEdit ? (
        <button
          onClick={onNew}
          className="mt-4 w-full rounded-lg py-2 text-sm font-semibold text-white transition"
          style={{ background: "var(--cc-primary)" }}
        >
          + New workflow
        </button>
      ) : (
        <p className="text-text-muted mt-4 text-center text-xs">
          Switch to Builder mode to create or edit workflows.
        </p>
      )}
    </>
  );
}

// ───── Diagnostics ─────

function Verdict({ ok }: { ok: boolean }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
      style={{
        background: ok ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
        color: ok ? "var(--cc-green)" : "var(--cc-red-1)",
      }}
    >
      {ok ? "true" : "false"}
    </span>
  );
}

function ConditionTrace({ node }: { node: TraceNode }) {
  if (node.type === "logical") {
    return (
      <div className="border-l border-white/10 pl-3">
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-xs uppercase">{node.op}</span>
          <Verdict ok={node.verdict} />
        </div>
        <div className="mt-1 flex flex-col gap-1">
          {node.children.map((c, i) => (
            <ConditionTrace key={i} node={c} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <code className="rounded bg-black/30 px-1.5 py-0.5 text-text">{node.field}</code>
      <span className="text-text-muted">{node.operator}</span>
      <code className="text-text">{JSON.stringify(node.expected)}</code>
      <span className="text-text-muted">· actual:</span>
      <code className="text-text">{JSON.stringify(node.actual)}</code>
      {node.for_duration_seconds != null && (
        <span className="text-text-muted">for {node.for_duration_seconds}s</span>
      )}
      <Verdict ok={node.verdict} />
      {node.instantaneous && !node.verdict && node.for_duration_seconds != null && (
        <span style={{ color: "var(--cc-orange, #f59e0b)" }}>
          true now, but not held for the duration yet
        </span>
      )}
      {node.parse_error && (
        <span style={{ color: "var(--cc-red-1)" }}>⚠ {node.parse_error}</span>
      )}
    </div>
  );
}

function DiagnosePanel({
  rule,
  canEdit,
  onChanged,
}: {
  rule: Rule;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const debug = useQuery<RuleDebugResponse>({
    queryKey: ["rule-debug", rule.id],
    queryFn: () => apiFetch(`/api/rules/${encodeURIComponent(rule.id)}/debug`),
  });
  const versions = useQuery<RuleVersion[]>({
    queryKey: ["rule-versions", rule.id],
    queryFn: () => apiFetch(`/api/rules/${encodeURIComponent(rule.id)}/versions`),
  });
  const [dry, setDry] = useState<DryRunResult | null>(null);

  const test = useMutation({
    mutationFn: () =>
      apiFetch<DryRunResult>(`/api/rules/${encodeURIComponent(rule.id)}/test`, { method: "POST" }),
    onSuccess: (r) => setDry(r),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Dry-run failed"),
  });

  const restore = useMutation({
    mutationFn: (versionId: string) =>
      apiFetch(
        `/api/rules/${encodeURIComponent(rule.id)}/versions/${encodeURIComponent(versionId)}/restore`,
        { method: "POST" },
      ),
    onSuccess: () => {
      toast.success("Version restored");
      qc.invalidateQueries({ queryKey: ["rule-debug", rule.id] });
      qc.invalidateQueries({ queryKey: ["rule-versions", rule.id] });
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Restore failed"),
  });

  if (debug.isLoading) return <p className="text-text-muted text-sm">Loading diagnostics…</p>;
  if (debug.error || !debug.data) {
    return (
      <p className="text-sm" style={{ color: "var(--cc-red-1)" }}>
        {debug.error instanceof Error ? debug.error.message : "Failed to load diagnostics."}
      </p>
    );
  }

  const d = debug.data;

  return (
    <div className="space-y-5 text-sm">
      {/* Verdict + cooldown */}
      <section className="rounded-lg border border-border bg-elevated p-3">
        <div className="flex items-center gap-3">
          <span className="text-text-muted">Would match right now:</span>
          <Verdict ok={d.would_match_now} />
        </div>
        <div className="text-text-muted mt-2 text-xs">
          Cooldown {d.cooldown.cooldown_seconds}s · {d.cooldown.remaining_seconds}s remaining ·
          last outcome: {d.cooldown.last_outcome_state ?? "—"}
          {d.cooldown.would_skip_due_to_cooldown && (
            <span style={{ color: "var(--cc-orange, #f59e0b)" }}>
              {" "}
              · would be skipped by cooldown
            </span>
          )}
        </div>
        {!d.would_match_now && (
          <p className="text-text-muted mt-2 text-xs">
            Not matching: check the per-condition values below. A{" "}
            <code className="text-text">null</code> actual usually means the monitor
            isn&apos;t being polled yet (no metric reading), or it was deleted.
          </p>
        )}
      </section>

      {/* Condition trace */}
      <section>
        <h3 className="text-text-muted mb-2 text-xs uppercase tracking-wide">Condition</h3>
        <ConditionTrace node={d.condition_summary as TraceNode} />
      </section>

      {/* Referenced monitors */}
      {d.monitors_referenced.length > 0 && (
        <section>
          <h3 className="text-text-muted mb-2 text-xs uppercase tracking-wide">
            Monitors referenced
          </h3>
          <ul className="flex flex-col gap-1">
            {d.monitors_referenced.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-xs">
                <span className="text-text">{m.display_name}</span>
                <span className="text-text-muted">
                  {m.current_state} · held {m.held_for_seconds}s
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Channels */}
      {d.channels_used.length > 0 && (
        <section>
          <h3 className="text-text-muted mb-2 text-xs uppercase tracking-wide">Channels</h3>
          <ul className="flex flex-col gap-1">
            {d.channels_used.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-xs">
                <span className="text-text">
                  {c.name} ({c.kind})
                </span>
                <span style={{ color: c.failure_count > 0 ? "var(--cc-red-1)" : "var(--cc-green)" }}>
                  {c.failure_count > 0 ? `${c.failure_count} failures` : "healthy"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Dry-run */}
      <section>
        <button
          onClick={() => test.mutate()}
          disabled={test.isPending}
          className={`${btn}`}
          style={{ background: "var(--cc-primary)" }}
        >
          {test.isPending ? "Running…" : "Run dry-run test"}
        </button>
        {dry && (
          <span className="text-text-muted ml-3 text-xs">
            matched: <Verdict ok={dry.matched} /> · {dry.actions_that_would_run} action(s) would run
          </span>
        )}
      </section>

      {/* Recent firings */}
      <section>
        <h3 className="text-text-muted mb-2 text-xs uppercase tracking-wide">Recent activity</h3>
        {d.recent_firings.length === 0 ? (
          <p className="text-text-muted text-xs">
            No firings recorded. If you expect activity, enable WORKFLOW_DEBUG on the
            backend and watch the logs on the next poll.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {d.recent_firings.map((f) => (
              <li key={f.id} className="flex items-center justify-between text-xs">
                <span className="text-text">{f.outcome}</span>
                <span className="text-text-muted">
                  {f.trigger_kind} · {fmtTime(f.fired_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Versions */}
      <section>
        <h3 className="text-text-muted mb-2 text-xs uppercase tracking-wide">Version history</h3>
        {versions.isLoading ? (
          <p className="text-text-muted text-xs">Loading…</p>
        ) : versions.data && versions.data.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {versions.data.map((v) => (
              <li key={v.version_id} className="flex items-center justify-between text-xs">
                <span className="text-text-muted">
                  {fmtTime(v.saved_at)}
                  {v.comment ? ` · ${v.comment}` : ""}
                </span>
                {canEdit && (
                  <button
                    onClick={() => restore.mutate(v.version_id)}
                    disabled={restore.isPending}
                    className={btnGhost}
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-muted text-xs">No saved versions.</p>
        )}
      </section>
    </div>
  );
}
