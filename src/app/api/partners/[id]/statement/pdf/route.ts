import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { parseIsoDate } from "@/lib/dates";
import { loadPartnerStatement } from "@/lib/partnerStatement";
import { renderPartnerStatementPdf } from "@/lib/reports/PartnerStatementPdf";

/**
 * Partner reconciliation statement PDF. Admin only.
 * GET /api/partners/<id>/statement/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
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
  const to = parseIsoDate(url.searchParams.get("to"), true) ?? now;

  const data = await loadPartnerStatement(params.id, from, to);
  if (!data) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }
  const pdf = await renderPartnerStatementPdf(data);
  const safeName = data.partnerName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="statement-${safeName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
