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
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
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
 * Partner activity log — Phase 2.
 *
 * Merges three sources:
 *   1. Jobs we sent the partner (handledByPartnerId = me, NOT
 *      recordedByPartner) — read-only.
 *   2. Jobs the partner recorded themselves (recordedByPartner = true)
 *      — clickable through to /edit.
 *   3. Shifts the partner recorded themselves.
 *
 * Source is shown as a chip so the partner can tell which rows they
 * own vs which we sent them.
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

  const [jobs, shifts] = await Promise.all([
    prisma.job.findMany({
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
        recordedByPartner: true,
        partnerChargeToUsAmount: true,
        site: {
          select: { id: true, name: true, code: true, postcodeFormatted: true },
        },
        customer: { select: { name: true } },
        handledByPartnerOfficer: { select: { id: true, name: true } },
      },
      take: 500,
    }),
    prisma.shift.findMany({
      where: {
        handledByPartnerId: me.partnerId,
        // Includes BOTH partner-recorded shifts and shifts our staff
        // logged with handledByPartnerId = this partner. Recorded-by-
        // partner vs 1NW-logged is differentiated by the chip in the
        // row.
        OR: [
          { actualStartedAt: { gte: fromDate, lte: toDate } },
          { scheduledStartsAt: { gte: fromDate, lte: toDate } },
        ],
      },
      orderBy: [{ actualStartedAt: "desc" }, { scheduledStartsAt: "desc" }],
      select: {
        id: true,
        type: true,
        status: true,
        actualStartedAt: true,
        actualEndedAt: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        recordedByPartner: true,
        partnerChargeToUsAmount: true,
        site: {
          select: { id: true, name: true, code: true, postcodeFormatted: true, customer: { select: { name: true } } },
        },
        handledByPartnerOfficer: { select: { id: true, name: true } },
      },
      take: 500,
    }),
  ]);

  type Row = {
    encodedId: string;
    when: Date | null;
    kindLabel: string;
    source:
      | "we-sent"
      | "we-logged-shift"
      | "you-logged-job"
      | "you-logged-shift";
    siteName: string | null;
    siteCode: string | null;
    customerName: string | null;
    officerName: string | null;
    chargeToUs: number | null;
  };

  const rows: Row[] = [];
  for (const j of jobs) {
    rows.push({
      encodedId: j.id,
      when: j.scheduledFor ?? j.completedAt,
      kindLabel: KIND_LABEL[j.type] ?? j.type.replace(/_/g, " "),
      source: j.recordedByPartner ? "you-logged-job" : "we-sent",
      siteName: j.site?.name ?? null,
      siteCode: j.site?.code ?? null,
      customerName: j.customer?.name ?? null,
      officerName: j.handledByPartnerOfficer?.name ?? null,
      chargeToUs: j.partnerChargeToUsAmount
        ? Number(j.partnerChargeToUsAmount)
        : null,
    });
  }
  for (const s of shifts) {
    rows.push({
      encodedId: `shift-${s.id}`,
      when: s.actualStartedAt ?? s.scheduledStartsAt,
      kindLabel: KIND_LABEL[s.type] ?? s.type,
      source: s.recordedByPartner ? "you-logged-shift" : "we-logged-shift",
      siteName: s.site?.name ?? null,
      siteCode: s.site?.code ?? null,
      customerName: s.site?.customer?.name ?? null,
      officerName: s.handledByPartnerOfficer?.name ?? null,
      chargeToUs: s.partnerChargeToUsAmount
        ? Number(s.partnerChargeToUsAmount)
        : null,
    });
  }
  rows.sort((a, b) => (b.when?.getTime() ?? 0) - (a.when?.getTime() ?? 0));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activities"
        subtitle={`Everything you've handled for 1NW, ${fmtDate(fromDate)} → ${fmtDate(toDate)}.`}
        actions={
          <div className="flex items-end gap-2 flex-wrap">
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
            <Link href="/partner/activities/new" className="btn-primary text-sm">
              + Record activity
            </Link>
          </div>
        }
      />

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">No activities in this range.</p>
            <p className="empty-blurb">
              Record one you've done with the button above, or widen
              the date filter.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-default">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Site</th>
                  <th>Customer</th>
                  <th>Your officer</th>
                  <th>Source</th>
                  <th className="text-right">Charge</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.encodedId}>
                    <td className="whitespace-nowrap tabular-nums">
                      {fmtDate(r.when)}
                    </td>
                    <td>
                      <span className="chip-slate text-[10px]">
                        {r.kindLabel}
                      </span>
                    </td>
                    <td>
                      <div className="font-medium text-brand-navy">
                        {r.siteCode ? `${r.siteCode} · ` : ""}
                        {r.siteName ?? "—"}
                      </div>
                    </td>
                    <td className="text-slate-600">
                      {r.customerName ?? "—"}
                    </td>
                    <td className="text-slate-600">
                      {r.officerName ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td>
                      {r.source === "we-sent" ||
                      r.source === "we-logged-shift" ? (
                        <span className="chip-amber text-[10px]">
                          1NW logged
                        </span>
                      ) : (
                        <span className="chip-mint text-[10px]">
                          You logged
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {r.chargeToUs != null
                        ? `£${r.chargeToUs.toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="text-right">
                      {r.source === "we-logged-shift" ||
                      r.source === "we-sent" ? (
                        <Link
                          href={`/partner/activities/${r.encodedId}/assign`}
                          className="text-xs text-brand-blue-dark hover:text-brand-navy underline"
                        >
                          assign officer
                        </Link>
                      ) : (
                        <Link
                          href={`/partner/activities/${r.encodedId}/edit`}
                          className="text-xs text-brand-blue-dark hover:text-brand-navy underline"
                        >
                          edit
                        </Link>
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
