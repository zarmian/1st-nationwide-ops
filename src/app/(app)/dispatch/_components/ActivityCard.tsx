import Link from "next/link";
import type { ReactNode } from "react";
import { StatusDot } from "@/components/StatusDot";

/**
 * Compact activity row used inside the dispatch workspace columns
 * (UPCOMING / COMPLETED). Tighter than the DataTable cell — designed
 * for a 240–320px wide column — but still surfaces the data dispatch
 * scans for: type, site, when, who, status, plus inline actions when
 * the activity is still live.
 *
 * Layout (per card):
 *   ┌─ Type chip · Priority chip ───────── Status chip ┐
 *   │ Site name (link to detail)                       │
 *   │ When · Officer                                   │
 *   └─ [edit] [close] [cancel] (live work only) ──────┘
 */
export type ActivityCardProps = {
  href: string;
  typeLabel: string;
  /** "Today 14:30" / "Yesterday 22:00" / "Mon 16 Jun 09:00" */
  whenLabel: string | null;
  siteId: string | null;
  siteName: string | null;
  officerName: string | null;
  /** Status chip text (e.g. "in progress", "completed"). */
  statusLabel?: string;
  /** StatusDot tone driving the dot color + pulse. */
  statusTone?: "muted" | "live" | "warn" | "active" | "danger";
  statusPulse?: boolean;
  priority?: "HIGH" | "MEDIUM" | "LOW" | null;
  /** Whether the row is overdue (drives a red "When" treatment). */
  overdue?: boolean;
  /** Optional inline actions (Edit / Close / Cancel links). */
  actions?: ReactNode;
};

export function ActivityCard({
  href,
  typeLabel,
  whenLabel,
  siteId,
  siteName,
  officerName,
  statusLabel,
  statusTone = "muted",
  statusPulse = false,
  priority,
  overdue = false,
  actions,
}: ActivityCardProps) {
  return (
    <li className="px-3 py-2.5 hover:bg-brand-blue-50/40 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="chip-slate text-[10px] uppercase tracking-wider truncate max-w-[150px]">
            {typeLabel}
          </span>
          {priority === "HIGH" && (
            <span className="chip-red text-[10px]">HIGH</span>
          )}
        </div>
        {statusLabel && (
          <span className="inline-flex items-center gap-1 shrink-0">
            <StatusDot tone={statusTone} pulse={statusPulse} />
            <span className="text-[10px] text-slate-600 whitespace-nowrap">
              {statusLabel}
            </span>
          </span>
        )}
      </div>

      <Link
        href={href}
        className="block text-sm font-medium text-brand-navy hover:text-brand-blue-dark truncate"
      >
        {siteName ?? "—"}
      </Link>

      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1 flex-wrap">
        {whenLabel && (
          <span
            className={
              "tabular-nums " +
              (overdue ? "text-red-600 font-medium" : "")
            }
          >
            {whenLabel}
          </span>
        )}
        {whenLabel && officerName && <span className="text-slate-300">·</span>}
        {officerName && <span className="truncate">{officerName}</span>}
      </div>

      {actions && (
        <div className="mt-1.5 flex items-center gap-2 text-xs">{actions}</div>
      )}
    </li>
  );
}
