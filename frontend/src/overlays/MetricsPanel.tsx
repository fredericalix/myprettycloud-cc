"use client";

import dynamic from "next/dynamic";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { apiFetch } from "@/lib/api";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <div className="cc-muted flex h-[260px] items-center justify-center text-sm">Loading chart…</div>,
});

type Panel = "cpu" | "memory" | "network" | "disk";
const PANELS: { key: Panel; label: string }[] = [
  { key: "cpu", label: "CPU" },
  { key: "memory", label: "Memory" },
  { key: "network", label: "Network" },
  { key: "disk", label: "Disk" },
];
const DURATIONS = ["1h", "6h", "24h", "7d", "30d"];

interface MetricSeries {
  name: string;
  data: Array<Array<number | null>>;
}
interface MetricsResponse {
  panel: string;
  series: MetricSeries[];
}

export function MetricsPanel({ orgId, appId }: { orgId: string; appId: string }) {
  const [panel, setPanel] = useState<Panel>("cpu");
  const [duration, setDuration] = useState("1h");

  const q = useQuery<MetricsResponse>({
    queryKey: ["metrics", orgId, appId, panel, duration],
    queryFn: () =>
      apiFetch<MetricsResponse>(
        `/api/metrics/${encodeURIComponent(orgId)}/${encodeURIComponent(appId)}?panel=${panel}&duration=${duration}`,
      ),
    refetchInterval: 30_000,
    // Keep the previous curve on screen while a duration/panel switch loads
    // instead of blanking the chart.
    placeholderData: keepPreviousData,
  });

  // Rebuilt only when the data changes (not on every keystroke/refetch render).
  const option: EChartsOption = useMemo(
    () => ({
      grid: { left: 48, right: 16, top: 24, bottom: 28 },
      tooltip: { trigger: "axis" },
      legend: { textStyle: { color: "#b7a999" }, top: 0 },
      xAxis: { type: "time", axisLabel: { color: "#b7a999" } },
      yAxis: {
        type: "value",
        axisLabel: { color: "#b7a999" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
      },
      series: (q.data?.series ?? []).map((s) => ({
        name: s.name.replace(/^.*\./, ""),
        type: "line",
        showSymbol: false,
        smooth: true,
        connectNulls: false,
        data: s.data,
      })),
    }),
    [q.data],
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {PANELS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPanel(p.key)}
              className={`rounded px-2 py-1 text-xs ${
                panel === p.key ? "bg-accent text-white" : "bg-white/5 text-text-muted"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="ml-auto rounded bg-white/5 px-2 py-1 text-xs"
        >
          {DURATIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      {q.error ? (
        <div className="cc-muted flex h-[260px] items-center justify-center text-sm">
          No metrics available.
        </div>
      ) : (
        // replaceMerge (not notMerge) keeps the chart INSTANCE alive across the
        // 30s polls — canvas, axes, legend state and tooltip survive; only the
        // series are swapped in place (and stale ones are removed). Switching
        // building/panel still remounts cleanly via the `key`.
        <ReactECharts
          key={`${appId}:${panel}`}
          option={option}
          style={{ height: 260 }}
          replaceMerge={["series"]}
          lazyUpdate
        />
      )}
    </div>
  );
}
