import { NextResponse } from "next/server";
import { getClientScope } from "@/lib/authz";
import { ukDayPlus, ukDayString } from "@/lib/dates";
import { loadShurgardReport } from "@/lib/reports/shurgardReport";
import { renderShurgardReportPdf } from "@/lib/reports/ShurgardReportPdf";
import { FLOOR_DAY } from "@/lib/clientPeriod";

/** The client's daily report for one UK day (PDF): callouts, lock-ups and
 *  unlocks, and static guarding — their own sites only.
 *  GET /client/download/daily-report?date=YYYY-MM-DD (default yesterday) */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export async function GET(req: Request) {
  const scope = await getClientScope();
  if (!scope) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const raw = new URL(req.url).searchParams.get("date") ?? "";
  const today = ukDayString(new Date());
  const y = ukDayPlus(new Date(), -1);
  const yesterday = `${y.year}-${pad(y.month)}-${pad(y.day)}`;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : yesterday;
  if (date < FLOOR_DAY || date > today) {
    return NextResponse.json({ error: "Pick a day from 1 September 2026 to today." }, { status: 400 });
  }
  const [year, month, day] = date.split("-").map(Number);

  const data = await loadShurgardReport({ year, month, day }, new Date(), {
    customerId: scope.customerId,
  });
  const pdf = await renderShurgardReportPdf(data);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="daily-report-${date}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
