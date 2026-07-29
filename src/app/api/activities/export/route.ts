import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/authz";
import {
  loadActivitiesReportRows,
  parseActivitiesQuery,
  statusLabel,
} from "@/lib/reports/activitiesReport";

export const dynamic = "force-dynamic";

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  // Admin-only — the CSV contains billed/paid columns. Dispatchers run
  // the live board but don't see financials.
  await requireAdmin();

  const params = parseActivitiesQuery(new URL(req.url));
  const rows = await loadActivitiesReportRows(params);

  const header = [
    "Date",
    "Service",
    "Site code",
    "Site",
    "Region",
    "Customer",
    "Partner",
    "Officer",
    "Location",
    "Billed (GBP)",
    "Paid (GBP)",
    "Status",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.at.toISOString(),
        r.kind,
        r.siteCode,
        r.siteName,
        r.region,
        r.customer,
        r.partner,
        r.officer,
        r.location,
        r.billed != null ? r.billed.toFixed(2) : "",
        r.paid != null ? r.paid.toFixed(2) : "",
        statusLabel(r.status),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const filename = `activities-${params.from
    .toISOString()
    .slice(0, 10)}-to-${params.to.toISOString().slice(0, 10)}.csv`;
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
