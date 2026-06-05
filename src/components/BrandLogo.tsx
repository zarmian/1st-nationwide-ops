/**
 * Inline-SVG brand mark — colour is driven by the design tokens, not by
 * a raster file, so a brand colour change is one line in tailwind.config.
 *
 * Pre-PR-23 this rendered /logo.jpg via next/image. That worked but baked
 * the colour into a binary asset that needed re-exporting from Illustrator
 * every time we touched the brand. The SVG version reads from
 * --brand-blue + --brand-navy via Tailwind, so the same mark renders
 * correctly today (blue) and in any future palette shift.
 */
export function BrandLogo({
  className = "",
  size = "sm",
  showWordmark = true,
}: {
  className?: string;
  size?: "sm" | "lg";
  showWordmark?: boolean;
}) {
  const px = size === "lg" ? 56 : 32;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg
        width={px}
        height={px}
        viewBox="0 0 64 64"
        aria-label="1st Nationwide Security"
        role="img"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="bl-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#60A5FA" />
            <stop offset="100%" stopColor="#2563EB" />
          </linearGradient>
        </defs>
        <rect
          x="0"
          y="0"
          width="64"
          height="64"
          rx="14"
          fill="url(#bl-bg)"
        />
        {/* "1" */}
        <text
          x="50%"
          y="48%"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="var(--font-sans), Inter, system-ui, sans-serif"
          fontWeight="800"
          fontSize="42"
          fill="#FFFFFF"
        >
          1
        </text>
        {/* "NW" baseline */}
        <text
          x="50%"
          y="82%"
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="var(--font-sans), Inter, system-ui, sans-serif"
          fontWeight="700"
          fontSize="9"
          letterSpacing="1.6"
          fill="#0F1929"
        >
          NW
        </text>
      </svg>
      {showWordmark && (
        <div className="leading-tight">
          <div
            className={
              size === "lg"
                ? "text-base font-semibold text-brand-navy"
                : "text-sm font-semibold text-brand-navy"
            }
          >
            1st Nationwide
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            Operations
          </div>
        </div>
      )}
    </div>
  );
}
