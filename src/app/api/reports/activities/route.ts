import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  loadActivitiesReportRows,
  parseActivitiesQuery,
  statusLabel,
} from "@/lib/reports/activitiesReport";
import {
  renderActivitiesReportPdf,
  type ActivitiesReportData,
} from "@/lib/reports/ActivitiesReportPdf";
import { formatDate, formatDateTime } from "@/lib/dates";

/**
 * Completed-activities report as a PDF. Staff only (no financial columns, so
 * dispatchers get it too). Respects the /activities filters via the query
 * string; defaults to completed when no status filter is set.
 *
 * GET /api/reports/activities?from=&to=&customerId=&status=…
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN" && role !== "DISPATCHER") {
    return NextResponse.json({ error: "Unauthorised" }, { status: 403 });
  }

  const params = parseActivitiesQuery(new URL(req.url));
  const defaultedToCompleted = params.statuses.length === 0;
  if (defaultedToCompleted) params.statuses = ["completed"];

  const rows = await loadActivitiesReportRows(params);

  const data: ActivitiesReportData = {
    title: defaultedToCompleted ? "Completed activities" : "Activities report",
    rangeLabel: `${formatDate(params.from)} – ${formatDate(params.to)}`,
    scopeLabel: null,
    generatedAt: formatDateTime(new Date()),
    total: rows.length,
    rows: rows.map((r) => ({
      date: formatDateTime(r.at),
      service: r.kind,
      site: [r.siteCode, r.siteName].filter(Boolean).join(" · ") || "—",
      account: r.customer ?? r.partner ?? "—",
      officer: r.officer ?? "—",
      status: statusLabel(r.status),
      location: r.location,
    })),
  };

  const pdf = await renderActivitiesReportPdf(data);
  const fn = `activities-${params.from
    .toISOString()
    .slice(0, 10)}-to-${params.to.toISOString().slice(0, 10)}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fn}"`,
      "Cache-Control": "no-store",
    },
  });
}
