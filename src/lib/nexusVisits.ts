/**
 * Nexus patrols ↔ our own patrol visits.
 *
 * Some Nexus sites are on our patrol schedule too. Swail House: our schedule
 * makes a 22:00 visit, and Nexus sends the same patrol with a 19:00–23:00
 * window. Both Nexus imports used to make a job stub for it, so the one patrol
 * showed twice. Now a Nexus patrol or VPI is matched to the visit and its
 * LINK-… reference goes on the visit instead (PatrolVisit.partnerActivityRef),
 * the way Keyholding patrols already link (lib/keyholdingJobs.ts):
 *
 *   - Match: same site; a visit that isn't cancelled or linked to another
 *     activity; whose time fits — within 3 h of when the officer was on site,
 *     or inside the due window (an hour's slack either side; windows up to a
 *     day — a week-long VPI window can't be pinned to one visit). Best fit
 *     first, one visit per activity.
 *   - A completed activity moves the visit forward to completed (never back),
 *     fills in arrival / departure times it lacks, and snapshots billing and
 *     officer pay where missing — as when the office closes a visit for an
 *     officer. The officer, client and partner are never taken from Nexus.
 *   - A stub an earlier import made for the same patrol is merged into the
 *     visit (reference moved, stub deleted, its officer carried over when the
 *     visit has none) — only if nobody has worked on it. Otherwise it stays,
 *     flagged ⚠ possible duplicate for the office.
 *
 * mergeNexusDuplicates sweeps up the stubs made before this (the imports only
 * see the last few days): this month's, nightly from the patrol-visits cron and
 * on demand from Patrols → Clean up duplicates. Earlier months are left as they
 * were — their pay and billing are already done.
 */
import type { PrismaClient } from "@prisma/client";
import { formatDateTime, formatTime, ukDayString, ukWallClockToUtc } from "@/lib/dates";

const HOUR = 60 * 60 * 1000;
/** On-site time ↔ visit time, either way. */
export const NEXUS_LINK_MS = 3 * HOUR;
/** Slack either side of a due window. */
export const WINDOW_PAD_MS = HOUR;
/** Longer windows (a week-long VPI) are too wide to pin to one visit. */
export const MAX_WINDOW_MS = 24 * HOUR;

export type VisitStatusT =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "LATE"
  | "MISSED"
  | "CANCELLED";

/** When a Nexus activity is due, and when the officer was on site (if done). */
export type NexusTiming = {
  start: Date | null;
  end: Date | null;
  onSite: Date | null;
};

/** What a Nexus activity tells us about the visit it is. */
export type NexusOutcome = { done: boolean; onSite: Date | null; offSite: Date | null };

export const isPatrolFamily = (type: string | null | undefined): boolean =>
  type === "PATROL" || type === "VPI";

// ── Pure rules ────────────────────────────────────────────────────────────

/**
 * How well a visit at `at` fits a Nexus activity — lower is better, null when
 * it doesn't fit at all.
 */
export function visitFit(t: NexusTiming, at: Date): number | null {
  const x = at.getTime();
  const s = t.start?.getTime() ?? null;
  const e = t.end?.getTime() ?? null;
  const hasWindow = s != null && e != null && e >= s;
  const window = hasWindow && e - s <= MAX_WINDOW_MS ? { s, e } : null;
  const inWindow =
    window != null && x >= window.s - WINDOW_PAD_MS && x <= window.e + WINDOW_PAD_MS;

  if (t.onSite) {
    const gap = Math.abs(x - t.onSite.getTime());
    return gap <= NEXUS_LINK_MS || inWindow ? gap : null;
  }
  if (window) {
    if (!inWindow) return null;
    const outside = x < window.s ? window.s - x : x > window.e ? x - window.e : 0;
    // Inside the window beats the slack around it; then nearest the middle.
    return outside > 0 ? MAX_WINDOW_MS + outside : Math.abs(x - (window.s + window.e) / 2);
  }
  if (hasWindow) return null;
  const single = s ?? e;
  if (single == null) return null;
  const gap = Math.abs(x - single);
  return gap <= NEXUS_LINK_MS ? gap : null;
}

/**
 * Pair activities with visits at the same site: best fit first across the
 * whole batch, each visit used once. So a site with two patrols a night pairs
 * each Nexus activity with its own visit. Returns the visit per row (or null).
 */
