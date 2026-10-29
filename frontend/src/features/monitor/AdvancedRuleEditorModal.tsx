"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import RuleEditor from "./RuleEditor/RuleEditor";
import type {
  EditorData,
} from "./RuleEditor/EditorContext";
import type {
  GroupView,
  Monitor,
  NotificationChannel,
  Rule,
  UpsertRuleInput,
} from "./types";

/**
 * Large centered popup hosting the advanced graph rule editor (ReactFlow).
 * Portalled to document.body so the fixed layer escapes the BuildingDrawer's
 * `.cc-panel` backdrop-filter containing block (which otherwise traps `fixed`
 * inside the 420px drawer). Loads the EditorData (monitors / groups / rules /
 * channels) and saves via /api/rules — the same schema the sentinel form and
 * NL generator produce. Dismissed with Esc or the × button (backdrop inert).
 */
export function AdvancedRuleEditorModal({
  orgId,
  initialRule,
  onClose,
}: {
  orgId: string;
  initialRule?: Rule;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const monitors = useQuery<Monitor[]>({
    queryKey: ["monitors", orgId],
    queryFn: () => apiFetch<Monitor[]>(`/api/orgs/${encodeURIComponent(orgId)}/monitors`),
  });
  const groups = useQuery<GroupView[]>({ queryKey: ["groups"], queryFn: () => apiFetch("/api/groups") });
  const rules = useQuery<Rule[]>({ queryKey: ["rules"], queryFn: () => apiFetch("/api/rules") });
  const channels = useQuery<NotificationChannel[]>({
    queryKey: ["channels"],
    queryFn: () => apiFetch("/api/channels"),
  });

  const ready = monitors.data && groups.data && rules.data && channels.data;

  // Memoize so the EditorData identity is stable across the modal's query-state
  // re-renders — otherwise RuleEditor's EditorContext value changes every render
  // and re-renders every node in the graph.
  const data: EditorData = useMemo(
    () => ({
      monitors: monitors.data ?? [],
      groups: groups.data ?? [],
      rules: rules.data ?? [],
      channels: channels.data ?? [],
    }),
    [monitors.data, groups.data, rules.data, channels.data],
  );

  const [saving, setSaving] = useState(false);
  const onSave = async (input: UpsertRuleInput) => {
    setSaving(true);
    try {
      // Tag the workflow with the current org; PUT when editing an existing
      // rule (else we'd create a duplicate), POST when creating.
      const payload: UpsertRuleInput = { ...input, cc_org_id: orgId };
      if (initialRule) {
        await apiFetch(`/api/rules/${encodeURIComponent(initialRule.id)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch("/api/rules", { method: "POST", body: JSON.stringify(payload) });
      }
      toast.success(initialRule ? "Workflow updated" : "Workflow saved");
      qc.invalidateQueries({ queryKey: ["rules"] });
      qc.invalidateQueries({ queryKey: ["rules", "org", orgId] });
      onClose(); // unmounts — deliberately no setSaving after this
    } catch (e) {
      setSaving(false);
      throw e; // let RuleEditor surface the failure
    }
  };

  // Esc closes (the dark backdrop is intentionally inert so a stray click can't
  // discard an unsaved graph).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="rule-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="rule-modal-panel flex h-[90vh] w-[92vw] max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-warm-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold text-white">
            {initialRule ? `Edit workflow · ${initialRule.name}` : "Advanced rule editor"}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-white px-3 text-2xl leading-none"
            aria-label="Close"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {ready ? (
            <RuleEditor data={data} initialRule={initialRule} onSave={onSave} busy={saving} />
          ) : (
            <div className="cc-muted flex h-full items-center justify-center">Loading editor…</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
