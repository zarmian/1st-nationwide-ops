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
 */
import type { PrismaClient } from "@prisma/client";
import { NEXUS_PARTNER_NAME, normalisePostcode } from "@/lib/nexusImport";
import { normaliseNameKey } from "@/lib/siteDuplicates";
import { ukWallClockToUtc } from "@/lib/dates";

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
  unmatchedSites: number;
  possibleDuplicates: number;
  skipped: ActivitySkip[];
};

export type ActivitiesResult = {
  created: number;
  updated: number;
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
  const sites = await prisma.site.findMany({
    where: {
      OR: [
        sins.length ? { partnerSin: { in: sins } } : { id: "" },
        postcodes.length ? { postcode: { in: postcodes } } : { id: "" },
      ],
    },
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

export async function previewNexusActivities(
  prisma: PrismaClient,
  activities: NexusCompletedActivity[],
): Promise<ActivitiesSummary> {
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

  const index = await loadSiteIndex(prisma, rows);
  const nexus = await prisma.partner.findUnique({
    where: { name: NEXUS_PARTNER_NAME },
    select: { id: true },
  });
  let unmatchedSites = 0;
  let possibleDuplicates = 0;
  for (const r of rows) {
    const siteId = matchSiteId(r, index, nexus?.id ?? null);
    if (!siteId) unmatchedSites++;
    else if (
      !existingRefs.has(r.reference) &&
      (await looksLikeManualDuplicate(prisma, siteId, r.jobType, r.scheduledFor))
    ) {
      possibleDuplicates++;
    }
  }

  return {
    read: activities.length,
    toCreate: rows.length - toUpdate,
    toUpdate,
    unmatchedSites,
    possibleDuplicates,
    skipped,
  };
}

export async function runNexusActivities(
  prisma: PrismaClient,
  activities: NexusCompletedActivity[],
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

  const { rows, skipped } = splitActivities(activities);
  const index = await loadSiteIndex(prisma, rows);

  let created = 0;
  let updated = 0;
  let unmatched = 0;
  let possibleDuplicates = 0;

  for (const row of rows) {
    const siteId = matchSiteId(row, index, nexus.id);
    if (!siteId) unmatched++;

    const existing = await prisma.job.findUnique({
      where: { partnerActivityRef: row.reference },
      select: { id: true, status: true, cancelledByUserId: true, siteId: true },
    });

    if (existing) {
      // A human cancel wins — don't resurrect it.
      if (existing.status === "CANCELLED" && existing.cancelledByUserId !== null) {
        updated++;
        continue;
      }
      // Upgrade the stub (e.g. an upcoming callout) to completed.
      await prisma.job.update({
        where: { id: existing.id },
        data: {
          type: row.jobType as any,
          typeLabel: row.typeLabel,
          status: "APPROVED",
          partnerId: nexus.id,
          reportedViaPartnerApp: true,
          scheduledFor: row.scheduledFor ?? undefined,
          startedAt: row.startedAt ?? undefined,
          completedAt: row.completedAt ?? undefined,
          notes: row.notes,
          ...(siteId && existing.siteId === null ? { siteId } : {}),
          ...(existing.status === "CANCELLED"
            ? { cancelledAt: null, statusBeforeCancel: null }
            : {}),
        },
      });
      updated++;
      continue;
    }

    const flagged = siteId
      ? await looksLikeManualDuplicate(prisma, siteId, row.jobType, row.scheduledFor)
      : false;
    if (flagged) possibleDuplicates++;

    await prisma.job.create({
      data: {
        type: row.jobType as any,
        typeLabel: row.typeLabel,
        source: "PARTNER_REQUEST",
        status: "APPROVED",
        priority: "MEDIUM",
        siteId: siteId ?? undefined,
        partnerId: nexus.id,
        reportedViaPartnerApp: true,
        partnerActivityRef: row.reference,
        scheduledFor: row.scheduledFor ?? undefined,
        startedAt: row.startedAt ?? undefined,
        completedAt: row.completedAt ?? undefined,
        possibleDuplicate: flagged,
        notes: row.notes,
      },
    });
    created++;
  }

  return { created, updated, unmatched, possibleDuplicates, skipped };
}
