import Link from "next/link";
import type { ReactNode } from "react";

/** Row hover used by every clickable activity row. */
export const ACTIVITY_ROW_HOVER = "hover:bg-brand-blue-50/40 transition-colors";

/**
 * An activity's own link inside a ClickableRow — the one keyboard and screen
 * reader users reach, and the one a click anywhere on the row follows.
 */
export function ActivityLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      data-row-link
      className={`rounded font-medium text-brand-navy hover:text-brand-blue-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${className ?? ""}`}
    >
      {children}
    </Link>
  );
}
