/**
 * Keyholding Company jobs — turn the rows read off the Chase2Base "Jobs"
 * screen (scripts/keyholding-jobs.mjs) into job records.
 *
 * Keyholding Company is one of our CUSTOMERS (set up as a Customer, not a
 * Partner): they dispatch work through their own platform, our officers attend
 * and file it in their app (Chase2Base), and we keep the job record here —
 * tied to the Keyholding customer, reportedViaPartnerApp (their app holds the
 * report, so no /submit or client report from us).
 *
 * Rules agreed with the operator ("map properly, or if any is missed, update
 * or create"):
 *   - Dedup on the Keyholding job number ("#", e.g. J21634508 or J21816769/9)
 *     stored in Job.partnerActivityRef (UNIQUE) — re-runs update, never duplicate.
 *   - Most of these jobs ALREADY EXIST in our system, generated from the site's
 *     lock/unlock/patrol schedule (or entered by hand). So before creating, we
 *     LINK to the existing job: same site, same type, scheduled within ±3h,
 *     not already linked, nearest in time wins (one-to-one). Linking attaches
 *     the J… number and brings the status / times up to date from Keyholding —
 *     but only ever moves a job FORWARD (never un-completes it), only fills
 *     times that are missing, never touches the officer, customer/partner or
 *     billing, and appends (never replaces) a note.
 *   - PATROLS live as PatrolVisits (generated from the site's patrol schedule),
 *     not Jobs — so a Keyholding patrol links to the matching VISIT (same site,
 *     ±3h, nearest, one-to-one; ref stored in PatrolVisit.partnerActivityRef).
 *     A patrol job an earlier import created that duplicates a visit is merged
 *     into it (ref moved to the visit, the copy deleted) — but only if nobody
 *     has touched it (no officer, invoice or form); otherwise it's left and
 *     reported for review.
 *   - Only a job with no match is CREATED — tied to the Keyholding customer,
 *     reportedViaPartnerApp, unallocated for the office to assign.
 *   - Officers are never taken from Keyholding's Executor column.
 *   - Status follows Keyholding's Execution Status (Done → completed,
 *     Cancelled → cancelled, At Location → in progress, else open).
 */
import type { PrismaClient } from "@prisma/client";
import { normalisePostcode } from "@/lib/nexusImport";
import { normaliseNameKey } from "@/lib/siteDuplicates";
import { ukWallClockToUtc } from "@/lib/dates";

export const KEYHOLDING_CUSTOMER_NAME = "Keyholding Company";

/**
 * Our Keyholding CUSTOMER record (Keyholding is set up as a customer, not a
 * partner). Order: an explicit KEYHOLDING_CUSTOMER_NAME env override → the
 * name "Keyholding Company" → the single customer whose name contains
 * "keyholding" (or, failing that, "khc"). Returns null when there's none or
 * it's ambiguous — callers then report the customers on file.
 */
export async function resolveKeyholdingCustomer(
  prisma: PrismaClient,
): Promise<{ id: string; name: string } | null> {
  const select = { id: true, name: true } as const;
  const configured = process.env.KEYHOLDING_CUSTOMER_NAME?.trim();
  if (configured) {
    const hit = await prisma.customer.findUnique({ where: { name: configured }, select });
    if (hit) return hit;
  }
  const exact = await prisma.customer.findUnique({
    where: { name: KEYHOLDING_CUSTOMER_NAME },
    select,
  });
  if (exact) return exact;
  const fuzzy = await prisma.customer.findMany({
    where: {
      OR: [
        { name: { contains: "keyholding", mode: "insensitive" } },
        { name: { contains: "khc", mode: "insensitive" } },
      ],
    },
    select,
  });
  const named = fuzzy.filter((c) => /keyholding/i.test(c.name));
  if (named.length === 1) return named[0];
  if (named.length === 0 && fuzzy.length === 1) return fuzzy[0];
  return null; // none, or ambiguous
}

/** A setup problem (not a transient failure) — the endpoint answers 422. */
export class KhConfigError extends Error {}

