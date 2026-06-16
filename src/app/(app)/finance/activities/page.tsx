import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ActivitiesFilters } from "./_components/ActivitiesFilters";
import { FilterPanel } from "@/components/FilterPanel";
import { ActivityStatus } from "@/components/ActivityStatus";
import { RestoreJobButton } from "../../dispatch/_components/RestoreJobButton";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

// Single human-readable label per activity kind. Keys come from JobType
// + a "VISIT" suffix for PatrolVisit's two kinds.
const KIND_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  VPI: "VPI",
  ADHOC: "Ad-hoc",
  STATIC_GUARDING_SHIFT: "Static-guarding shift",
  DOG_HANDLER_SHIFT: "Dog-handler shift",
  VISIT_PATROL: "Patrol visit",
  VISIT_VPI: "VPI visit",
};

const VISIT_KIND_OPTIONS = ["PATROL", "VPI"] as const;

const JOB_TYPES = [
  "ALARM_RESPONSE",
  "PATROL",
  "LOCK",
  "UNLOCK",
  "KEY_COLLECTION",
  "KEY_DROPOFF",
  "SURVEY",
  "VPI",
  "ADHOC",
] as const;

function fmtMoney(amount: number | null, currency = "GBP"): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(d: Date): string {
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ymd(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseLocalDate(s: string | undefined, endOfDay = false): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

type GroupBy = "none" | "day" | "week" | "month";

function bucketKey(d: Date, groupBy: GroupBy): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (groupBy === "day") {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (groupBy === "month") {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  if (groupBy === "week") {
    // ISO-style: Monday-start week. Use the Monday of the row's week.
    const day = (d.getDay() + 6) % 7; // 0=Mon … 6=Sun
    const monday = new Date(d);
    monday.setDate(d.getDate() - day);
    monday.setHours(0, 0, 0, 0);
    return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  }
  return "";
}

function bucketLabel(key: string, groupBy: GroupBy): string {
  if (groupBy === "day") {
    const d = new Date(`${key}T00:00:00`);
    return d.toLocaleDateString("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  if (groupBy === "month") {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
      timeZone: "Europe/London",
      month: "long",
      year: "numeric",
    });
  }
  if (groupBy === "week") {
    const d = new Date(`${key}T00:00:00`);
    const end = new Date(d);
    end.setDate(d.getDate() + 6);
    return `${d.toLocaleDateString("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "short",
    })} – ${end.toLocaleDateString("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "short",
      year: "numeric",
    })}`;
  }
  return key;
}

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: {
    from?: string;
    to?: string;
    accountId?: string; // "customer:<id>" | "partner:<id>"
    customerId?: string;
    partnerId?: string;
    officerId?: string;
    siteId?: string;
    regionId?: string;
    kind?: string; // JobType or "VISIT_PATROL" / "VISIT_VPI"
    status?: string; // "completed" | "billed" | "paid" | "all"
    groupBy?: GroupBy;
    page?: string;
  };
}) {
  await requireAdmin();
  const isAdmin = true;

  // ── 1. Resolve params ───────────────────────────────────────────────────
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

  // Allow `accountId=customer:<uuid>` or `partner:<uuid>` shorthand from
  // the Finance click-throughs — split it into the right side.
  let customerId = searchParams.customerId ?? "";
  let partnerId = searchParams.partnerId ?? "";
  if (searchParams.accountId) {
    const [kind, id] = searchParams.accountId.split(":");
    if (kind === "customer") customerId = id ?? "";
    else if (kind === "partner") partnerId = id ?? "";
  }

  const officerId = searchParams.officerId ?? "";
  const siteId = searchParams.siteId ?? "";
  const regionId = searchParams.regionId ?? "";
  const kind = searchParams.kind ?? "";
  const status = searchParams.status ?? "completed";
  const groupBy: GroupBy =
    searchParams.groupBy === "day" ||
    searchParams.groupBy === "week" ||
    searchParams.groupBy === "month"
      ? searchParams.groupBy
      : "none";
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);

  // ── 2. Build the where clauses ──────────────────────────────────────────
  // The page is "completed activities" by default — we anchor on the
  // event's billed/completed date so finance + ops both line up. The user
  // can change to "all" / "billed" / "paid" via the status filter.

  // Field selection per status. PatrolVisit uses departedAt/billedAt/paidAt;
  // Job uses completedAt/billedAt/paidAt. We keep them parallel.
  const visitWhere: any = {};
  const jobWhere: any = {};

  // Every status mode requires the work to actually be done. Jobs are
  // auto-billed by the cron at creation time, so without these guards a
  // scheduled lock-up that no one attended yet would show up here.
  if (status === "billed") {
    visitWhere.status = "COMPLETED";
    visitWhere.billedAt = { gte: fromDate, lte: toDate };
    jobWhere.completedAt = { not: null };
    jobWhere.billedAt = { gte: fromDate, lte: toDate };
  } else if (status === "paid") {
    visitWhere.status = "COMPLETED";
    visitWhere.paidAt = { gte: fromDate, lte: toDate };
    jobWhere.completedAt = { not: null };
    jobWhere.paidAt = { gte: fromDate, lte: toDate };
  } else {
    // default: completed
    visitWhere.status = "COMPLETED";
    visitWhere.departedAt = { gte: fromDate, lte: toDate };
    jobWhere.completedAt = { gte: fromDate, lte: toDate };
  }

  if (officerId) {
    visitWhere.officerId = officerId;
    jobWhere.assignedToUserId = officerId;
  }
  if (siteId) {
    visitWhere.siteId = siteId;
    jobWhere.siteId = siteId;
  }
  if (customerId) {
    visitWhere.site = { ...(visitWhere.site ?? {}), customerId };
    jobWhere.customerId = customerId;
  }
  if (partnerId) {
    visitWhere.site = { ...(visitWhere.site ?? {}), partnerId };
    jobWhere.partnerId = partnerId;
  }
  if (regionId && Number.isFinite(Number(regionId))) {
    const rid = Number(regionId);
    visitWhere.site = { ...(visitWhere.site ?? {}), regionId: rid };
    jobWhere.site = { ...(jobWhere.site ?? {}), regionId: rid };
  }

  // Kind filter routes between the two tables. If the user picks one of
  // the JobType kinds we still load visits only if no kind set (so the
  // merged list isn't accidentally empty).
  let loadVisits = true;
  let loadJobs = true;
  if (kind === "VISIT_PATROL") {
    loadJobs = false;
    visitWhere.patrolSchedule = { kind: "PATROL" };
  } else if (kind === "VISIT_VPI") {
    loadJobs = false;
    visitWhere.patrolSchedule = { kind: "VPI" };
  } else if (kind) {
    // It's a JobType — restrict jobs and drop visits.
    loadVisits = false;
    jobWhere.type = kind;
  }

  // ── 3. Load rows + the small filter-lookup data ────────────────────────
  const [visits, jobs, regions, customers, partners, officers] =
    await Promise.all([
      loadVisits
        ? prisma.patrolVisit.findMany({
            where: visitWhere,
            include: {
              site: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  region: { select: { name: true } },
                  customer: { select: { id: true, name: true } },
                  partner: { select: { id: true, name: true } },
                },
              },
              officer: { select: { id: true, name: true } },
              patrolSchedule: { select: { kind: true } },
            },
            orderBy: [{ scheduledAt: "desc" }],
            take: 1000,
          })
        : Promise.resolve([] as any[]),
      loadJobs
        ? prisma.job.findMany({
            where: jobWhere,
            include: {
              site: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  region: { select: { name: true } },
                  // Fallbacks for stale Jobs whose customerId/partnerId
                  // hadn't been backfilled when the site got assigned.
                  customer: { select: { id: true, name: true } },
                  partner: { select: { id: true, name: true } },
                },
              },
              customer: { select: { id: true, name: true } },
              partner: { select: { id: true, name: true } },
              assignedTo: { select: { id: true, name: true } },
              handledByPartner: { select: { id: true, name: true } },
            },
            orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
            take: 1000,
          })
        : Promise.resolve([] as any[]),
      prisma.region.findMany({ orderBy: { name: "asc" } }),
      prisma.customer.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.partner.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.user.findMany({
        where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  // ── 4. Normalise into a unified row shape ──────────────────────────────
  type Row = {
    id: string;
    href: string;
    source: "JOB" | "VISIT";
    kind: string;
    kindLabel: string;
    at: Date;
    status: string;
    siteId: string | null;
    siteCode: string | null;
    siteName: string | null;
    regionName: string | null;
    customerId: string | null;
    customerName: string | null;
    partnerId: string | null;
    partnerName: string | null;
    officerId: string | null;
    officerName: string | null;
    billed: number | null;
    paid: number | null;
  };

  const rows: Row[] = [];

  for (const v of visits) {
    const vkind = v.patrolSchedule?.kind === "VPI" ? "VPI" : "PATROL";
    rows.push({
      id: `v:${v.id}`,
      href: `/patrols/visits/${v.id}`,
      source: "VISIT",
      kind: `VISIT_${vkind}`,
      kindLabel: KIND_LABEL[`VISIT_${vkind}`] ?? "Visit",
      at:
        // Chronology by schedule, not completion. Matches /activities.
        v.scheduledAt ??
        v.arrivedAt ??
        v.createdAt ??
        new Date(),
      status: v.status,
      siteId: v.site?.id ?? null,
      siteCode: v.site?.code ?? null,
      siteName: v.site?.name ?? null,
      regionName: v.site?.region?.name ?? null,
      customerId: v.site?.customer?.id ?? null,
      customerName: v.site?.customer?.name ?? null,
      partnerId: v.site?.partner?.id ?? null,
      partnerName: v.site?.partner?.name ?? null,
      officerId: v.officer?.id ?? null,
      officerName: v.officer?.name ?? null,
      billed: v.billedAmount != null ? Number(v.billedAmount) : null,
      paid: v.paidAmount != null ? Number(v.paidAmount) : null,
    });
  }

  for (const j of jobs) {
    rows.push({
      id: `j:${j.id}`,
      href: `/dispatch/${j.id}`,
      source: "JOB",
      kind: j.type,
      kindLabel: KIND_LABEL[j.type] ?? j.type,
      at:
        j.scheduledFor ??
        j.startedAt ??
        j.createdAt ??
        new Date(),
      status: j.status,
      siteId: j.site?.id ?? null,
      siteCode: j.site?.code ?? null,
      siteName: j.site?.name ?? null,
      regionName: j.site?.region?.name ?? null,
      customerId: j.customer?.id ?? j.site?.customer?.id ?? null,
      customerName: j.customer?.name ?? j.site?.customer?.name ?? null,
      partnerId: j.partner?.id ?? j.site?.partner?.id ?? null,
      partnerName: j.partner?.name ?? j.site?.partner?.name ?? null,
      officerId: j.assignedTo?.id ?? null,
      officerName: j.handledByPartner
        ? `${j.handledByPartner.name} (partner)`
        : j.assignedTo?.name ?? null,
      billed: j.billedAmount != null ? Number(j.billedAmount) : null,
      paid: j.paidAmount != null ? Number(j.paidAmount) : null,
    });
  }

  rows.sort((a, b) => b.at.getTime() - a.at.getTime());

  // ── 5. Totals (always over the unfiltered-by-page slice) ───────────────
  const totals = rows.reduce(
    (acc, r) => ({
      count: acc.count + 1,
      billed: acc.billed + (r.billed ?? 0),
      paid: acc.paid + (r.paid ?? 0),
    }),
    { count: 0, billed: 0, paid: 0 },
  );

  // ── 6. Group-by pivot OR paginated raw rows ────────────────────────────
  type Bucket = { key: string; label: string; count: number; billed: number; paid: number };
  let pivot: Bucket[] = [];
  if (groupBy !== "none") {
    const m = new Map<string, Bucket>();
    for (const r of rows) {
      const key = bucketKey(r.at, groupBy);
      const b = m.get(key) ?? {
        key,
        label: bucketLabel(key, groupBy),
        count: 0,
        billed: 0,
        paid: 0,
      };
      b.count++;
      b.billed += r.billed ?? 0;
      b.paid += r.paid ?? 0;
      m.set(key, b);
    }
    pivot = Array.from(m.values()).sort((a, b) =>
      a.key < b.key ? 1 : a.key > b.key ? -1 : 0,
    );
  }

  const totalShown = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalShown / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── 7. Export QS (preserve every filter) ───────────────────────────────
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v && k !== "page") exportParams.set(k, v);
  }

  const accountLabel = (() => {
    if (customerId) {
      return customers.find((c) => c.id === customerId)?.name ?? "Customer";
    }
    if (partnerId) {
      return partners.find((p) => p.id === partnerId)?.name ?? "Partner";
    }
    return null;
  })();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance · Activities"
        backHref="/finance"
        backLabel="Finance"
        subtitle={
          <>
            Admin-only ledger with billed + paid columns. Same filters as
            the ops Activities log on /activities.
            {accountLabel ? (
              <>
                {" "}Currently scoped to{" "}
                <span className="font-medium text-brand-navy">{accountLabel}</span>.
              </>
            ) : null}
          </>
        }
        actions={
          <Link
            href={`/api/activities/export${exportParams.toString() ? `?${exportParams}` : ""}`}
            className="btn-secondary text-sm"
          >
            Export CSV
          </Link>
        }
      />

      <FilterPanel
        clearAllHref="/finance/activities"
        activeFilters={(() => {
          const filters: { label: string; clearHref: string }[] = [];
          const drop = (k: string): string => {
            const sp = new URLSearchParams(searchParams as any);
            sp.delete(k);
            if (k === "customerId" || k === "partnerId") sp.delete("accountId");
            const qs = sp.toString();
            return qs ? `/finance/activities?${qs}` : "/finance/activities";
          };
          if (customerId) {
            filters.push({
              label: `Customer: ${customers.find((c) => c.id === customerId)?.name ?? "?"}`,
              clearHref: drop("customerId"),
            });
          }
          if (partnerId) {
            filters.push({
              label: `Partner: ${partners.find((p) => p.id === partnerId)?.name ?? "?"}`,
              clearHref: drop("partnerId"),
            });
          }
          if (officerId) {
            filters.push({
              label: `Officer: ${officers.find((o) => o.id === officerId)?.name ?? "?"}`,
              clearHref: drop("officerId"),
            });
          }
          if (regionId) {
            filters.push({
              label: `Region: ${regions.find((r) => r.id === Number(regionId))?.name ?? "?"}`,
              clearHref: drop("regionId"),
            });
          }
          if (kind) {
            filters.push({
              label: `Service: ${KIND_LABEL[kind] ?? kind}`,
              clearHref: drop("kind"),
            });
          }
          if (status && status !== "completed") {
            filters.push({
              label: `Status: ${status}`,
              clearHref: drop("status"),
            });
          }
          return filters;
        })()}
      >
        <ActivitiesFilters
          initial={{
            from: ymd(fromDate),
            to: ymd(toDate),
            customerId,
            partnerId,
            officerId,
            regionId,
            kind,
            status,
            groupBy,
          }}
          regions={regions.map((r) => ({ id: r.id, name: r.name }))}
          customers={customers}
          partners={partners}
          officers={officers}
          jobTypes={JOB_TYPES.map((t) => ({ v: t, label: KIND_LABEL[t] ?? t }))}
          visitKinds={VISIT_KIND_OPTIONS.map((k) => ({
            v: `VISIT_${k}`,
            label: KIND_LABEL[`VISIT_${k}`] ?? k,
          }))}
        />
      </FilterPanel>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Activities
          </div>
          <div className="text-2xl font-semibold text-brand-navy tabular-nums">
            {totals.count.toLocaleString("en-GB")}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Billed
          </div>
          <div className="text-2xl font-semibold text-brand-navy tabular-nums">
            {fmtMoney(totals.billed)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Paid to officers
          </div>
          <div className="text-2xl font-semibold text-brand-navy tabular-nums">
            {fmtMoney(totals.paid)}
          </div>
        </div>
      </div>

      {groupBy !== "none" ? (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">
              Grouped by {groupBy}
            </h2>
            <p className="text-xs text-slate-500">
              Counts and totals per {groupBy}.
            </p>
          </div>
          <table className="table-default">
            <thead>
              <tr>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  {groupBy === "month" ? "Month" : groupBy === "week" ? "Week" : "Day"}
                </th>
                <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Activities
                </th>
                <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Billed
                </th>
                <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Paid
                </th>
                <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                  Profit
                </th>
              </tr>
            </thead>
            <tbody>
              {pivot.map((p) => (
                <tr key={p.key}>
                  <td className="px-4 py-2 text-brand-navy font-medium">
                    {p.label}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {p.count.toLocaleString("en-GB")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmtMoney(p.billed)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {fmtMoney(p.paid)}
                  </td>
                  <td
                    className={
                      "px-4 py-2 text-right tabular-nums font-medium " +
                      (p.billed - p.paid >= 0 ? "text-brand-navy" : "text-red-600")
                    }
                  >
                    {fmtMoney(p.billed - p.paid)}
                  </td>
                </tr>
              ))}
              {pivot.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No activities for these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">
              Activity list
            </h2>
            <p className="text-xs text-slate-500">
              Sorted by completion / scheduled date, newest first.
            </p>
          </div>
          <div className="overflow-x-auto">
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
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Officer
                  </th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Billed
                  </th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Paid
                  </th>
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-slate-700 whitespace-nowrap">
                      {fmtDate(r.at)}
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      <span className="chip-slate text-[10px]">
                        {r.kindLabel}
                      </span>
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
                        <span className="text-slate-400">—</span>
                      )}
                      <div className="text-xs text-slate-500">
                        {r.regionName ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      {r.customerName ?? r.partnerName ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      {r.officerName ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {fmtMoney(r.billed)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      {fmtMoney(r.paid)}
                    </td>
                    <td className="px-4 py-2 text-slate-600 text-xs">
                      <div className="flex items-center gap-2">
                        <ActivityStatus status={r.status} />
                        {isAdmin &&
                          r.source === "JOB" &&
                          r.status === "CANCELLED" && (
                            <RestoreJobButton
                              jobId={r.id.replace(/^j:/, "")}
                              jobLabel={`${r.kindLabel} @ ${r.siteName ?? "site"}`}
                              size="small"
                            />
                          )}
                        {isAdmin && r.status !== "CANCELLED" && (
                          <Link
                            href={`${r.href}/edit`}
                            className="text-brand-blue-dark hover:text-brand-navy underline"
                          >
                            edit
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      No activities for these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {groupBy === "none" && totalPages > 1 && (
        <Pagination
          page={safePage}
          totalPages={totalPages}
          searchParams={searchParams}
        />
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  searchParams,
}: {
  page: number;
  totalPages: number;
  searchParams: Record<string, string | undefined>;
}) {
  const link = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && k !== "page") qs.set(k, v);
    }
    qs.set("page", String(p));
    return `/finance/activities?${qs.toString()}`;
  };
  return (
    <nav className="flex items-center justify-center gap-1 text-sm">
      <Link
        href={page > 1 ? link(page - 1) : "#"}
        aria-disabled={page === 1}
        className={`px-3 py-1 rounded-lg border border-slate-200 ${
          page === 1 ? "text-slate-300 pointer-events-none" : "text-slate-600 hover:bg-slate-50"
        }`}
      >
        ‹ Prev
      </Link>
      <span className="px-3 text-slate-500">
        Page {page} / {totalPages}
      </span>
      <Link
        href={page < totalPages ? link(page + 1) : "#"}
        aria-disabled={page === totalPages}
        className={`px-3 py-1 rounded-lg border border-slate-200 ${
          page === totalPages
            ? "text-slate-300 pointer-events-none"
            : "text-slate-600 hover:bg-slate-50"
        }`}
      >
        Next ›
      </Link>
    </nav>
  );
}
