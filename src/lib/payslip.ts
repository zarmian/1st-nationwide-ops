/**
 * Per-officer payslip for a period. Brings together the three pay sources into
 * one statement:
 *
 *   1. Retainer   — the officer's monthly OfficerRate (unit PER_MONTH), or the
 *                   company default, × whole months in the period. Same rule as
 *                   buildPayrollReport so the payslip reconciles with payroll.
 *   2. Activity   — sum of `paidAmount` on completed, paid visits + jobs +
 *                   shifts, windowed on the scheduled (accounting) date and
 *                   grouped by service so the officer sees what they did.
 *   3. Adjustments — manual PayAdjustment lines dated into the period (signed).
 *
 *   net = retainer + activity + Σ adjustments
 */
import { prisma } from "@/lib/db";
import {
  jobScheduledRange,
  shiftScheduledRange,
  visitScheduledRange,
} from "@/lib/activityWhen";
import { monthsBetween } from "@/lib/payroll";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { COMPANY } from "@/lib/company";

const round2 = (n: number) => Math.round(n * 100) / 100;
const humanize = (s: string) =>
  s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export type PayslipEarningLine = {
  service: string;
  count: number;
  amount: number;
};

export type PayslipAdjustmentLine = {
  id: string;
  date: Date;
  kind: string;
  label: string;
  amount: number;
  note: string | null;
};

export type Payslip = {
  officer: {
    id: string;
    name: string;
    email: string;
    role: string;
    siaNumber: string | null;
  };
  from: Date;
  to: Date;
  currency: string;
  retainer: { months: number; monthly: number; amount: number } | null;
  earnings: PayslipEarningLine[];
  activityTotal: number;
  activityCount: number;
  adjustments: PayslipAdjustmentLine[];
  adjustmentsTotal: number;
  /** retainer + activity (before adjustments). */
  gross: number;
  /** gross + Σ adjustments. */
  net: number;
};

export async function loadPayslip(
  officerId: string,
  from: Date,
  to: Date,
): Promise<Payslip | null> {
  const officer = await prisma.user.findUnique({
    where: { id: officerId },
    select: { id: true, name: true, email: true, role: true, siaNumber: true },
  });
  if (!officer) return null;

  const [visits, jobs, shifts, adjustmentRows, retainerRates] =
    await Promise.all([
      prisma.patrolVisit.findMany({
        where: {
          officerId,
          status: "COMPLETED",
          paidAt: { not: null },
          ...visitScheduledRange(from, to),
        },
        select: {
          paidAmount: true,
          patrolSchedule: { select: { kind: true } },
        },
      }),
      prisma.job.findMany({
        where: {
          assignedToUserId: officerId,
          completedAt: { not: null },
          paidAt: { not: null },
          ...jobScheduledRange(from, to),
        },
        select: { type: true, typeLabel: true, paidAmount: true },
      }),
      prisma.shift.findMany({
        where: {
          officerId,
          status: "COMPLETED",
          paidAt: { not: null },
          ...shiftScheduledRange(from, to),
        },
        select: { type: true, paidAmount: true },
      }),
      prisma.payAdjustment.findMany({
        where: { officerId, date: { gte: from, lte: to } },
        orderBy: { date: "asc" },
      }),
      prisma.officerRate.findMany({
        where: { unit: "PER_MONTH", OR: [{ officerId }, { officerId: null }] },
        select: { officerId: true, amount: true, currency: true },
      }),
    ]);

  // Group activity pay by service label.
  const groups = new Map<string, { count: number; sum: number }>();
  const add = (label: string, amount: number) => {
    const g = groups.get(label) ?? { count: 0, sum: 0 };
    g.count += 1;
    g.sum += amount;
    groups.set(label, g);
  };
  for (const v of visits) {
    add(
      v.patrolSchedule?.kind === "VPI" ? "Void property inspection" : "Mobile patrol",
      Number(v.paidAmount ?? 0),
    );
  }
  for (const j of jobs) {
    add(j.typeLabel ?? humanize(j.type), Number(j.paidAmount ?? 0));
  }
  for (const s of shifts) {
    add(humanize(s.type), Number(s.paidAmount ?? 0));
  }
  const earnings: PayslipEarningLine[] = [...groups.entries()]
    .map(([service, g]) => ({ service, count: g.count, amount: round2(g.sum) }))
    .sort((a, b) => b.amount - a.amount);
  const activityTotal = round2(earnings.reduce((n, e) => n + e.amount, 0));
  const activityCount = earnings.reduce((n, e) => n + e.count, 0);

  // Retainer: per-officer PER_MONTH rate, else the company default.
  const perOfficer = retainerRates.find((r) => r.officerId === officerId);
  const def = retainerRates.find((r) => r.officerId === null);
  const rate = perOfficer ?? def ?? null;
  const months = monthsBetween(from, to);
  const currency = rate?.currency ?? "GBP";
  const retainer = rate
    ? {
        months,
        monthly: round2(Number(rate.amount)),
        amount: round2(Number(rate.amount) * months),
      }
    : null;

  const adjustments: PayslipAdjustmentLine[] = adjustmentRows.map((a) => ({
    id: a.id,
    date: a.date,
    kind: a.kind,
    label: a.label,
    amount: Number(a.amount),
    note: a.note,
  }));
  const adjustmentsTotal = round2(
    adjustments.reduce((n, a) => n + a.amount, 0),
  );

  const gross = round2((retainer?.amount ?? 0) + activityTotal);
  const net = round2(gross + adjustmentsTotal);

  return {
    officer,
    from,
    to,
    currency,
    retainer,
    earnings,
    activityTotal,
    activityCount,
    adjustments,
    adjustmentsTotal,
    gross,
    net,
  };
}

