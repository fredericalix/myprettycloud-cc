import type { MetricPoint } from '../../stores/useRealtimeStore';

interface SparklineProps {
  data: MetricPoint[];
  color: string;
  /** Upper bound of the value axis (e.g. 100 for percentages). */
  max?: number;
  width?: number;
  height?: number;
  label?: string;
}

/**
 * Tiny SVG sparkline for CPU/RAM history. Pure presentation — no D3,
 * no recharts. Accepts the MetricPoint[] that useRealtimeStore buffers
 * from WS frames directly.
 */
export function Sparkline({
  data,
  color,
  max = 100,
  width = 140,
  height = 36,
  label,
}: SparklineProps) {
  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[10px] cc-muted"
        style={{ width, height, border: '1px dashed rgba(241,240,251,0.1)', borderRadius: 4 }}
      >
        {label ? `${label}: waiting…` : 'waiting…'}
      </div>
    );
  }

  // Normalise t to a 0..1 position across width, v to a 0..1 position across height.
  const t0 = data[0]!.t;
  const tN = data[data.length - 1]!.t;
  const tSpan = Math.max(1, tN - t0);

  const pad = 2; // leave room for the trailing dot stroke
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;

  const points = data.map((d) => {
    const x = pad + ((d.t - t0) / tSpan) * plotW;
    const clamped = Math.max(0, Math.min(max, d.v));
    const y = pad + (1 - clamped / max) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const last = data[data.length - 1]!;
  const lastX = pad + plotW; // always at the right edge
  const lastClamped = Math.max(0, Math.min(max, last.v));
  const lastY = pad + (1 - lastClamped / max) * plotH;

  return (
    <div className="flex flex-col gap-0.5">
      {label && (
        <div className="flex items-center justify-between text-[10px]">
          <span className="cc-muted">{label}</span>
          <span style={{ color }}>{last.v.toFixed(0)}%</span>
        </div>
      )}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block' }}
      >
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
      </svg>
    </div>
  );
}
