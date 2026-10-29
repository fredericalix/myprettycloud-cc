"use client";

// Lightweight filter-as-you-type combobox (no deps), styled like ui/Input.
// Built for ReactFlow nodes: the `nodrag`/`nowheel` classes stop typing from
// dragging the node and list-scrolling from zooming the canvas — a native
// <select> gets that for free, a custom dropdown doesn't.

import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

export interface SelectOption {
  id: string;
  label: string;
  hint?: string;
}

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  options: SelectOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as globalThis.Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className={cn("nodrag relative", className)}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        value={open ? query : (selected?.label ?? "")}
        placeholder={placeholder ?? "search…"}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Enter" && open && filtered.length > 0) {
            e.preventDefault();
            pick(filtered[0].id);
          }
        }}
        className="w-full rounded-md border border-border bg-elevated px-2 py-1 pr-6 text-xs text-text focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none"
      />
      <CaretDown
        weight="bold"
        size={10}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-subtle"
      />
      {open ? (
        <ul className="nowheel absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-warm-md">
          {filtered.length === 0 ? (
            <li className="px-2 py-1 text-[11px] italic text-text-subtle">
              no match
            </li>
          ) : (
            filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // Pick before the input's blur removes the list.
                    e.preventDefault();
                    pick(o.id);
                  }}
                  className={cn(
                    "block w-full px-2 py-1 text-left text-xs hover:bg-accent-soft",
                    o.id === value ? "text-accent-strong font-medium" : "text-text",
                  )}
                >
                  <span className="block truncate">{o.label}</span>
                  {o.hint ? (
                    <span className="block truncate text-[10px] text-text-subtle">
                      {o.hint}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
