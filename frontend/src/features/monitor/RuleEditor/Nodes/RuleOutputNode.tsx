"use client";

import { Handle, Position } from "reactflow";
import { CheckCircle } from "@phosphor-icons/react";
import { VerdictChip, useTestOverlay } from "../TestOverlayContext";
import { cn } from "@/lib/cn";

export default function RuleOutputNode() {
  const overlay = useTestOverlay();
  return (
    <div
      className={cn(
        "w-36 rounded-2xl border-2 bg-accent-soft p-3 text-center shadow-warm-md",
        overlay
          ? overlay.matched
            ? "border-ok/70"
            : "border-critical/70"
          : "border-accent/60",
      )}
    >
      <div className="flex flex-col items-center gap-0.5">
        <CheckCircle weight="duotone" size={22} className="text-accent-strong" />
        <div className="text-xs font-semibold uppercase tracking-wider text-accent-strong">
          Rule output
        </div>
        <div className="text-[10px] text-text-muted italic">fire actions →</div>
        {overlay ? (
          <VerdictChip
            ok={overlay.matched}
            label={overlay.matched ? "matched" : "no match"}
          />
        ) : null}
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="rule-in"
        style={{
          background: "var(--color-accent)",
          width: 12,
          height: 12,
          border: "2px solid var(--color-surface)",
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="rule-out"
        style={{
          background: "var(--color-accent)",
          width: 12,
          height: 12,
          border: "2px solid var(--color-surface)",
        }}
      />
    </div>
  );
}
