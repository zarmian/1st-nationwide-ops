"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import type { RateService } from "@prisma/client";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  calculateBilling,
  calculatePay,
  durationMinutes,
  jobTypeToRateService,
} from "@/lib/billing";

export type RecalcResult = {
  ok: boolean;
  visitsScanned: number;
  visitsBilled: number;
  jobsScanned: number;
  jobsBilled: number;
  jobsAccountBackfilled: number;
  shiftsScanned: number;
  shiftsBilled: number;
  error?: string;
};

/**
 * Bulk-billing recalculation for rows in a date window.
 *
 * - scope="all"      → re-snapshot every COMPLETED visit + every
 *                       non-cancelled Job in the window.
 * - scope="missing"  → only touch rows where billedAmount is currently null.
 *
 * Performance: pre-fetches SiteRate and OfficerRate in two queries
 * total (filtered to the unique site/officer ids actually in use),
 * then drives the per-row math in memory and writes in parallel
 * chunks. The previous implementation did 4 sequential queries per
 * row, which timed out at ~250 rows on Vercel's 60s limit; the
 * batched version comfortably handles a month's worth in seconds.
 *
 * Self-heal: while we have each Job's site in hand, if the Job's own
 * customerId / partnerId is NULL but the Site has one set (admin
 * assigned account *after* the Job was created), patch the Job in
 * the same update. Stops "Unassigned" from sticking on finance once
 * the site has been corrected.
 *
 * Cancelled jobs are always excluded — Restore is the only path that
 * puts billing back on a cancelled job.
 */
