/**
 * Two-sided partner reconciliation statement for a period.
 *
 *   theyOweUs  — mode 2 (partner-as-customer): work WE did on the partner's
 *                account, billed to them (`billedAmount`).
 *   weOweThem  — mode 3 (partner-as-subcontractor): work THEY did for us, at
 *                the price they charge us (`partnerChargeToUsAmount`).
 *   net        — theyOweUs − weOweThem (positive = the partner owes us net).
 *
 * Read-only; reads the frozen snapshots, windowed on the scheduled date.
 * Note: subcontracted PATROL visits carry no partner-charge column, so the
 * "we owe them" side counts partner jobs + shifts only.
 */
import { prisma } from "@/lib/db";
import {
  jobScheduledRange,
  visitScheduledRange,
  shiftScheduledRange,
} from "@/lib/activityWhen";

const round2 = (n: number) => Math.round(n * 100) / 100;
const humanize = (s: string) =>
  s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export type StatementLine = {
  service: string;
  quantity: number;
  amount: number;
};
export type StatementSide = {
  lines: StatementLine[];
  total: number;
  count: number;
};
export type PartnerStatement = {
  partnerId: string;
  partnerName: string;
  from: Date;
  to: Date;
  theyOweUs: StatementSide;
  weOweThem: StatementSide;
  net: number;
};

function group(entries: { label: string; amount: number }[]): StatementSide {
  const map = new Map<string, { count: number; sum: number }>();
  for (const e of entries) {
    const g = map.get(e.label) ?? { count: 0, sum: 0 };
    g.count += 1;
    g.sum += e.amount;
    map.set(e.label, g);
  }
  const lines = [...map.entries()]
    .map(([service, g]) => ({
      service,
      quantity: g.count,
      amount: round2(g.sum),
    }))
    .sort((a, b) => b.amount - a.amount);
  return {
    lines,
    total: round2(lines.reduce((n, l) => n + l.amount, 0)),
    count: entries.length,
  };
}

const visitLabel = (kind: string | null | undefined) =>
  kind === "VPI" ? "Void property inspection" : "Mobile patrol";

export async function loadPartnerStatement(
  partnerId: string,
  from: Date,
  to: Date,
): Promise<PartnerStatement | null> {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { name: true },
  });
  if (!partner) return null;

  const [
    owedJobs,
    owedVisits,
    owedShifts,
    oweJobs,
    oweShifts,
  ] = await Promise.all([
    // ── They owe us (mode 2): our work on the partner's account ──
    prisma.job.findMany({
      where: {
        status: { not: "CANCELLED" },
        completedAt: { not: null },
        billedAmount: { not: null },
        AND: [
          { OR: [{ partnerId }, { site: { is: { partnerId } } }] },
          jobScheduledRange(from, to),
        ],
      },
      select: { type: true, typeLabel: true, billedAmount: true },
    }),
    prisma.patrolVisit.findMany({
      where: {
        status: "COMPLETED",
        billedAmount: { not: null },
        site: { is: { partnerId } },
        ...visitScheduledRange(from, to),
      },
      select: {
        billedAmount: true,
        patrolSchedule: { select: { kind: true } },
      },
    }),
    prisma.shift.findMany({
      where: {
        status: "COMPLETED",
        billedAmount: { not: null },
        site: { is: { partnerId } },
        ...shiftScheduledRange(from, to),
      },
      select: { type: true, billedAmount: true },
    }),
    // ── We owe them (mode 3): their work for us ──
    prisma.job.findMany({
      where: {
        status: { not: "CANCELLED" },
        handledByPartnerId: partnerId,
        partnerChargeToUsAmount: { not: null },
        ...jobScheduledRange(from, to),
      },
      select: { type: true, typeLabel: true, partnerChargeToUsAmount: true },
    }),
    prisma.shift.findMany({
      where: {
        handledByPartnerId: partnerId,
        partnerChargeToUsAmount: { not: null },
        ...shiftScheduledRange(from, to),
      },
      select: { type: true, partnerChargeToUsAmount: true },
    }),
  ]);

  const theyOweUs = group([
    ...owedJobs.map((j) => ({
      label: j.typeLabel ?? humanize(j.type),
      amount: Number(j.billedAmount ?? 0),
    })),
    ...owedVisits.map((v) => ({
      label: visitLabel(v.patrolSchedule?.kind),
      amount: Number(v.billedAmount ?? 0),
    })),
    ...owedShifts.map((s) => ({
      label: humanize(s.type),
      amount: Number(s.billedAmount ?? 0),
    })),
  ]);

  const weOweThem = group([
    ...oweJobs.map((j) => ({
      label: j.typeLabel ?? humanize(j.type),
      amount: Number(j.partnerChargeToUsAmount ?? 0),
    })),
    ...oweShifts.map((s) => ({
      label: humanize(s.type),
      amount: Number(s.partnerChargeToUsAmount ?? 0),
    })),
  ]);

  return {
    partnerId,
    partnerName: partner.name,
    from,
    to,
    theyOweUs,
    weOweThem,
    net: round2(theyOweUs.total - weOweThem.total),
  };
}
