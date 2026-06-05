import Link from "next/link";

export type Crumb = {
  /** Link target. Omit for the current page. */
  href?: string;
  label: string;
};

/**
 * Standardised breadcrumb. Replaces the ad-hoc `← Section` patterns
 * scattered across pages. Always include the last (current page) crumb
 * without an `href` so it renders as text.
 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="hover:text-brand-blue-dark"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={isLast ? "text-slate-700 font-medium" : "text-slate-500"}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <span className="text-slate-400" aria-hidden>
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
