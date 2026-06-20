import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { FilterPanel } from "@/components/FilterPanel";
import { FinanceAccountFilters } from "../../_components/FinanceAccountFilters";

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
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
};

const FILTER_JOB_TYPES = [
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "VPI",
  "KEY_COLLECTION",
  "KEY_DROPOFF",
  "ADHOC",
] as const;
// Visit-kind filter keys mirror /activities — "VISIT_PATROL" / "VISIT_VPI"
// route the where-clause to PatrolVisit-only, with the matching schedule kind.
const FILTER_VISIT_KINDS = ["PATROL", "VPI"] as const;
// Shift-kind keys ride the same `kind` URL param. "SHIFT_<type>" narrows
// to shifts-only with that ShiftType, mirroring the visit-kind handling.
const FILTER_SHIFT_TYPES = ["STATIC_GUARDING", "DOG_HANDLER"] as const;

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
  searchParams: {
    from?: string;
    to?: string;
    kind?: string;
    siteId?: string;
    regionId?: string;
  };
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
  const kind = (searchParams.kind ?? "").trim();
  const siteId = (searchParams.siteId ?? "").trim();
  const regionIdRaw = (searchParams.regionId ?? "").trim();
  const regionId =
    regionIdRaw && Number.isFinite(Number(regionIdRaw))
      ? Number(regionIdRaw)
      : null;

  // Translate the unified "kind" param into the right filter slot for
  // each data source. VISIT_PATROL / VISIT_VPI → visits-only with that
  // schedule kind; SHIFT_STATIC_GUARDING / SHIFT_DOG_HANDLER → shifts-only
  // with that ShiftType; a bare job-type → jobs-only with type=X;
  // empty → all three.
  const visitKindFilter =
    kind === "VISIT_PATROL"
      ? ("PATROL" as const)
      : kind === "VISIT_VPI"
        ? ("VPI" as const)
        : null;
  const shiftTypeFilter = kind.startsWith("SHIFT_")
    ? (kind.slice("SHIFT_".length) as "STATIC_GUARDING" | "DOG_HANDLER")
    : null;
  const jobTypeFilter =
    kind && !kind.startsWith("VISIT_") && !kind.startsWith("SHIFT_")
      ? kind
      : null;
  const loadVisits = !jobTypeFilter && !shiftTypeFilter;
  const loadJobs = !visitKindFilter && !shiftTypeFilter;
  const loadShifts = !visitKindFilter && !jobTypeFilter;

  const siteWhereExtras: { id?: string; regionId?: number } = {};
  if (siteId) siteWhereExtras.id = siteId;
  if (regionId != null) siteWhereExtras.regionId = regionId;
  const hasSiteFilter = Object.keys(siteWhereExtras).length > 0;

  const visitWhere: any = {
    officerId: params.id,
    status: "COMPLETED",
    departedAt: { gte: fromDate, lte: toDate },
    ...(visitKindFilter
      ? { patrolSchedule: { kind: visitKindFilter } }
      : {}),
    ...(hasSiteFilter ? { site: { is: siteWhereExtras } } : {}),
  };
  const jobWhere: any = {
    assignedToUserId: params.id,
    status: { in: ["APPROVED", "CLOSED", "SENT_TO_CLIENT", "SUBMITTED"] },
    completedAt: { gte: fromDate, lte: toDate },
    ...(jobTypeFilter ? { type: jobTypeFilter as any } : {}),
    ...(hasSiteFilter ? { site: { is: siteWhereExtras } } : {}),
  };
  const shiftWhere: any = {
    officerId: params.id,
    status: "COMPLETED",
    actualEndedAt: { gte: fromDate, lte: toDate },
    ...(shiftTypeFilter ? { type: shiftTypeFilter } : {}),
    ...(hasSiteFilter ? { site: { is: siteWhereExtras } } : {}),
  };

  const [officer, visits, jobs, shifts, sites, regions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, email: true, role: true },
    }),
    loadVisits
      ? prisma.patrolVisit.findMany({
          where: visitWhere,
          orderBy: { scheduledAt: "desc" },
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
        })
      : Promise.resolve([] as any[]),
    loadJobs
      ? prisma.job.findMany({
          where: jobWhere,
          orderBy: { scheduledFor: "desc" },
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
        })
      : Promise.resolve([] as any[]),
    loadShifts
      ? prisma.shift.findMany({
          where: shiftWhere,
          orderBy: { scheduledStartsAt: "desc" },
          select: {
            id: true,
            type: true,
            scheduledStartsAt: true,
            actualStartedAt: true,
            actualEndedAt: true,
            status: true,
            billedAmount: true,
            paidAmount: true,
            site: {
              select: {
                id: true,
                name: true,
                code: true,
                customer: { select: { name: true } },
                partner: { select: { name: true } },
              },
            },
          },
        })
      : Promise.resolve([] as any[]),
    prisma.site.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    prisma.region.findMany({ orderBy: { name: "asc" } }),
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
      when: v.scheduledAt ?? v.arrivedAt ?? v.departedAt,
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
      when: j.scheduledFor ?? j.startedAt ?? j.completedAt,
      kindLabel: KIND_LABEL[j.type] ?? j.type,
      siteName: j.site?.name ?? null,
      siteCode: j.site?.code ?? null,
      siteId: j.site?.id ?? null,
      accountName: j.customer?.name ?? j.partner?.name ?? null,
      paid: Number(j.paidAmount ?? 0),
    });
  }
  for (const sh of shifts) {
    rows.push({
      id: `s:${sh.id}`,
      href: `/shifts/${sh.id}`,
      when: sh.scheduledStartsAt ?? sh.actualStartedAt ?? sh.actualEndedAt,
      kindLabel: KIND_LABEL[sh.type] ?? sh.type,
      siteName: sh.site?.name ?? null,
      siteCode: sh.site?.code ?? null,
      siteId: sh.site?.id ?? null,
      accountName:
        sh.site?.customer?.name ?? sh.site?.partner?.name ?? null,
      paid: Number(sh.paidAmount ?? 0),
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

      <FilterPanel
        clearAllHref={`/finance/officers/${officer.id}`}
        activeFilters={(() => {
          const filters: { label: string; clearHref: string }[] = [];
          const drop = (k: string): string => {
            const sp = new URLSearchParams(searchParams as Record<string, string>);
            sp.delete(k);
            const qs = sp.toString();
            return `/finance/officers/${officer.id}${qs ? `?${qs}` : ""}`;
          };
          if (kind) {
            const label =
              kind === "VISIT_PATROL"
                ? "Patrol visits"
                : kind === "VISIT_VPI"
                  ? "VPI visits"
                  : kind.startsWith("SHIFT_")
                    ? `${KIND_LABEL[kind.slice("SHIFT_".length)] ?? kind} shifts`
                    : (KIND_LABEL[kind] ?? kind);
            filters.push({ label: `Service: ${label}`, clearHref: drop("kind") });
          }
          if (siteId) {
            const s = sites.find((x) => x.id === siteId);
            filters.push({
              label: `Site: ${s ? (s.code ? `${s.code} · ${s.name}` : s.name) : "?"}`,
              clearHref: drop("siteId"),
            });
          }
          if (regionId != null) {
            const r = regions.find((x) => x.id === regionId);
            filters.push({
              label: `Region: ${r?.name ?? "?"}`,
              clearHref: drop("regionId"),
            });
          }
          return filters;
        })()}
      >
        <FinanceAccountFilters
          basePath={`/finance/officers/${officer.id}`}
          initial={{
            from: ymd(fromDate),
            to: ymd(toDate),
            kind,
            siteId,
            regionId: regionIdRaw,
          }}
          jobTypes={FILTER_JOB_TYPES.map((t) => ({
            v: t,
            label: KIND_LABEL[t] ?? t,
          }))}
          visitKinds={FILTER_VISIT_KINDS.map((k) => ({
            v: `VISIT_${k}`,
            label: k === "VPI" ? "VPI visit" : "Patrol visit",
          }))}
          shiftTypes={FILTER_SHIFT_TYPES.map((s) => ({
            v: `SHIFT_${s}`,
            label: KIND_LABEL[s] ?? s,
          }))}
          sites={sites.map((s) => ({
            id: s.id,
            name: s.name,
            code: s.code,
          }))}
          regions={regions.map((r) => ({ id: r.id, name: r.name }))}
        />
      </FilterPanel>

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
          <table className="table-default">
            <thead>
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
            <tbody>
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
