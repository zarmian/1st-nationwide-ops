import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  ADHOC: "Ad-hoc",
  STATIC_GUARDING_SHIFT: "Static guarding",
  DOG_HANDLER_SHIFT: "Dog handler",
};

function parseLocalDate(s: string | undefined, end = false): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    end ? 23 : 0,
    end ? 59 : 0,
    end ? 59 : 0,
    end ? 999 : 0,
  );
}

function ymd(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Partner-portal activity log — Phase 1 read-only.
 *
 * Shows every Job we sent this partner where they're the handler
 * (handledByPartnerId = me). No filter UI yet beyond the date range
 * (matches what we shipped on the staff-side per-account finance
 * pages first cut). Service / site / region filters come in Phase 2
 * alongside the partner-creates-activity flow.
 */
export default async function PartnerActivitiesPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const me = await requirePartner();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  const fromDate = parseLocalDate(searchParams.from) ?? monthStart;
  const toDate = parseLocalDate(searchParams.to, true) ?? monthEnd;

  const jobs = await prisma.job.findMany({
    where: {
      handledByPartnerId: me.partnerId,
      status: { not: "CANCELLED" },
      OR: [
        { completedAt: { gte: fromDate, lte: toDate } },
        { scheduledFor: { gte: fromDate, lte: toDate } },
      ],
    },
    orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      type: true,
      status: true,
      scheduledFor: true,
      completedAt: true,
      partnerReportRef: true,
      externalResponder: true,
      site: {
        select: { id: true, name: true, code: true, postcodeFormatted: true },
      },
      customer: { select: { name: true } },
    },
    take: 500,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activities"
        subtitle={`Jobs 1NW sent you, ${fmtDate(fromDate)} → ${fmtDate(toDate)}.`}
        actions={
          <form className="flex items-end gap-2" method="GET">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
                From
              </label>
              <input
                type="date"
                name="from"
                defaultValue={ymd(fromDate)}
                className="input text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
                To
              </label>
              <input
                type="date"
                name="to"
                defaultValue={ymd(toDate)}
                className="input text-sm"
              />
            </div>
            <button type="submit" className="btn-secondary text-sm">
              Apply
            </button>
          </form>
        }
      />

      <div className="card overflow-hidden">
        {jobs.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">No activities in this range.</p>
            <p className="empty-blurb">
              Widen the date filter or pick a different month.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Scheduled</th>
                  <th>Type</th>
                  <th>Site</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Your ref</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="whitespace-nowrap tabular-nums">
                      {fmtDate(j.scheduledFor ?? j.completedAt)}
                    </td>
                    <td>
                      <span className="chip-slate text-[10px]">
                        {KIND_LABEL[j.type] ?? j.type.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td>
                      <div className="font-medium text-brand-navy">
                        {j.site?.code ? `${j.site.code} · ` : ""}
                        {j.site?.name ?? "—"}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {j.site?.postcodeFormatted}
                      </div>
                    </td>
                    <td className="text-slate-600">
                      {j.customer?.name ?? "—"}
                    </td>
                    <td className="text-xs text-slate-600">
                      {j.status.toLowerCase().replace(/_/g, " ")}
                    </td>
                    <td className="text-xs text-slate-500 font-mono">
                      {j.partnerReportRef ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
