import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { ActivitiesFilters } from "./_components/ActivitiesFilters";
import { FilterPanel } from "@/components/FilterPanel";
import { ActivityStatus } from "@/components/ActivityStatus";
import { RestoreJobButton } from "../dispatch/_components/RestoreJobButton";
import { CloseActivityButton } from "../dispatch/_components/CloseActivityButton";
import { CancelJobButton } from "../dispatch/_components/CancelJobButton";
import { ReassignOfficer } from "../dispatch/_components/ReassignOfficer";
import { EditIconLink } from "../dispatch/_components/EditIconLink";

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
    accountId?: string; // "customer:<id>" | "partner:<id>" — finance click-through
    customerId?: string; // comma-separated ids
    partnerId?: string; // comma-separated ids
    officerId?: string; // comma-separated ids
    siteId?: string; // comma-separated ids
    regionId?: string; // comma-separated numeric ids
    kind?: string; // comma-separated JobType / VISIT_PATROL / SHIFT_*
    status?: string; // comma-separated user-friendly status keys (see STATUS_GROUPS)
    groupBy?: GroupBy;
    page?: string;
  };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const isAdmin = role === "ADMIN";
  // Dispatcher gets the inline Edit link too — they can correct
  // scheduling / officer / notes; Restore stays admin-only because
  // it re-snapshots billing.
  const isStaff = isAdmin || role === "DISPATCHER";

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

  // Comma-separated lists — every facet picker is multi-select.
  const splitCsv = (v: string | undefined): string[] =>
    v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];

  // Allow `accountId=customer:<uuid>` or `partner:<uuid>` shorthand from
  // the Finance click-throughs — split it into the right side.
  let customerIds = splitCsv(searchParams.customerId);
  let partnerIds = splitCsv(searchParams.partnerId);
  if (searchParams.accountId) {
    const [aKind, id] = searchParams.accountId.split(":");
    if (aKind === "customer" && id) customerIds = [id];
    else if (aKind === "partner" && id) partnerIds = [id];
  }

  const officerIds = splitCsv(searchParams.officerId);
  const siteIds = splitCsv(searchParams.siteId);
  const regionIdsRaw = splitCsv(searchParams.regionId);
  const regionIds = regionIdsRaw
    .map((r) => Number(r))
    .filter((n) => Number.isFinite(n));
  const kinds = splitCsv(searchParams.kind);
  // No status param → no filter (show all). Empty array = "show all".
  const statuses = splitCsv(searchParams.status);
  const groupBy: GroupBy =
    searchParams.groupBy === "day" ||
    searchParams.groupBy === "week" ||
    searchParams.groupBy === "month"
      ? searchParams.groupBy
      : "none";
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);

  // ── 2. Build the where clauses ──────────────────────────────────────────
  // Date range anchors on the SCHEDULED timestamp for each source so a
  // shift scheduled for 22:00 → 06:00 falls into the day it started,
  // and a visit scheduled for Tue but completed Wed shows up on Tue.
  // Rows with no scheduled date fall back to createdAt so ad-hoc jobs
  // logged from /submit don't disappear.
  const dateInRange = { gte: fromDate, lte: toDate };
  // PatrolVisit.scheduledAt is a required column, so every visit has one —
  // anchor the window directly on it. (Filtering it by null is an invalid
  // Prisma filter and was crashing the page.)
  const visitWhere: any = { scheduledAt: dateInRange };
  // Job.scheduledFor is nullable, so keep the createdAt fallback for ad-hoc
  // jobs that were logged without a scheduled time.
  const jobWhere: any = {
    OR: [
      { scheduledFor: dateInRange },
      { AND: [{ scheduledFor: null }, { createdAt: dateInRange }] },
    ],
  };

  if (officerIds.length) {
    visitWhere.officerId = { in: officerIds };
    jobWhere.assignedToUserId = { in: officerIds };
  }
  if (siteIds.length) {
    visitWhere.siteId = { in: siteIds };
    jobWhere.siteId = { in: siteIds };
  }
  if (customerIds.length) {
    visitWhere.site = { ...(visitWhere.site ?? {}), customerId: { in: customerIds } };
    jobWhere.customerId = { in: customerIds };
  }
  if (partnerIds.length) {
    visitWhere.site = { ...(visitWhere.site ?? {}), partnerId: { in: partnerIds } };
    jobWhere.partnerId = { in: partnerIds };
  }
  if (regionIds.length) {
    visitWhere.site = { ...(visitWhere.site ?? {}), regionId: { in: regionIds } };
    jobWhere.site = { ...(jobWhere.site ?? {}), regionId: { in: regionIds } };
  }

  // ── Kind filter routes loading per source ──────────────────────────────
  // Each kind value belongs to exactly one source. With multi-select
  // we look at the SET of selected kinds to decide which tables to
  // hit — e.g. picking only `VISIT_PATROL` drops jobs + shifts.
  const kindSet = new Set(kinds);
  const wantVisitPatrol = kindSet.has("VISIT_PATROL");
  const wantVisitVpi = kindSet.has("VISIT_VPI");
  const wantShiftStatic = kindSet.has("STATIC_GUARDING_SHIFT");
  const wantShiftDog = kindSet.has("DOG_HANDLER_SHIFT");
  const jobKinds = [...kindSet].filter(
    (k) =>
      k !== "VISIT_PATROL" &&
      k !== "VISIT_VPI" &&
      k !== "STATIC_GUARDING_SHIFT" &&
      k !== "DOG_HANDLER_SHIFT",
  );

  let loadVisits = true;
  let loadJobs = true;
  let loadShifts = true;
  let loadOrphanSubmissions = true;
  if (kinds.length > 0) {
    const wantsAnyVisit = wantVisitPatrol || wantVisitVpi;
    const wantsAnyShift = wantShiftStatic || wantShiftDog;
    const wantsAnyJob = jobKinds.length > 0;
    loadVisits = wantsAnyVisit;
    loadJobs = wantsAnyJob;
    loadShifts = wantsAnyShift;
    // Orphan submissions are job-shaped (no shift / visit ref). They
    // surface only when the kind filter includes a JobType the orphan
    // matches.
    loadOrphanSubmissions = wantsAnyJob;
    if (wantsAnyVisit) {
      const visitKindFilter: string[] = [];
      if (wantVisitPatrol) visitKindFilter.push("PATROL");
      if (wantVisitVpi) visitKindFilter.push("VPI");
      visitWhere.patrolSchedule = { kind: { in: visitKindFilter } };
    }
    if (wantsAnyJob) {
      jobWhere.type = { in: jobKinds };
    }
  }

  // Shift where clause — anchor on the scheduled start. Cancelled
  // shifts use status=MISSED/ABANDONED (no CANCELLED in the enum) so
  // no cancel-status branch here.
  const shiftWhere: any = {
    scheduledStartsAt: dateInRange,
  };
  if (officerIds.length) shiftWhere.officerId = { in: officerIds };
  if (siteIds.length) shiftWhere.siteId = { in: siteIds };
  if (customerIds.length) shiftWhere.site = { ...(shiftWhere.site ?? {}), customerId: { in: customerIds } };
  if (partnerIds.length) shiftWhere.site = { ...(shiftWhere.site ?? {}), partnerId: { in: partnerIds } };
  if (regionIds.length) shiftWhere.site = { ...(shiftWhere.site ?? {}), regionId: { in: regionIds } };
  if (wantShiftStatic && !wantShiftDog) shiftWhere.type = "STATIC_GUARDING";
  else if (wantShiftDog && !wantShiftStatic) shiftWhere.type = "DOG_HANDLER";

  // Orphan-submission where — anchored on submittedAt, the only
  // timestamp on rows without a Job / Visit link.
  const submissionWhere: any = {
    jobId: null,
    patrolVisitId: null,
    // Exclude shift hourly check-ins — they belong to their shift row, not
    // the orphan list. (They have shiftId set but no job/visit link.)
    shiftId: null,
    submittedAt: dateInRange,
  };
  if (officerIds.length) submissionWhere.submittedByUserId = { in: officerIds };
  if (siteIds.length) submissionWhere.siteId = { in: siteIds };
  if (customerIds.length) submissionWhere.site = { ...(submissionWhere.site ?? {}), customerId: { in: customerIds } };
  if (partnerIds.length) submissionWhere.site = { ...(submissionWhere.site ?? {}), partnerId: { in: partnerIds } };
  if (regionIds.length) submissionWhere.site = { ...(submissionWhere.site ?? {}), regionId: { in: regionIds } };
  // The /submit form writes `form` = JobType. Same kind filter applies.
  if (kinds.length > 0 && jobKinds.length > 0) {
    submissionWhere.form = { in: jobKinds };
  }

  // ── 3. Load rows + the small filter-lookup data ────────────────────────
  // Run serially in a single $transaction (one pooled connection) rather
  // than Promise.all — concurrent fan-out exhausts the Supabase pgbouncer
  // pool on Vercel (the documented gotcha; the admin hub does the same).
  // Sources excluded by the kind filter use an empty `id in []` so every
  // element stays a Prisma promise (required by $transaction) and returns
  // nothing without a wasted scan.
  const NONE = { id: { in: [] as string[] } };
  const [visits, jobs, shifts, orphanSubmissions, regions, customers, partners, officers, sites] =
    await prisma.$transaction([
      prisma.patrolVisit.findMany({
        where: loadVisits ? visitWhere : NONE,
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
      }),
      prisma.job.findMany({
        where: loadJobs ? jobWhere : NONE,
        include: {
          site: {
            select: {
              id: true,
              name: true,
              code: true,
              region: { select: { name: true } },
            },
          },
          customer: { select: { id: true, name: true } },
          partner: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
          handledByPartner: { select: { id: true, name: true } },
        },
        orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
        take: 1000,
      }),
      prisma.shift.findMany({
        where: loadShifts ? shiftWhere : NONE,
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
        },
        orderBy: [{ scheduledStartsAt: "desc" }],
        take: 1000,
      }),
      prisma.formSubmission.findMany({
        where: loadOrphanSubmissions ? submissionWhere : NONE,
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
          submittedBy: { select: { id: true, name: true } },
          review: { select: { status: true } },
        },
        orderBy: [{ submittedAt: "desc" }],
        take: 1000,
      }),
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
      prisma.site.findMany({
        where: { active: true },
        orderBy: [{ code: "asc" }, { name: "asc" }],
        select: { id: true, name: true, code: true },
      }),
    ]);

  // ── 4. Normalise into a unified row shape ──────────────────────────────
  type Row = {
    id: string;
    href: string;
    source: "JOB" | "VISIT" | "SHIFT";
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
        // Sort by when work was scheduled / officer arrived, never by
        // completion — operator wants the chronology to follow the
        // shift schedule, not when the paperwork closed.
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
        // Same anchor as visits — scheduled / started / created, not
        // completedAt.
        j.scheduledFor ??
        j.startedAt ??
        j.createdAt ??
        new Date(),
      status: j.status,
      siteId: j.site?.id ?? null,
      siteCode: j.site?.code ?? null,
      siteName: j.site?.name ?? null,
      regionName: j.site?.region?.name ?? null,
      customerId: j.customer?.id ?? null,
      customerName: j.customer?.name ?? null,
      partnerId: j.partner?.id ?? null,
      partnerName: j.partner?.name ?? null,
      officerId: j.assignedTo?.id ?? null,
      officerName: j.handledByPartner
        ? `${j.handledByPartner.name} (partner)`
        : j.assignedTo?.name ?? null,
    });
  }

  for (const s of shifts) {
    const kind =
      s.type === "DOG_HANDLER" ? "DOG_HANDLER_SHIFT" : "STATIC_GUARDING_SHIFT";
    rows.push({
      id: `s:${s.id}`,
      href: `/shifts/${s.id}`,
      source: "SHIFT",
      kind,
      kindLabel: KIND_LABEL[kind] ?? kind,
      // Sort by the scheduled start — shift detail + list use the same.
      at: s.scheduledStartsAt ?? s.actualStartedAt,
      status: s.status,
      siteId: s.site?.id ?? null,
      siteCode: s.site?.code ?? null,
      siteName: s.site?.name ?? null,
      regionName: s.site?.region?.name ?? null,
      customerId: s.site?.customer?.id ?? null,
      customerName: s.site?.customer?.name ?? null,
      partnerId: s.site?.partner?.id ?? null,
      partnerName: s.site?.partner?.name ?? null,
      officerId: s.officer?.id ?? null,
      officerName: s.officer?.name ?? null,
    });
  }

  // Orphan FormSubmissions — officer logged via /submit without a
  // scheduled job/visit. The site's customer/partner relations carry
  // through so per-account filters still work.
  for (const sub of orphanSubmissions) {
    rows.push({
      id: `f:${sub.id}`,
      href: `/sites/${sub.siteId}?tab=activity`,
      source: "JOB",
      kind: sub.form,
      kindLabel: KIND_LABEL[sub.form] ?? sub.form,
      at: sub.submittedAt,
      // FormSubmissions are auto-approved for PATROL/VPI/LOCK/UNLOCK,
      // otherwise sit in PENDING review. Map the review status into
      // the unified status enum the ActivityStatus chip understands.
      status: sub.review?.status ?? "SUBMITTED",
      siteId: sub.site?.id ?? null,
      siteCode: sub.site?.code ?? null,
      siteName: sub.site?.name ?? null,
      regionName: sub.site?.region?.name ?? null,
      customerId: sub.site?.customer?.id ?? null,
      customerName: sub.site?.customer?.name ?? null,
      partnerId: sub.site?.partner?.id ?? null,
      partnerName: sub.site?.partner?.name ?? null,
      officerId: sub.submittedBy?.id ?? null,
      officerName: sub.submittedBy?.name ?? sub.officerNameRaw ?? null,
    });
  }

  // ── 4b. Status filter (post-load) ──────────────────────────────────────
  // Each user-facing status group maps to a different set of enum
  // values per source — VisitStatus / JobStatus / ShiftStatus +
  // ReviewStatus (orphan submissions) don't share names. Doing this
  // in JS after the merge avoids three parallel where-clauses with
  // the same logical filter.
  const STATUS_GROUPS: Record<string, Set<string>> = {
    scheduled: new Set([
      // Job
      "OPEN",
      "ASSIGNED",
      // Visit + Shift
      "PENDING",
      // Orphan submission (review)
      "DRAFT",
    ]),
    in_progress: new Set([
      "IN_PROGRESS",
      // Job intermediate stages
      "SUBMITTED",
      "REVIEW_PENDING",
      // Visit "running late but still active"
      "LATE",
    ]),
    completed: new Set([
      // Visit + Shift
      "COMPLETED",
      // Job
      "APPROVED",
      "SENT_TO_CLIENT",
      "CLOSED",
      // Orphan submission (review)
      "EDITED_AND_APPROVED",
    ]),
    missed: new Set(["MISSED", "ABANDONED"]),
    cancelled: new Set(["CANCELLED"]),
  };
  let filteredRows = rows;
  if (statuses.length > 0) {
    const allowed = new Set<string>();
    for (const g of statuses) {
      const set = STATUS_GROUPS[g];
      if (!set) continue;
      for (const s of set) allowed.add(s);
    }
    filteredRows = rows.filter((r) => allowed.has(r.status));
  }
  filteredRows.sort((a, b) => b.at.getTime() - a.at.getTime());

  // ── 5. Totals (always over the unfiltered-by-page slice) ───────────────
  const totals = { count: filteredRows.length };

  // ── 6. Group-by pivot OR paginated raw rows ────────────────────────────
  type Bucket = { key: string; label: string; count: number };
  let pivot: Bucket[] = [];
  if (groupBy !== "none") {
    const m = new Map<string, Bucket>();
    for (const r of filteredRows) {
      const key = bucketKey(r.at, groupBy);
      const b = m.get(key) ?? {
        key,
        label: bucketLabel(key, groupBy),
        count: 0,
      };
      b.count++;
      m.set(key, b);
    }
    pivot = Array.from(m.values()).sort((a, b) =>
      a.key < b.key ? 1 : a.key > b.key ? -1 : 0,
    );
  }

  const totalShown = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalShown / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── 7. Export QS (preserve every filter) ───────────────────────────────
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v && k !== "page") exportParams.set(k, v);
  }

  const accountLabel = (() => {
    if (customerIds.length === 1) {
      return customers.find((c) => c.id === customerIds[0])?.name ?? "Customer";
    }
    if (customerIds.length > 1) {
      return `${customerIds.length} customers`;
    }
    if (partnerIds.length === 1) {
      return partners.find((p) => p.id === partnerIds[0])?.name ?? "Partner";
    }
    if (partnerIds.length > 1) {
      return `${partnerIds.length} partners`;
    }
    return null;
  })();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activities"
        subtitle={
          <>
            Every completed job and visit, filterable by date, account,
            officer, site, service and region.
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
        clearAllHref="/activities"
        activeFilters={(() => {
          const filters: { label: string; clearHref: string }[] = [];
          const drop = (k: string): string => {
            const sp = new URLSearchParams(searchParams as any);
            sp.delete(k);
            if (k === "customerId" || k === "partnerId") sp.delete("accountId");
            const qs = sp.toString();
            return qs ? `/activities?${qs}` : "/activities";
          };
          const summarise = (
            ids: string[],
            lookup: (id: string) => string | undefined,
          ): string => {
            if (ids.length === 1) return lookup(ids[0]) ?? "?";
            const first = lookup(ids[0]) ?? "?";
            return `${first} +${ids.length - 1}`;
          };
          if (customerIds.length) {
            filters.push({
              label: `Customer: ${summarise(customerIds, (id) => customers.find((c) => c.id === id)?.name)}`,
              clearHref: drop("customerId"),
            });
          }
          if (partnerIds.length) {
            filters.push({
              label: `Partner: ${summarise(partnerIds, (id) => partners.find((p) => p.id === id)?.name)}`,
              clearHref: drop("partnerId"),
            });
          }
          if (officerIds.length) {
            filters.push({
              label: `Officer: ${summarise(officerIds, (id) => officers.find((o) => o.id === id)?.name)}`,
              clearHref: drop("officerId"),
            });
          }
          if (siteIds.length) {
            filters.push({
              label: `Site: ${summarise(siteIds, (id) => {
                const s = sites.find((x) => x.id === id);
                return s ? (s.code ? `${s.code} · ${s.name}` : s.name) : undefined;
              })}`,
              clearHref: drop("siteId"),
            });
          }
          if (regionIds.length) {
            filters.push({
              label: `Region: ${summarise(regionIds.map(String), (id) => regions.find((r) => r.id === Number(id))?.name)}`,
              clearHref: drop("regionId"),
            });
          }
          if (kinds.length) {
            filters.push({
              label: `Service: ${summarise(kinds, (k) => KIND_LABEL[k] ?? k)}`,
              clearHref: drop("kind"),
            });
          }
          if (statuses.length) {
            const STATUS_LABEL: Record<string, string> = {
              scheduled: "Scheduled",
              in_progress: "In progress",
              completed: "Completed",
              missed: "Missed",
              cancelled: "Cancelled",
            };
            filters.push({
              label: `Status: ${summarise(statuses, (s) => STATUS_LABEL[s] ?? s)}`,
              clearHref: drop("status"),
            });
          }
          return filters;
        })()}
      >
        <ActivitiesFilters
          initial={{ from: ymd(fromDate), to: ymd(toDate) }}
          regions={regions.map((r) => ({ id: r.id, name: r.name }))}
          customers={customers}
          partners={partners}
          officers={officers}
          sites={sites}
          jobTypes={JOB_TYPES.map((t) => ({ v: t, label: KIND_LABEL[t] ?? t }))}
          visitKinds={VISIT_KIND_OPTIONS.map((k) => ({
            v: `VISIT_${k}`,
            label: KIND_LABEL[`VISIT_${k}`] ?? k,
          }))}
          shiftKinds={[
            { v: "STATIC_GUARDING_SHIFT", label: "Static-guarding shift" },
            { v: "DOG_HANDLER_SHIFT", label: "Dog-handler shift" },
          ]}
        />
      </FilterPanel>

      <div className="card p-4 inline-block">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          Activities in range
        </div>
        <div className="text-2xl font-semibold text-brand-navy tabular-nums">
          {totals.count.toLocaleString("en-GB")}
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
                </tr>
              ))}
              {pivot.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-slate-500">
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
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const activityLabel = `${r.kindLabel} @ ${r.siteName ?? "site"}`;
                  const rawId = r.id.replace(/^[jv]:/, "");
                  const notDone = ![
                    "APPROVED",
                    "SENT_TO_CLIENT",
                    "CLOSED",
                    "CANCELLED",
                    "COMPLETED",
                  ].includes(r.status);
                  const isJobOrVisit = r.source === "JOB" || r.source === "VISIT";
                  const canReassign =
                    isStaff &&
                    isJobOrVisit &&
                    ["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING", "LATE"].includes(
                      r.status,
                    );
                  const canEdit =
                    isStaff && r.status !== "CANCELLED" && r.source !== "SHIFT";
                  const canClose = isStaff && isJobOrVisit && notDone;
                  const canCancel = isStaff && r.source === "JOB" && notDone;
                  return (
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
                        {canReassign ? (
                          <ReassignOfficer
                            kind={r.source === "VISIT" ? "visit" : "job"}
                            id={rawId}
                            currentOfficerId={r.officerId}
                            officers={officers}
                            size="small"
                          />
                        ) : (
                          r.officerName ?? (
                            <span className="text-slate-400">—</span>
                          )
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-600 text-xs">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <ActivityStatus status={r.status} />
                          {isAdmin &&
                            r.source === "JOB" &&
                            r.status === "CANCELLED" && (
                              <RestoreJobButton
                                jobId={rawId}
                                jobLabel={activityLabel}
                                size="small"
                              />
                            )}
                          {canEdit && (
                            <EditIconLink href={`${r.href}/edit`} size="small" />
                          )}
                          {canClose && (
                            <CloseActivityButton
                              kind={r.source === "VISIT" ? "visit" : "job"}
                              id={rawId}
                              label={activityLabel}
                              size="small"
                            />
                          )}
                          {canCancel && (
                            <CancelJobButton
                              jobId={rawId}
                              jobLabel={activityLabel}
                              size="small"
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
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
    return `/activities?${qs.toString()}`;
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
