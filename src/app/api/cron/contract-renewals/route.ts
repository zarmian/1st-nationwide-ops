import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cronAuth";
import { contractsDueForRenewal } from "@/lib/contracts";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { COMPANY } from "@/lib/company";

/**
 * Weekly contract-renewal reminder.
 *
 * Runs Monday 08:00 UK (vercel.json). Emails a digest of active contracts whose
 * renewal date is within 30 days (or already past) to the business — so a
 * contract never quietly lapses. Recipient is ADMIN_EMAIL, falling back to
 * COMPANY.email; no-op if neither is set or email isn't configured.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function longDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}
function money(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
  }).format(n);
}

export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const due = await contractsDueForRenewal(30);
  const recipient = (process.env.ADMIN_EMAIL || COMPANY.email || "").trim();

  if (due.length === 0) {
    return NextResponse.json({ ok: true, due: 0, emailed: false });
  }
  if (!isEmailConfigured() || !recipient) {
    return NextResponse.json({
      ok: true,
      due: due.length,
      emailed: false,
      reason: !recipient ? "no recipient (set ADMIN_EMAIL)" : "email not configured",
    });
  }

  const rows = due
    .map((c) => {
      const d = c.daysUntilRenewal ?? 0;
      const when = d < 0 ? `${Math.abs(d)} days ago` : `in ${d} days`;
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${c.title}<div style="color:#64748b;font-size:12px;">${c.customerName}</div></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${longDate(c.endDate)}<div style="color:${d < 0 ? "#dc2626" : "#b45309"};font-size:12px;">${when}</div></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${money(c.annualised)}/yr</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#0F1929;">
    <p>These contracts are due to renew within 30 days:</p>
    <table style="border-collapse:collapse;width:100%;max-width:560px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0F1929;font-size:12px;text-transform:uppercase;color:#475569;">Contract</th>
        <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #0F1929;font-size:12px;text-transform:uppercase;color:#475569;">Renewal</th>
        <th style="text-align:right;padding:6px 10px;border-bottom:2px solid #0F1929;font-size:12px;text-transform:uppercase;color:#475569;">Value</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#64748b;font-size:12px;">Review them in Finance → Contracts.</p>
  </body></html>`;
  const text = due
    .map((c) => {
      const d = c.daysUntilRenewal ?? 0;
      const when = d < 0 ? `${Math.abs(d)} days ago` : `in ${d} days`;
      return `- ${c.title} (${c.customerName}) — renews ${longDate(c.endDate)} (${when}), ${money(c.annualised)}/yr`;
    })
    .join("\n");

  const sent = await sendEmail({
    to: recipient,
    subject: `${due.length} contract${due.length === 1 ? "" : "s"} renewing soon`,
    html,
    text: `Contracts renewing within 30 days:\n\n${text}\n\nReview in Finance → Contracts.`,
  });

  return NextResponse.json({
    ok: true,
    due: due.length,
    emailed: sent.ok,
    error: sent.ok ? undefined : sent.error,
  });
}
