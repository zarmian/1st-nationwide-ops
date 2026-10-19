import Link from "next/link";
import { Suspense } from "react";
import { BackLink, PageTitleTracker } from "@/components/BackLink";

/**
 * Locks the page header layout used across (app)/* pages:
 *   ← Back link (optional)
 *   <h1>title</h1>      [right-aligned actions]
 *   subtitle / blurb
 *
 * The back link returns to the page you actually came from (BackLink);
 * `backHref` / `backLabel` are the usual parent, used when you arrived
 * directly. The title is remembered so the next page's back link can name
 * this one.
 *
 * Before this component, every page hand-rolled the same flexbox +
 * typography combo. They were 95% consistent, but the leftover 5% —
 * back link colour, h1 size, subtitle muted shade, action spacing —
 * varied subtly. Use this everywhere instead.
 */
const BACK_LINK_CLASS =
  "inline-flex items-center rounded text-sm text-slate-500 hover:text-brand-blue-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue";

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
        <Suspense fallback={null}>
          <PageTitleTracker title={title} />
        </Suspense>
        {backHref && (
          <Suspense
            fallback={
              <Link href={backHref} className={`max-w-full ${BACK_LINK_CLASS}`}>
                <span aria-hidden="true">←&nbsp;</span>
                <span className="truncate">{backLabel}</span>
              </Link>
            }
          >
            <BackLink fallbackHref={backHref} fallbackLabel={backLabel} className={BACK_LINK_CLASS} />
          </Suspense>
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
