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

function parseDate(s: string | undefined, end = false): Date | null {
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

export default async function PartnerFinancePage({
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

  const [partner, visitsWeDidForThem, jobsWeDidForThem, jobsTheyDidForUs] =
    await Promise.all([
      prisma.partner.findUnique({
        where: { id: params.id },
        select: { id: true, name: true, role: true },
      }),
      // WE did for THEM via patrol visits: partner-owned sites we attend.
      prisma.patrolVisit.findMany({
        where: {
          status: "COMPLETED",
          departedAt: { gte: fromDate, lte: toDate },
          site: { partnerId: params.id },
        },
        orderBy: { departedAt: "desc" },
        select: {
          id: true,
          departedAt: true,
          arrivedAt: true,
          scheduledAt: true,
          billedAmount: true,
          site: { select: { id: true, name: true, code: true } },
          patrolSchedule: { select: { kind: true } },
          officer: { select: { id: true, name: true } },
        },
      }),
      // WE did for THEM via jobs: partner is the bill-to (Job.partnerId).
      prisma.job.findMany({
        where: {
          partnerId: params.id,
          status: { not: "CANCELLED" },
          completedAt: { gte: fromDate, lte: toDate },
        },
        orderBy: { completedAt: "desc" },
        select: {
          id: true,
          type: true,
          completedAt: true,
          startedAt: true,
          billedAmount: true,
          site: { select: { id: true, name: true, code: true } },
          assignedTo: { select: { id: true, name: true } },
        },
      }),
      // THEY did for US: partner attended (Job.handledByPartnerId). The
      // billedAmount here is what we charged our end customer; the schema
      // doesn't track what we owe the partner in return yet (separate item).
      prisma.job.findMany({
        where: {
          handledByPartnerId: params.id,
          status: { not: "CANCELLED" },
          completedAt: { gte: fromDate, lte: toDate },
        },
        orderBy: { completedAt: "desc" },
        select: {
          id: true,
          type: true,
          completedAt: true,
          startedAt: true,
          billedAmount: true,
          partnerReportRef: true,
          site: { select: { id: true, name: true, code: true } },
          customer: { select: { name: true } },
          partner: { select: { name: true } },
        },
      }),
    ]);

  if (!partner) notFound();

  type WeDidRow = {
    id: string;
    href: string;
    when: Date | null;
    kindLabel: string;
    siteId: string | null;
    siteName: string | null;
    siteCode: string | null;
    officer: string | null;
    billed: number;
  };
  const weDidRows: WeDidRow[] = [];
  for (const v of visitsWeDidForThem) {
    const k = v.patrolSchedule?.kind === "VPI" ? "VPI" : "PATROL";
    weDidRows.push({
      id: `v:${v.id}`,
      href: `/patrols/visits/${v.id}`,
      when: v.departedAt ?? v.arrivedAt ?? v.scheduledAt,
      kindLabel: KIND_LABEL[k] ?? "Visit",
      siteId: v.site?.id ?? null,
      siteName: v.site?.name ?? null,
      siteCode: v.site?.code ?? null,
      officer: v.officer?.name ?? null,
      billed: Number(v.billedAmount ?? 0),
    });
  }
  for (const j of jobsWeDidForThem) {
    weDidRows.push({
      id: `j:${j.id}`,
      href: `/dispatch/${j.id}`,
      when: j.completedAt ?? j.startedAt,
      kindLabel: KIND_LABEL[j.type] ?? j.type,
      siteId: j.site?.id ?? null,
      siteName: j.site?.name ?? null,
      siteCode: j.site?.code ?? null,
      officer: j.assignedTo?.name ?? null,
      billed: Number(j.billedAmount ?? 0),
    });
  }
  weDidRows.sort(
    (a, b) => (b.when?.getTime() ?? 0) - (a.when?.getTime() ?? 0),
  );

  type TheyDidRow = {
    id: string;
    href: string;
    when: Date | null;
    kindLabel: string;
    siteId: string | null;
    siteName: string | null;
    siteCode: string | null;
    customer: string | null;
    billed: number;
    partnerRef: string | null;
  };
  const theyDidRows: TheyDidRow[] = jobsTheyDidForUs.map((j) => ({
    id: j.id,
    href: `/dispatch/${j.id}`,
    when: j.completedAt ?? j.startedAt,
    kindLabel: KIND_LABEL[j.type] ?? j.type,
    siteId: j.site?.id ?? null,
    siteName: j.site?.name ?? null,
    siteCode: j.site?.code ?? null,
    customer: j.customer?.name ?? j.partner?.name ?? null,
    billed: Number(j.billedAmount ?? 0),
    partnerRef: j.partnerReportRef,
  }));

  const weDidTotal = weDidRows.reduce((acc, r) => acc + r.billed, 0);
  const theyDidTotal = theyDidRows.reduce((acc, r) => acc + r.billed, 0);

  return (
    <div className="section">
      <PageHeader
        backHref="/finance"
        backLabel="Finance"
        title={partner.name}
        subtitle={
          <>
            Partner · role:{" "}
            <span className="font-medium text-brand-navy">
              {partner.role.toLowerCase()}
            </span>{" "}
            · {fmtDate(fromDate)} → {fmtDate(toDate)}
          </>
        }
      />

      <RangeBar from={fromDate} to={toDate} basePath={`/finance/partners/${partner.id}`} />

      <div className="grid sm:grid-cols-2 gap-4">
        <SplitCard
          title="We did for them"
          subtitle="They're our customer — we attended their sites or jobs they sent us."
          rows={weDidRows.length}
          total={weDidTotal}
          totalLabel="Billed to them"
        />
        <SplitCard
          title="They did for us"
          subtitle="They're our subcontractor — they attended on our behalf."
          rows={theyDidRows.length}
          total={theyDidTotal}
          totalLabel="Billed to our end customer"
          subdued
        />
      </div>

      <section>
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">
              We did for them — line items
            </h2>
            <p className="text-xs text-slate-500">
              Visits + jobs where {partner.name} is the bill-to. Cancelled
              excluded.
            </p>
          </div>
          {weDidRows.length === 0 ? (
            <EmptyState
              variant="inline"
              title={`No activities for ${partner.name} as customer in this range`}
              blurb="Sites and jobs they pay us for will appear here."
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
                    Our officer
                  </th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Billed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {weDidRows.map((r) => (
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
                          className="font-medium text-brand-navy hover:text-brand-mint-dark"
                        >
                          {r.siteCode ? `${r.siteCode} · ` : ""}
                          {r.siteName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {r.officer ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmtMoney(r.billed)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
                  <td className="px-4 py-2 text-slate-600" colSpan={4}>
                    Total
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmtMoney(weDidTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">
              They did for us — line items
            </h2>
            <p className="text-xs text-slate-500">
              Jobs {partner.name} attended on our behalf. "Billed to our end
              customer" is what we invoiced the underlying customer; the
              schema doesn't yet capture what we owe {partner.name} per job.
            </p>
          </div>
          {theyDidRows.length === 0 ? (
            <EmptyState
              variant="inline"
              title="No subcontract jobs in this range"
              blurb="Jobs they handled on our behalf will appear here."
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
                    Our customer
                  </th>
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Their ref
                  </th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Billed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {theyDidRows.map((r) => (
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
                          className="font-medium text-brand-navy hover:text-brand-mint-dark"
                        >
                          {r.siteCode ? `${r.siteCode} · ` : ""}
                          {r.siteName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {r.customer ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-500 text-xs font-mono">
                      {r.partnerRef ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmtMoney(r.billed)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
                  <td className="px-4 py-2 text-slate-600" colSpan={5}>
                    Total
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmtMoney(theyDidTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function SplitCard({
  title,
  subtitle,
  rows,
  total,
  totalLabel,
  subdued = false,
}: {
  title: string;
  subtitle: string;
  rows: number;
  total: number;
  totalLabel: string;
  subdued?: boolean;
}) {
  return (
    <div
      className={
        "card p-4 " +
        (subdued ? "bg-slate-50/60" : "bg-brand-mint-light/30")
      }
    >
      <h2 className="font-semibold text-brand-navy">{title}</h2>
      <p className="text-xs text-slate-500 mb-3">{subtitle}</p>
      <div className="flex items-baseline gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            Activities
          </div>
          <div className="text-2xl font-semibold text-brand-navy tabular-nums">
            {rows.toLocaleString("en-GB")}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            {totalLabel}
          </div>
          <div className="text-2xl font-semibold text-brand-navy tabular-nums">
            {fmtMoney(total)}
          </div>
        </div>
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
