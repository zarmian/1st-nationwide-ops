import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorisedCron } from "@/lib/cronAuth";
import {
  applyBillingToJob,
  applyPayToJob,
  billForSite,
  payForOfficer,
} from "@/lib/billing";

/**
 * Daily creator: walks every active LockUnlockSchedule, and when today's
 * day-of-week is included, creates UNLOCK and / or LOCK Job rows scheduled
 * for the configured times (HH:MM).
 *
 *   - Idempotent: a job already created for this site + type + day is
 *     skipped (matched by source=SCHEDULED + same date).
 *   - Auto-bills + auto-pays the job from the relevant SiteRate /
 *     OfficerRate at creation time, same as /dispatch/new.
 *
 * Vercel Cron should hit this once a day, early morning UK time. Hand-
 * invocable for a specific date with ?date=YYYY-MM-DD.
 */

const DAY_BY_INDEX = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const target = dateParam ? new Date(dateParam) : new Date();
  if (isNaN(target.getTime())) {
    return NextResponse.json({ error: "Bad date" }, { status: 400 });
  }
  // Local-day anchor — same approach as patrol-visits cron.
  target.setUTCHours(0, 0, 0, 0);

  const dow = DAY_BY_INDEX[target.getUTCDay()];

  const schedules = await prisma.lockUnlockSchedule.findMany({
    where: { active: true, days: { has: dow as any } },
    include: {
      site: { select: { id: true, customerId: true, partnerId: true, active: true } },
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
      const ok = await maybeCreate({
        type: "UNLOCK",
        siteId: s.siteId,
        siteCustomerId: s.site.customerId,
        sitePartnerId: s.site.partnerId,
        officerId: s.assignedOfficerId,
        target,
        timeHHMM: s.unlockTime,
      });
      if (ok) createdUnlock++;
      else skipped++;
    }
    if (s.lockdownTime) {
      const ok = await maybeCreate({
        type: "LOCK",
        siteId: s.siteId,
        siteCustomerId: s.site.customerId,
        sitePartnerId: s.site.partnerId,
        officerId: s.assignedOfficerId,
        target,
        timeHHMM: s.lockdownTime,
      });
      if (ok) createdLock++;
      else skipped++;
    }
  }

  return NextResponse.json({
    ok: true,
    date: target.toISOString().slice(0, 10),
    dow,
    schedulesChecked: schedules.length,
    createdUnlock,
    createdLock,
    skipped,
  });
}

async function maybeCreate(args: {
  type: "LOCK" | "UNLOCK";
  siteId: string;
  siteCustomerId: string | null;
  sitePartnerId: string | null;
  officerId: string | null;
  target: Date;
  timeHHMM: string;
}): Promise<boolean> {
  const dayStart = new Date(args.target);
  const dayEnd = new Date(args.target);
  dayEnd.setUTCHours(23, 59, 59, 999);

  // Idempotency — same site + type + SCHEDULED source within the day.
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

  const scheduledFor = combineDateAndTime(args.target, args.timeHHMM);

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

  // Best-effort billing + pay snapshot. Mirrors createJob in /dispatch.
  const rateService = args.type === "LOCK" ? "LOCKUP" : "UNLOCK";
  const bill = await billForSite(args.siteId, rateService as any);
  if (bill.ok) await applyBillingToJob(job.id, bill);
  if (args.officerId) {
    const pay = await payForOfficer(args.officerId, rateService as any);
    if (pay.ok) await applyPayToJob(job.id, pay);
  }

  return true;
}

function combineDateAndTime(date: Date, hhmm: string): Date {
  // "HH:MM" → set hours/minutes on a copy of the target day.
  const out = new Date(date);
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    out.setUTCHours(9, 0, 0, 0);
    return out;
  }
  const h = Number(m[1]);
  const mins = Number(m[2]);
  // UK local time → UTC. Europe/London is UTC+0 (winter) or UTC+1 (BST).
  // Cheapest correct path: build the local date in JS, let the engine
  // figure it out.
  const local = new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    h,
    mins,
    0,
    0,
  );
  return local;
}
