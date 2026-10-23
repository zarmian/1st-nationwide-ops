import { NextResponse } from "next/server";
import { getClientScope } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { isUuid } from "@/lib/clientPreview";
import { loadShiftReportData } from "@/lib/reports/shiftReport";
import { renderShiftReportPdf } from "@/lib/reports/ShiftReportPdf";

/** A guarding shift's report (PDF) — only for the client's own sites.
 *  GET /client/download/shift/<id> */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const scope = await getClientScope();
  if (!scope) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const own = await prisma.shift.findFirst({
    where: {
      id: params.id,
      site: { is: { customerId: scope.customerId } },
      status: { notIn: ["MISSED", "ABANDONED"] },
    },
    select: { id: true },
  });
  const data = own ? await loadShiftReportData(own.id) : null;
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
