import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  previewNexusActivities,
  runNexusActivities,
  type NexusCompletedActivity,
} from "@/lib/nexusActivities";

/**
 * Machine ingest for the Nexus "Activities" report (completed activities). The
 * scheduled reader (scripts/nexus-activities.mjs, GitHub Actions) logs in,
 * pages through the report for a date window, and POSTs the rows here as JSON.
 * Each becomes a completed VPI/patrol/alarm job stub — see lib/nexusActivities.
 *
 * Auth:  Authorization: Bearer <NEXUS_IMPORT_SECRET> (or x-import-secret) —
 *        the same secret the sites/callouts imports use. Fail-closed.
 * Body:  JSON, a bare array of activities or { "activities": [ … ] }.
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

async function readActivities(req: Request): Promise<NexusCompletedActivity[] | null> {
  const body: unknown = await req.json().catch(() => null);
  if (Array.isArray(body)) return body as NexusCompletedActivity[];
  if (body && typeof body === "object" && Array.isArray((body as any).activities)) {
    return (body as any).activities as NexusCompletedActivity[];
  }
  return null;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "nexus-activities",
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
      const result = await previewNexusActivities(prisma, activities);
      return NextResponse.json({ ok: true, preview: true, ...result });
    }
    const result = await runNexusActivities(prisma, activities);
    return NextResponse.json({ ok: true, preview: false, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Import failed" },
      { status: 500 },
    );
  }
}
