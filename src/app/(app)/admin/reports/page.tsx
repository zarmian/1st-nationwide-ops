import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

// The scheduled date of the activity the submission is for (else when it was
// submitted, for orphan submissions).
function scheduledWhen(sub: {
  submittedAt: Date;
  job?: { scheduledFor: Date | null } | null;
  patrolVisit?: { scheduledAt: Date } | null;
  shift?: { scheduledStartsAt: Date } | null;
}): Date {
  return (
    sub.job?.scheduledFor ??
    sub.patrolVisit?.scheduledAt ??
    sub.shift?.scheduledStartsAt ??
    sub.submittedAt
  );
}

function fmtUk(d: Date): string {
  // Show submitted timestamps in UK wall-clock, not raw UTC. Was
  // .toISOString().slice(0,16).replace("T"," ") which displayed
  // 17:00 for an 18:00 BST submission.
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminReportsPage() {
  const queue = await prisma.reportReview.findMany({
    where: { status: { in: ["PENDING", "REJECTED"] } },
    include: {
      submission: {
        include: {
          site: { select: { name: true, postcodeFormatted: true } },
          submittedBy: { select: { name: true } },
          job: {
            include: {
              customer: { select: { name: true } },
              partner: { select: { name: true } },
            },
          },
          patrolVisit: { select: { scheduledAt: true } },
          shift: { select: { scheduledStartsAt: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Review queue"
        subtitle={
          <>
            {queue.length} submission{queue.length === 1 ? "" : "s"} awaiting
            review before client send
          </>
        }
      />

      {/* Desktop: full table. Mobile: stacked card list — the table's
          7 columns plus a Review button can't fit on a phone, the
          rightmost button just clips off the screen. */}
      <div className="hidden md:block card overflow-x-auto">
        <table className="table-default">
          <thead>
            <tr>
              <th>Scheduled</th>
              <th>Form</th>
              <th>Site</th>
              <th>Customer</th>
              <th>Officer</th>
              <th>Status</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((r) => (
              <tr key={r.id}>
                <td className="text-slate-500 whitespace-nowrap">
                  {fmtUk(scheduledWhen(r.submission))}
                </td>
                <td>
                  <span className="chip-slate">
                    {r.submission.form.replace(/_/g, " ")}
                  </span>
                </td>
                <td>
                  <div className="font-medium text-brand-navy">
                    {r.submission.site?.name ?? "—"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {r.submission.site?.postcodeFormatted}
                  </div>
                </td>
                <td>
                  {r.submission.job?.customer?.name ??
                    r.submission.job?.partner?.name ??
                    "—"}
                </td>
                <td>
                  {r.submission.submittedBy?.name ??
                    r.submission.officerNameRaw ??
                    "—"}
                </td>
                <td>
                  {r.status === "PENDING" ? (
                    <span className="chip-amber">Pending</span>
                  ) : (
                    <span className="chip-red">Rejected</span>
                  )}
                </td>
                <td className="text-right whitespace-nowrap">
                  <Link
                    href={`/admin/reports/${r.id}`}
                    className="btn-secondary text-xs"
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))}
            {queue.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={7}>
                  Nothing pending. You're all caught up.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ul className="md:hidden space-y-2">
        {queue.map((r) => (
          <li key={r.id} className="card p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-brand-navy truncate">
                  {r.submission.site?.name ?? "—"}
                </div>
                <div className="text-xs text-slate-500">
                  {fmtUk(scheduledWhen(r.submission))} ·{" "}
                  {r.submission.site?.postcodeFormatted}
                </div>
              </div>
              {r.status === "PENDING" ? (
                <span className="chip-amber">Pending</span>
              ) : (
                <span className="chip-red">Rejected</span>
              )}
            </div>
            <div className="text-xs text-slate-600 flex flex-wrap gap-x-2">
              <span className="chip-slate">
                {r.submission.form.replace(/_/g, " ")}
              </span>
              <span>
                {r.submission.job?.customer?.name ??
                  r.submission.job?.partner?.name ??
                  "—"}{" "}
                ·{" "}
                {r.submission.submittedBy?.name ??
                  r.submission.officerNameRaw ??
                  "—"}
              </span>
            </div>
            <Link
              href={`/admin/reports/${r.id}`}
              className="btn-secondary text-xs w-full"
            >
              Review
            </Link>
          </li>
        ))}
        {queue.length === 0 && (
          <li className="empty-state">
            <p className="empty-title">Nothing pending</p>
            <p className="empty-blurb">You're all caught up.</p>
          </li>
        )}
      </ul>
    </div>
  );
}
