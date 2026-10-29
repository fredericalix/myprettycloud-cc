"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

/**
 * Describe a workflow in plain English; the backend generates it via an
 * OpenAI-compatible LM Studio endpoint (scoped to the chosen monitor) and saves
 * it. Disabled server-side when LMSTUDIO_BASE_URL is unset — the call then
 * returns a 400 with a clear error. The generated rule is tagged with the
 * monitor's org on the backend (derived from monitor_id).
 */
export function NaturalLanguageRule({
  orgId,
  monitorId,
  onSaved,
}: {
  orgId: string;
  monitorId: string;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");

  const gen = useMutation({
    mutationFn: () =>
      apiFetch("/api/rules/generate", {
        method: "POST",
        body: JSON.stringify({ text, monitor_id: monitorId }),
      }),
    onSuccess: () => {
      toast.success("Workflow generated & saved");
      setText("");
      qc.invalidateQueries({ queryKey: ["rules"] });
      qc.invalidateQueries({ queryKey: ["rules", "org", orgId] });
      onSaved?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "generation failed"),
  });

  return (
    <div className="border-t border-white/10 pt-3">
      <label className="text-text-muted text-xs">Describe the workflow in plain language</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="alert me if CPU stays above 80% for 5 minutes"
        className="mt-1 w-full rounded bg-white/5 px-2 py-1 text-sm"
      />
      <button
        onClick={() => gen.mutate()}
        disabled={gen.isPending || text.trim().length === 0 || !monitorId}
        className="mt-2 rounded bg-white/10 px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {gen.isPending ? "Generating…" : "Generate workflow"}
      </button>
    </div>
  );
}
