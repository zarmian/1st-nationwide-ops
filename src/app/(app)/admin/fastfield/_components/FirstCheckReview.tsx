import Link from "next/link";
import { formatDateTime } from "@/lib/dates";
import { loadFirstCheckReview } from "@/lib/fastfieldFirstCheck";
import { FirstCheckActions } from "./ReportActions";

/**
 * Admin → FastField: the reports the robot's first shift check (24 Nov) moved
 * or took off, which may have been put on their shift by hand. Each can go
 * back where it was, as a hand link, or be left. Renders nothing once there
 * are none left to look at.
 */
export async function FirstCheckReview() {
  const { items, total, shiftGone } = await loadFirstCheckReview();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="ff-first-check" className="card overflow-hidden border-amber-300">
      <div className="px-4 py-3 border-b border-slate-100 bg-amber-50">
        <h2 id="ff-first-check" className="font-semibold text-brand-navy">
          Checked by the robot on 24 Nov — some may have been linked by hand ({total})
        </h2>
        <p className="text-xs text-slate-600">
          On 24 Nov the robot checked the reports on shifts against each shift&rsquo;s time for the
          first time and moved or took off those that didn&rsquo;t fit — some may have been put there
          by hand on purpose, and the records can&rsquo;t show which, so put each one back on the
          shift it was on, or leave it.
        </p>
      </div>
      <ul className="divide-y divide-slate-100">
        {items.map((r) => (
          <li key={r.reportId} className="px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-2 text-sm">
            <div className="min-w-0 w-full sm:w-auto sm:flex-1 space-y-0.5">
              <div className="font-medium text-slate-900 break-words">
                {r.site}
                <span className="font-normal text-slate-500"> · report {r.reportTime}</span>
              </div>
              <div className="text-xs text-slate-500 break-words">
                {r.form}
                {r.officer ? ` · ${r.officer}` : ""}
              </div>
              <div className="text-xs text-slate-700">
                Was on the shift{" "}
                <Link href={`/shifts/${r.original.id}`} className="text-brand-blue-dark hover:underline">
                  {r.original.hours}
                </Link>{" "}
                at {r.original.site}
                {r.original.outside ? ` (the report ${r.original.outside})` : " (the report fits it)"}.
                The robot {r.robot.what === "moved" ? "moved it to another shift" : "took it off"}{" "}
                {formatDateTime(r.robot.at)}.
              </div>
              <div className="text-xs text-slate-700">Now: {r.now}</div>
              <Link
                href={`/admin/fastfield/${r.reportId}`}
                className="inline-block text-xs text-brand-blue-dark hover:underline"
                aria-label={`Open the report from ${r.reportTime} at ${r.site}`}
              >
                Open the report →
              </Link>
            </div>
            <FirstCheckActions
              reportId={r.reportId}
              reportTime={r.reportTime}
              shiftId={r.original.id}
              shiftHours={r.original.hours}
              mode={r.mode}
              fromHours={r.from?.hours ?? null}
            />
          </li>
        ))}
      </ul>
      {(total > items.length || shiftGone > 0) && (
        <div className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100 space-y-0.5">
          {total > items.length && (
            <p>
              Showing the newest {items.length} of {total}.
            </p>
          )}
          {shiftGone > 0 && (
            <p>
              {shiftGone} more {shiftGone === 1 ? "isn't" : "aren't"} listed: the shift{" "}
              {shiftGone === 1 ? "it was" : "they were"} on has since been deleted.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
