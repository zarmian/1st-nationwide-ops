import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { FilterPanel } from "@/components/FilterPanel";
import { FinanceAccountFilters } from "../../_components/FinanceAccountFilters";
import {
  jobScheduledRange,
  visitScheduledRange,
  shiftScheduledRange,
} from "@/lib/activityWhen";

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
const FILTER_VISIT_KINDS = ["PATROL", "VPI"] as const;
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

  // Filter routing (same as officer page): visit-kind → visits-only,
  // shift-type → shifts-only, bare job-type → jobs-only, empty → all three.
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

  // Site filter is composed with the partner-ownership where on
  // visits/jobs; region narrows via site.regionId on either branch.
  const visitSiteWhere: any = { partnerId: params.id };
  if (siteId) visitSiteWhere.id = siteId;
  if (regionId != null) visitSiteWhere.regionId = regionId;

  const jobSiteWhere: any = {};
  if (siteId) jobSiteWhere.id = siteId;
  if (regionId != null) jobSiteWhere.regionId = regionId;
  const jobHasSiteFilter = Object.keys(jobSiteWhere).length > 0;

  const [
    partner,
    visitsWeDidForThem,
    jobsWeDidForThem,
    jobsTheyDidForUs,
    shiftsWeDidForThem,
    shiftsTheyDidForUs,
    sites,
    regions,
  ] = await Promise.all([
    prisma.partner.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, role: true },
    }),
    // WE did for THEM via patrol visits: partner-owned sites we attend.
    loadVisits
      ? prisma.patrolVisit.findMany({
          where: {
            status: "COMPLETED",
            ...visitScheduledRange(fromDate, toDate),
            site: { is: visitSiteWhere },
            ...(visitKindFilter
              ? { patrolSchedule: { kind: visitKindFilter } }
              : {}),
          },
          orderBy: { scheduledAt: "desc" },
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
        })
      : Promise.resolve([] as any[]),
    // WE did for THEM via jobs: partner is the bill-to (Job.partnerId).
    loadJobs
      ? prisma.job.findMany({
          where: {
            partnerId: params.id,
            status: { not: "CANCELLED" },
            completedAt: { not: null },
            ...jobScheduledRange(fromDate, toDate),
            ...(jobTypeFilter ? { type: jobTypeFilter as any } : {}),
            ...(jobHasSiteFilter ? { site: { is: jobSiteWhere } } : {}),
          },
          orderBy: { scheduledFor: "desc" },
          select: {
            id: true,
            type: true,
            scheduledFor: true,
            startedAt: true,
            completedAt: true,
            billedAmount: true,
            site: { select: { id: true, name: true, code: true } },
            assignedTo: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([] as any[]),
    // THEY did for US: partner attended (Job.handledByPartnerId).
    // `billedAmount` is what we charged our end customer.
    // `partnerChargeToUsAmount` (Phase 2) is what the partner invoiced
    // us — surfaced separately in the table so we can reconcile the two.
    loadJobs
      ? prisma.job.findMany({
          where: {
            handledByPartnerId: params.id,
            status: { not: "CANCELLED" },
            completedAt: { not: null },
            ...jobScheduledRange(fromDate, toDate),
            ...(jobTypeFilter ? { type: jobTypeFilter as any } : {}),
            ...(jobHasSiteFilter ? { site: { is: jobSiteWhere } } : {}),
          },
          orderBy: { scheduledFor: "desc" },
          select: {
            id: true,
            type: true,
            scheduledFor: true,
            startedAt: true,
            completedAt: true,
            billedAmount: true,
            partnerChargeToUsAmount: true,
            partnerReportRef: true,
            recordedByPartner: true,
            site: { select: { id: true, name: true, code: true } },
            customer: { select: { name: true } },
            partner: { select: { name: true } },
          },
        })
      : Promise.resolve([] as any[]),
    // Shifts WE did for THEM — site owned by this partner.
    loadShifts
      ? prisma.shift.findMany({
          where: {
            status: "COMPLETED",
            ...shiftScheduledRange(fromDate, toDate),
            site: { is: visitSiteWhere },
            ...(shiftTypeFilter ? { type: shiftTypeFilter } : {}),
          },
          orderBy: { scheduledStartsAt: "desc" },
          select: {
            id: true,
            type: true,
            scheduledStartsAt: true,
            actualStartedAt: true,
            actualEndedAt: true,
            billedAmount: true,
            site: { select: { id: true, name: true, code: true } },
            officer: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([] as any[]),
    // Shifts THEY did for US — partner attended on our behalf.
    loadShifts
      ? prisma.shift.findMany({
          where: {
            handledByPartnerId: params.id,
            status: "COMPLETED",
            ...shiftScheduledRange(fromDate, toDate),
            ...(shiftTypeFilter ? { type: shiftTypeFilter } : {}),
            ...(jobHasSiteFilter ? { site: { is: jobSiteWhere } } : {}),
          },
          orderBy: { scheduledStartsAt: "desc" },
          select: {
            id: true,
            type: true,
            scheduledStartsAt: true,
            actualStartedAt: true,
            actualEndedAt: true,
            billedAmount: true,
            partnerChargeToUsAmount: true,
            recordedByPartner: true,
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
      when: v.scheduledAt ?? v.arrivedAt ?? v.departedAt,
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
      when: j.scheduledFor ?? j.startedAt ?? j.completedAt,
      kindLabel: KIND_LABEL[j.type] ?? j.type,
      siteId: j.site?.id ?? null,
      siteName: j.site?.name ?? null,
      siteCode: j.site?.code ?? null,
      officer: j.assignedTo?.name ?? null,
      billed: Number(j.billedAmount ?? 0),
    });
  }
  for (const sh of shiftsWeDidForThem) {
    weDidRows.push({
      id: `s:${sh.id}`,
      href: `/shifts/${sh.id}`,
      when: sh.scheduledStartsAt ?? sh.actualStartedAt ?? sh.actualEndedAt,
      kindLabel: KIND_LABEL[sh.type] ?? sh.type,
      siteId: sh.site?.id ?? null,
      siteName: sh.site?.name ?? null,
      siteCode: sh.site?.code ?? null,
      officer: sh.officer?.name ?? null,
      billed: Number(sh.billedAmount ?? 0),
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
    /// What the partner invoiced us for this row (their portal value),
    /// null if they haven't logged it themselves yet.
    partnerCharge: number | null;
    partnerRef: string | null;
    recordedByPartner: boolean;
  };
  const theyDidRows: TheyDidRow[] = [
    ...jobsTheyDidForUs.map((j) => ({
      id: `j:${j.id}`,
      href: `/dispatch/${j.id}`,
      when: j.scheduledFor ?? j.startedAt ?? j.completedAt,
      kindLabel: KIND_LABEL[j.type] ?? j.type,
      siteId: j.site?.id ?? null,
      siteName: j.site?.name ?? null,
      siteCode: j.site?.code ?? null,
      customer: j.customer?.name ?? j.partner?.name ?? null,
      billed: Number(j.billedAmount ?? 0),
      partnerCharge:
        j.partnerChargeToUsAmount != null
          ? Number(j.partnerChargeToUsAmount)
          : null,
      partnerRef: j.partnerReportRef,
      recordedByPartner: j.recordedByPartner,
    })),
    ...shiftsTheyDidForUs.map((sh) => ({
      id: `s:${sh.id}`,
      href: `/shifts/${sh.id}`,
      when: sh.scheduledStartsAt ?? sh.actualStartedAt ?? sh.actualEndedAt,
      kindLabel: KIND_LABEL[sh.type] ?? sh.type,
      siteId: sh.site?.id ?? null,
      siteName: sh.site?.name ?? null,
      siteCode: sh.site?.code ?? null,
      customer:
        sh.site?.customer?.name ?? sh.site?.partner?.name ?? null,
      billed: Number(sh.billedAmount ?? 0),
      partnerCharge:
        sh.partnerChargeToUsAmount != null
          ? Number(sh.partnerChargeToUsAmount)
          : null,
      partnerRef: null as string | null,
      recordedByPartner: sh.recordedByPartner,
    })),
  ];
  theyDidRows.sort(
    (a, b) => (b.when?.getTime() ?? 0) - (a.when?.getTime() ?? 0),
  );

  const weDidTotal = weDidRows.reduce((acc, r) => acc + r.billed, 0);
  const theyDidTotal = theyDidRows.reduce((acc, r) => acc + r.billed, 0);
  const theyDidPartnerChargeTotal = theyDidRows.reduce(
    (acc, r) => acc + (r.partnerCharge ?? 0),
    0,
  );

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

      <FilterPanel
        clearAllHref={`/finance/partners/${partner.id}`}
        activeFilters={(() => {
          const filters: { label: string; clearHref: string }[] = [];
          const drop = (k: string): string => {
            const sp = new URLSearchParams(searchParams as Record<string, string>);
            sp.delete(k);
            const qs = sp.toString();
            return `/finance/partners/${partner.id}${qs ? `?${qs}` : ""}`;
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
          basePath={`/finance/partners/${partner.id}`}
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
            <div className="table-scroll">
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
                    Our officer
                  </th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Billed
                  </th>
                </tr>
              </thead>
              <tbody>
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
            </div>
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
            <div className="table-scroll">
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
                    Our customer
                  </th>
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Their ref
                  </th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Billed to customer
                  </th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    They invoiced us
                  </th>
                </tr>
              </thead>
              <tbody>
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
                      {r.customer ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-500 text-xs font-mono">
                      {r.partnerRef ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmtMoney(r.billed)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.partnerCharge != null
                        ? fmtMoney(r.partnerCharge)
                        : "—"}
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
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmtMoney(theyDidPartnerChargeTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
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
        (subdued ? "bg-slate-50/60" : "bg-brand-blue-light/30")
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
