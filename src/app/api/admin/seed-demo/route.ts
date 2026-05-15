import { NextResponse } from "next/server";
import { runDemoSeed } from "@/lib/demoSeed";
import {
  adminInitLimiter,
  checkLimit,
  clientKey,
} from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Seed the database with demo data so every page in the app has something
 * to render. Same auth model as /api/admin/init — gated by INIT_SECRET so
 * accidental hits don't run it.
 *
 *   GET /api/admin/seed-demo?secret=<INIT_SECRET>            (idempotent — refuses if demo already seeded)
 *   GET /api/admin/seed-demo?secret=<INIT_SECRET>&reset=true (wipes existing demo rows first)
 *
 * Demo rows are identified by a "DEMO-" prefix on their unique fields
 * (site code, customer name, partner name, officer email). Real data is
 * never touched.
 */
export async function GET(req: Request) {
  const limit = await checkLimit(adminInitLimiter, clientKey(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const reset = url.searchParams.get("reset") === "true";

  if (!process.env.INIT_SECRET) {
    return NextResponse.json(
      { error: "INIT_SECRET not configured on the server." },
      { status: 500 },
    );
  }
  if (secret !== process.env.INIT_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await runDemoSeed({ reset });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
      },
      { status: 500 },
    );
  }
}
