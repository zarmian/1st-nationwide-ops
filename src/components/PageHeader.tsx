import Link from "next/link";

/**
 * Locks the page header layout used across (app)/* pages:
 *   ← Back link (optional)
 *   <h1>title</h1>      [right-aligned actions]
 *   subtitle / blurb
 *
 * Before this component, every page hand-rolled the same flexbox +
 * typography combo. They were 95% consistent, but the leftover 5% —
 * back link colour, h1 size, subtitle muted shade, action spacing —
 * varied subtly. Use this everywhere instead.
 */
export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel = "Back",
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center text-sm text-slate-500 hover:text-brand-blue-dark transition-colors"
          >
            ← {backLabel}
          </Link>
        )}
        <h1 className="text-2xl font-semibold text-brand-navy tracking-tight text-balance mt-1">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
      )}
    </header>
  );
}