// ── Emailing ────────────────────────────────────────────────────────────────

function money(n: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(n);
}
function longDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function payslipEmailBodies(data: Payslip): { html: string; text: string } {
  const period = `${longDate(data.from)} – ${longDate(data.to)}`;
  const net = money(data.net, data.currency);
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f1f5f9;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#0F1929;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#0F1929;padding:20px 28px;color:#ffffff;font-size:16px;font-weight:bold;">${COMPANY.name}</td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 14px;">Hi ${data.officer.name},</p>
        <p style="margin:0 0 14px;">Your payslip for <strong>${period}</strong> is attached.</p>
        <p style="margin:0 0 6px;font-size:14px;color:#475569;">Net pay</p>
        <p style="margin:0 0 16px;font-size:26px;font-weight:bold;">${net}</p>
        <p style="margin:0 0 4px;">Thank you,</p>
        <p style="margin:0;">${COMPANY.name}</p>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f8fafc;font-size:12px;color:#94a3b8;">Your payslip is attached as a PDF. Reply with any questions.</td></tr>
    </table>
  </body>
</html>`;
  const text = [
    `Hi ${data.officer.name},`,
    "",
    `Your payslip for ${period} is attached.`,
    "",
    `Net pay: ${net}`,
    "",
    "Thank you,",
    COMPANY.name,
  ].join("\n");
  return { html, text };
}

/**
 * Email the payslip PDF to the officer's own email. No-op with a clear message
 * when email isn't configured or the officer has no email on file.
 */
export async function sendPayslipEmail(
  officerId: string,
  from: Date,
  to: Date,
): Promise<{ ok: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    return {
      ok: false,
      error: "Email isn't set up yet. Add RESEND_API_KEY to send payslips.",
    };
  }
  const data = await loadPayslip(officerId, from, to);
  if (!data) return { ok: false, error: "Officer not found." };
  const recipient = data.officer.email?.trim();
  if (!recipient) {
    return { ok: false, error: "No email on file for this officer." };
  }
  // Loaded lazily so the @react-pdf renderer stays out of this module's graph.
  const { renderPayslipPdf } = await import("@/lib/reports/PayslipPdf");
  const pdf = await renderPayslipPdf(data);
  const { html, text } = payslipEmailBodies(data);
  const period = `${longDate(data.from)} – ${longDate(data.to)}`;
  const slug = data.officer.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

  const sent = await sendEmail({
    to: recipient,
    subject: `Your payslip · ${period}`,
    html,
    text,
    replyTo: COMPANY.email || undefined,
    attachments: [{ filename: `Payslip-${slug}.pdf`, content: pdf }],
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true };
}