export function assignVisits<V extends { id: string; siteId: string; scheduledAt: Date }>(
  rows: ({ siteId: string; timing: NexusTiming } | null)[],
  visits: V[],
): (V | null)[] {
  const bySite = new Map<string, V[]>();
  for (const v of visits) bySite.set(v.siteId, [...(bySite.get(v.siteId) ?? []), v]);
  const cands: { i: number; v: V; score: number }[] = [];
  rows.forEach((r, i) => {
    if (!r) return;
    for (const v of bySite.get(r.siteId) ?? []) {
      const score = visitFit(r.timing, v.scheduledAt);
      if (score != null) cands.push({ i, v, score });
    }
  });
  cands.sort(
    (a, b) =>
      a.score - b.score || a.v.scheduledAt.getTime() - b.v.scheduledAt.getTime() || a.i - b.i,
  );
  const out: (V | null)[] = rows.map(() => null);
  const used = new Set<string>();
  for (const c of cands) {
    if (out[c.i] || used.has(c.v.id)) continue;
    out[c.i] = c.v;
    used.add(c.v.id);
  }
  return out;
}

/** The visit's new status, or null to leave it: done → completed (including
 *  one we'd marked late or missed), never back, never a cancelled visit. */
export function nexusVisitStatus(current: VisitStatusT, done: boolean): VisitStatusT | null {
  if (!done || current === "COMPLETED" || current === "CANCELLED") return null;
  return "COMPLETED";
}

/** Fields that bring a visit up to date: status forward, missing times filled. */
export function visitUpdate(
  v: { status: VisitStatusT; arrivedAt: Date | null; departedAt: Date | null },
  o: NexusOutcome,
): { status?: VisitStatusT; arrivedAt?: Date; departedAt?: Date } {
  if (v.status === "CANCELLED") return {};
  const next = nexusVisitStatus(v.status, o.done);
  return {
    ...(next ? { status: next } : {}),
    ...(!v.arrivedAt && o.onSite ? { arrivedAt: o.onSite } : {}),
    ...(!v.departedAt && o.offSite ? { departedAt: o.offSite } : {}),
  };
}

/** A stub's state, as far as merging it away is concerned. */
export type StubFacts = {
  status: string;
  cancelledByUserId: string | null;
  assignedToUserId: string | null;
  invoiceId: string | null;
  billedAmount: unknown;
  paidAmount: unknown;
  handledByPartnerId: string | null;
  recordedByUserId: string | null;
  patrolVisitId: string | null;
  _count: { formSubmissions: number; fastfieldReports: number };
};

/**
 * Why a Nexus stub can't be merged into its visit, or null when it can:
 * merging deletes the stub, so only one nobody has worked on goes.
 */
export function stubBlocker(
  j: StubFacts,
  v: { officerId: string | null; handledByPartnerId: string | null },
): string | null {
  if (j.status === "CANCELLED" && j.cancelledByUserId) return "cancelled by hand";
  if (j.status === "IN_PROGRESS") return "in progress";
  if (j.invoiceId) return "invoiced";
  if (j.billedAmount != null || j.paidAmount != null) return "has billing or pay";
  if (j._count.formSubmissions > 0 || j._count.fastfieldReports > 0) return "has a report";
  if (j.handledByPartnerId) return "handed to a partner";
  if (j.recordedByUserId) return "recorded by the office";
  if (j.patrolVisitId) return "tied to a patrol visit";
  if (
    j.assignedToUserId &&
    (v.handledByPartnerId || (v.officerId && v.officerId !== j.assignedToUserId))
  ) {
    return "a different officer";
  }
  return null;
}

/** The note added to a visit when a Nexus activity is linked to it. */
export function nexusLinkNote(
  existing: string | null,
  ref: string,
  label: string | null,
  detail: string | null,
): string {
  const line = `[Nexus activity ${ref}${label ? ` (${label})` : ""}${detail ? ` — ${detail}` : ""}. Filed in Nexus's app.]`;
  return existing ? `${existing}\n${line}` : line;
}

/** "done, on site 17 Oct, 22:05 to 22:20" — for the link note. */
export function doneDetail(onSite: Date | null, offSite: Date | null): string {
  if (!onSite) return "done";
  return `done, on site ${formatDateTime(onSite)}${offSite ? ` to ${formatTime(offSite)}` : ""}`;
}

// ── Database ──────────────────────────────────────────────────────────────

export const NEXUS_VISIT_SELECT = {
  id: true,
  siteId: true,
  status: true,
  scheduledAt: true,
  scheduleDate: true,
  arrivedAt: true,
  departedAt: true,
  officerId: true,
  handledByPartnerId: true,
  notes: true,
} as const;

