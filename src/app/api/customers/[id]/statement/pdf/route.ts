import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { parseIsoDate } from "@/lib/dates";
import { loadCustomerStatement } from "@/lib/customerStatement";
import { renderCustomerStatementPdf } from "@/lib/reports/CustomerStatementPdf";

/**
 * Customer account statement PDF. Admin only.
 * GET /api/customers/<id>/statement/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
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
    new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const to =
    parseIsoDate(url.searchParams.get("to"), true) ??
    new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const data = await loadCustomerStatement(params.id, from, to);
  if (!data) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  const pdf = await renderCustomerStatementPdf(data);
  const slug = data.customer.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Statement-${slug}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
