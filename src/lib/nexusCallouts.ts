/**
 * Nexus callouts — turn the "Upcoming Activities" read off the Nexus Link
 * dashboard (see scripts/nexus-callouts.mjs) into internal job stubs so the
 * office can assign an officer without re-keying anything.
 *
 * These are partner-as-customer jobs (operating-model mode 2): Nexus sends us
 * the VPI, our officer attends and fills in *Nexus's* app, and we keep a stub
 * for pay/audit. So every stub is `reportedViaPartnerApp = true`, tied to the
 * Nexus partner, and never produces a ClientReport.
 *
 * Dedup key is the activity's `LINK-…` reference (Job.partnerActivityRef,
 * UNIQUE): a re-run updates the same stub instead of duplicating, and two
 * genuine callouts on one site (different references, different windows) stay
 * two stubs. Sites are matched by postcode (then by name when a postcode is
 * shared); an unmatched activity still becomes a stub with the address in the
 * notes so nothing is silently dropped.
 *
 * A patrol or VPI at a site that's on our own patrol schedule doesn't get a
 * stub: it links to the matching patrol visit (inside its due window), and an
 * open stub an earlier run made for it is merged into the visit
 * (lib/nexusVisits.ts). The auto-drop below only ever cancels job stubs —
 * never a visit on our schedule.
 *
 * Used by the machine endpoint (/api/imports/nexus-callouts). Pure-ish: all DB
 * work goes through the passed PrismaClient.
 */
import type { PrismaClient } from "@prisma/client";
import { NEXUS_PARTNER_NAME, normalisePostcode } from "@/lib/nexusImport";
import { normaliseNameKey } from "@/lib/siteDuplicates";
import { ukWallClockToUtc } from "@/lib/dates";
import { mapJobType } from "@/lib/nexusActivities";
import {
  NEXUS_STUB_SELECT,
  assignVisits,
  errCode,
  isPatrolFamily,
  linkNexusVisit,
  loadVisitPool,
  nexusLinkNote,
  stubBlocker,
  type NexusStub,
  type NexusTiming,
  type NexusVisit,
} from "@/lib/nexusVisits";

/** One parsed row from the dashboard reader. Matches nexus-callouts.mjs. */
export type NexusActivity = {
  reference: string | null;
  type: string | null;
  siteName: string | null;
  address: string | null;
  postcode: string | null;
  service: string | null;
  dueStart: string | null;
  dueEnd: string | null;
  status: string | null;
  raw?: string[];
};

export type CalloutSkip = { reference: string | null; reason: string };

export type CalloutSummary = {
  read: number;
  toCreate: number;
  toUpdate: number;
  /** Patrols / VPIs that would link to the matching visit on our schedule. */
  toLinkVisit: number;
  /** Open stubs that would be merged into the visit they duplicate. */
  toMerge: number;
  /** Stubs that duplicate a visit but someone has worked on — flagged ⚠. */
  toReview: number;
  /** OPEN stubs that would be auto-dropped (fell off Nexus's list). */
  toClose: number;
  /** Activities with a reference but no matching site (still importable). */
  unmatchedSites: number;
  skipped: CalloutSkip[];
};

export type CalloutResult = {
  created: number;
  updated: number;
  linkedVisits: number;
  merged: number;
  keptForReview: number;
  /** OPEN stubs auto-cancelled because they're no longer on the dashboard. */
  closed: number;
  /** Stubs written with no linked site. */
  unmatched: number;
  skipped: CalloutSkip[];
  /** The callouts newly created this run — for the "new callouts" alert. */
  newCallouts: {
    reference: string;
    siteName: string | null;
    postcode: string | null;
    scheduledFor: Date | null;
  }[];
};

/** "07/09/2026 00:00" → Date. The dashboard shows UK wall-clock times (as the
 *  Activities report does), so 19:00 in summer is 18:00 UTC. Also accepts a
 *  bare "07/09/2026" (UK midnight). */
export function parseNexusDateTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const [, d, mo, y, hh, mm] = m;
  const dt = ukWallClockToUtc(
    Number(y),
    Number(mo),
    Number(d),
    hh ? Number(hh) : 0,
    mm ? Number(mm) : 0,
    0,
  );
  return Number.isFinite(dt.getTime()) ? dt : null;
}

type Prepared = {
  reference: string;
  siteName: string | null;
  postcode: string | null; // normalised, or null
  typeLabel: string | null;
  scheduledFor: Date | null;
  /** A patrol or VPI by its type — the kind that can be a visit on our schedule. */
  patrol: boolean;
  /** Due window, for matching a visit on our schedule. */
  timing: NexusTiming;
  /** The window as Nexus shows it, for the visit's note. */
  window: string;
  notes: string;
};

