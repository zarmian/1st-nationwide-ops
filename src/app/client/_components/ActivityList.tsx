import Link from "next/link";
import { FileText } from "lucide-react";
import { ClickableRow } from "@/components/ClickableRow";
import { formatDateTime } from "@/lib/dates";
import { formatHours, formatMoney } from "@/lib/numbers";
import type { ClientActivity } from "@/lib/clientPortal";
import { StatusChip } from "./StatusChip";
import { GroupDot } from "./groupColors";

/** Read-only activity table (no officer identity), reused across the portal.
 *  A row opens the activity's own page, with its report. */
export function ActivityList({
  activities,
  showSite = true,
  emptyLabel = "No activity in this period.",
}: {
  activities: ClientActivity[];
  showSite?: boolean;
  emptyLabel?: string;
}) {
  if (activities.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-slate-500">{emptyLabel}</p>
    );
  }
  return (
    <div className="table-scroll">
      <table className="table-default">
        <thead>
          <tr>
            <th>When</th>
            {showSite && <th>Site</th>}
            <th>Activity</th>
            <th>Status</th>
            <th className="text-right">Charge</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((a) => (
            <ClickableRow key={a.id} href={a.href} className="hover:bg-slate-50">
              <td className="whitespace-nowrap text-slate-700">
                <Link
                  href={a.href}
                  data-row-link
                  className="font-medium text-brand-navy hover:text-brand-blue-dark"
                >
                  {formatDateTime(a.at)}
                </Link>
              </td>
              {showSite && (
                <td className="text-slate-700">
                  {a.siteCode ? `${a.siteCode} · ` : ""}
                  {a.siteName}
                </td>
              )}
              <td className="text-slate-700">
                <span className="inline-flex items-center gap-1.5">
                  <GroupDot group={a.group} />
                  {a.kind}
                  {a.group === "guarding" && a.hours != null && (
                    <span className="tabular-nums text-slate-500">· {formatHours(a.hours)}</span>
                  )}
                  {a.hasReport && (
                    <FileText
                      size={14}
                      className="text-brand-blue-dark"
                      aria-label="Has a report"
                    />
                  )}
                </span>
              </td>
              <td>
                <StatusChip status={a.status} />
              </td>
              <td className="whitespace-nowrap text-right tabular-nums text-slate-700">
                {a.charge == null ? "—" : formatMoney(a.charge)}
              </td>
            </ClickableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
