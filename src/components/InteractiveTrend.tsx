"use client";

import { useRef, useState, useId } from "react";

/**
 * Interactive time-series area chart for a dashboard headline (14-day billed).
 *
 * A server-safe SVG area + line (scales to its container) with a client hover
 * layer: a crosshair + point marker + HTML tooltip that tracks the pointer 1:1
 * and snaps to the nearest bucket. Keyboard-accessible — focus the plot and use
 * ← / → to move the readout, Home / End to jump to the ends. The peak stays
 * annotated so the chart is still readable with no interaction at all.
 *
 * Values oldest → newest; `labels` (same length) name each bucket; `format`
 * renders the tooltip + peak value.
 */
export function InteractiveTrend({
  values,
  labels,
  height = 168,
  format = (n) => n.toLocaleString("en-GB"),
  ariaLabel,
}: {
  values: number[];
  labels: string[];
  height?: number;
  format?: (n: number) => string;
  ariaLabel?: string;
}) {
  const gradId = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const width = 600;
  const padX = 6;
  const padTop = 20;
  const padBottom = 22;

  if (values.length < 2) {
    return (
      <div className="px-4 py-12 text-center text-sm text-slate-500">
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

  const xAt = (i: number) => padX + i * stepX;
  const yAt = (v: number) => padTop + innerH - ((v - min) / range) * innerH;

  const pts = values.map((v, i) => [xAt(i), yAt(v)] as const);
  const lineStr = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaStr =
    `M${padX},${padTop + innerH} ` +
    `L${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")} ` +
    `L${padX + innerW},${padTop + innerH} Z`;

  const peakIdx = values.indexOf(max);
  const [lastX, lastY] = pts[pts.length - 1];

  // ~4 axis labels so they never crowd.
  const ticks: { x: number; text: string }[] = [];
  const tickCount = Math.min(4, labels.length);
  for (let k = 0; k < tickCount; k++) {
    const i = Math.round((k / (tickCount - 1)) * (labels.length - 1));
    ticks.push({ x: xAt(i), text: labels[i] ?? "" });
  }

  function pointerIndex(clientX: number): number {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const frac = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(values.length - 1, Math.round(frac * (values.length - 1))));
  }

  const activeIdx = active;
  const leftPct = activeIdx != null ? (xAt(activeIdx) / width) * 100 : 0;
  const topPct = activeIdx != null ? (yAt(values[activeIdx]) / height) * 100 : 0;

  return (
    <div className="relative">
      <div
        ref={wrapRef}
        className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        role="application"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerMove={(e) => setActive(pointerIndex(e.clientX))}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? values.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
            e.preventDefault();
            setActive((a) => {
              const cur = a ?? values.length - 1;
              if (e.key === "Home") return 0;
              if (e.key === "End") return values.length - 1;
              const next = cur + (e.key === "ArrowRight" ? 1 : -1);
              return Math.max(0, Math.min(values.length - 1, next));
            });
          }
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full block"
          style={{ height }}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.02" />
            </linearGradient>
          </defs>

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
            stroke="#3B82F6"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Crosshair + marker for the active bucket. */}
          {activeIdx != null && (
            <>
              <line
                x1={xAt(activeIdx)}
                y1={padTop - 6}
                x2={xAt(activeIdx)}
                y2={padTop + innerH}
                stroke="#94A3B8"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={xAt(activeIdx)}
                cy={yAt(values[activeIdx])}
                r={4}
                fill="#3B82F6"
                stroke="#fff"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}

          {/* End marker (only when not actively probing, to avoid doubling up). */}
          {activeIdx == null && <circle cx={lastX} cy={lastY} r={3} fill="#3B82F6" />}

          {/* Peak annotation — readable with no interaction. */}
          {activeIdx == null && max > 0 && (
            <text
              x={Math.min(Math.max(xAt(peakIdx), 26), width - 26)}
              y={Math.max(yAt(max) - 7, 11)}
              textAnchor="middle"
              className="fill-slate-400"
              style={{ fontSize: 11, fontWeight: 600 }}
            >
              {format(max)}
            </text>
          )}

          {ticks.map((t, i) => (
            <text
              key={i}
              x={Math.min(Math.max(t.x, 20), width - 20)}
              y={height - 5}
              textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
              className="fill-slate-400"
              style={{ fontSize: 10 }}
            >
              {t.text}
            </text>
          ))}
        </svg>

        {/* HTML tooltip — positioned by percentage so it tracks the stretch. */}
        {activeIdx != null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full"
            style={{ left: `${leftPct}%`, top: `calc(${topPct}% - 10px)` }}
            role="status"
            aria-live="polite"
          >
            <div className="whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-md">
              <div className="text-[11px] text-slate-500">{labels[activeIdx]}</div>
              <div className="text-sm font-semibold tabular-nums text-brand-navy">
                {format(values[activeIdx])}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
