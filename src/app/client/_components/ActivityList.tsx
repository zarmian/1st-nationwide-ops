import Link from "next/link";
import { formatDateTime } from "@/lib/dates";
import type { ClientActivity } from "@/lib/clientPortal";
import { StatusChip } from "./StatusChip";

/** Read-only activity table (no officer identity), reused across the portal. */
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
          </tr>
        </thead>
        <tbody>
          {activities.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap text-slate-700">
                {formatDateTime(a.at)}
              </td>
              {showSite && (
                <td>
                  <Link
                    href={`/client/sites/${a.siteId}`}
                    className="font-medium text-brand-navy hover:text-brand-blue-dark"
                  >
                    {a.siteCode ? `${a.siteCode} · ` : ""}
                    {a.siteName}
                  </Link>
                </td>
              )}
              <td className="text-slate-700">{a.kind}</td>
              <td>
                <StatusChip status={a.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
