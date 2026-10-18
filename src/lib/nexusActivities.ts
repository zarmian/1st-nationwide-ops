/**
 * Nexus completed activities — turn the "Activities" report (read off the Nexus
 * Link portal, all statuses = Completed) into internal COMPLETED job stubs for
 * pay/audit. The counterpart to nexusCallouts.ts, which handles the still-to-do
 * "Upcoming Activities" from the dashboard.
 *
 * Operating-model mode 2 (partner-as-customer): Nexus sends us the work, our
 * officer attends and files in Nexus's app, we keep a stub. So every stub is
 * tied to the Nexus partner, reportedViaPartnerApp = true, and never makes a
 * ClientReport. Completed ones land at APPROVED with the attend/leave times.
 *
 * Dedup key is the LINK-… reference (Job.partnerActivityRef, UNIQUE): a re-run
 * updates the same stub, and — nicely — a completed activity that we already
 * imported as an upcoming callout upgrades that same stub to completed instead
 * of creating a second row.
 *
 * Sites are matched by SIN (Site.partnerSin) first, then postcode + name. An
 * unmatched activity still becomes a stub (address in the notes). A conservative
 * possible-duplicate flag is set when the activity looks like a job someone
 * entered by hand (same site, type, and time — no partnerActivityRef).
 *
 * A patrol or VPI at a site that's on our own patrol schedule doesn't get a
 * stub: it links to the matching patrol visit, which it completes — and a stub
 * an earlier import made for it is merged into the visit (lib/nexusVisits.ts).
 */
import type { PrismaClient } from "@prisma/client";
import { NEXUS_PARTNER_NAME, normalisePostcode } from "@/lib/nexusImport";
import { normaliseNameKey } from "@/lib/siteDuplicates";
import { ukWallClockToUtc } from "@/lib/dates";
import { snapshotVisitFinanceIfNeeded } from "@/lib/billing";
import {
  NEXUS_STUB_SELECT,
  assignVisits,
  doneDetail,
  errCode,
  isPatrolFamily,
  linkNexusVisit,
  loadVisitPool,
  nexusLinkNote,
  stubBlocker,
  updateLinkedVisit,
  type NexusStub,
  type NexusTiming,
  type NexusVisit,
  type VisitStatusT,
} from "@/lib/nexusVisits";

/** One row off the Activities report, as mapped by the robot (header → field). */
export type NexusCompletedActivity = {
  reference: string | null;
  type: string | null;
  siteName: string | null;
  address: string | null;
  sin: string | null;
  customer: string | null;
  dueDate: string | null;
  timeOnSite: string | null;
  timeOffSite: string | null;
  timeCallReceived: string | null;
  status: string | null;
};

export type ActivitySkip = { reference: string | null; reason: string };

export type ActivitiesSummary = {
  read: number;
  toCreate: number;
  toUpdate: number;
  /** Patrols / VPIs that would link to the matching visit on our schedule. */
  toLinkVisit: number;
  /** Earlier stubs that would be merged into the visit they duplicate. */
  toMerge: number;
  /** Stubs that duplicate a visit but someone has worked on — flagged ⚠. */
  toReview: number;
  unmatchedSites: number;
  possibleDuplicates: number;
  skipped: ActivitySkip[];
};

export type ActivitiesResult = {
  created: number;
  updated: number;
  linkedVisits: number;
  merged: number;
  keptForReview: number;
  unmatched: number;
  possibleDuplicates: number;
  skipped: ActivitySkip[];
};

