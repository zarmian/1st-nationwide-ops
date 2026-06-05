/**
 * Coloured status dot. Use `pulse` for "live" states (in progress, on
 * duty, syncing) so the eye lands on them in a dense table.
 *
 * Tones map to the semantic palette in tailwind.config.ts:
 *   live   → blue (default, neutral live)
 *   active → success green
 *   warn   → amber
 *   danger → red
 *   muted  → slate (idle/inactive)
 */
export function StatusDot({
  tone = "live",
  pulse = false,
  label,
}: {
  tone?: "live" | "active" | "warn" | "danger" | "muted";
  pulse?: boolean;
  label?: string;
}) {
  const color =
    tone === "active"
      ? "bg-success"
      : tone === "warn"
        ? "bg-warning"
        : tone === "danger"
          ? "bg-danger"
          : tone === "muted"
            ? "bg-slate-300"
            : "bg-brand-blue";
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      className="inline-flex items-center gap-1.5"
    >
      <span className="relative inline-flex h-2 w-2">
        {pulse && (
          <span
            aria-hidden
            className={`absolute inset-0 rounded-full ${color} opacity-60 animate-pulse-dot`}
          />
        )}
        <span
          aria-hidden
          className={`relative inline-flex h-2 w-2 rounded-full ${color}`}
        />
      </span>
      {label && <span className="text-xs text-slate-600">{label}</span>}
    </span>
  );
}
