/**
 * Larger time-series area chart — a step up from the inline Sparkline for
 * a headline trend (14-day billed, 14-day activity volume, …).
 *
 * Server-rendered SVG, zero-dep, no client JS. Draws a smoothed-ish
 * polyline + area fill across a fixed viewBox, a faint baseline, an
 * end-point marker, and optional sparse x-axis day ticks. The peak value
 * is annotated as text so the chart is readable without interaction
 * (no hover-only data), which keeps it accessible.
 *
 * Pass `values` (one per bucket, oldest → newest). `labels` (same length)
 * are sampled for the axis. `formatValue` renders the peak annotation.
 */
export function TrendChart({
  values,
  labels,
  height = 120,
  stroke = "#3B82F6",
  fill = "#3B82F6",
  formatValue = (n) => n.toLocaleString("en-GB"),
  ariaLabel,
}: {
  values: number[];
  labels?: string[];
  height?: number;
  stroke?: string;
  fill?: string;
  formatValue?: (n: number) => string;
  ariaLabel?: string;
}) {
  const width = 600; // viewBox width; SVG scales to container via class
  const padX = 4;
  const padTop = 18; // headroom for the peak label
  const padBottom = labels && labels.length > 0 ? 18 : 6;

  if (values.length < 2) {
    return (
      <div className="px-4 py-10 text-center text-sm text-slate-500">
        Not enough data to plot a trend yet.
      </div>
    );
  }

  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const stepX = innerW / (values.length - 1);

  const pt = (v: number, i: number) => {
    const x = padX + i * stepX;
    const y = padTop + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  };

  const linePoints = values.map((v, i) => pt(v, i));
  const lineStr = linePoints.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaStr = `M${padX},${padTop + innerH} L${linePoints
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" L")} L${padX + innerW},${padTop + innerH} Z`;

  const peakIdx = values.indexOf(max);
  const [peakX, peakY] = pt(max, peakIdx);
  const [lastX, lastY] = linePoints[linePoints.length - 1];

  const gradId = `trend-grad-${stroke.replace("#", "")}`;

  // Sample ~4 axis labels so they never crowd on small screens.
  const ticks: { x: number; text: string }[] = [];
  if (labels && labels.length === values.length) {
    const count = Math.min(4, labels.length);
    for (let k = 0; k < count; k++) {
      const i = Math.round((k / (count - 1)) * (labels.length - 1));
      const [x] = pt(values[i], i);
      ticks.push({ x, text: labels[i] });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.22" />
          <stop offset="100%" stopColor={fill} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Baseline */}
      <line
        x1={padX}
        y1={padTop + innerH}
        x2={padX + innerW}
        y2={padTop + innerH}
        stroke="#E2E8F0"
        strokeWidth={1}
      />

      <path d={areaStr} fill={`url(#${gradId})`} />
      <polyline
        points={lineStr}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />

      {/* End marker */}
      <circle cx={lastX} cy={lastY} r={3} fill={stroke} />

      {/* Peak annotation — keeps the chart readable without hover. */}
      {max > 0 && (
        <text
          x={Math.min(Math.max(peakX, 24), width - 24)}
          y={Math.max(peakY - 6, 10)}
          textAnchor="middle"
          className="fill-slate-500"
          style={{ fontSize: 11, fontWeight: 600 }}
        >
          {formatValue(max)}
        </text>
      )}

      {ticks.map((t, i) => (
        <text
          key={i}
          x={Math.min(Math.max(t.x, 18), width - 18)}
          y={height - 4}
          textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
          className="fill-slate-400"
          style={{ fontSize: 10 }}
        >
          {t.text}
        </text>
      ))}
    </svg>
  );
}
