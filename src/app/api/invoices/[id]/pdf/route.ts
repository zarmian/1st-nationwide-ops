import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { loadInvoiceForPdf } from "@/lib/reports/invoiceReport";
import { renderInvoicePdf } from "@/lib/reports/InvoicePdf";

/**
 * Invoice PDF download. Admin only.
 * GET /api/invoices/<id>/pdf
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const u = await getSessionUser();
  if (!u || u.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorised" }, { status: 403 });
  }
  const data = await loadInvoiceForPdf(params.id);
  if (!data) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  const pdf = await renderInvoicePdf(data);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${data.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
