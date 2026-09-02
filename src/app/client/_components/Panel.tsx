import type { ComponentType, ReactNode } from "react";

type Accent = "blue" | "emerald" | "indigo" | "amber";

const ACCENT: Record<Accent, string> = {
  blue: "from-blue-400 to-blue-600",
  emerald: "from-emerald-400 to-emerald-600",
  indigo: "from-indigo-400 to-indigo-600",
  amber: "from-amber-400 to-amber-500",
};

/**
 * A section card for the client portal — white surface, soft border + shadow,
 * and a gradient icon chip in the header so each section reads with colour.
 */
export function Panel({
  title,
  hint,
  icon: Icon,
  accent = "blue",
  action,
  flush = false,
  children,
}: {
  title: string;
  hint?: string;
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  accent?: Accent;
  action?: ReactNode;
  /** No body padding — for tables that draw their own edges. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span
              className={
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm " +
                ACCENT[accent]
              }
            >
              <Icon size={14} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate font-semibold leading-tight text-brand-navy">
              {title}
            </h2>
            {hint && <p className="truncate text-xs text-slate-500">{hint}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}
