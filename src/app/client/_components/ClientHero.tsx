import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Gradient hero banner for the client portal — deep navy→blue with a soft
 * radial highlight and a glow, giving each page a premium, branded header.
 */
export function ClientHero({
  eyebrow,
  title,
  subtitle,
  backHref,
  backLabel,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  backHref?: string;
  backLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-navy via-brand-navy-700 to-brand-blue-dark px-5 py-6 sm:px-7 sm:py-7 text-white shadow-lg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(720px_240px_at_85%_-60%,rgba(96,165,250,0.45),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -left-12 h-48 w-48 rounded-full bg-brand-blue-500/20 blur-3xl"
      />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {backHref && (
            <Link
              href={backHref}
              className="inline-flex items-center gap-1 text-xs text-white/70 hover:text-white transition-colors"
            >
              ← {backLabel ?? "Back"}
            </Link>
          )}
          {eyebrow && (
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-blue-200">
              {eyebrow}
            </div>
          )}
          <h1 className="mt-1 text-2xl sm:text-[26px] font-semibold tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-white/70">
              {subtitle}
            </p>
          )}
        </div>
        {children && <div className="shrink-0">{children}</div>}
      </div>
    </div>
  );
}
