import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadShiftReportData } from "@/lib/reports/shiftReport";
import { renderShiftReportPdf } from "@/lib/reports/ShiftReportPdf";

/**
 * Customer-facing shift report as a PDF download. Staff only.
 * GET /api/shifts/<id>/report
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN" && role !== "DISPATCHER") {
    return NextResponse.json({ error: "Unauthorised" }, { status: 403 });
  }

  const data = await loadShiftReportData(params.id);
  if (!data) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  const pdf = await renderShiftReportPdf(data);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="shift-report-${data.reportRef}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
