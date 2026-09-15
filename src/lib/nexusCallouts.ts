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
 * Used by the machine endpoint (/api/imports/nexus-callouts). Pure-ish: all DB
 * work goes through the passed PrismaClient.
 */
import type { PrismaClient } from "@prisma/client";
import { NEXUS_PARTNER_NAME, normalisePostcode } from "@/lib/nexusImport";
import { normaliseNameKey } from "@/lib/siteDuplicates";

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
  /** OPEN stubs that would be auto-dropped (fell off Nexus's list). */
  toClose: number;
  /** Activities with a reference but no matching site (still importable). */
  unmatchedSites: number;
  skipped: CalloutSkip[];
};

export type CalloutResult = {
  created: number;
  updated: number;
  /** OPEN stubs auto-cancelled because they're no longer on the dashboard. */
  closed: number;
  /** Stubs written with no linked site. */
  unmatched: number;
  skipped: CalloutSkip[];
};

/** "07/09/2026 00:00" → Date (UTC). Also accepts a bare "07/09/2026". */
export function parseNexusDateTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const [, d, mo, y, hh, mm] = m;
  const dt = new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      hh ? Number(hh) : 0,
      mm ? Number(mm) : 0,
    ),
  );
  return Number.isFinite(dt.getTime()) ? dt : null;
}

type Prepared = {
  reference: string;
  siteName: string | null;
  postcode: string | null; // normalised, or null
  typeLabel: string | null;
  scheduledFor: Date | null;
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

  return {
    ok: true,
    row: {
      reference,
      siteName: (a.siteName ?? "").trim() || null,
      postcode,
      typeLabel: (a.type ?? "").trim() || null,
      scheduledFor,
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
  byPostcode: Map<string, { id: string; name: string; partnerId: string | null }[]>,
  nexusPartnerId: string | null,
): string | null {
  if (!row.postcode) return null;
  const candidates = byPostcode.get(row.postcode);
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

/** Load a postcode → sites index for every postcode the batch references. */
async function loadSiteIndex(prisma: PrismaClient, rows: Prepared[]) {
  const postcodes = Array.from(
    new Set(rows.map((r) => r.postcode).filter((p): p is string => Boolean(p))),
  );
  const map = new Map<
    string,
    { id: string; name: string; partnerId: string | null }[]
  >();
  if (postcodes.length === 0) return map;
  const sites = await prisma.site.findMany({
    where: { postcode: { in: postcodes } },
    select: { id: true, name: true, postcode: true, partnerId: true },
  });
  for (const s of sites) {
    if (!s.postcode) continue;
    const list = map.get(s.postcode) ?? [];
    list.push({ id: s.id, name: s.name, partnerId: s.partnerId });
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

/** Report what an import would do, writing nothing. */
export async function previewNexusCallouts(
  prisma: PrismaClient,
  activities: NexusActivity[],
): Promise<CalloutSummary> {
  const { rows, skipped } = splitActivities(activities);
  const refs = rows.map((r) => r.reference);

  const existing = await prisma.job.findMany({
    where: { partnerActivityRef: { in: refs } },
    select: { partnerActivityRef: true },
  });
  const existingRefs = new Set(
    existing.map((j) => j.partnerActivityRef).filter(Boolean) as string[],
  );
  const toUpdate = rows.filter((r) => existingRefs.has(r.reference)).length;
  const toCreate = rows.length - toUpdate;

  const index = await loadSiteIndex(prisma, rows);
  const nexus = await prisma.partner.findUnique({
    where: { name: NEXUS_PARTNER_NAME },
    select: { id: true },
  });
  const unmatchedSites = rows.filter(
    (r) => matchSiteId(r, index, nexus?.id ?? null) === null,
  ).length;

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
    toCreate,
    toUpdate,
    toClose,
    unmatchedSites,
    skipped,
  };
}

/**
 * Import for real. Upserts one stub per activity (keyed on the LINK- reference)
 * and, when the batch is non-empty, auto-cancels OPEN stubs that dropped off
 * the dashboard. Never touches stubs an officer has already picked up
 * (ASSIGNED / IN_PROGRESS / …) or that a human cancelled.
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
  const index = await loadSiteIndex(prisma, rows);

  let created = 0;
  let updated = 0;
  let unmatched = 0;

  for (const row of rows) {
    const siteId = matchSiteId(row, index, nexus.id);
    if (!siteId) unmatched++;

    const existing = await prisma.job.findUnique({
      where: { partnerActivityRef: row.reference },
      select: { id: true, status: true, cancelledByUserId: true, siteId: true },
    });

    if (existing) {
      // Revive a stub *we* auto-dropped earlier that Nexus is now listing again.
      const revive =
        existing.status === "CANCELLED" && existing.cancelledByUserId === null;
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
            partnerId: nexus.id,
            ...(siteId ? { siteId } : {}),
            ...(revive
              ? { status: "OPEN", cancelledAt: null, statusBeforeCancel: null }
              : {}),
          },
        });
      } else if (siteId && existing.siteId === null) {
        await prisma.job.update({
          where: { id: existing.id },
          data: { siteId, partnerId: nexus.id, reportedViaPartnerApp: true },
        });
      }
      updated++;
    } else {
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
    }
  }

  // Auto-drop: OPEN Nexus stubs no longer on the dashboard. Guarded on a
  // non-empty batch so a transient empty read never cancels the whole board.
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

  return { created, updated, closed, unmatched, skipped };
}