async function customerNotFoundError(prisma: PrismaClient): Promise<KhConfigError> {
  const names = (
    await prisma.customer.findMany({ select: { name: true }, orderBy: { name: "asc" } })
  ).map((c) => c.name);
  return new KhConfigError(
    `No single Keyholding customer found. Customers on file: ${
      names.length ? names.join(" | ") : "(none)"
    }. Tell us which one is Keyholding (or set KEYHOLDING_CUSTOMER_NAME).`,
  );
}

/** One row off the Jobs table, keyed by its column header. */
export type KeyholdingRow = Record<string, string | null | undefined>;

export type KhSkip = { reference: string | null; reason: string };

export type KhSummary = {
  /** The customer record new jobs attach to. */
  customer: string;
  read: number;
  /** New jobs that would be created (no existing match). */
  toCreate: number;
  /** Existing jobs (from a schedule / entered by hand) that would be linked. */
  toLink: number;
  /** Existing patrol VISITS (from the site's patrol schedule) that would be linked. */
  toLinkVisit: number;
  /** Patrol jobs an earlier import created that duplicate a visit — would be merged away. */
  toMerge: number;
  /** Such duplicates someone has already worked on — left alone, for review. */
  toReview: number;
  /** Jobs already linked/imported on an earlier run that would be refreshed. */
  toUpdate: number;
  unmatchedSites: number;
  byStatus: Record<string, number>;
  skipped: KhSkip[];
};

export type KhResult = {
  customer: string;
  created: number;
  linked: number;
  /** Keyholding patrols linked to the patrol visit our schedule made. */
  linkedVisits: number;
  /** Duplicate patrol jobs (made by an earlier import) merged into their visit. */
  merged: number;
  /** Duplicate patrol jobs left alone because someone had already touched them. */
  keptForReview: number;
  updated: number;
  unmatched: number;
  skipped: KhSkip[];
};

type KhStatus = "OPEN" | "IN_PROGRESS" | "APPROVED" | "CANCELLED";

