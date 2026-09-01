import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/authz";
import { parseIsoDate, toIsoDate } from "@/lib/dates";
import { costsCsv } from "@/lib/accountingExport";

/**
 * GET /api/finance/export/costs?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Supplier costs / purchases — one row per bill (by bill date). Admin only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }
  const url = new URL(req.url);
  const from = parseIsoDate(url.searchParams.get("from"));
  const to = parseIsoDate(url.searchParams.get("to"), true);
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
  const csv = await costsCsv(from, to);
  const filename = `costs-${toIsoDate(from)}_to_${toIsoDate(to)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
