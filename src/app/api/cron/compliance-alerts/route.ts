import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { expiringComplianceItems } from "@/lib/compliance";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { COMPANY } from "@/lib/company";

/**
 * Weekly officer-compliance alert.
 *
 * Runs Monday 08:30 UK (vercel.json). Emails a digest of officer vetting items
 * that are expired, expiring within 30 days, or (for SIA) not recorded — SIA
 * licences, right-to-work, DBS and training certificates. Deploying a lapsed
 * SIA licence fails ACS audits and breaches most client contracts, so this is
 * the safety net that stops one quietly slipping through.
 *
 * Recipient is ADMIN_EMAIL, falling back to COMPANY.email; no-op if neither is
 * set or email isn't configured.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_DAYS = 30;

function longDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

const STATUS_LABEL: Record<string, { text: string; colour: string }> = {
  expired: { text: "Expired", colour: "#dc2626" },
  expiring: { text: "Expiring", colour: "#b45309" },
  missing: { text: "Not recorded", colour: "#b45309" },
  valid: { text: "OK", colour: "#16a34a" },
};

export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const items = await expiringComplianceItems(WARN_DAYS);
  const recipient = (process.env.ADMIN_EMAIL || COMPANY.email || "").trim();

  if (items.length === 0) {
    return NextResponse.json({ ok: true, items: 0, emailed: false });
  }
  if (!isEmailConfigured() || !recipient) {
    return NextResponse.json({
      ok: true,
      items: items.length,
      emailed: false,
      reason: !recipient
        ? "no recipient (set ADMIN_EMAIL)"
        : "email not configured",
    });
  }

  const rows = items
    .map((i) => {
      const s = STATUS_LABEL[i.status] ?? STATUS_LABEL.valid;
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${i.officerName}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${i.kind}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${longDate(i.date)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${s.colour};font-weight:600;">${s.text}</td>
      </tr>`;
    })
    .join("");

  const expiredCount = items.filter((i) => i.status === "expired").length;
  const headline =
    expiredCount > 0
      ? `${expiredCount} officer compliance item${expiredCount === 1 ? "" : "s"} have lapsed`
      : `${items.length} officer compliance item${items.length === 1 ? "" : "s"} need attention`;

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#0F1929;">
    <p>${headline}. Update them before deploying the officer:</p>
    <table style="border-collapse:collapse;width:100%;max-width:640px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0F1929;font-size:12px;text-transform:uppercase;color:#475569;">Officer</th>
        <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0F1929;font-size:12px;text-transform:uppercase;color:#475569;">Item</th>
        <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0F1929;font-size:12px;text-transform:uppercase;color:#475569;">Date</th>
        <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0F1929;font-size:12px;text-transform:uppercase;color:#475569;">Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#64748b;font-size:12px;">Review them in Operations → Compliance register.</p>
  </body></html>`;

  const text = items
    .map((i) => {
      const s = STATUS_LABEL[i.status] ?? STATUS_LABEL.valid;
      return `- ${i.officerName} — ${i.kind}: ${s.text} (${longDate(i.date)})`;
    })
    .join("\n");

  const sent = await sendEmail({
    to: recipient,
    subject: `${headline}`,
    html,
    text: `${headline}.\n\n${text}\n\nReview in Operations → Compliance register.`,
  });

  return NextResponse.json({
    ok: true,
    items: items.length,
    expired: expiredCount,
    emailed: sent.ok,
    error: sent.ok ? undefined : sent.error,
  });
}
