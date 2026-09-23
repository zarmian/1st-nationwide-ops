/**
 * Keyholding Company jobs — turn the rows read off the Chase2Base "Jobs"
 * screen (scripts/keyholding-jobs.mjs) into job records.
 *
 * Operating-model mode 2 (partner-as-customer): Keyholding sends us the work,
 * our officer attends and files in their app, and we keep a record. So every
 * job is tied to the Keyholding partner, reportedViaPartnerApp = true, and
 * never makes a ClientReport.
 *
 * Rules agreed with the operator:
 *   - Dedup on the Keyholding job number ("#", e.g. J21634508 or J21816769/9)
 *     stored in Job.partnerActivityRef (UNIQUE) — re-runs update, never duplicate.
 *   - Officers are NOT taken from Keyholding's Executor column: jobs import
 *     unallocated and the office allocates them. Re-imports never touch an
 *     officer the office has assigned.
 *   - Sites: most already exist (with schedules), so match by postcode (then
 *     property name). A job that looks like one already in the system — same
 *     site, type and time, entered by hand or generated from a schedule — is
 *     created but flagged possibleDuplicate so the office can reconcile it,
 *     rather than silently merged.
 *   - Status follows Keyholding's Execution Status (Done → completed,
 *     Cancelled → cancelled, Booked/Allocated/Waiting → open, At Location →
 *     in progress).
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
  toCreate: number;
  toUpdate: number;
  unmatchedSites: number;
  possibleDuplicates: number;
  byStatus: Record<string, number>;
  skipped: KhSkip[];
};

export type KhResult = {
  created: number;
  updated: number;
  unmatched: number;
  possibleDuplicates: number;
  skipped: KhSkip[];
};

const POSTCODE_RE = /([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/i;
const DUP_WINDOW_MS = 3 * 60 * 60 * 1000; // ±3h around the scheduled time

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
  status: "OPEN" | "IN_PROGRESS" | "APPROVED" | "CANCELLED";
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

type Prepared = {
  reference: string;
  jobType: string;
  typeLabel: string | null;
  status: "OPEN" | "IN_PROGRESS" | "APPROVED" | "CANCELLED";
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
    `Keyholding job ${reference}.`,
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

/** Does a job already exist here that this looks like (hand-entered or from a schedule)? */
async function looksLikeExisting(
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

  let unmatchedSites = 0;
  let possibleDuplicates = 0;
  const byStatus: Record<string, number> = {};
  for (const r of ok) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const siteId = matchKhSiteId(r, index, partner?.id ?? null);
    if (!siteId) unmatchedSites++;
    else if (!seen.has(r.reference) && (await looksLikeExisting(prisma, siteId, r.jobType, r.scheduledFor))) {
      possibleDuplicates++;
    }
  }
  const toUpdate = ok.filter((r) => seen.has(r.reference)).length;
  return {
    read: rows.length,
    toCreate: ok.length - toUpdate,
    toUpdate,
    unmatchedSites,
    possibleDuplicates,
    byStatus,
    skipped,
  };
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
  let created = 0;
  let updated = 0;
  let unmatched = 0;
  let possibleDuplicates = 0;

  for (const r of ok) {
    const siteId = matchKhSiteId(r, index, partner.id);
    if (!siteId) unmatched++;

    const existing = await prisma.job.findUnique({
      where: { partnerActivityRef: r.reference },
      select: { id: true, status: true, cancelledByUserId: true, cancelledAt: true, siteId: true },
    });

    if (existing) {
      // A cancel the office made by hand wins — don't resurrect it.
      if (existing.status === "CANCELLED" && existing.cancelledByUserId !== null) {
        updated++;
        continue;
      }
      const cancelling = r.status === "CANCELLED" && existing.status !== "CANCELLED";
      await prisma.job.update({
        where: { id: existing.id },
        data: {
          type: r.jobType as any,
          typeLabel: r.typeLabel,
          status: r.status,
          partnerId: partner.id,
          reportedViaPartnerApp: true,
          scheduledFor: r.scheduledFor ?? undefined,
          startedAt: r.startedAt ?? undefined,
          completedAt: r.completedAt ?? undefined,
          notes: r.notes,
          // Keep the office's allocation; only fill a site match if missing.
          ...(siteId && existing.siteId === null ? { siteId } : {}),
          ...(cancelling
            ? { cancelledAt: new Date(), statusBeforeCancel: existing.status as any }
            : {}),
          ...(r.status !== "CANCELLED" && existing.status === "CANCELLED"
            ? { cancelledAt: null, statusBeforeCancel: null }
            : {}),
        },
      });
      updated++;
      continue;
    }

    const flagged = siteId
      ? await looksLikeExisting(prisma, siteId, r.jobType, r.scheduledFor)
      : false;
    if (flagged) possibleDuplicates++;

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
        possibleDuplicate: flagged,
        notes: r.notes,
      },
    });
    created++;
  }

  return { created, updated, unmatched, possibleDuplicates, skipped };
}
