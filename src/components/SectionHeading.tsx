/**
 * A quiet group heading that breaks a long page into scannable sections — an
 * eyebrow-weight title, an optional one-line hint, and a hairline that runs to
 * the edge. Shared across the finance pages so every screen has the same
 * rhythm as the dashboard.
 *
 * Server component (no client state) — safe to render from anywhere.
 */
export function SectionHeading({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-3 pt-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 shrink-0">
        {title}
      </h2>
      {hint && (
        <p className="min-w-0 text-xs text-slate-400 truncate hidden sm:block">
          {hint}
        </p>
      )}
      <div className="flex-1 border-t border-slate-200/70" />
    </div>
  );
}
