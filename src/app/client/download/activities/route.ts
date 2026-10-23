import { NextResponse } from "next/server";
import { getClientScope } from "@/lib/authz";
import { isActivityGroup, loadClientActivities } from "@/lib/clientPortal";
import { activitiesCsv } from "@/lib/clientCsv";
import { resolveRange } from "../../_range";

/** The activity log as CSV, with the same filters as the page.
 *  GET /client/download/activities?range=&siteId=&type= */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const scope = await getClientScope();
  if (!scope) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const url = new URL(req.url);
  const { from, to } = resolveRange(url.searchParams.get("range") ?? undefined);
  const siteId = url.searchParams.get("siteId")?.trim() || null;
  const type = url.searchParams.get("type");
  const rows = await loadClientActivities(scope.customerId, {
    from,
    to,
    siteId,
    group: isActivityGroup(type) ? type : null,
    limit: 5000,
  });
  return new NextResponse(activitiesCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="activity-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
