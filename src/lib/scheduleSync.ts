import { prisma } from "@/lib/db";
import {
  applyBillingToJob,
  applyPayToJob,
  billForSite,
  payForOfficer,
} from "@/lib/billing";
import { evaluateSchedule, resolvePatrolSlots } from "@/lib/patrolDates";
import { ukDayPlus, ukWallClockToUtc } from "@/lib/dates";

/**
 * Shared materialisation library for the recurring-schedules → Jobs/Visits
 * pipeline. Both the daily Vercel cron and the dispatcher's manual
 * "Sync schedules" button call into here, so the logic lives in one place.
 *
 * Idempotent in both directions: re-running for the same UK day never
 * creates duplicates.
 */

const DAY_BY_INDEX = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

type UkDay = { year: number; month: number; day: number };

export type LockUnlockDayResult = {
  date: string;
  dow: string;
  schedulesChecked: number;
  createdUnlock: number;
  createdLock: number;
  skipped: number;
};

export type ScheduleDiagnostic = {
  scheduleId: string;
  siteName: string;
  kind: string;
  dayOfWeek: string;
  status: "created" | "exists" | "skipped";
  reason?: string;
};

export type PatrolDayResult = {
  date: string;
  created: number;
  skipped: number;
  schedulesChecked: number;
  diagnostics: ScheduleDiagnostic[];
};

/**
 * Materialise LOCK / UNLOCK Jobs from active LockUnlockSchedules across the
 * given UK-day window. `anchor` is the moment to base "today" on (use
 * `new Date()` in normal operation; pass a specific date for back-fills).
 *
 *  - offsets [0]    → just `anchor`'s UK day (manual back-fill)
 *  - offsets [0,1]  → today + tomorrow UK (the normal cron behaviour)
 */
export async function materializeLockUnlockJobs(opts: {
  anchor: Date;
  offsets: number[];
}): Promise<LockUnlockDayResult[]> {
  const ukDays = opts.offsets.map((n) => ukDayPlus(opts.anchor, n));
  const out: LockUnlockDayResult[] = [];

  for (const ukDay of ukDays) {
    const dow = DAY_BY_INDEX[dayOfWeekFor(ukDay)];

    const schedules = await prisma.lockUnlockSchedule.findMany({
      where: { active: true, days: { has: dow as any } },
      include: {
        site: {
          select: { id: true, customerId: true, partnerId: true, active: true },
        },
      },
    });

    let createdUnlock = 0;
    let createdLock = 0;
    let skipped = 0;

    for (const s of schedules) {
      if (!s.site.active) {
        skipped++;
        continue;
      }
      if (s.unlockTime) {
        const ok = await maybeCreateLockUnlock({
          type: "UNLOCK",
          siteId: s.siteId,
          siteCustomerId: s.site.customerId,
          sitePartnerId: s.site.partnerId,
          officerId: s.assignedOfficerId,
          ukDay,
          timeHHMM: s.unlockTime,
        });
        if (ok) createdUnlock++;
        else skipped++;
      }
      if (s.lockdownTime) {
        const ok = await maybeCreateLockUnlock({
          type: "LOCK",
          siteId: s.siteId,
          siteCustomerId: s.site.customerId,
          sitePartnerId: s.site.partnerId,
          officerId: s.assignedOfficerId,
          ukDay,
          timeHHMM: s.lockdownTime,
        });
        if (ok) createdLock++;
        else skipped++;
      }
    }

    out.push({
      date: `${ukDay.year}-${pad(ukDay.month)}-${pad(ukDay.day)}`,
      dow,
      schedulesChecked: schedules.length,
      createdUnlock,
      createdLock,
      skipped,
    });
  }

  return out;
}

/**
 * Materialise PatrolVisits from active PatrolSchedules across the given
 * UK-day window. Same offset semantics as the lockunlock helper.
 */
