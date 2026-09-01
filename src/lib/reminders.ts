/**
 * Overdue-invoice reminders (dunning). A daily cron emails the customer when an
 * invoice passes each overdue threshold, at most once per stage (the
 * `InvoiceReminder` unique on `[invoiceId, stage]` enforces it).
 *
 * The cron sends only the **highest** stage an invoice currently qualifies for
 * that hasn't been sent, so newly-tracked, already-very-overdue invoices get a
 * single reminder — never a burst of back-dated ones.
 *
 * Everything is a no-op with a clear result when email isn't configured, and a
 * missing customer contact email simply skips that invoice.
 */
import { prisma } from "@/lib/db";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { COMPANY } from "@/lib/company";
import type { InvoicePdfData } from "@/lib/reports/invoiceReport";

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type ReminderStage = { key: string; days: number; label: string };

/** Dunning cadence — thresholds in days past the due date. */
export const REMINDER_STAGES: ReminderStage[] = [
  { key: "overdue_1", days: 1, label: "just overdue" },
  { key: "overdue_7", days: 7, label: "7 days overdue" },
  { key: "overdue_14", days: 14, label: "14 days overdue" },
  { key: "overdue_30", days: 30, label: "30 days overdue" },
];

/** The highest stage whose threshold ≤ `days`, or null if not yet due. */
export function stageForDaysOverdue(days: number): ReminderStage | null {
  let match: ReminderStage | null = null;
  for (const s of REMINDER_STAGES) if (days >= s.days) match = s;
  return match;
}

export type DueReminder = {
  invoiceId: string;
  number: string;
  customer: string;
  toEmail: string;
  balance: number;
  daysOverdue: number;
  stage: string;
};

/** Which SENT invoices are due a (not-yet-sent) reminder as of `asOf`. */
export async function computeDueReminders(
  asOf: Date = new Date(),
): Promise<DueReminder[]> {
  const invoices = await prisma.invoice.findMany({
    where: { status: "SENT", dueAt: { lt: asOf } },
    include: {
      customer: { select: { name: true, contactEmail: true } },
      payments: { select: { amount: true } },
      reminders: { select: { stage: true } },
    },
  });

  const out: DueReminder[] = [];
  for (const inv of invoices) {
    if (!inv.dueAt) continue;
    const email = inv.customer.contactEmail?.trim();
    if (!email) continue;
    const paid = inv.payments.reduce((n, p) => n + Number(p.amount), 0);
    const balance = round2(Number(inv.total) - paid);
    if (balance <= 0.009) continue;
    const daysOverdue = Math.floor((asOf.getTime() - inv.dueAt.getTime()) / DAY_MS);
    const stage = stageForDaysOverdue(daysOverdue);
    if (!stage) continue;
    if (inv.reminders.some((r) => r.stage === stage.key)) continue;
    out.push({
      invoiceId: inv.id,
      number: inv.number,
      customer: inv.customer.name,
      toEmail: email,
      balance,
      daysOverdue,
      stage: stage.key,
    });
  }
  return out;
}

