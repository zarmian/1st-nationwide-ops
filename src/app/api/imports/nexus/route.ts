import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { previewNexusImport, runNexusImport } from "@/lib/nexusImport";

/**
 * Machine ingest for the Nexus sites/rates export — the automated counterpart
 * to the manual /admin/imports/nexus upload. The scheduled Nexus sync robot
 * (GitHub Actions) logs into the portal, downloads the CSV, and POSTs it here,
 * so the same importer runs without anyone uploading by hand.
 *
 * Auth:  Authorization: Bearer <NEXUS_IMPORT_SECRET> (or x-import-secret).
 *        Fail-closed — refuses everything until the secret is set, so the
 *        endpoint can't be abused before it's configured.
 * Body:  the raw CSV (Content-Type text/csv / text/plain) or JSON { "csv": "…" }.
 * Query: ?preview=1 reports what WOULD change without writing anything.
 *
 * Upserts only (no deletes), so a re-run is safe. A destructive reset stays a
 * deliberate, admin-only action on the manual page.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.NEXUS_IMPORT_SECRET;
  if (!secret) return false; // fail closed until configured
  const bearer = req.headers.get("authorization");
  const alt = req.headers.get("x-import-secret");
  return bearer === `Bearer ${secret}` || alt === secret;
}

async function readCsv(req: Request): Promise<string> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body: any = await req.json().catch(() => null);
    return typeof body?.csv === "string" ? body.csv : "";
  }
  return (await req.text().catch(() => "")) ?? "";
}

export async function GET() {
  // Liveness only — never returns data or config, no secret needed.
  return NextResponse.json({ ok: true, service: "nexus-import", method: "POST" });
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const csv = (await readCsv(req)).trim();
  if (!csv) {
    return NextResponse.json({ error: "Empty CSV body" }, { status: 400 });
  }

  const preview = new URL(req.url).searchParams.get("preview") === "1";

  try {
    if (preview) {
      const result = await previewNexusImport(prisma, csv);
      return NextResponse.json({ ok: true, preview: true, ...result });
    }
    const result = await runNexusImport(
      prisma,
      csv,
      `Nexus auto-sync ${new Date().toISOString().slice(0, 10)}`,
    );
    return NextResponse.json({ ok: true, preview: false, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Import failed" },
      { status: 500 },
    );
  }
}