export async function materializePatrolVisits(opts: {
  anchor: Date;
  offsets: number[];
}): Promise<PatrolDayResult[]> {
  const schedules = await prisma.patrolSchedule.findMany({
    where: { active: true },
    include: { site: { select: { name: true, code: true } } },
  });

  const out: PatrolDayResult[] = [];

  for (const offset of opts.offsets) {
    // The existing shouldCreateVisitOn / defaultScheduledAt logic compares
    // dates via getUTCDay, so we keep the UTC-day convention here too.
    const target = new Date(opts.anchor);
    target.setUTCHours(0, 0, 0, 0);
    target.setUTCDate(target.getUTCDate() + offset);

    let created = 0;
    let skipped = 0;
    const diagnostics: ScheduleDiagnostic[] = [];

    for (const s of schedules) {
      const siteName = s.site.code
        ? `${s.site.code} · ${s.site.name}`
        : s.site.name;
      const eval_ = evaluateSchedule(s, target);
      if (!eval_.ok) {
        diagnostics.push({
          scheduleId: s.id,
          siteName,
          kind: s.kind,
          dayOfWeek: s.dayOfWeek,
          status: "skipped",
          reason: eval_.reason,
        });
        continue;
      }

      // One visit per configured time. Post-midnight times roll to the next
      // calendar day but stay grouped under the night they started. Dedup is
      // on the exact scheduledAt so re-runs (and the today/tomorrow overlap)
      // never double up.
      const slots = resolvePatrolSlots(target, s.kind, s.timesOfDay, s.timeOfDay);
      let createdHere = 0;
      let existedHere = 0;
      for (const slot of slots) {
        const existing = await prisma.patrolVisit.findFirst({
          where: { patrolScheduleId: s.id, scheduledAt: slot.scheduledAt },
          select: { id: true },
        });
        if (existing) {
          existedHere++;
          continue;
        }
        await prisma.patrolVisit.create({
          data: {
            siteId: s.siteId,
            patrolScheduleId: s.id,
            officerId: s.assignedOfficerId,
            scheduledAt: slot.scheduledAt,
            scheduleDate: slot.scheduleDate,
            status: "PENDING",
          },
        });
        createdHere++;
      }
      created += createdHere;
      skipped += existedHere;
      diagnostics.push({
        scheduleId: s.id,
        siteName,
        kind: s.kind,
        dayOfWeek: s.dayOfWeek,
        status: createdHere > 0 ? "created" : "exists",
        reason:
          slots.length > 1
            ? `${createdHere} created, ${existedHere} already there (${slots.length} patrols)`
            : undefined,
      });
    }

    out.push({
      date: target.toISOString().slice(0, 10),
      created,
      skipped,
      schedulesChecked: schedules.length,
      diagnostics,
    });
  }

  return out;
}

async function maybeCreateLockUnlock(args: {
  type: "LOCK" | "UNLOCK";
  siteId: string;
  siteCustomerId: string | null;
  sitePartnerId: string | null;
  officerId: string | null;
  ukDay: UkDay;
  timeHHMM: string;
}): Promise<boolean> {
  // UK-day window in UTC terms — 00:00 UK to 23:59:59.999 UK.
  const dayStart = ukWallClockToUtc(
    args.ukDay.year,
    args.ukDay.month,
    args.ukDay.day,
    0,
    0,
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  const existing = await prisma.job.findFirst({
    where: {
      siteId: args.siteId,
      type: args.type as any,
      source: "SCHEDULED" as any,
      scheduledFor: { gte: dayStart, lte: dayEnd },
    },
    select: { id: true },
  });
  if (existing) return false;

  const scheduledFor = parseHHMMToUk(args.ukDay, args.timeHHMM);

  const job = await prisma.job.create({
    data: {
      type: args.type as any,
      source: "SCHEDULED" as any,
      status: args.officerId ? ("ASSIGNED" as any) : ("OPEN" as any),
      siteId: args.siteId,
      customerId: args.siteCustomerId,
      partnerId: args.sitePartnerId,
      responderType: "INTERNAL_OFFICER" as any,
      assignedToUserId: args.officerId,
      scheduledFor,
    },
    select: { id: true },
  });

  const rateService = args.type === "LOCK" ? "LOCKUP" : "UNLOCK";
  const bill = await billForSite(args.siteId, rateService as any);
  if (bill.ok) await applyBillingToJob(job.id, bill);
  if (args.officerId) {
    const pay = await payForOfficer(args.officerId, rateService as any);
    if (pay.ok) await applyPayToJob(job.id, pay);
  }

  return true;
}

function parseHHMMToUk(ukDay: UkDay, hhmm: string): Date {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    return ukWallClockToUtc(ukDay.year, ukDay.month, ukDay.day, 9, 0);
  }
  return ukWallClockToUtc(
    ukDay.year,
    ukDay.month,
    ukDay.day,
    Number(m[1]),
    Number(m[2]),
  );
}

function dayOfWeekFor(d: UkDay): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
