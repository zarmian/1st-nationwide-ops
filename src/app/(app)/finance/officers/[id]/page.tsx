import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key dropoff",
  ADHOC: "Ad-hoc",
};

function fmtMoney(amount: unknown, currency = "GBP"): string {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function parseDate(s: string | undefined, end: boolean = false): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    end ? 23 : 0,
    end ? 59 : 0,
    end ? 59 : 0,
    end ? 999 : 0,
  );
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function OfficerFinancePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();

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
  const fromDate = parseDate(searchParams.from) ?? monthStart;
  const toDate = parseDate(searchParams.to, true) ?? monthEnd;

  const [officer, visits, jobs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, email: true, role: true },
    }),
    // Approved/completed work only: no cancelled, no upcoming. Visits
    // hit status=COMPLETED; cron auto-completes once the officer submits.
    prisma.patrolVisit.findMany({
      where: {
        officerId: params.id,
        status: "COMPLETED",
        departedAt: { gte: fromDate, lte: toDate },
      },
      orderBy: { departedAt: "desc" },
      select: {
        id: true,
        scheduledAt: true,
        departedAt: true,
        arrivedAt: true,
        billedAmount: true,
        paidAmount: true,
        site: { select: { id: true, name: true, code: true } },
        patrolSchedule: { select: { kind: true } },
      },
    }),
    prisma.job.findMany({
      where: {
        assignedToUserId: params.id,
        status: { in: ["APPROVED", "CLOSED", "SENT_TO_CLIENT", "SUBMITTED"] },
        completedAt: { gte: fromDate, lte: toDate },
      },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        type: true,
        scheduledFor: true,
        startedAt: true,
        completedAt: true,
        status: true,
        billedAmount: true,
        paidAmount: true,
        site: { select: { id: true, name: true, code: true } },
        customer: { select: { name: true } },
        partner: { select: { name: true } },
      },
    }),
  ]);

  if (!officer) notFound();

  type Row = {
    id: string;
    href: string;
    when: Date | null;
    kindLabel: string;
    siteName: string | null;
    siteCode: string | null;
    siteId: string | null;
    accountName: string | null;
    paid: number;
  };

  const rows: Row[] = [];
  for (const v of visits) {
    const kind = v.patrolSchedule?.kind === "VPI" ? "VPI" : "PATROL";
    rows.push({
      id: `v:${v.id}`,
      href: `/patrols/visits/${v.id}`,
      when: v.departedAt ?? v.arrivedAt ?? v.scheduledAt,
      kindLabel: KIND_LABEL[kind] ?? "Visit",
      siteName: v.site?.name ?? null,
      siteCode: v.site?.code ?? null,
      siteId: v.site?.id ?? null,
      accountName: null,
      paid: Number(v.paidAmount ?? 0),
    });
  }
  for (const j of jobs) {
    rows.push({
      id: `j:${j.id}`,
      href: `/dispatch/${j.id}`,
      when: j.completedAt ?? j.startedAt ?? j.scheduledFor,
      kindLabel: KIND_LABEL[j.type] ?? j.type,
      siteName: j.site?.name ?? null,
      siteCode: j.site?.code ?? null,
      siteId: j.site?.id ?? null,
      accountName: j.customer?.name ?? j.partner?.name ?? null,
      paid: Number(j.paidAmount ?? 0),
    });
  }
  rows.sort((a, b) => (b.when?.getTime() ?? 0) - (a.when?.getTime() ?? 0));

  const totalPaid = rows.reduce((acc, r) => acc + r.paid, 0);

  return (
    <div className="section">
      <PageHeader
        backHref="/finance"
        backLabel="Finance"
        title={officer.name}
        subtitle={
          <>Officer · {officer.email} · {fmtDate(fromDate)} → {fmtDate(toDate)}</>
        }
      />

      <RangeBar from={fromDate} to={toDate} basePath={`/finance/officers/${officer.id}`} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Activities
          </div>
          <div className="text-2xl font-semibold text-brand-navy tabular-nums">
            {rows.length.toLocaleString("en-GB")}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Pay in range
          </div>
          <div className="text-2xl font-semibold text-brand-navy tabular-nums">
            {fmtMoney(totalPaid)}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">Activities</h2>
          <p className="text-xs text-slate-500">
            Approved + completed only. Cancelled and upcoming are excluded.
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            variant="inline"
            title="No activities in this range"
            blurb="Try widening the date filter or jump to This month."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  When
                </th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Service
                </th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Site
                </th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Account
                </th>
                <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Pay
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-slate-700 whitespace-nowrap">
                    {fmtDate(r.when)}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={r.href}
                      className="chip-slate text-[10px] hover:bg-slate-200"
                    >
                      {r.kindLabel}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {r.siteId ? (
                      <Link
                        href={`/sites/${r.siteId}`}
                        className="font-medium text-brand-navy hover:text-brand-blue-dark"
                      >
                        {r.siteCode ? `${r.siteCode} · ` : ""}
                        {r.siteName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {r.accountName ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmtMoney(r.paid)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
                <td className="px-4 py-2 text-slate-600" colSpan={4}>
                  Total
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmtMoney(totalPaid)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RangeBar({
  from,
  to,
  basePath,
}: {
  from: Date;
  to: Date;
  basePath: string;
}) {
  const now = new Date();
  const thisMonth = {
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
  const lastMonth = {
    from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
    to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
  };
  return (
    <form className="card p-3 flex flex-wrap items-end gap-3" method="GET">
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
          From
        </label>
        <input
          type="date"
          name="from"
          defaultValue={ymd(from)}
          className="input"
        />
      </div>
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
          To
        </label>
        <input
          type="date"
          name="to"
          defaultValue={ymd(to)}
          className="input"
        />
      </div>
      <button type="submit" className="btn-secondary text-sm">
        Apply
      </button>
      <div className="ml-auto flex gap-2">
        <Link
          href={`${basePath}?from=${ymd(thisMonth.from)}&to=${ymd(thisMonth.to)}`}
          className="btn-ghost text-xs"
        >
          This month
        </Link>
        <Link
          href={`${basePath}?from=${ymd(lastMonth.from)}&to=${ymd(lastMonth.to)}`}
          className="btn-ghost text-xs"
        >
          Last month
        </Link>
      </div>
    </form>
  );
}
