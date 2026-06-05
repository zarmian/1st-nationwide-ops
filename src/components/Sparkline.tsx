/**
 * Tiny SVG sparkline. Zero deps, server-renderable (no client JS). Pass
 * an array of numbers; the component scales them into the viewBox and
 * draws a polyline + an optional area fill.
 *
 * Defaults are tuned for an inline KPI-card "last 14 days" strip:
 * 120×32 viewport, mint stroke, no area fill.
 */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  stroke = "#3B82F6",
  fill,
  strokeWidth = 1.5,
  className,
  ariaLabel,
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  className?: string;
  ariaLabel?: string;
}) {
  if (values.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className}
        aria-label={ariaLabel}
        role="img"
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#E2E8F0"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // flat series → render as a flat line, not NaN
  const stepX = width / (values.length - 1);
  const padY = strokeWidth;
  const innerH = height - padY * 2;

  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = padY + innerH - ((v - min) / range) * innerH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const areaPath = fill
    ? `M0,${height} L${points.replace(/ /g, " L")} L${width},${height} Z`
    : null;

  // Last point as a small marker — anchors the eye on the "now" value.
  const lastX = (values.length - 1) * stepX;
  const lastV = values[values.length - 1];
  const lastY = padY + innerH - ((lastV - min) / range) * innerH;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-label={ariaLabel}
      role="img"
    >
      {areaPath && <path d={areaPath} fill={fill} opacity={0.2} />}
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={2} fill={stroke} />
    </svg>
  );
}