/** Turn a raw activity into the fields we store, or a skip reason. */
function prepare(a: NexusActivity):
  | { ok: true; row: Prepared }
  | { ok: false; skip: CalloutSkip } {
  const reference = (a.reference ?? "").trim();
  if (!reference) {
    return { ok: false, skip: { reference: null, reason: "no reference" } };
  }

  const start = parseNexusDateTime(a.dueStart);
  const end = parseNexusDateTime(a.dueEnd);
  // Sort/urgency key: the completion deadline (window end). Falling back to the
  // window start, then null, keeps a malformed date from dropping the row —
  // it just lands undated on the board for the office to schedule.
  const scheduledFor = end ?? start ?? null;

  const postcode = a.postcode ? normalisePostcode(a.postcode) : null;
  const service = (a.service ?? "").trim();
  const window =
    a.dueStart && a.dueEnd
      ? `${a.dueStart} – ${a.dueEnd}`
      : a.dueStart || a.dueEnd || "no window given";

  const notes = [
    `Nexus callout ${reference}${service ? ` (${service})` : ""}.`,
    `Window ${window}.`,
    a.status ? `Nexus status: ${a.status}.` : null,
    a.address ? `Address: ${a.address}.` : null,
    "Imported from the Nexus dashboard — assign an officer; the report is filed in Nexus's app.",
  ]
    .filter(Boolean)
    .join(" ");

  const typeLabel = (a.type ?? "").trim() || null;
  return {
    ok: true,
    row: {
      reference,
      siteName: (a.siteName ?? "").trim() || null,
      postcode,
      typeLabel,
      scheduledFor,
      patrol: isPatrolFamily(mapJobType(typeLabel)),
      timing: { start, end, onSite: null },
      window,
      notes,
    },
  };
}

/**
 * Best-effort site match: unique postcode wins; when several sites share a
 * postcode, prefer a Nexus-partner site, then the closest name, else the first.
 * Returns null when nothing matches (the stub is still created, site-less).
 */