function money(n: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(n);
}
function longDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function reminderBodies(
  data: InvoicePdfData,
  daysOverdue: number,
  balance: number,
): { html: string; text: string } {
  const bal = money(balance, data.currency);
  const greeting = data.customer.contactName
    ? `Hi ${data.customer.contactName},`
    : "Hello,";
  const overduePhrase =
    daysOverdue <= 1 ? "is now due" : `is now ${daysOverdue} days overdue`;
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f1f5f9;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#0F1929;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#0F1929;padding:20px 28px;color:#ffffff;font-size:16px;font-weight:bold;">${COMPANY.name}</td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 14px;">${greeting}</p>
        <p style="margin:0 0 14px;">This is a friendly reminder that invoice <strong>${data.number}</strong> ${overduePhrase}.</p>
        <p style="margin:0 0 6px;font-size:14px;color:#475569;">Amount outstanding</p>
        <p style="margin:0 0 16px;font-size:26px;font-weight:bold;">${bal}</p>
        <p style="margin:0 0 14px;">The invoice was due on <strong>${longDate(data.dueAt)}</strong>. If you've already paid, please ignore this — and thank you. Otherwise we'd be grateful for payment at your earliest convenience.</p>
        <p style="margin:0 0 4px;">Thank you,</p>
        <p style="margin:0;">${COMPANY.name}</p>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f8fafc;font-size:12px;color:#94a3b8;">A copy of the invoice is attached. Reply to this email with any questions.</td></tr>
    </table>
  </body>
</html>`;
  const text = [
    greeting,
    "",
    `This is a friendly reminder that invoice ${data.number} ${overduePhrase}.`,
    "",
    `Amount outstanding: ${bal}`,
    `Due date: ${longDate(data.dueAt)}`,
    "",
    "If you've already paid, please ignore this. Otherwise we'd be grateful for payment at your earliest convenience.",
    "",
    "Thank you,",
    COMPANY.name,
  ].join("\n");
  return { html, text };
}

async function sendOne(
  invoiceId: string,
  daysOverdue: number,
  balance: number,
): Promise<{ ok: boolean; toEmail?: string; error?: string }> {
  const { loadInvoiceForPdf } = await import("@/lib/reports/invoiceReport");
  const data = await loadInvoiceForPdf(invoiceId);
  if (!data) return { ok: false, error: "Invoice not found." };
  const to = data.customer.contactEmail?.trim();
  if (!to) return { ok: false, error: "No contact email on this customer." };
  const { renderInvoicePdf } = await import("@/lib/reports/InvoicePdf");
  const pdf = await renderInvoicePdf(data);
  const { html, text } = reminderBodies(data, daysOverdue, balance);
  const res = await sendEmail({
    to,
    subject: `Reminder: invoice ${data.number} is overdue`,
    html,
    text,
    replyTo: COMPANY.email || undefined,
    attachments: [{ filename: `${data.number}.pdf`, content: pdf }],
  });
  if (!res.ok) return { ok: false, toEmail: to, error: res.error };
  return { ok: true, toEmail: to };
}

export type SendRemindersResult = {
  configured: boolean;
  due: number;
  sent: number;
  failed: number;
};

/** Send every due reminder and log each one. Called by the daily cron. */
export async function sendDueReminders(
  asOf: Date = new Date(),
): Promise<SendRemindersResult> {
  if (!isEmailConfigured()) {
    return { configured: false, due: 0, sent: 0, failed: 0 };
  }
  const due = await computeDueReminders(asOf);
  let sent = 0;
  let failed = 0;
  for (const d of due) {
    const res = await sendOne(d.invoiceId, d.daysOverdue, d.balance);
    if (!res.ok) {
      failed++;
      console.error("reminder send failed", d.number, res.error);
      continue;
    }
    // Unique [invoiceId, stage] makes a concurrent run a no-op rather than a
    // double-send record.
    await prisma.invoiceReminder
      .create({
        data: { invoiceId: d.invoiceId, stage: d.stage, toEmail: d.toEmail },
      })
      .catch(() => {});
    sent++;
  }
  return { configured: true, due: due.length, sent, failed };
}

/**
 * Manually send a reminder for one invoice now (admin button), regardless of
 * stage. Records/updates a "manual" reminder stamp so it shows as last-reminded.
 */
export async function sendManualReminder(
  invoiceId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    return {
      ok: false,
      error: "Email isn't set up yet. Add RESEND_API_KEY to send reminders.",
    };
  }
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      status: true,
      total: true,
      dueAt: true,
      payments: { select: { amount: true } },
    },
  });
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status !== "SENT") {
    return { ok: false, error: "Only a sent, unpaid invoice can be chased." };
  }
  const paid = inv.payments.reduce((n, p) => n + Number(p.amount), 0);
  const balance = round2(Number(inv.total) - paid);
  if (balance <= 0.009) return { ok: false, error: "Nothing outstanding on this invoice." };
  const daysOverdue = inv.dueAt
    ? Math.max(0, Math.floor((Date.now() - inv.dueAt.getTime()) / DAY_MS))
    : 0;

  const res = await sendOne(invoiceId, daysOverdue, balance);
  if (!res.ok) return { ok: false, error: res.error };

  await prisma.invoiceReminder
    .upsert({
      where: { invoiceId_stage: { invoiceId, stage: "manual" } },
      create: { invoiceId, stage: "manual", toEmail: res.toEmail ?? "" },
      update: { sentAt: new Date(), toEmail: res.toEmail ?? "" },
    })
    .catch(() => {});
  return { ok: true };
}
