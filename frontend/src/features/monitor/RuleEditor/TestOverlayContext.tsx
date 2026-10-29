"use client";

// Per-editor-session result of a draft dry-run (POST /api/rules/test-draft),
// overlaid on the ReactFlow graph: each condition/logical node shows its live
// verdict, edges on true paths light up, actions show would-run/skipped. The
// overlay is plain local state in RuleEditorInner (cleared on any graph edit)
// and reaches the custom nodes through this context — injecting verdicts into
// `node.data` would mean rewriting every node's data on each set/clear.

import { createContext, useContext } from "react";
import type { TraceNode } from "@/features/monitor/types";

export interface NodeVerdict {
  verdict: boolean;
  actual?: unknown;
  instantaneous?: boolean;
  parseError?: string | null;
  forDurationSeconds?: number | null;
}

export interface TestOverlay {
  matched: boolean;
  /** ReactFlow node id → verdict, for the condition/logical nodes that were
   *  included in the test (incomplete nodes are dropped at serialization). */
  byNodeId: Record<string, NodeVerdict>;
  /** Action node id → whether the action would run. */
  actionRun: Record<string, boolean>;
}

export const TestOverlayContext = createContext<TestOverlay | null>(null);

export function useTestOverlay(): TestOverlay | null {
  return useContext(TestOverlayContext);
}

export function useNodeVerdict(id: string): NodeVerdict | undefined {
  return useTestOverlay()?.byNodeId[id];
}

/** Small true/false pill shown in node headers while a test overlay is active. */
export function VerdictChip({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span
      className={
        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase " +
        (ok ? "bg-ok-soft text-ok" : "bg-critical-soft text-critical")
      }
    >
      {label ?? (ok ? "true" : "false")}
    </span>
  );
}

function toNodeVerdict(t: TraceNode): NodeVerdict {
  if (t.type === "comparison") {
    return {
      verdict: t.verdict,
      actual: t.actual,
      instantaneous: t.instantaneous,
      parseError: t.parse_error,
      forDurationSeconds: t.for_duration_seconds,
    };
  }
  return { verdict: t.verdict };
}

/** Map a backend condition trace onto ReactFlow node ids via the structural
 *  path map recorded during serialization (see `serializeGraph`): the trace
 *  mirrors the serialized condition tree 1:1, so walking both in the same
 *  child order is an exact mapping. */
export function collectVerdicts(
  trace: TraceNode,
  idByPath: Map<string, string>,
  path = "",
  out: Record<string, NodeVerdict> = {},
): Record<string, NodeVerdict> {
  const nodeId = idByPath.get(path);
  if (nodeId) out[nodeId] = toNodeVerdict(trace);
  if (trace.type === "logical") {
    trace.children.forEach((c, i) =>
      collectVerdicts(c, idByPath, path === "" ? String(i) : `${path}.${i}`, out),
    );
  }
  return out;
}
