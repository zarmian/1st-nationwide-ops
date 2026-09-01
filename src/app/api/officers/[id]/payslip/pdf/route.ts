import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { parseIsoDate } from "@/lib/dates";
import { loadPayslip } from "@/lib/payslip";
import { renderPayslipPdf } from "@/lib/reports/PayslipPdf";

/**
 * Officer payslip PDF. Admin only.
 * GET /api/officers/<id>/payslip/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const u = await getSessionUser();
  if (!u || u.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorised" }, { status: 403 });
  }

  const url = new URL(req.url);
  const now = new Date();
  const from =
    parseIsoDate(url.searchParams.get("from")) ??
    new Date(now.getFullYear(), now.getMonth(), 1);
  const to =
    parseIsoDate(url.searchParams.get("to"), true) ??
    new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const data = await loadPayslip(params.id, from, to);
  if (!data) {
    return NextResponse.json({ error: "Officer not found" }, { status: 404 });
  }

  const pdf = await renderPayslipPdf(data);
  const slug = data.officer.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const period = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Payslip-${slug}-${period}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