const POSTCODE_RE = /([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/i;
const DUP_WINDOW_MS = 2 * 60 * 60 * 1000; // ±2h around the scheduled time

/** "dd/mm/yyyy HH:MM" (or a "start - end" window → start) as a UK-time instant. */
export function parseNexusDateTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const first = s.split(/\s+-\s+/)[0].trim();
  const m = first.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
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

/** The end of a "start - end" due window ("dd/mm/yyyy HH:MM", or a bare
 *  "HH:MM" on the start's day), or null when it's a single time. */
export function parseNexusWindowEnd(s: string | null | undefined): Date | null {
  if (!s) return null;
  const parts = s.split(/\s+-\s+/);
  if (parts.length < 2) return null;
  const end = parts[1].trim();
  const full = parseNexusDateTime(end);
  if (full) return full;
  const t = end.match(/^(\d{2}):(\d{2})$/);
  const d = parts[0].trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!t || !d) return null;
  return ukWallClockToUtc(Number(d[3]), Number(d[2]), Number(d[1]), Number(t[1]), Number(t[2]), 0);
}

/** Map Nexus's activity type text to one of our JobTypes. */
export function mapJobType(typeRaw: string | null | undefined): string {
  const t = (typeRaw ?? "").toLowerCase();
  if (t.includes("vacant property") || t.includes("vpi")) return "VPI";
  if (t.includes("patrol")) return "PATROL";
  if (t.includes("alarm")) return "ALARM_RESPONSE";
  if (/\bunlock/.test(t)) return "UNLOCK";
  // \block avoids matching "clock" in "Stop The Clock" (no word boundary
  // before the "lock" inside "clock").
  if (/\block/.test(t)) return "LOCK";
  return "ADHOC"; // "Stop The Clock" and anything else
}

type Prepared = {
  reference: string;
  jobType: string;
  typeLabel: string | null;
  siteName: string | null;
  postcode: string | null;
  sin: string | null;
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Due window + on-site time, for matching a visit on our schedule. */
  timing: NexusTiming;
  notes: string;
};

function extractPostcode(address: string | null): string | null {
  if (!address) return null;
  const m = address.match(POSTCODE_RE);
  return m ? normalisePostcode(`${m[1]}${m[2]}`) : null;
}

function prepare(a: NexusCompletedActivity):
  | { ok: true; row: Prepared }
  | { ok: false; skip: ActivitySkip } {
  const reference = (a.reference ?? "").trim();
  if (!reference || !/^LINK-\d+/i.test(reference)) {
    return { ok: false, skip: { reference: reference || null, reason: "no LINK reference" } };
  }
  const scheduledFor = parseNexusDateTime(a.dueDate);
  const startedAt = parseNexusDateTime(a.timeOnSite);
  const completedAt = parseNexusDateTime(a.timeOffSite);
  const sinRaw = (a.sin ?? "").trim();
  const sin = sinRaw && sinRaw.toUpperCase() !== "SIN" ? sinRaw : null;

  const notes = [
    `Nexus activity ${reference}.`,
    a.type ? `Type: ${a.type}.` : null,
    a.customer ? `Customer: ${a.customer}.` : null,
    sin ? `SIN: ${sin}.` : null,
    a.dueDate ? `Due: ${a.dueDate}.` : null,
    a.timeOnSite ? `On site: ${a.timeOnSite}.` : null,
    a.timeOffSite ? `Off site: ${a.timeOffSite}.` : null,
    a.address ? `Address: ${a.address}.` : null,
    "Imported from the Nexus activities report (filed in Nexus's app).",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ok: true,
    row: {
      reference,
      jobType: mapJobType(a.type),
      typeLabel: (a.type ?? "").trim() || null,
      siteName: (a.siteName ?? "").trim() || null,
      postcode: extractPostcode(a.address),
      sin,
      scheduledFor,
      startedAt,
      completedAt,
      timing: { start: scheduledFor, end: parseNexusWindowEnd(a.dueDate), onSite: startedAt },
      notes,
    },
  };
}

type SiteRef = { id: string; name: string; partnerId: string | null };

async function loadSiteIndex(prisma: PrismaClient, rows: Prepared[]) {
  const sins = Array.from(
    new Set(rows.map((r) => r.sin).filter((s): s is string => Boolean(s))),
  );
  const postcodes = Array.from(
    new Set(rows.map((r) => r.postcode).filter((p): p is string => Boolean(p))),
  );
  const bySin = new Map<string, SiteRef>();
  const byPostcode = new Map<string, SiteRef[]>();
  // Only look up what the rows actually carry. (A blank `{ id: "" }`
  // placeholder used to stand in for a missing list, and Postgres rejects ""
  // as a UUID — so a window whose rows had no SIN failed the whole import.)
  const lookups = [
    ...(sins.length ? [{ partnerSin: { in: sins } }] : []),
    ...(postcodes.length ? [{ postcode: { in: postcodes } }] : []),
  ];
  if (!lookups.length) return { bySin, byPostcode };
  const sites = await prisma.site.findMany({
    where: { OR: lookups },
    select: { id: true, name: true, partnerId: true, partnerSin: true, postcode: true },
  });
  for (const s of sites) {
    const ref: SiteRef = { id: s.id, name: s.name, partnerId: s.partnerId };
    if (s.partnerSin) bySin.set(s.partnerSin, ref);
    if (s.postcode) {
      const list = byPostcode.get(s.postcode) ?? [];
      list.push(ref);
      byPostcode.set(s.postcode, list);
    }
  }
  return { bySin, byPostcode };
}

export function matchSiteId(
  row: { sin: string | null; postcode: string | null; siteName: string | null },
  index: { bySin: Map<string, SiteRef>; byPostcode: Map<string, SiteRef[]> },
  nexusPartnerId: string | null,
): string | null {
  if (row.sin) {
    const hit = index.bySin.get(row.sin);
    if (hit) return hit.id;
  }
  if (!row.postcode) return null;
  const candidates = index.byPostcode.get(row.postcode);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;
  const nexusOnes = nexusPartnerId
    ? candidates.filter((c) => c.partnerId === nexusPartnerId)
    : [];
  const pool = nexusOnes.length > 0 ? nexusOnes : candidates;
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

function splitActivities(activities: NexusCompletedActivity[]) {
  const rows: Prepared[] = [];
  const skipped: ActivitySkip[] = [];
  for (const a of activities) {
    const res = prepare(a);
    if (res.ok) rows.push(res.row);
    else skipped.push(res.skip);
  }
  return { rows, skipped };
}

/** Is there a manually-entered (non-Nexus) job that this activity looks like? */
async function looksLikeManualDuplicate(
  prisma: PrismaClient,
  siteId: string,
  jobType: string,
  scheduledFor: Date | null,
): Promise<boolean> {
  if (!scheduledFor) return false;
  const hit = await prisma.job.findFirst({
    where: {
      siteId,
      partnerActivityRef: null,
      status: { not: "CANCELLED" },
      type: jobType as any,
      scheduledFor: {
        gte: new Date(scheduledFor.getTime() - DUP_WINDOW_MS),
        lte: new Date(scheduledFor.getTime() + DUP_WINDOW_MS),
      },
    },
    select: { id: true },
  });
  return Boolean(hit);
}

// ── Planning: one decision per row, shared by preview and the real run ─────

type ExistingJob = NexusStub & { possibleDuplicate: boolean };
type LinkedVisit = {
  id: string;
  status: VisitStatusT;
  arrivedAt: Date | null;
  departedAt: Date | null;
};

type Action =
  | { kind: "updateVisit"; visit: LinkedVisit }
  | { kind: "merge"; job: ExistingJob; visit: NexusVisit }
  | { kind: "review"; job: ExistingJob }
  | { kind: "updateJob"; job: ExistingJob }
  | { kind: "linkVisit"; visit: NexusVisit }
  | { kind: "create" };

/**
 * Decide what to do with every row without writing anything. Preview counts
 * the decisions; the real run carries them out, so the two can't disagree.
 *
 *   - already on a visit (LINK ref)                → bring the visit up to date
 *   - a stub with the ref that duplicates a visit:
 *       nobody's worked on it                      → merge it into the visit
 *       worked on                                  → update it, flag ⚠ for review
 *   - a stub with the ref                          → update the stub
 *   - a patrol / VPI matching a visit on our schedule → link the visit
 *   - otherwise                                    → create a stub
 */
async function planActivities(
  prisma: PrismaClient,
  rows: Prepared[],
  nexusPartnerId: string | null,
) {
  const index = await loadSiteIndex(prisma, rows);
  const siteIds = rows.map((r) => matchSiteId(r, index, nexusPartnerId));
  const refs = rows.map((r) => r.reference);
  if (refs.length === 0) return { siteIds, actions: [] as Action[] };

  // Sequential, not Promise.all — concurrent queries exhaust the pooled
  // connections on Vercel.
  const jobs = (await prisma.job.findMany({
    where: { partnerActivityRef: { in: refs } },
    select: { ...NEXUS_STUB_SELECT, possibleDuplicate: true },
  })) as ExistingJob[];
  const visits = await prisma.patrolVisit.findMany({
    where: { partnerActivityRef: { in: refs } },
    select: { id: true, status: true, arrivedAt: true, departedAt: true, partnerActivityRef: true },
  });
  const jobByRef = new Map(jobs.map((j) => [j.partnerActivityRef as string, j]));
  const visitByRef = new Map(visits.map((v) => [v.partnerActivityRef as string, v]));

  const wanted = rows.map((r, i) => {
    const siteId = siteIds[i];
    const job = jobByRef.get(r.reference);
    if (!siteId || !isPatrolFamily(r.jobType) || visitByRef.has(r.reference)) return null;
    if (job?.status === "CANCELLED" && job.cancelledByUserId) return null; // a human cancel wins
    return { siteId, timing: r.timing };
  });
  const picks = assignVisits(wanted, await loadVisitPool(prisma, wanted));

  const actions = rows.map((r, i): Action => {
    const linked = visitByRef.get(r.reference);
    if (linked) return { kind: "updateVisit", visit: linked as LinkedVisit };
    const job = jobByRef.get(r.reference);
    const visit = picks[i];
    if (job) {
      if (!visit) return { kind: "updateJob", job };
      return stubBlocker(job, visit) ? { kind: "review", job } : { kind: "merge", job, visit };
    }
    return visit ? { kind: "linkVisit", visit } : { kind: "create" };
  });
  return { siteIds, actions };
}

export async function previewNexusActivities(
  prisma: PrismaClient,
  activities: NexusCompletedActivity[],
): Promise<ActivitiesSummary> {
  const { rows, skipped } = splitActivities(activities);
  const nexus = await prisma.partner.findUnique({
    where: { name: NEXUS_PARTNER_NAME },
    select: { id: true },
  });
  const { siteIds, actions } = await planActivities(prisma, rows, nexus?.id ?? null);
  const count = (k: Action["kind"]) => actions.filter((a) => a.kind === k).length;

  let possibleDuplicates = 0;
  for (let i = 0; i < rows.length; i++) {
    const siteId = siteIds[i];
    if (
      actions[i].kind === "create" &&
      siteId &&
      (await looksLikeManualDuplicate(prisma, siteId, rows[i].jobType, rows[i].scheduledFor))
    ) {
      possibleDuplicates++;
    }
  }

  return {
    read: activities.length,
    toCreate: count("create"),
    toUpdate: count("updateJob") + count("updateVisit"),
    toLinkVisit: count("linkVisit"),
    toMerge: count("merge"),
    toReview: count("review"),
    unmatchedSites: siteIds.filter((s) => !s).length,
    possibleDuplicates,
    skipped,
  };
}

/** Bring an existing stub up to date (e.g. an upcoming callout → completed). */
async function updateStub(
  prisma: PrismaClient,
  existing: ExistingJob,
  row: Prepared,
  siteId: string | null,
  nexusPartnerId: string,
  extra: { possibleDuplicate?: boolean } = {},
): Promise<void> {
  // A human cancel wins — don't resurrect it.
  if (existing.status === "CANCELLED" && existing.cancelledByUserId !== null) return;
  await prisma.job.update({
    where: { id: existing.id },
    data: {
      type: row.jobType as any,
      typeLabel: row.typeLabel,
      status: "APPROVED",
      partnerId: nexusPartnerId,
      reportedViaPartnerApp: true,
      scheduledFor: row.scheduledFor ?? undefined,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
      notes: row.notes,
      ...(siteId && existing.siteId === null ? { siteId } : {}),
      ...(existing.status === "CANCELLED"
        ? { cancelledAt: null, statusBeforeCancel: null }
        : {}),
      ...extra,
    },
  });
}

async function createStub(
  prisma: PrismaClient,
  row: Prepared,
  siteId: string | null,
  nexusPartnerId: string,
): Promise<boolean> {
  const flagged = siteId
    ? await looksLikeManualDuplicate(prisma, siteId, row.jobType, row.scheduledFor)
    : false;
  await prisma.job.create({
    data: {
      type: row.jobType as any,
      typeLabel: row.typeLabel,
      source: "PARTNER_REQUEST",
      status: "APPROVED",
      priority: "MEDIUM",
      siteId: siteId ?? undefined,
      partnerId: nexusPartnerId,
      reportedViaPartnerApp: true,
      partnerActivityRef: row.reference,
      scheduledFor: row.scheduledFor ?? undefined,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
      possibleDuplicate: flagged,
      notes: row.notes,
    },
  });
  return flagged;
}

export async function runNexusActivities(
  prisma: PrismaClient,
  activities: NexusCompletedActivity[],
  opts: {
    /** Billing + pay snapshot for a visit this completes (tests stub it). */
    snapshotVisit?: (visitId: string) => Promise<void>;
  } = {},
): Promise<ActivitiesResult> {
  const nexus = await prisma.partner.findUnique({
    where: { name: NEXUS_PARTNER_NAME },
    select: { id: true },
  });
  if (!nexus) {
    throw new Error(
      `Partner "${NEXUS_PARTNER_NAME}" not found. Run \`npm run db:seed\` first.`,
    );
  }
  const snapshot = opts.snapshotVisit ?? snapshotVisitFinanceIfNeeded;
  const finance = (visitId: string) =>
    snapshot(visitId).catch((e) => console.error("Nexus visit finance failed:", errCode(e)));

  const { rows, skipped } = splitActivities(activities);
  const { siteIds, actions } = await planActivities(prisma, rows, nexus.id);

  let created = 0;
  let updated = 0;
  let linkedVisits = 0;
  let merged = 0;
  let keptForReview = 0;
  let possibleDuplicates = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const siteId = siteIds[i];
    const a = actions[i];
    const outcome = { done: true, onSite: row.startedAt, offSite: row.completedAt };

    switch (a.kind) {
      case "updateVisit": {
        const { completed } = await updateLinkedVisit(prisma, a.visit, outcome);
        if (completed) await finance(a.visit.id);
        updated++;
        break;
      }

      case "linkVisit":
      case "merge": {
        try {
          const { completed } = await linkNexusVisit(prisma, {
            visit: a.visit,
            ref: row.reference,
            outcome,
            notes: nexusLinkNote(
              a.visit.notes,
              row.reference,
              row.typeLabel,
              doneDetail(row.startedAt, row.completedAt),
            ),
            stub: a.kind === "merge" ? { id: a.job.id, assignedToUserId: a.job.assignedToUserId } : null,
          });
          if (completed) await finance(a.visit.id);
          if (a.kind === "merge") merged++;
          else linkedVisits++;
        } catch (e) {
          // The stub or visit changed since planning — fall back to keeping a
          // stub, as before linking existed, so nothing is dropped.
          console.error("Nexus visit link failed:", errCode(e));
          if (a.kind === "merge") {
            await updateStub(prisma, a.job, row, siteId, nexus.id);
            updated++;
          } else {
            if (await createStub(prisma, row, siteId, nexus.id)) possibleDuplicates++;
            created++;
          }
        }
        break;
      }

      case "review": {
        // Duplicates a visit on our schedule, but someone's worked on it —
        // keep it up to date and flag it for the office.
        await updateStub(prisma, a.job, row, siteId, nexus.id, { possibleDuplicate: true });
        keptForReview++;
        break;
      }

      case "updateJob": {
        await updateStub(prisma, a.job, row, siteId, nexus.id);
        updated++;
        break;
      }

      case "create": {
        if (await createStub(prisma, row, siteId, nexus.id)) possibleDuplicates++;
        created++;
        break;
      }
    }
  }

  return {
    created,
    updated,
    linkedVisits,
    merged,
    keptForReview,
    unmatched: siteIds.filter((s) => !s).length,
    possibleDuplicates,
    skipped,
  };
}
