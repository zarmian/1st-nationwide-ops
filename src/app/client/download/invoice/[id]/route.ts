import { NextResponse } from "next/server";
import { getClientScope } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { isUuid } from "@/lib/clientPreview";
import { loadInvoiceForPdf } from "@/lib/reports/invoiceReport";
import { renderInvoicePdf } from "@/lib/reports/InvoicePdf";

/** One of the client's own sent invoices as a PDF (never drafts or voids).
 *  GET /client/download/invoice/<id> */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const scope = await getClientScope();
  if (!scope) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const own = await prisma.invoice.findFirst({
    where: { id: params.id, customerId: scope.customerId, status: { in: ["SENT", "PAID"] } },
    select: { id: true },
  });
  const data = own ? await loadInvoiceForPdf(own.id) : null;
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
