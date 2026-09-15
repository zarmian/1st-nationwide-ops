import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  previewNexusCallouts,
  runNexusCallouts,
  type NexusActivity,
} from "@/lib/nexusCallouts";

/**
 * Machine ingest for the Nexus dashboard callouts. The scheduled reader
 * (scripts/nexus-callouts.mjs, run from GitHub Actions) logs into the Nexus
 * Link portal, parses "Upcoming Activities" off the dashboard, and POSTs the
 * parsed rows here as JSON. This turns each into an internal VPI job stub the
 * office can assign — see src/lib/nexusCallouts.ts for the rules.
 *
 * Auth:  Authorization: Bearer <NEXUS_IMPORT_SECRET> (or x-import-secret) —
 *        the same secret the sites import uses. Fail-closed.
 * Body:  JSON, either a bare array of activities or { "activities": [ … ] }.
 * Query: ?preview=1 reports what WOULD change without writing anything.
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

async function readActivities(req: Request): Promise<NexusActivity[] | null> {
  const body: unknown = await req.json().catch(() => null);
  if (Array.isArray(body)) return body as NexusActivity[];
  if (body && typeof body === "object" && Array.isArray((body as any).activities)) {
    return (body as any).activities as NexusActivity[];
  }
  return null;
}

export async function GET() {
  // Liveness only — never returns data or config, no secret needed.
  return NextResponse.json({
    ok: true,
    service: "nexus-callouts",
    method: "POST",
  });
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const activities = await readActivities(req);
  if (!activities) {
    return NextResponse.json(
      { error: "Expected JSON array of activities or { activities: [...] }" },
      { status: 400 },
    );
  }

  const preview = new URL(req.url).searchParams.get("preview") === "1";

  try {
    if (preview) {
      const result = await previewNexusCallouts(prisma, activities);
      return NextResponse.json({ ok: true, preview: true, ...result });
    }
    const result = await runNexusCallouts(
      prisma,
      activities,
      `Nexus callouts auto-sync ${new Date().toISOString().slice(0, 10)}`,
    );
    return NextResponse.json({ ok: true, preview: false, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Import failed" },
      { status: 500 },
    );
  }
}