export type NexusVisit = {
  id: string;
  siteId: string;
  status: VisitStatusT;
  scheduledAt: Date;
  scheduleDate: Date | null;
  arrivedAt: Date | null;
  departedAt: Date | null;
  officerId: string | null;
  handledByPartnerId: string | null;
  notes: string | null;
};

export const NEXUS_STUB_SELECT = {
  id: true,
  status: true,
  cancelledByUserId: true,
  siteId: true,
  type: true,
  partnerActivityRef: true,
  assignedToUserId: true,
  invoiceId: true,
  billedAmount: true,
  paidAmount: true,
  handledByPartnerId: true,
  recordedByUserId: true,
  patrolVisitId: true,
  _count: { select: { formSubmissions: true, fastfieldReports: true } },
} as const;

export type NexusStub = StubFacts & {
  id: string;
  siteId: string | null;
  type: string;
  partnerActivityRef: string | null;
};

/** Unlinked, live visits at the rows' sites over the span their times cover. */
export async function loadVisitPool(
  prisma: PrismaClient,
  rows: ({ siteId: string; timing: NexusTiming } | null)[],
): Promise<NexusVisit[]> {
  const usable = rows.filter((r): r is { siteId: string; timing: NexusTiming } => r != null);
  let min = Infinity;
  let max = -Infinity;
  for (const r of usable) {
    for (const d of [r.timing.start, r.timing.end, r.timing.onSite]) {
      if (!d) continue;
      min = Math.min(min, d.getTime());
      max = Math.max(max, d.getTime());
    }
  }
  if (!Number.isFinite(min)) return [];
  return (await prisma.patrolVisit.findMany({
    where: {
      siteId: { in: Array.from(new Set(usable.map((r) => r.siteId))) },
      partnerActivityRef: null,
      status: { not: "CANCELLED" },
      scheduledAt: { gte: new Date(min - NEXUS_LINK_MS), lte: new Date(max + NEXUS_LINK_MS) },
    },
    select: NEXUS_VISIT_SELECT,
  })) as NexusVisit[];
}

/** Thrown inside a merge when the stub changed after it was planned. */
class StubChanged extends Error {
  code = "STUB_CHANGED";
}

/**
 * Put a Nexus activity on its visit — the reference, a note, and (unless
 * `bringUpToDate` is false) the status and times — folding in the stub an
 * earlier import made for it, when there is one. One transaction: the stub is
 * deleted only if it's still as planned (not invoiced, priced or re-assigned
 * since) and the visit is still free. Logged in the visit's history.
 */
export async function linkNexusVisit(
  prisma: PrismaClient,
  a: {
    visit: NexusVisit;
    ref: string;
    outcome: NexusOutcome;
    notes: string;
    stub?: { id: string; assignedToUserId: string | null } | null;
    bringUpToDate?: boolean;
  },
): Promise<{ completed: boolean }> {
  const up = a.bringUpToDate === false ? {} : visitUpdate(a.visit, a.outcome);
  const officer =
    a.stub?.assignedToUserId && !a.visit.officerId && !a.visit.handledByPartnerId
      ? { officerId: a.stub.assignedToUserId }
      : {};
  await prisma.$transaction(async (tx) => {
    if (a.stub) {
      const gone = await tx.job.deleteMany({
        where: {
          id: a.stub.id,
          partnerActivityRef: a.ref,
          assignedToUserId: a.stub.assignedToUserId,
          invoiceId: null,
          billedAmount: null,
          paidAmount: null,
        },
      });
      if (gone.count !== 1) throw new StubChanged();
    }
    const done = await tx.patrolVisit.updateMany({
      where: { id: a.visit.id, partnerActivityRef: null, status: { not: "CANCELLED" } },
      data: { partnerActivityRef: a.ref, ...up, ...officer, notes: a.notes },
    });
    if (done.count !== 1) throw new StubChanged();
    await tx.activityLog.create({
      data: {
        entity: "PatrolVisit",
        entityId: a.visit.id,
        action: a.stub ? "merged_nexus" : "linked_nexus",
        diff: {
          partnerActivityRef: { from: null, to: a.ref },
          ...(up.status ? { status: { from: a.visit.status, to: up.status } } : {}),
          ...("officerId" in officer ? { officerId: { from: null, to: officer.officerId } } : {}),
        },
      },
    });
  });
  return { completed: up.status === "COMPLETED" };
}

/** Bring a visit that already carries the Nexus reference up to date.
 *  Returns whether it was completed by this. */