export async function recalculateBilling(
  scope: "all" | "missing" = "missing",
  window?: { from?: Date | string; to?: Date | string },
): Promise<RecalcResult> {
  await requireAdmin();

  const from = window?.from ? new Date(window.from) : undefined;
  const to = window?.to ? new Date(window.to) : undefined;

  const visitWhere: Prisma.PatrolVisitWhereInput = {
    status: "COMPLETED",
    departedAt:
      from || to
        ? {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          }
        : { not: null },
  };
  if (scope === "missing") visitWhere.billedAmount = null;

  const visits = await prisma.patrolVisit.findMany({
    where: visitWhere,
    select: {
      id: true,
      siteId: true,
      officerId: true,
      arrivedAt: true,
      departedAt: true,
      formSubmissions: {
        select: { form: true },
        orderBy: { submittedAt: "desc" },
        take: 1,
      },
    },
    take: 5000,
  });

  const jobWhere: Prisma.JobWhereInput = {
    siteId: { not: null },
    status: { not: "CANCELLED" },
  };
  if (from || to) {
    jobWhere.completedAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (scope === "missing") jobWhere.billedAmount = null;

  const jobs = await prisma.job.findMany({
    where: jobWhere,
    select: {
      id: true,
      siteId: true,
      type: true,
      assignedToUserId: true,
      startedAt: true,
      completedAt: true,
      customerId: true,
      partnerId: true,
    },
    take: 5000,
  });

  // Shifts mirror the visit/job scan. Officer-handled shifts get a pay
  // snapshot too; partner-handled shifts only get the bill side because
  // their cost is held on `partnerChargeToUsAmount` instead.
  const shiftWhere: Prisma.ShiftWhereInput = { status: "COMPLETED" };
  if (from || to) {
    shiftWhere.actualEndedAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  } else {
    shiftWhere.actualEndedAt = { not: null };
  }
  if (scope === "missing") shiftWhere.billedAmount = null;

  const shifts = await prisma.shift.findMany({
    where: shiftWhere,
    select: {
      id: true,
      siteId: true,
      type: true,
      officerId: true,
      handledByPartnerId: true,
      actualStartedAt: true,
      actualEndedAt: true,
    },
    take: 5000,
  });

  // ── Pre-fetch all the rates in two queries instead of N+1 ──────────
  const siteIds = Array.from(
    new Set<string>([
      ...visits.map((v) => v.siteId).filter(Boolean),
      ...jobs.map((j) => j.siteId).filter((id): id is string => Boolean(id)),
      ...shifts.map((s) => s.siteId).filter(Boolean),
    ]),
  );
  const officerIds = Array.from(
    new Set<string>([
      ...visits.map((v) => v.officerId).filter((id): id is string => Boolean(id)),
      ...jobs
        .map((j) => j.assignedToUserId)
        .filter((id): id is string => Boolean(id)),
      ...shifts
        .map((s) => s.officerId)
        .filter((id): id is string => Boolean(id)),
    ]),
  );

  const [siteRates, officerRates, siteOwners] = await Promise.all([
    siteIds.length > 0
      ? prisma.siteRate.findMany({
          where: { siteId: { in: siteIds } },
          select: {
            id: true,
            siteId: true,
            service: true,
            amount: true,
            currency: true,
            unit: true,
            includedMinutes: true,
            excessRatePerMin: true,
          },
        })
      : Promise.resolve([] as any[]),
    officerIds.length > 0
      ? prisma.officerRate.findMany({
          where: { OR: [{ officerId: { in: officerIds } }, { officerId: null }] },
          select: {
            id: true,
            officerId: true,
            service: true,
            amount: true,
            currency: true,
            unit: true,
            includedMinutes: true,
            excessRatePerMin: true,
          },
        })
      : Promise.resolve([] as any[]),
    // Pulled once and reused for the self-heal step on jobs. Only the
    // ids we'll touch are loaded.
    siteIds.length > 0
      ? prisma.site.findMany({
          where: { id: { in: siteIds } },
          select: { id: true, customerId: true, partnerId: true },
        })
      : Promise.resolve([] as any[]),
  ]);

  const siteRatesByKey = new Map<string, typeof siteRates>();
  for (const r of siteRates) {
    const list = siteRatesByKey.get(r.siteId) ?? [];
    list.push(r);
    siteRatesByKey.set(r.siteId, list);
  }
  const officerRatesByKey = new Map<string, typeof officerRates>();
  const companyRates: typeof officerRates = [];
  for (const r of officerRates) {
    if (r.officerId == null) {
      companyRates.push(r);
      continue;
    }
    const list = officerRatesByKey.get(r.officerId) ?? [];
    list.push(r);
    officerRatesByKey.set(r.officerId, list);
  }
  const siteOwnerById = new Map(
    siteOwners.map((s) => [s.id, { customerId: s.customerId, partnerId: s.partnerId }]),
  );

  // ── Build per-row update payloads (sync) ───────────────────────────
  type VisitUpdate = {
    id: string;
    bill: ReturnType<typeof calculateBilling>;
    pay: ReturnType<typeof calculatePay> | null;
  };
  const visitUpdates: VisitUpdate[] = [];
  for (const v of visits) {
    const form = v.formSubmissions[0]?.form ?? "PATROL";
    const rateService = jobTypeToRateService(form) as RateService | null;
    if (!rateService) continue;
    const duration = durationMinutes(v.arrivedAt, v.departedAt);
    const rates = siteRatesByKey.get(v.siteId) ?? [];
    const bill = calculateBilling(rates, rateService, duration);
    let pay = null;
    if (v.officerId) {
      const officerSpecific = officerRatesByKey.get(v.officerId) ?? [];
      const merged = [...officerSpecific, ...companyRates];
      pay = calculatePay(merged, v.officerId, rateService, duration);
    }
    visitUpdates.push({ id: v.id, bill, pay });
  }

  type JobUpdate = {
    id: string;
    bill: ReturnType<typeof calculateBilling>;
    pay: ReturnType<typeof calculatePay> | null;
    backfillCustomerId: string | null;
    backfillPartnerId: string | null;
  };
  const jobUpdates: JobUpdate[] = [];
  let jobsAccountBackfilled = 0;
  for (const j of jobs) {
    if (!j.siteId) continue;
    const rateService = jobTypeToRateService(j.type) as RateService | null;
    if (!rateService) continue;
    const duration = durationMinutes(j.startedAt, j.completedAt);
    const rates = siteRatesByKey.get(j.siteId) ?? [];
    const bill = calculateBilling(rates, rateService, duration);
    let pay = null;
    if (j.assignedToUserId) {
      const officerSpecific = officerRatesByKey.get(j.assignedToUserId) ?? [];
      const merged = [...officerSpecific, ...companyRates];
      pay = calculatePay(merged, j.assignedToUserId, rateService, duration);
    }
    const owner = siteOwnerById.get(j.siteId);
    const backfillCustomerId =
      j.customerId == null && owner?.customerId ? owner.customerId : null;
    const backfillPartnerId =
      j.partnerId == null && owner?.partnerId ? owner.partnerId : null;
    if (backfillCustomerId || backfillPartnerId) jobsAccountBackfilled++;
    jobUpdates.push({
      id: j.id,
      bill,
      pay,
      backfillCustomerId,
      backfillPartnerId,
    });
  }

  type ShiftUpdate = {
    id: string;
    bill: ReturnType<typeof calculateBilling>;
    pay: ReturnType<typeof calculatePay> | null;
  };
  const shiftUpdates: ShiftUpdate[] = [];
  for (const s of shifts) {
    if (!s.siteId) continue;
    const rateService = jobTypeToRateService(s.type) as RateService | null;
    if (!rateService) continue;
    const duration = durationMinutes(s.actualStartedAt, s.actualEndedAt);
    const rates = siteRatesByKey.get(s.siteId) ?? [];
    const bill = calculateBilling(rates, rateService, duration);
    // Only officer-handled shifts get a pay snapshot — partner-handled
    // shifts carry their cost on `partnerChargeToUsAmount` instead, set
    // when the partner-side action recorded the shift.
    let pay = null;
    if (s.officerId && !s.handledByPartnerId) {
      const officerSpecific = officerRatesByKey.get(s.officerId) ?? [];
      const merged = [...officerSpecific, ...companyRates];
      pay = calculatePay(merged, s.officerId, rateService, duration);
    }
    shiftUpdates.push({ id: s.id, bill, pay });
  }

  // ── Write in parallel chunks ──────────────────────────────────────
  const CHUNK = 25;
  let visitsBilled = 0;
  for (let i = 0; i < visitUpdates.length; i += CHUNK) {
    await Promise.all(
      visitUpdates.slice(i, i + CHUNK).map(async (u) => {
        await prisma.patrolVisit.update({
          where: { id: u.id },
          data: visitDataFor(u.bill, u.pay),
        });
        if (u.bill.ok) visitsBilled++;
      }),
    );
  }

  let jobsBilled = 0;
  for (let i = 0; i < jobUpdates.length; i += CHUNK) {
    await Promise.all(
      jobUpdates.slice(i, i + CHUNK).map(async (u) => {
        await prisma.job.update({
          where: { id: u.id },
          data: {
            ...jobDataFor(u.bill, u.pay),
            ...(u.backfillCustomerId ? { customerId: u.backfillCustomerId } : {}),
            ...(u.backfillPartnerId ? { partnerId: u.backfillPartnerId } : {}),
          },
        });
        if (u.bill.ok) jobsBilled++;
      }),
    );
  }

  let shiftsBilled = 0;
  for (let i = 0; i < shiftUpdates.length; i += CHUNK) {
    await Promise.all(
      shiftUpdates.slice(i, i + CHUNK).map(async (u) => {
        await prisma.shift.update({
          where: { id: u.id },
          data: shiftDataFor(u.bill, u.pay),
        });
        if (u.bill.ok) shiftsBilled++;
      }),
    );
  }

  revalidatePath("/finance");
  revalidatePath("/dispatch");
  revalidatePath("/activities");
  revalidatePath("/shifts");
  return {
    ok: true,
    visitsScanned: visits.length,
    visitsBilled,
    jobsScanned: jobs.length,
    jobsBilled,
    jobsAccountBackfilled,
    shiftsScanned: shifts.length,
    shiftsBilled,
  };
}

function visitDataFor(
  bill: ReturnType<typeof calculateBilling>,
  pay: ReturnType<typeof calculatePay> | null,
): Prisma.PatrolVisitUpdateInput {
  const data: Prisma.PatrolVisitUpdateInput = bill.ok
    ? {
        billedAmount: new Prisma.Decimal(bill.amount),
        billedCurrency: bill.currency,
        billedAt: new Date(),
        payRateUnit: bill.unit,
      }
    : {
        billedAmount: null,
        billedCurrency: null,
        billedAt: null,
        payRateUnit: null,
      };
  if (pay == null) {
    // Officer not set — leave pay columns alone.
  } else if (pay.ok) {
    data.paidAmount = new Prisma.Decimal(pay.amount);
    data.paidCurrency = pay.currency;
    data.paidAt = new Date();
  } else {
    data.paidAmount = null;
    data.paidCurrency = null;
    data.paidAt = null;
  }
  return data;
}

function jobDataFor(
  bill: ReturnType<typeof calculateBilling>,
  pay: ReturnType<typeof calculatePay> | null,
): Prisma.JobUncheckedUpdateInput {
  const data: Prisma.JobUncheckedUpdateInput = bill.ok
    ? {
        billedAmount: new Prisma.Decimal(bill.amount),
        billedCurrency: bill.currency,
        billedAt: new Date(),
        payRateUnit: bill.unit,
      }
    : {
        billedAmount: null,
        billedCurrency: null,
        billedAt: null,
        payRateUnit: null,
      };
  if (pay == null) {
    // Officer not assigned — leave pay columns alone.
  } else if (pay.ok) {
    data.paidAmount = new Prisma.Decimal(pay.amount);
    data.paidCurrency = pay.currency;
    data.paidAt = new Date();
  } else {
    data.paidAmount = null;
    data.paidCurrency = null;
    data.paidAt = null;
  }
  return data;
}

function shiftDataFor(
  bill: ReturnType<typeof calculateBilling>,
  pay: ReturnType<typeof calculatePay> | null,
): Prisma.ShiftUncheckedUpdateInput {
  const data: Prisma.ShiftUncheckedUpdateInput = bill.ok
    ? {
        billedAmount: new Prisma.Decimal(bill.amount),
        billedCurrency: bill.currency,
        billedAt: new Date(),
        payRateUnit: bill.unit,
      }
    : {
        billedAmount: null,
        billedCurrency: null,
        billedAt: null,
        payRateUnit: null,
      };
  if (pay == null) {
    // Partner-handled or unstaffed shift — leave pay columns alone.
  } else if (pay.ok) {
    data.paidAmount = new Prisma.Decimal(pay.amount);
    data.paidCurrency = pay.currency;
    data.paidAt = new Date();
  } else {
    data.paidAmount = null;
    data.paidCurrency = null;
    data.paidAt = null;
  }
  return data;
}
