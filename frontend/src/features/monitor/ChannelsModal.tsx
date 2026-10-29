"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import type { ChannelKind, NotificationChannel, UpsertChannelInput } from "./types";

const KINDS: { value: ChannelKind; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "webhook", label: "Webhook" },
];

const inputCls =
  "w-full rounded-md border border-border bg-elevated px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent";
const labelCls = "block text-xs text-text-muted mb-1";

/**
 * Manage the user's notification channels (CRUD over /api/channels). Portalled
 * to document.body so the fixed layer escapes the TopBar's `.cc-panel`
 * backdrop-filter containing block. Esc / × close; the backdrop is inert.
 */
export function ChannelsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const channels = useQuery<NotificationChannel[]>({
    queryKey: ["channels"],
    queryFn: () => apiFetch("/api/channels"),
  });

  // null = list view; "new" or a channel = the form is open.
  const [editing, setEditing] = useState<NotificationChannel | "new" | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const del = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/channels/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Channel deleted");
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  return createPortal(
    <div className="rule-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="rule-modal-panel flex max-h-[88vh] w-[92vw] max-w-[640px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-warm-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold text-white">Notification channels</h2>
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
          {editing ? (
            <ChannelForm
              channel={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          ) : (
            <>
              {channels.isLoading && <p className="text-text-muted text-sm">Loading…</p>}
              {channels.data && channels.data.length === 0 && (
                <p className="text-text-muted text-sm">
                  No channels yet. Create one to receive rule alerts (email, Slack,
                  Discord or a webhook).
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {channels.data?.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-elevated px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{
                            background: c.enabled ? "var(--cc-green)" : "var(--cc-gray)",
                          }}
                          title={c.enabled ? "enabled" : "disabled"}
                        />
                        <span className="truncate text-sm font-medium text-text">{c.name}</span>
                        <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
                          {c.kind}
                        </span>
                      </div>
                      {c.failure_count > 0 && (
                        <div
                          className="text-warning mt-0.5 truncate text-[11px]"
                          title={c.last_failure_message ?? undefined}
                        >
                          ● {c.failure_count} recent failure{c.failure_count > 1 ? "s" : ""}
                        </div>
                      )}
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => setEditing(c)}
                        className="rounded px-2 py-1 text-xs text-text-muted transition hover:bg-white/10 hover:text-white"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete channel "${c.name}"?`)) del.mutate(c.id);
                        }}
                        className="rounded px-2 py-1 text-xs transition hover:bg-white/10"
                        style={{ color: "var(--cc-red-1)" }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => setEditing("new")}
                className="mt-4 w-full rounded-lg py-2 text-sm font-semibold text-white transition"
                style={{ background: "var(--cc-primary)" }}
              >
                + New channel
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Create/edit form. `channel === null` means a new channel. */
function ChannelForm({
  channel,
  onDone,
}: {
  channel: NotificationChannel | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const editingId = channel?.id ?? null;

  const [kind, setKind] = useState<ChannelKind>(channel?.kind ?? "email");
  const [name, setName] = useState(channel?.name ?? "");
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);

  const cfg = (channel?.config ?? {}) as Record<string, unknown>;
  // email
  const [emailTo, setEmailTo] = useState(
    Array.isArray(cfg.to) ? (cfg.to as string[]).join(", ") : "",
  );
  const [subjectPrefix, setSubjectPrefix] = useState(
    typeof cfg.subject_prefix === "string" ? cfg.subject_prefix : "",
  );
  // slack / discord
  const [webhookUrl, setWebhookUrl] = useState(
    typeof cfg.webhook_url === "string" ? cfg.webhook_url : "",
  );
  // generic webhook
  const [url, setUrl] = useState(typeof cfg.url === "string" ? cfg.url : "");
  const [method, setMethod] = useState(
    cfg.method === "PUT" ? "PUT" : "POST",
  );
  const [headersText, setHeadersText] = useState(
    cfg.headers && typeof cfg.headers === "object"
      ? JSON.stringify(cfg.headers, null, 2)
      : "",
  );

  const buildConfig = (): Record<string, unknown> | string => {
    if (kind === "email") {
      const to = emailTo
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (to.length === 0) return "Add at least one recipient email.";
      const c: Record<string, unknown> = { to };
      if (subjectPrefix.trim()) c.subject_prefix = subjectPrefix.trim();
      return c;
    }
    if (kind === "slack" || kind === "discord") {
      if (!webhookUrl.trim()) return "The webhook URL is required.";
      return { webhook_url: webhookUrl.trim() };
    }
    // webhook
    if (!url.trim()) return "The URL is required.";
    const c: Record<string, unknown> = { url: url.trim(), method };
    if (headersText.trim()) {
      try {
        const parsed = JSON.parse(headersText);
        if (parsed && typeof parsed === "object") c.headers = parsed;
        else return "Headers must be a JSON object.";
      } catch {
        return 'Headers must be valid JSON, e.g. {"Authorization": "Bearer …"}.';
      }
    }
    return c;
  };

  const save = useMutation({
    mutationFn: async () => {
      const config = buildConfig();
      if (typeof config === "string") throw new Error(config);
      if (!name.trim()) throw new Error("Give the channel a name.");
      const input: UpsertChannelInput = { kind, name: name.trim(), config, enabled };
      const path = editingId
        ? `/api/channels/${encodeURIComponent(editingId)}`
        : "/api/channels";
      return apiFetch(path, {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(input),
      });
    },
    onSuccess: () => {
      toast.success(editingId ? "Channel updated" : "Channel created");
      qc.invalidateQueries({ queryKey: ["channels"] });
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="flex flex-col gap-3"
    >
      <div>
        <label className={labelCls}>Type</label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ChannelKind)}
          className={inputCls}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls}>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ops Slack"
          className={inputCls}
        />
      </div>

      {kind === "email" && (
        <>
          <div>
            <label className={labelCls}>Recipients (comma-separated)</label>
            <input
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="alice@example.com, bob@example.com"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Subject prefix (optional)</label>
            <input
              value={subjectPrefix}
              onChange={(e) => setSubjectPrefix(e.target.value)}
              placeholder="[myprettycloud]"
              className={inputCls}
            />
          </div>
        </>
      )}

      {(kind === "slack" || kind === "discord") && (
        <div>
          <label className={labelCls}>{kind === "slack" ? "Slack" : "Discord"} webhook URL</label>
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/…"
            className={inputCls}
          />
        </div>
      )}

      {kind === "webhook" && (
        <>
          <div>
            <label className={labelCls}>URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/hook"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className={inputCls}
            >
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Headers (optional JSON)</label>
            <textarea
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              rows={3}
              placeholder={'{"Authorization": "Bearer …"}'}
              className={`${inputCls} font-mono text-xs`}
            />
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-sm text-text-muted">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="accent-accent h-4 w-4"
        />
        Enabled
      </label>

      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg px-3 py-1.5 text-sm text-text-muted transition hover:bg-white/10 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ background: "var(--cc-primary)" }}
        >
          {save.isPending ? "Saving…" : editingId ? "Save changes" : "Create channel"}
        </button>
      </div>
    </form>
  );
}