export async function updateLinkedVisit(
  prisma: PrismaClient,
  visit: { id: string; status: VisitStatusT; arrivedAt: Date | null; departedAt: Date | null },
  outcome: NexusOutcome,
): Promise<{ completed: boolean }> {
  const up = visitUpdate(visit, outcome);
  if (Object.keys(up).length === 0) return { completed: false };
  await prisma.patrolVisit.update({ where: { id: visit.id }, data: up });
  if (up.status) {
    await prisma.activityLog.create({
      data: {
        entity: "PatrolVisit",
        entityId: visit.id,
        action: "edited",
        diff: { status: { from: visit.status, to: up.status } },
      },
    });
  }
  return { completed: up.status === "COMPLETED" };
}

/** An error's code or name only — never its message (it can quote data). */
export const errCode = (e: unknown) =>
  (e as { code?: string })?.code ?? (e as Error)?.name ?? "error";

// ── Sweep: merge the duplicates made before linking existed ───────────────

export type NexusMergeResult = {
  /** Stubs looked at (Nexus patrols / VPIs this month with a site). */
  checked: number;
  /** Merged into their visit and removed. */
  merged: number;
  /** Duplicates a visit, but someone has worked on it — flagged ⚠. */
  keptForReview: number;
  /** Merges that failed (e.g. the stub changed meanwhile) — retried next run. */
  failed: number;
};

/** The first instant of the current UK month. */
export function ukMonthStart(now: Date): Date {
  const [y, m] = ukDayString(now).split("-").map(Number);
  return ukWallClockToUtc(y, m, 1, 0, 0, 0);
}

/**
 * Merge completed Nexus patrol / VPI stubs into the visit they duplicate —
 * those the imports made before they linked to visits. Matched on the
 * officer's on-site time. Only this month (`since`, default the 1st, UK):
 * earlier months' pay and billing are already done, so they're left as they
 * were. Stubs still to do are left to the callouts import, which knows their
 * due window. Safe to re-run.
 */
export async function mergeNexusDuplicates(
  prisma: PrismaClient,
  opts: {
    now?: Date;
    since?: Date;
    /** Billing + pay snapshot for a visit this completes (lib/billing). */
    snapshotVisit?: (visitId: string) => Promise<void>;
  } = {},
): Promise<NexusMergeResult> {
  const now = opts.now ?? new Date();
  const since = opts.since ?? ukMonthStart(now);
  const stubs = (await prisma.job.findMany({
    where: {
      partnerActivityRef: { startsWith: "LINK-" },
      type: { in: ["PATROL", "VPI"] },
      status: { in: ["APPROVED", "CLOSED"] },
      siteId: { not: null },
      startedAt: { gte: since },
    },
    select: {
      ...NEXUS_STUB_SELECT,
      startedAt: true,
      completedAt: true,
      typeLabel: true,
      possibleDuplicate: true,
    },
    orderBy: { startedAt: "asc" },
    take: 2000,
  })) as (NexusStub & {
    startedAt: Date;
    completedAt: Date | null;
    typeLabel: string | null;
    possibleDuplicate: boolean;
  })[];
  const result: NexusMergeResult = { checked: stubs.length, merged: 0, keptForReview: 0, failed: 0 };
  if (stubs.length === 0) return result;

  const rows = stubs.map((s) => ({
    siteId: s.siteId as string,
    timing: { start: null, end: null, onSite: s.startedAt } as NexusTiming,
  }));
  const pool = await loadVisitPool(prisma, rows);
  const picks = assignVisits(rows, pool);

  for (let i = 0; i < stubs.length; i++) {
    const s = stubs[i];
    const v = picks[i];
    if (!v) continue;
    const blocker = stubBlocker(s, v);
    if (blocker) {
      result.keptForReview++;
      if (!s.possibleDuplicate) {
        await prisma.job.update({ where: { id: s.id }, data: { possibleDuplicate: true } });
      }
      continue;
    }
    try {
      const { completed } = await linkNexusVisit(prisma, {
        visit: v,
        ref: s.partnerActivityRef as string,
        outcome: { done: true, onSite: s.startedAt, offSite: s.completedAt },
        notes: nexusLinkNote(
          v.notes,
          s.partnerActivityRef as string,
          s.typeLabel,
          doneDetail(s.startedAt, s.completedAt),
        ),
        stub: { id: s.id, assignedToUserId: s.assignedToUserId },
      });
      result.merged++;
      if (completed && opts.snapshotVisit) {
        await opts.snapshotVisit(v.id).catch((e) =>
          console.error("Nexus visit finance failed:", errCode(e)),
        );
      }
    } catch (e) {
      result.failed++;
      console.error("Nexus merge failed for one stub:", errCode(e));
    }
  }
  return result;
}
