import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/authz";
import { buildPayrollReport, csvHeader, csvLineFor } from "@/lib/payroll";

/**
 * GET /api/payroll/export?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns a CSV with one row per active officer / dispatcher and the
 * totals shown on /finance/payroll. Admin-only.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"), true);
  if (!from || !to) {
    return NextResponse.json(
      { error: "from + to (YYYY-MM-DD) required" },
      { status: 400 },
    );
  }
  if (to < from) {
    return NextResponse.json(
      { error: "to must be on or after from" },
      { status: 400 },
    );
  }

  const report = await buildPayrollReport(from, to);
  const lines = [csvHeader(), ...report.rows.map(csvLineFor)];
  const filename = `payroll-${ymd(from)}_to_${ymd(to)}.csv`;
  return new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function parseDate(s: string | null, endOfDay = false): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function ymd(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
