/**
 * Delivery layer for the daily client report.
 *
 * The report itself (queries + PDF) already exists in shurgardReport.ts /
 * ShurgardReportPdf.tsx — this module adds emailing it and a send audit log.
 *
 * Safety: the scheduled cron only sends when the Shurgard customer has
 * `dailyReportOn = true` (off by default), so nothing reaches a client before
 * the format is agreed with them. Manual "Send now" from /reports is an
 * explicit admin action and always allowed.
 */
import { prisma } from "@/lib/db";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { COMPANY } from "@/lib/company";
import { ukWallClockToUtc } from "@/lib/dates";
import {
  loadShurgardReport,
  type ShurgardReportData,
  type UkDay,
} from "./shurgardReport";

export const SHURGARD_REPORT_KEY = "shurgard";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
function ymd(d: UkDay): string {
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/** The UTC instant we store for a UK report day (UK-noon, safely inside the day). */
export function reportDateInstant(day: UkDay): Date {
  return ukWallClockToUtc(day.year, day.month, day.day, 12, 0);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type ShurgardDelivery = {
  shurgard: {
    id: string;
    name: string;
    contactEmail: string | null;
    dailyReportOn: boolean;
    dailyReportRecipient: string | null;
  } | null;
  /** Resolved recipient: dailyReportRecipient → contactEmail → null. */
  recipient: string | null;
};

/** Look up the Shurgard customer and its resolved daily-report recipient. */
export async function getShurgardDelivery(): Promise<ShurgardDelivery> {
  const shurgard = await prisma.customer.findFirst({
    where: { name: { contains: "Shurgard", mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      contactEmail: true,
      dailyReportOn: true,
      dailyReportRecipient: true,
    },
  });
  const recipient =
    (shurgard?.dailyReportRecipient || shurgard?.contactEmail || "").trim() ||
    null;
  return { shurgard, recipient };
}

/** HTML email body mirroring the PDF: grouped callouts/lock-ups + static hours. */
export function buildReportHtml(data: ShurgardReportData): string {
  const jobItems = data.jobSites.length
    ? data.jobSites.map((s) => `<li>${esc(s)}</li>`).join("")
    : `<li style="color:#64748b;">No callouts or lock-ups recorded.</li>`;

  const shiftRows = data.shifts.length
    ? data.shifts
        .map(
          (s) => `<tr>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(s.label)}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums;">${esc(s.hours)}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="2" style="padding:6px 10px;color:#64748b;">No static guarding shifts recorded.</td></tr>`;

  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#0F1929;margin:0;padding:0;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 4px;color:#0F1929;">Daily security report</h2>
      <p style="margin:0 0 20px;color:#475569;">${esc(data.dateLabel)}</p>

      <h3 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#475569;">Callouts, lock-ups &amp; unlocks</h3>
      <ul style="margin:0 0 24px;padding-left:20px;line-height:1.6;">${jobItems}</ul>

      <h3 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#475569;">Static guarding</h3>
      <table style="border-collapse:collapse;width:100%;max-width:560px;">
        <thead><tr>
          <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0F1929;font-size:12px;text-transform:uppercase;color:#475569;">Site</th>
          <th style="text-align:right;padding:6px 10px;border-bottom:2px solid #0F1929;font-size:12px;text-transform:uppercase;color:#475569;">Hours</th>
        </tr></thead>
        <tbody>${shiftRows}</tbody>
      </table>

      <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">
        The full report is attached as a PDF.<br/>
        ${esc(COMPANY.name)} · generated ${esc(data.generatedAt)}
      </p>
    </div>
  </body></html>`;
}

/** Plain-text fallback. */
export function buildReportText(data: ShurgardReportData): string {
  const jobs = data.jobSites.length
    ? data.jobSites.map((s) => `  - ${s}`).join("\n")
    : "  (none)";
  const shifts = data.shifts.length
    ? data.shifts.map((s) => `  - ${s.label}: ${s.hours}`).join("\n")
    : "  (none)";
  return [
    `Daily security report — ${data.dateLabel}`,
    "",
    "Callouts, lock-ups & unlocks:",
    jobs,
    "",
    "Static guarding:",
    shifts,
    "",
    "The full report is attached as a PDF.",
    COMPANY.name,
  ].join("\n");
}

export type DeliverResult =
  | { ok: true; sendId: string; to: string }
  | { ok: false; reason: string };

/**
 * Render + email the Shurgard report for a UK day, logging the attempt.
 * `to` overrides the configured recipient (used by manual send). `triggeredBy`
 * is "cron" or an admin user id.
 */
export async function deliverShurgardReport(
  day: UkDay,
  opts: { to?: string | null; triggeredBy: string },
): Promise<DeliverResult> {
  const { recipient: configured } = await getShurgardDelivery();
  const to = (opts.to || configured || process.env.ADMIN_EMAIL || COMPANY.email || "").trim();
  if (!to) {
    return {
      ok: false,
      reason:
        "No recipient set. Add a delivery email on the Daily report page (or the Shurgard customer's contact email).",
    };
  }
  if (!isEmailConfigured()) {
    return {
      ok: false,
      reason: "Email isn't configured yet (set RESEND_API_KEY in Vercel).",
    };
  }

  const data = await loadShurgardReport(day);
  const subject = `Daily security report — ${data.dateLabel}`;

  // Log the attempt up front so a crash mid-send still leaves a trace.
  const send = await prisma.clientReportSend.create({
    data: {
      reportKey: SHURGARD_REPORT_KEY,
      reportDate: reportDateInstant(day),
      toAddress: to,
      subject,
      status: "PENDING",
      jobCount: data.jobSites.length,
      shiftCount: data.shifts.length,
      triggeredBy: opts.triggeredBy,
    },
    select: { id: true },
  });

  try {
    // Dynamic import keeps the heavy PDF renderer out of callers' module graphs.
    const { renderShurgardReportPdf } = await import("./ShurgardReportPdf");
    const pdf = await renderShurgardReportPdf(data);
    const res = await sendEmail({
      to,
      subject,
      html: buildReportHtml(data),
      text: buildReportText(data),
      attachments: [{ filename: `shurgard-report-${ymd(day)}.pdf`, content: pdf }],
    });
    if (!res.ok) {
      await prisma.clientReportSend.update({
        where: { id: send.id },
        data: { status: "FAILED", failureReason: res.error },
      });
      return { ok: false, reason: res.error };
    }
    await prisma.clientReportSend.update({
      where: { id: send.id },
      data: { status: "SENT", sentAt: new Date() },
    });
    return { ok: true, sendId: send.id, to };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Report render/send failed";
    await prisma.clientReportSend.update({
      where: { id: send.id },
      data: { status: "FAILED", failureReason: msg },
    });
    return { ok: false, reason: msg };
  }
}

/** Has a SENT report already gone out for this UK day? (cron idempotency) */
export async function alreadySentForDay(day: UkDay): Promise<boolean> {
  const dayStart = ukWallClockToUtc(day.year, day.month, day.day, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const n = await prisma.clientReportSend.count({
    where: {
      reportKey: SHURGARD_REPORT_KEY,
      status: "SENT",
      reportDate: { gte: dayStart, lte: dayEnd },
    },
  });
  return n > 0;
}

export type RecentSend = {
  id: string;
  reportDate: Date;
  toAddress: string;
  status: string;
  sentAt: Date | null;
  failureReason: string | null;
  triggeredBy: string | null;
  createdAt: Date;
};

/** Most-recent send attempts, newest first, for the /reports status panel. */
export async function recentReportSends(limit = 6): Promise<RecentSend[]> {
  return prisma.clientReportSend.findMany({
    where: { reportKey: SHURGARD_REPORT_KEY },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      reportDate: true,
      toAddress: true,
      status: true,
      sentAt: true,
      failureReason: true,
      triggeredBy: true,
      createdAt: true,
    },
  });
}
