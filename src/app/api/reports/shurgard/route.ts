import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadShurgardReport } from "@/lib/reports/shurgardReport";
import { renderShurgardReportPdf } from "@/lib/reports/ShurgardReportPdf";
import { ukDayPlus } from "@/lib/dates";

/**
 * Shurgard daily report as a PDF. Staff only.
 * GET /api/reports/shurgard?date=YYYY-MM-DD  (defaults to today, UK)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseUkDay(s: string | null) {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN" && role !== "DISPATCHER") {
    return NextResponse.json({ error: "Unauthorised" }, { status: 403 });
  }

  const url = new URL(req.url);
  const day = parseUkDay(url.searchParams.get("date")) ?? ukDayPlus(new Date(), 0);

  const data = await loadShurgardReport(day);
  const pdf = await renderShurgardReportPdf(data);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="shurgard-report-${day.year}-${pad(day.month)}-${pad(day.day)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