export function matchSiteId(
  row: { postcode: string | null; siteName: string | null },
  byPostcode: Map<string, { id: string; name: string; partnerId: string | null; active?: boolean }[]>,
  nexusPartnerId: string | null,
): string | null {
  if (!row.postcode) return null;
  const candidates = byPostcode.get(row.postcode);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;

  const nexusOnes = nexusPartnerId
    ? candidates.filter((c) => c.partnerId === nexusPartnerId)
    : [];
  const partnerPool = nexusOnes.length > 0 ? nexusOnes : candidates;
  // A switched-off site loses to a live one at the same postcode — e.g. a
  // duplicate record merged into the real site (lib/siteMerge.ts).
  const live = partnerPool.filter((c) => c.active !== false);
  const pool = live.length > 0 ? live : partnerPool;
  if (pool.length === 1) return pool[0].id;

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

/** Load a postcode → sites index for every postcode the batch references. */
async function loadSiteIndex(prisma: PrismaClient, rows: Prepared[]) {
  const postcodes = Array.from(
    new Set(rows.map((r) => r.postcode).filter((p): p is string => Boolean(p))),
  );
  const map = new Map<
    string,
    { id: string; name: string; partnerId: string | null; active: boolean }[]
  >();
  if (postcodes.length === 0) return map;
  const sites = await prisma.site.findMany({
    where: { postcode: { in: postcodes } },
    select: { id: true, name: true, postcode: true, partnerId: true, active: true },
  });
  for (const s of sites) {
    if (!s.postcode) continue;
    const list = map.get(s.postcode) ?? [];
    list.push({ id: s.id, name: s.name, partnerId: s.partnerId, active: s.active });
    map.set(s.postcode, list);
  }
  return map;
}

function splitActivities(activities: NexusActivity[]) {
  const rows: Prepared[] = [];
  const skipped: CalloutSkip[] = [];
  for (const a of activities) {
    const res = prepare(a);
    if (res.ok) rows.push(res.row);
    else skipped.push(res.skip);
  }
  return { rows, skipped };
}

// ── Planning: one decision per row, shared by preview and the real run ─────

type ExistingStub = NexusStub & { possibleDuplicate: boolean };

type Action =
  | { kind: "onVisit" }
  | { kind: "merge"; job: ExistingStub; visit: NexusVisit }
  | { kind: "review"; job: ExistingStub }
  | { kind: "updateJob"; job: ExistingStub }
  | { kind: "linkVisit"; visit: NexusVisit }
  | { kind: "create" };

/**
 * Decide what to do with every row without writing anything:
 *
 *   - already on a visit (LINK ref)                    → nothing to change
 *   - a stub with the ref that duplicates a visit:
 *       nobody's worked on it                          → merge it into the visit
 *       worked on                                      → keep it, flag ⚠ for review
 *   - a stub with the ref                              → refresh the stub
 *   - a patrol / VPI with a visit inside its window    → link the visit
 *   - otherwise                                        → create a stub
 */
async function planCallouts(
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
  })) as ExistingStub[];
  const onVisits = await prisma.patrolVisit.findMany({
    where: { partnerActivityRef: { in: refs } },
    select: { partnerActivityRef: true },
  });
  const jobByRef = new Map(jobs.map((j) => [j.partnerActivityRef as string, j]));
  const visitRefs = new Set(onVisits.map((v) => v.partnerActivityRef as string));

  const wanted = rows.map((r, i) => {
    const siteId = siteIds[i];
    const job = jobByRef.get(r.reference);
    if (!siteId || !r.patrol || visitRefs.has(r.reference)) return null;
    if (job?.status === "CANCELLED" && job.cancelledByUserId) return null; // a human cancel wins
    return { siteId, timing: r.timing };
  });
  const picks = assignVisits(wanted, await loadVisitPool(prisma, wanted));

  const actions = rows.map((r, i): Action => {
    if (visitRefs.has(r.reference)) return { kind: "onVisit" };
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

/** Report what an import would do, writing nothing. */
export async function previewNexusCallouts(
  prisma: PrismaClient,
  activities: NexusActivity[],
): Promise<CalloutSummary> {
  const { rows, skipped } = splitActivities(activities);
  const refs = rows.map((r) => r.reference);
  const nexus = await prisma.partner.findUnique({
    where: { name: NEXUS_PARTNER_NAME },
    select: { id: true },
  });
  const { siteIds, actions } = await planCallouts(prisma, rows, nexus?.id ?? null);
  const count = (k: Action["kind"]) => actions.filter((a) => a.kind === k).length;

  // Would-drop count: OPEN Nexus stubs not present in this (non-empty) batch.
  let toClose = 0;
  if (rows.length > 0) {
    toClose = await prisma.job.count({
      where: {
        reportedViaPartnerApp: true,
        status: "OPEN",
        AND: [
          { partnerActivityRef: { startsWith: "LINK-" } },
          { partnerActivityRef: { notIn: refs } },
        ],
      },
    });
  }

  return {
    read: activities.length,
    toCreate: count("create"),
    toUpdate: count("updateJob") + count("onVisit"),
    toLinkVisit: count("linkVisit"),
    toMerge: count("merge"),
    toReview: count("review"),
    toClose,
    unmatchedSites: siteIds.filter((s) => !s).length,
    skipped,
  };
}

/** Refresh an existing stub from the dashboard (the pre-linking behaviour). */
async function updateStub(
  prisma: PrismaClient,
  existing: ExistingStub,
  row: Prepared,
  siteId: string | null,
  nexusPartnerId: string,
  extra: { possibleDuplicate?: boolean } = {},
): Promise<void> {
  // Revive a stub *we* auto-dropped earlier that Nexus is now listing again.
  const revive = existing.status === "CANCELLED" && existing.cancelledByUserId === null;
  // Only refresh the human-facing fields while the stub is still untouched
  // (OPEN) or being revived. Once a dispatcher has picked it up or edited
  // it, we must not clobber their notes / reschedule — just keep the link
  // and backfill a missing site match.
  if (existing.status === "OPEN" || revive) {
    await prisma.job.update({
      where: { id: existing.id },
      data: {
        typeLabel: row.typeLabel,
        scheduledFor: row.scheduledFor,
        notes: row.notes,
        reportedViaPartnerApp: true,
        partnerId: nexusPartnerId,
        ...(siteId ? { siteId } : {}),
        ...(revive ? { status: "OPEN", cancelledAt: null, statusBeforeCancel: null } : {}),
        ...extra,
      },
    });
  } else if ((siteId && existing.siteId === null) || (extra.possibleDuplicate && !existing.possibleDuplicate)) {
    await prisma.job.update({
      where: { id: existing.id },
      data: {
        ...(siteId && existing.siteId === null
          ? { siteId, partnerId: nexusPartnerId, reportedViaPartnerApp: true }
          : {}),
        ...extra,
      },
    });
  }
}

/**
 * Import for real. Upserts one stub per activity (keyed on the LINK- reference)
 * — or links it to the visit on our schedule — and, when the batch is
 * non-empty, auto-cancels OPEN stubs that dropped off the dashboard. Never
 * touches stubs an officer has already picked up (ASSIGNED / IN_PROGRESS / …)
 * or that a human cancelled, and never a patrol visit.
 */
export async function runNexusCallouts(
  prisma: PrismaClient,
  activities: NexusActivity[],
  source: string = `Nexus callouts ${new Date().toISOString().slice(0, 10)}`,
): Promise<CalloutResult> {
  const nexus = await prisma.partner.findUnique({
    where: { name: NEXUS_PARTNER_NAME },
    select: { id: true },
  });
  if (!nexus) {
    throw new Error(
      `Partner "${NEXUS_PARTNER_NAME}" not found. Run \`npm run db:seed\` first.`,
    );
  }

  const { rows, skipped } = splitActivities(activities);
  const { siteIds, actions } = await planCallouts(prisma, rows, nexus.id);

  let created = 0;
  let updated = 0;
  let linkedVisits = 0;
  let merged = 0;
  let keptForReview = 0;
  const newCallouts: CalloutResult["newCallouts"] = [];

  const createStub = async (row: Prepared, siteId: string | null) => {
    await prisma.job.create({
      data: {
        type: "VPI",
        typeLabel: row.typeLabel,
        source: "PARTNER_REQUEST",
        status: "OPEN",
        priority: "MEDIUM",
        siteId: siteId ?? undefined,
        partnerId: nexus.id,
        reportedViaPartnerApp: true,
        partnerActivityRef: row.reference,
        scheduledFor: row.scheduledFor ?? undefined,
        notes: row.notes,
      },
    });
    created++;
    newCallouts.push({
      reference: row.reference,
      siteName: row.siteName,
      postcode: row.postcode,
      scheduledFor: row.scheduledFor,
    });
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const siteId = siteIds[i];
    const a = actions[i];

    switch (a.kind) {
      case "onVisit": {
        // Already the visit on our schedule — nothing to change until it's
        // done (the activities import completes it).
        updated++;
        break;
      }

      case "linkVisit":
      case "merge": {
        try {
          await linkNexusVisit(prisma, {
            visit: a.visit,
            ref: row.reference,
            outcome: { done: false, onSite: null, offSite: null },
            notes: nexusLinkNote(a.visit.notes, row.reference, row.typeLabel, `due ${row.window}`),
            stub: a.kind === "merge" ? { id: a.job.id, assignedToUserId: a.job.assignedToUserId } : null,
          });
          if (a.kind === "merge") merged++;
          else linkedVisits++;
        } catch (e) {
          // The stub or visit changed since planning — fall back to a stub,
          // as before linking existed, so nothing is dropped.
          console.error("Nexus visit link failed:", errCode(e));
          if (a.kind === "merge") {
            await updateStub(prisma, a.job, row, siteId, nexus.id);
            updated++;
          } else {
            await createStub(row, siteId);
          }
        }
        break;
      }

      case "review": {
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
        await createStub(row, siteId);
        break;
      }
    }
  }

  // Auto-drop: OPEN Nexus stubs no longer on the dashboard. Guarded on a
  // non-empty batch so a transient empty read never cancels the whole board.
  // Job stubs only — a visit on our schedule is never cancelled from here.
  let closed = 0;
  if (rows.length > 0) {
    const refs = rows.map((r) => r.reference);
    const stale = await prisma.job.findMany({
      where: {
        reportedViaPartnerApp: true,
        status: "OPEN",
        AND: [
          { partnerActivityRef: { startsWith: "LINK-" } },
          { partnerActivityRef: { notIn: refs } },
        ],
      },
      select: { id: true, notes: true },
    });
    const droppedOn = new Date().toISOString().slice(0, 10);
    for (const j of stale) {
      await prisma.job.update({
        where: { id: j.id },
        data: {
          status: "CANCELLED",
          statusBeforeCancel: "OPEN",
          cancelledAt: new Date(),
          notes: `${j.notes ? `${j.notes} ` : ""}[${source}] Auto-dropped ${droppedOn}: no longer listed on the Nexus dashboard.`,
        },
      });
      closed++;
    }
  }

  return {
    created,
    updated,
    linkedVisits,
    merged,
    keptForReview,
    closed,
    unmatched: siteIds.filter((s) => !s).length,
    skipped,
    newCallouts,
  };
}
