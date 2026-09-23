import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  previewKeyholdingJobs,
  runKeyholdingJobs,
  type KeyholdingRow,
} from "@/lib/keyholdingJobs";

/**
 * Machine ingest for the Keyholding Company (Chase2Base) Jobs screen. The
 * reader (scripts/keyholding-jobs.mjs, GitHub Actions) logs in, sets a date
 * window, pages through the table and POSTs the rows here as JSON. Each
 * becomes a job record — see lib/keyholdingJobs for the rules.
 *
 * Auth:  Authorization: Bearer <NEXUS_IMPORT_SECRET> (or x-import-secret) —
 *        the shared import secret. Fail-closed.
 * Body:  JSON, a bare array of rows or { "jobs": [ … ] }.
 * Query: ?preview=1 reports what WOULD change without writing anything.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.NEXUS_IMPORT_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization");
  const alt = req.headers.get("x-import-secret");
  return bearer === `Bearer ${secret}` || alt === secret;
}

async function readRows(req: Request): Promise<KeyholdingRow[] | null> {
  const body: unknown = await req.json().catch(() => null);
  if (Array.isArray(body)) return body as KeyholdingRow[];
  if (body && typeof body === "object" && Array.isArray((body as any).jobs)) {
    return (body as any).jobs as KeyholdingRow[];
  }
  return null;
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "keyholding-jobs", method: "POST" });
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const rows = await readRows(req);
  if (!rows) {
    return NextResponse.json(
      { error: "Expected JSON array of jobs or { jobs: [...] }" },
      { status: 400 },
    );
  }
  const preview = new URL(req.url).searchParams.get("preview") === "1";
  try {
    if (preview) {
      const result = await previewKeyholdingJobs(prisma, rows);
      return NextResponse.json({ ok: true, preview: true, ...result });
    }
    const result = await runKeyholdingJobs(prisma, rows);
    return NextResponse.json({ ok: true, preview: false, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Import failed" },
      { status: 500 },
    );
  }
}