const POSTCODE_RE = /([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/i;
const LINK_WINDOW_MS = 3 * 60 * 60 * 1000; // ±3h around the scheduled time
/** Prefix on notes of jobs this importer CREATED (vs ones it linked to). */
const CREATED_NOTE_PREFIX = "Keyholding job ";

const cell = (r: KeyholdingRow, k: string) => (r[k] ?? "").toString().trim();

/** "dd/MM/yyyy HH:mm" (UK wall-clock) → UTC instant. */
export function parseKhDateTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  return ukWallClockToUtc(
    Number(m[3]),
    Number(m[2]),
    Number(m[1]),
    m[4] ? Number(m[4]) : 0,
    m[5] ? Number(m[5]) : 0,
    0,
  );
}

/** Keyholding service ("UCK: Unlock", "ODEP: External Patrol: On-demand", …) → JobType. */
export function mapKhService(service: string | null | undefined): string {
  const t = (service ?? "").toLowerCase();
  if (t.includes("unlock")) return "UNLOCK";
  if (/\block/.test(t)) return "LOCK"; // \b so "unlock" never lands here
  if (t.includes("patrol")) return "PATROL";
  if (t.includes("alarm")) return "ALARM_RESPONSE";
  if (t.includes("survey")) return "SURVEY";
  return "ADHOC"; // welfare checks and anything else
}

/** Keyholding Execution Status → our JobStatus. */
export function mapKhStatus(exec: string | null | undefined): {
  status: KhStatus;
  done: boolean;
} {
  const e = (exec ?? "").trim().toLowerCase();
  if (e === "done") return { status: "APPROVED", done: true };
  if (e === "cancelled" || e === "canceled") return { status: "CANCELLED", done: false };
  // "At Location" as a phrase — a bare "location" would also match
  // "Waiting for Allocation".
  if (/\bat location\b/.test(e) || e.includes("executing") || e.includes("on way"))
    return { status: "IN_PROGRESS", done: false };
  return { status: "OPEN", done: false }; // Booked / Allocated / Waiting for Allocation
}

/** Progress rank — a linked job's status only ever moves forward. */
const RANK: Record<string, number> = {
  OPEN: 0,
  ASSIGNED: 1,
  IN_PROGRESS: 2,
  SUBMITTED: 3,
  REVIEW_PENDING: 3,
  APPROVED: 4,
  SENT_TO_CLIENT: 4,
  CLOSED: 4,
};

/**
 * The status a linked job should move to given Keyholding's, or null to leave
 * it. Never un-completes, never touches a cancelled job, and only cancels one
 * that isn't done yet.
 */
export function mergeKhStatus(current: string, kh: KhStatus): KhStatus | null {
  if (current === "CANCELLED") return null;
  const cur = RANK[current] ?? 0;
  if (kh === "CANCELLED") return cur >= 4 ? null : "CANCELLED";
  return (RANK[kh] ?? 0) > cur ? kh : null;
}

type Prepared = {
  reference: string;
  jobType: string;
  typeLabel: string | null;
  /** Keyholding's Source Type — "Scheduled" jobs vs "Booked" (on-demand). */
  scheduledSource: boolean;
  status: KhStatus;
  siteName: string | null;
  postcode: string | null;
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  notes: string;
};

function prepare(r: KeyholdingRow):
  | { ok: true; row: Prepared }
  | { ok: false; skip: KhSkip } {
  const reference = cell(r, "#");
  if (!/^J\d+/i.test(reference)) {
    return { ok: false, skip: { reference: reference || null, reason: "no Keyholding job number" } };
  }
  const service = cell(r, "Service");
  const exec = cell(r, "Execution Status");
  const { status, done } = mapKhStatus(exec);
  const addresses = cell(r, "Addresses");
  const pc = addresses.match(POSTCODE_RE);

  const notes = [
    `${CREATED_NOTE_PREFIX}${reference}.`,
    service ? `Service: ${service}.` : null,
    exec ? `Keyholding status: ${exec}${cell(r, "Status") ? ` / ${cell(r, "Status")}` : ""}.` : null,
    cell(r, "Source Type") ? `Source: ${cell(r, "Source Type")}.` : null,
    cell(r, "Date") ? `Due: ${cell(r, "Date")}${cell(r, "Last Date") ? ` – ${cell(r, "Last Date")}` : ""}.` : null,
    cell(r, "Property") ? `Property: ${cell(r, "Property")} (#${cell(r, "Property Number")}).` : null,
    cell(r, "Contract") ? `Contract: ${cell(r, "Contract")}.` : null,
    addresses ? `Address: ${addresses}.` : null,
    "Imported from the Keyholding (Chase2Base) portal — filed in their app.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ok: true,
    row: {
      reference,
      jobType: mapKhService(service),
      typeLabel: service || null,
      scheduledSource: /^scheduled$/i.test(cell(r, "Source Type")),
      status,
      siteName: cell(r, "Property") || null,
      postcode: pc ? normalisePostcode(`${pc[1]}${pc[2]}`) : null,
      scheduledFor: parseKhDateTime(cell(r, "Date")),
      startedAt:
        parseKhDateTime(cell(r, "Started At")) ?? parseKhDateTime(cell(r, "On Site At")),
      completedAt: done
        ? parseKhDateTime(cell(r, "Finished At")) ?? parseKhDateTime(cell(r, "Leave Site At"))
        : null,
      notes,
    },
  };
}

type SiteRef = { id: string; name: string; customerId: string | null };

export function matchKhSiteId(
  row: { postcode: string | null; siteName: string | null },
  byPostcode: Map<string, SiteRef[]>,
  customerId: string | null,
): string | null {
  if (!row.postcode) return null;
  const candidates = byPostcode.get(row.postcode);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;
  const ownOnes = customerId ? candidates.filter((c) => c.customerId === customerId) : [];
  const pool = ownOnes.length > 0 ? ownOnes : candidates;
  if (row.siteName) {
    const wanted = normaliseNameKey(row.siteName);
    const exact = pool.find((c) => normaliseNameKey(c.name) === wanted);
    if (exact) return exact.id;
    const partial = pool.find((c) => {
      const k = normaliseNameKey(c.name);
      return k.includes(wanted) || wanted.includes(k);
    });
    if (partial) return partial.id;
  }
  return pool[0].id;
}

async function loadSiteIndex(prisma: PrismaClient, rows: Prepared[]) {
  const postcodes = Array.from(
    new Set(rows.map((r) => r.postcode).filter((p): p is string => Boolean(p))),
  );
  const byPostcode = new Map<string, SiteRef[]>();
  if (postcodes.length === 0) return byPostcode;
  const sites = await prisma.site.findMany({
    where: { postcode: { in: postcodes } },
    select: { id: true, name: true, customerId: true, postcode: true },
  });
  for (const s of sites) {
    if (!s.postcode) continue;
    const list = byPostcode.get(s.postcode) ?? [];
    list.push({ id: s.id, name: s.name, customerId: s.customerId });
    byPostcode.set(s.postcode, list);
  }
  return byPostcode;
}

function split(rows: KeyholdingRow[]) {
  const ok: Prepared[] = [];
  const skipped: KhSkip[] = [];
  for (const r of rows) {
    const res = prepare(r);
    if (res.ok) ok.push(res.row);
    else skipped.push(res.skip);
  }
  return { ok, skipped };
}

type Candidate = {
  id: string;
  status: string;
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  notes: string | null;
};

type CandidateIndex = Map<string, Candidate[]>; // key: `${siteId}|${type}`

/**
 * One query for every not-yet-linked, not-cancelled job at the batch's sites
 * across its date span (±3h) — the pool a Keyholding job can link to. Keeps a
 * 600-row backfill to a single round-trip instead of one query per row.
 */
async function prefetchCandidates(
  prisma: PrismaClient,
  wanted: { siteId: string | null; scheduledFor: Date | null }[],
): Promise<CandidateIndex> {
  const index: CandidateIndex = new Map();
  const usable = wanted.filter(
    (w): w is { siteId: string; scheduledFor: Date } => Boolean(w.siteId && w.scheduledFor),
  );
  if (usable.length === 0) return index;
  let min = Infinity;
  let max = -Infinity;
  for (const u of usable) {
    const t = u.scheduledFor.getTime();
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const jobs = await prisma.job.findMany({
    where: {
      siteId: { in: Array.from(new Set(usable.map((u) => u.siteId))) },
      partnerActivityRef: null,
      status: { not: "CANCELLED" },
      scheduledFor: {
        gte: new Date(min - LINK_WINDOW_MS),
        lte: new Date(max + LINK_WINDOW_MS),
      },
    },
    select: {
      id: true,
      siteId: true,
      type: true,
      status: true,
      scheduledFor: true,
      startedAt: true,
      completedAt: true,
      notes: true,
    },
  });
  for (const j of jobs) {
    const key = `${j.siteId}|${j.type}`;
    const list = index.get(key) ?? [];
    list.push(j);
    index.set(key, list);
  }
  return index;
}

/**
 * The existing job this Keyholding job IS — same site + type, scheduled within
 * ±3h, not claimed by another Keyholding job in this run — nearest in time
 * wins. Null when there's no such job.
 */
function pickCandidate(
  index: CandidateIndex,
  siteId: string,
  jobType: string,
  scheduledFor: Date | null,
  claimed: Set<string>,
): Candidate | null {
  if (!scheduledFor) return null;
  const t = scheduledFor.getTime();
  let best: Candidate | null = null;
  let bestGap = Infinity;
  for (const c of index.get(`${siteId}|${jobType}`) ?? []) {
    if (claimed.has(c.id) || !c.scheduledFor) continue;
    const gap = Math.abs(c.scheduledFor.getTime() - t);
    if (gap <= LINK_WINDOW_MS && gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

// ── Patrol visits ────────────────────────────────────────────────────────────
// Patrols live as PatrolVisits (generated from the site's patrol schedule), not
// Jobs — so a Keyholding patrol must link to the VISIT or it duplicates it.

type VisitStatusT = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "LATE" | "MISSED" | "CANCELLED";

type VisitCandidate = {
  id: string;
  siteId: string;
  status: VisitStatusT;
  scheduledAt: Date;
  arrivedAt: Date | null;
  departedAt: Date | null;
  notes: string | null;
};

type VisitIndex = Map<string, VisitCandidate[]>; // key: siteId

/** One query: unlinked, non-cancelled visits at the batch's sites over its date span. */
async function prefetchVisitCandidates(
  prisma: PrismaClient,
  wanted: { siteId: string | null; scheduledFor: Date | null }[],
): Promise<VisitIndex> {
  const index: VisitIndex = new Map();
  const usable = wanted.filter(
    (w): w is { siteId: string; scheduledFor: Date } => Boolean(w.siteId && w.scheduledFor),
  );
  if (usable.length === 0) return index;
  let min = Infinity;
  let max = -Infinity;
  for (const u of usable) {
    const t = u.scheduledFor.getTime();
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const visits = await prisma.patrolVisit.findMany({
    where: {
      siteId: { in: Array.from(new Set(usable.map((u) => u.siteId))) },
      partnerActivityRef: null,
      status: { not: "CANCELLED" },
      scheduledAt: {
        gte: new Date(min - LINK_WINDOW_MS),
        lte: new Date(max + LINK_WINDOW_MS),
      },
    },
    select: {
      id: true,
      siteId: true,
      status: true,
      scheduledAt: true,
      arrivedAt: true,
      departedAt: true,
      notes: true,
    },
  });
  for (const v of visits) {
    const list = index.get(v.siteId) ?? [];
    list.push(v as VisitCandidate);
    index.set(v.siteId, list);
  }
  return index;
}

/** The patrol visit this Keyholding patrol IS — same site, ±3h, nearest, unclaimed. */
function pickVisit(
  index: VisitIndex,
  siteId: string,
  scheduledFor: Date | null,
  claimed: Set<string>,
): VisitCandidate | null {
  if (!scheduledFor) return null;
  const t = scheduledFor.getTime();
  let best: VisitCandidate | null = null;
  let bestGap = Infinity;
  for (const v of index.get(siteId) ?? []) {
    if (claimed.has(v.id)) continue;
    const gap = Math.abs(v.scheduledAt.getTime() - t);
    if (gap <= LINK_WINDOW_MS && gap < bestGap) {
      best = v;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Visit status given Keyholding's, or null to leave it. Only moves forward:
 * Done → COMPLETED (including one our system had marked LATE/MISSED — the
 * officer recorded it in Keyholding's app); never touches a completed or
 * cancelled visit; cancels only one nobody has started.
 */
export function mergeKhVisitStatus(current: VisitStatusT, kh: KhStatus): VisitStatusT | null {
  if (current === "CANCELLED" || current === "COMPLETED") return null;
  if (kh === "APPROVED") return "COMPLETED";
  if (kh === "IN_PROGRESS") return current === "IN_PROGRESS" ? null : "IN_PROGRESS";
  if (kh === "CANCELLED") return current === "IN_PROGRESS" ? null : "CANCELLED";
  return null; // Keyholding still has it open — leave ours as it is
}

/** Update for bringing a linked visit up to date (status forward, fill missing times). */
function visitLinkedUpdate(
  current: { status: VisitStatusT; arrivedAt: Date | null; departedAt: Date | null },
  r: { status: KhStatus; startedAt: Date | null; completedAt: Date | null },
) {
  const next = mergeKhVisitStatus(current.status, r.status);
  return {
    ...(next ? { status: next } : {}),
    ...(next === "CANCELLED"
      ? { cancelledAt: new Date(), statusBeforeCancel: current.status as any }
      : {}),
    ...(!current.arrivedAt && r.startedAt ? { arrivedAt: r.startedAt } : {}),
    ...(!current.departedAt && r.completedAt ? { departedAt: r.completedAt } : {}),
  };
}

const linkNote = (existing: string | null, ref: string, label: string | null, status: string) =>
  `${existing ? `${existing}\n` : ""}[Linked to Keyholding job ${ref} — ${label ?? "patrol"}, Keyholding status: ${status}]`;

/** Update fields for bringing a job we LINKED (not created) up to date. */
function linkedUpdate(
  current: { status: string; startedAt: Date | null; completedAt: Date | null },
  r: Prepared,
) {
  const next = mergeKhStatus(current.status, r.status);
  return {
    ...(next ? { status: next } : {}),
    ...(next === "CANCELLED"
      ? { cancelledAt: new Date(), statusBeforeCancel: current.status as any }
      : {}),
    ...(!current.startedAt && r.startedAt ? { startedAt: r.startedAt } : {}),
    ...(!current.completedAt && r.completedAt ? { completedAt: r.completedAt } : {}),
  };
}


// ── Planning: one decision per row, shared by preview and the real run ─────

type ExistingJob = {
  id: string;
  status: string;
  cancelledByUserId: string | null;
  siteId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  notes: string | null;
  type: string;
  assignedToUserId: string | null;
  invoiceId: string | null;
  partnerActivityRef: string | null;
  _count: { formSubmissions: number };
};

type ExistingVisit = {
  id: string;
  status: VisitStatusT;
  arrivedAt: Date | null;
  departedAt: Date | null;
  partnerActivityRef: string | null;
};

type Action =
  | { kind: "updateJob"; job: ExistingJob }
  | { kind: "updateVisit"; visit: ExistingVisit }
  | { kind: "merge"; job: ExistingJob; visit: VisitCandidate }
  | { kind: "review"; job: ExistingJob }
  | { kind: "linkJob"; cand: Candidate }
  | { kind: "linkVisit"; visit: VisitCandidate }
  | { kind: "create" };

/**
 * Decide what to do with every row — without writing anything. Preview counts
 * the decisions; the real run executes them, so the two can't disagree.
 *
 *   - already on a visit (J… ref)            → update the visit
 *   - a patrol JOB an earlier import created that duplicates a visit:
 *       untouched (no officer / invoice / form) → MERGE into the visit
 *       touched                                 → leave it, flag for review
 *   - already on a job (J… ref)              → update the job
 *   - an existing job at the site (same type, ±3h)   → link it
 *   - a patrol with an existing visit (±3h)          → link the visit
 *   - otherwise                                      → create a job
 */
async function planRows(prisma: PrismaClient, ok: Prepared[], customerId: string) {
  const index = await loadSiteIndex(prisma, ok);
  const siteIds = ok.map((r) => matchKhSiteId(r, index, customerId));
  const refs = ok.map((r) => r.reference);

  // Sequential, not Promise.all — concurrent queries exhaust the pooled
  // connections on Vercel.
  const jobs = (await prisma.job.findMany({
    where: { partnerActivityRef: { in: refs } },
    select: {
      id: true,
      status: true,
      cancelledByUserId: true,
      siteId: true,
      startedAt: true,
      completedAt: true,
      notes: true,
      type: true,
      assignedToUserId: true,
      invoiceId: true,
      partnerActivityRef: true,
      _count: { select: { formSubmissions: true } },
    },
  })) as ExistingJob[];
  const visits = (await prisma.patrolVisit.findMany({
    where: { partnerActivityRef: { in: refs } },
    select: {
      id: true,
      status: true,
      arrivedAt: true,
      departedAt: true,
      partnerActivityRef: true,
    },
  })) as ExistingVisit[];
  const jobByRef = new Map(jobs.map((j) => [j.partnerActivityRef as string, j]));
  const visitByRef = new Map(visits.map((v) => [v.partnerActivityRef as string, v]));

  const jobPool = await prefetchCandidates(
    prisma,
    ok.map((r, i) =>
      jobByRef.has(r.reference) || visitByRef.has(r.reference)
        ? { siteId: null, scheduledFor: null }
        : { siteId: siteIds[i], scheduledFor: r.scheduledFor },
    ),
  );
  const visitPool = await prefetchVisitCandidates(
    prisma,
    ok.map((r, i) =>
      r.jobType === "PATROL" && !visitByRef.has(r.reference)
        ? { siteId: siteIds[i], scheduledFor: r.scheduledFor }
        : { siteId: null, scheduledFor: null },
    ),
  );

  const claimedJobs = new Set<string>();
  const claimedVisits = new Set<string>();
  const actions: Action[] = [];
  for (let i = 0; i < ok.length; i++) {
    const r = ok[i];
    const siteId = siteIds[i];

    const ev = visitByRef.get(r.reference);
    if (ev) {
      actions.push({ kind: "updateVisit", visit: ev });
      continue;
    }

    const ej = jobByRef.get(r.reference);
    if (ej) {
      const createdByUs = (ej.notes ?? "").startsWith(CREATED_NOTE_PREFIX);
      if (createdByUs && r.jobType === "PATROL" && siteId && ej.status !== "CANCELLED") {
        const v = pickVisit(visitPool, siteId, r.scheduledFor, claimedVisits);
        if (v) {
          const untouched =
            !ej.assignedToUserId && !ej.invoiceId && ej._count.formSubmissions === 0;
          if (untouched) {
            claimedVisits.add(v.id);
            actions.push({ kind: "merge", job: ej, visit: v });
          } else {
            actions.push({ kind: "review", job: ej });
          }
          continue;
        }
      }
      actions.push({ kind: "updateJob", job: ej });
      continue;
    }

    const jc = siteId
      ? pickCandidate(jobPool, siteId, r.jobType, r.scheduledFor, claimedJobs)
      : null;
    if (jc) {
      claimedJobs.add(jc.id);
      actions.push({ kind: "linkJob", cand: jc });
      continue;
    }
    if (r.jobType === "PATROL" && siteId) {
      const v = pickVisit(visitPool, siteId, r.scheduledFor, claimedVisits);
      if (v) {
        claimedVisits.add(v.id);
        actions.push({ kind: "linkVisit", visit: v });
        continue;
      }
    }
    actions.push({ kind: "create" });
  }
  return { siteIds, actions };
}

export async function previewKeyholdingJobs(
  prisma: PrismaClient,
  rows: KeyholdingRow[],
): Promise<KhSummary> {
  const { ok, skipped } = split(rows);
  // Fail the preview the same way the real run would, so it's caught here.
  const customer = await resolveKeyholdingCustomer(prisma);
  if (!customer) throw await customerNotFoundError(prisma);
  const { siteIds, actions } = await planRows(prisma, ok, customer.id);
  const count = (k: Action["kind"]) => actions.filter((a) => a.kind === k).length;
  const byStatus: Record<string, number> = {};
  for (const r of ok) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return {
    customer: customer.name,
    read: rows.length,
    toCreate: count("create"),
    toLink: count("linkJob"),
    toLinkVisit: count("linkVisit"),
    toMerge: count("merge"),
    toReview: count("review"),
    toUpdate: count("updateJob") + count("updateVisit"),
    unmatchedSites: siteIds.filter((s) => !s).length,
    byStatus,
    skipped,
  };
}

export async function runKeyholdingJobs(
  prisma: PrismaClient,
  rows: KeyholdingRow[],
): Promise<KhResult> {
  const customer = await resolveKeyholdingCustomer(prisma);
  if (!customer) throw await customerNotFoundError(prisma);

  const { ok, skipped } = split(rows);
  const { siteIds, actions } = await planRows(prisma, ok, customer.id);
  let created = 0;
  let linked = 0;
  let linkedVisits = 0;
  let merged = 0;
  let keptForReview = 0;
  let updated = 0;

  for (let i = 0; i < ok.length; i++) {
    const r = ok[i];
    const siteId = siteIds[i];
    const a = actions[i];

    switch (a.kind) {
      case "updateVisit": {
        await prisma.patrolVisit.update({
          where: { id: a.visit.id },
          data: visitLinkedUpdate(a.visit, r),
        });
        updated++;
        break;
      }

      case "merge": {
        // The duplicate was made by an earlier import and nobody has touched
        // it: put the Keyholding reference on the real visit and drop the copy.
        await prisma.$transaction([
          prisma.patrolVisit.update({
            where: { id: a.visit.id },
            data: {
              partnerActivityRef: r.reference,
              ...visitLinkedUpdate(a.visit, r),
              notes: linkNote(a.visit.notes, r.reference, r.typeLabel, r.status),
            },
          }),
          prisma.job.delete({ where: { id: a.job.id } }),
        ]);
        merged++;
        break;
      }

      case "review": {
        keptForReview++; // someone's worked on it — leave both, report it
        break;
      }

      case "updateJob": {
        const existing = a.job;
        // A cancel the office made by hand wins — leave it.
        if (existing.status === "CANCELLED" && existing.cancelledByUserId !== null) {
          updated++;
          break;
        }
        const createdByUs = (existing.notes ?? "").startsWith(CREATED_NOTE_PREFIX);
        await prisma.job.update({
          where: { id: existing.id },
          data: createdByUs
            ? {
                // Our own record — keep it in step with Keyholding (but never
                // touch the office's officer allocation).
                type: r.jobType as any,
                typeLabel: r.typeLabel,
                status: r.status,
                scheduledFor: r.scheduledFor ?? undefined,
                startedAt: r.startedAt ?? undefined,
                completedAt: r.completedAt ?? undefined,
                notes: r.notes,
                ...(siteId && existing.siteId === null ? { siteId } : {}),
                ...(r.status === "CANCELLED" && existing.status !== "CANCELLED"
                  ? { cancelledAt: new Date(), statusBeforeCancel: existing.status as any }
                  : {}),
                ...(r.status !== "CANCELLED" && existing.status === "CANCELLED"
                  ? { cancelledAt: null, statusBeforeCancel: null }
                  : {}),
              }
            : // A job we linked to — only move it forward / fill gaps.
              linkedUpdate(existing, r),
        });
        updated++;
        break;
      }

      case "linkJob": {
        const cand = a.cand;
        await prisma.job.update({
          where: { id: cand.id },
          data: {
            partnerActivityRef: r.reference,
            possibleDuplicate: false,
            ...linkedUpdate(cand, r),
            notes: `${cand.notes ? `${cand.notes}\n` : ""}[Linked to Keyholding job ${r.reference} — ${r.typeLabel ?? r.jobType}, Keyholding status: ${r.status}]`,
          },
        });
        linked++;
        break;
      }

      case "linkVisit": {
        await prisma.patrolVisit.update({
          where: { id: a.visit.id },
          data: {
            partnerActivityRef: r.reference,
            ...visitLinkedUpdate(a.visit, r),
            notes: linkNote(a.visit.notes, r.reference, r.typeLabel, r.status),
          },
        });
        linkedVisits++;
        break;
      }

      case "create": {
        // Genuinely new — create it for the Keyholding customer, unallocated
        // for the office. Source mirrors Keyholding's: a scheduled job vs an
        // on-demand booking from the customer.
        await prisma.job.create({
          data: {
            type: r.jobType as any,
            typeLabel: r.typeLabel,
            source: r.scheduledSource ? "SCHEDULED" : "CUSTOMER_REQUEST",
            status: r.status,
            priority: "MEDIUM",
            siteId: siteId ?? undefined,
            customerId: customer.id,
            reportedViaPartnerApp: true,
            partnerActivityRef: r.reference,
            scheduledFor: r.scheduledFor ?? undefined,
            startedAt: r.startedAt ?? undefined,
            completedAt: r.completedAt ?? undefined,
            cancelledAt: r.status === "CANCELLED" ? new Date() : undefined,
            notes: r.notes,
          },
        });
        created++;
        break;
      }
    }
  }

  return {
    customer: customer.name,
    created,
    linked,
    linkedVisits,
    merged,
    keptForReview,
    updated,
    unmatched: siteIds.filter((s) => !s).length,
    skipped,
  };
}
