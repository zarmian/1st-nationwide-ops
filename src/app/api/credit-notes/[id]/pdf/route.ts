import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { loadCreditNoteForPdf } from "@/lib/creditNotes";
import { renderCreditNotePdf } from "@/lib/reports/CreditNotePdf";

/**
 * Credit note PDF download. Admin only.
 * GET /api/credit-notes/<id>/pdf
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
  const data = await loadCreditNoteForPdf(params.id);
  if (!data) {
    return NextResponse.json({ error: "Credit note not found" }, { status: 404 });
  }
  const pdf = await renderCreditNotePdf(data);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${data.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
