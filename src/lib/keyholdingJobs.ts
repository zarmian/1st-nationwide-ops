/**
 * Keyholding Company jobs — turn the rows read off the Chase2Base "Jobs"
 * screen (scripts/keyholding-jobs.mjs) into job records.
 *
 * Operating-model mode 2 (partner-as-customer): Keyholding sends us the work,
 * our officer attends and files in their app, and we keep a record.
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
 *   - Only a job with no match is CREATED — tied to the Keyholding partner,
 *     reportedViaPartnerApp, unallocated for the office to assign.
 *   - Officers are never taken from Keyholding's Executor column.
 *   - Status follows Keyholding's Execution Status (Done → completed,
 *     Cancelled → cancelled, At Location → in progress, else open).
 */
import type { PrismaClient } from "@prisma/client";
import { normalisePostcode } from "@/lib/nexusImport";
import { normaliseNameKey } from "@/lib/siteDuplicates";
import { ukWallClockToUtc } from "@/lib/dates";

export const KEYHOLDING_PARTNER_NAME = "Keyholding Company";

/** One row off the Jobs table, keyed by its column header. */
export type KeyholdingRow = Record<string, string | null | undefined>;

export type KhSkip = { reference: string | null; reason: string };

export type KhSummary = {
  read: number;
  /** New jobs that would be created (no existing match). */
  toCreate: number;
  /** Existing jobs (from a schedule / entered by hand) that would be linked. */
  toLink: number;
  /** Jobs already linked/imported on an earlier run that would be refreshed. */
  toUpdate: number;
  unmatchedSites: number;
  byStatus: Record<string, number>;
  skipped: KhSkip[];
};

export type KhResult = {
  created: number;
  linked: number;
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

type SiteRef = { id: string; name: string; partnerId: string | null };

export function matchKhSiteId(
  row: { postcode: string | null; siteName: string | null },
  byPostcode: Map<string, SiteRef[]>,
  partnerId: string | null,
): string | null {
  if (!row.postcode) return null;
  const candidates = byPostcode.get(row.postcode);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;
  const partnerOnes = partnerId ? candidates.filter((c) => c.partnerId === partnerId) : [];
  const pool = partnerOnes.length > 0 ? partnerOnes : candidates;
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
    select: { id: true, name: true, partnerId: true, postcode: true },
  });
  for (const s of sites) {
    if (!s.postcode) continue;
    const list = byPostcode.get(s.postcode) ?? [];
    list.push({ id: s.id, name: s.name, partnerId: s.partnerId });
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

export async function previewKeyholdingJobs(
  prisma: PrismaClient,
  rows: KeyholdingRow[],
): Promise<KhSummary> {
  const { ok, skipped } = split(rows);
  const existing = await prisma.job.findMany({
    where: { partnerActivityRef: { in: ok.map((r) => r.reference) } },
    select: { partnerActivityRef: true },
  });
  const seen = new Set(existing.map((j) => j.partnerActivityRef).filter(Boolean) as string[]);
  const partner = await prisma.partner.findUnique({
    where: { name: KEYHOLDING_PARTNER_NAME },
    select: { id: true },
  });
  const index = await loadSiteIndex(prisma, ok);
  const siteIds = ok.map((r) => matchKhSiteId(r, index, partner?.id ?? null));
  const pool = await prefetchCandidates(
    prisma,
    ok.map((r, i) =>
      seen.has(r.reference)
        ? { siteId: null, scheduledFor: null }
        : { siteId: siteIds[i], scheduledFor: r.scheduledFor },
    ),
  );

  let toCreate = 0;
  let toLink = 0;
  let toUpdate = 0;
  let unmatchedSites = 0;
  const byStatus: Record<string, number> = {};
  const claimed = new Set<string>();
  for (let i = 0; i < ok.length; i++) {
    const r = ok[i];
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const siteId = siteIds[i];
    if (!siteId) unmatchedSites++;
    if (seen.has(r.reference)) {
      toUpdate++;
      continue;
    }
    const cand = siteId
      ? pickCandidate(pool, siteId, r.jobType, r.scheduledFor, claimed)
      : null;
    if (cand) {
      claimed.add(cand.id);
      toLink++;
    } else {
      toCreate++;
    }
  }
  return { read: rows.length, toCreate, toLink, toUpdate, unmatchedSites, byStatus, skipped };
}

export async function runKeyholdingJobs(
  prisma: PrismaClient,
  rows: KeyholdingRow[],
): Promise<KhResult> {
  const partner = await prisma.partner.findUnique({
    where: { name: KEYHOLDING_PARTNER_NAME },
    select: { id: true },
  });
  if (!partner) {
    throw new Error(`Partner "${KEYHOLDING_PARTNER_NAME}" not found. Run \`npm run db:seed\` first.`);
  }

  const { ok, skipped } = split(rows);
  const index = await loadSiteIndex(prisma, ok);
  const siteIds = ok.map((r) => matchKhSiteId(r, index, partner.id));
  const knownRefs = new Set(
    (
      await prisma.job.findMany({
        where: { partnerActivityRef: { in: ok.map((r) => r.reference) } },
        select: { partnerActivityRef: true },
      })
    )
      .map((j) => j.partnerActivityRef)
      .filter(Boolean) as string[],
  );
  const pool = await prefetchCandidates(
    prisma,
    ok.map((r, i) =>
      knownRefs.has(r.reference)
        ? { siteId: null, scheduledFor: null }
        : { siteId: siteIds[i], scheduledFor: r.scheduledFor },
    ),
  );
  let created = 0;
  let linked = 0;
  let updated = 0;
  let unmatched = 0;
  const claimed = new Set<string>();

  for (let i = 0; i < ok.length; i++) {
    const r = ok[i];
    const siteId = siteIds[i];
    if (!siteId) unmatched++;

    // 1. Already imported / linked on an earlier run.
    const existing = await prisma.job.findUnique({
      where: { partnerActivityRef: r.reference },
      select: {
        id: true,
        status: true,
        cancelledByUserId: true,
        siteId: true,
        startedAt: true,
        completedAt: true,
        notes: true,
      },
    });
    if (existing) {
      // A cancel the office made by hand wins — leave it.
      if (existing.status === "CANCELLED" && existing.cancelledByUserId !== null) {
        updated++;
        continue;
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
      continue;
    }

    // 2. Link to the job the site's schedule (or the office) already made.
    const cand = siteId
      ? pickCandidate(pool, siteId, r.jobType, r.scheduledFor, claimed)
      : null;
    if (cand) {
      claimed.add(cand.id);
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
      continue;
    }

    // 3. Genuinely new — create it, unallocated for the office.
    await prisma.job.create({
      data: {
        type: r.jobType as any,
        typeLabel: r.typeLabel,
        source: "PARTNER_REQUEST",
        status: r.status,
        priority: "MEDIUM",
        siteId: siteId ?? undefined,
        partnerId: partner.id,
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
  }

  return { created, linked, updated, unmatched, skipped };
}
