import Link from "next/link";
import { ClickableRow } from "@/components/ClickableRow";
import { formatHours, formatMoney, formatNumber } from "@/lib/numbers";
import { groupLabel, type ActivityGroup, type GroupTotal } from "@/lib/clientPortal";
import { GroupDot } from "./groupColors";

/** How much of a type of work there was: hours for guarding, a count otherwise. */
export function groupAmount(g: Pick<GroupTotal, "group" | "count" | "hours">): string {
  return g.group === "guarding" ? formatHours(g.hours) : formatNumber(g.count);
}

/**
 * Activity by type for a period — each type with its colour, how much there
 * was (hours for static guarding) and what it was charged. A row opens the
 * activity log filtered to that type.
 */
export function TypeTable({
  groups,
  hrefFor,
  emptyLabel = "No activity in this period.",
}: {
  groups: GroupTotal[];
  hrefFor: (g: ActivityGroup) => string;
  emptyLabel?: string;
}) {
  const rows = groups.filter((g) => g.count > 0);
  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-slate-500">{emptyLabel}</p>;
  }
  const charged = rows.reduce((n, g) => n + g.charged, 0);
  return (
    <div className="table-scroll">
      <table className="table-default">
        <thead>
          <tr>
            <th>Type</th>
            <th className="col-num">Activities</th>
            <th className="col-num">Charged</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <ClickableRow key={g.group} href={hrefFor(g.group)} className="hover:bg-slate-50">
              <td>
                <Link
                  href={hrefFor(g.group)}
                  data-row-link
                  className="inline-flex items-center gap-2 font-medium text-brand-navy hover:text-brand-blue-dark"
                >
                  <GroupDot group={g.group} />
                  {groupLabel(g.group)}
                </Link>
              </td>
              <td className="col-num tabular-nums text-slate-700">{groupAmount(g)}</td>
              <td className="col-num tabular-nums text-slate-700">{formatMoney(g.charged)}</td>
            </ClickableRow>
          ))}
          <tr className="font-medium">
            <td className="text-brand-navy">Total</td>
            <td />
            <td className="col-num tabular-nums text-brand-navy">{formatMoney(charged)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
