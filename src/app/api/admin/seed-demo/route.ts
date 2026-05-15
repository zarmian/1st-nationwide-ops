import { NextResponse } from "next/server";
import { runDemoSeed } from "@/lib/demoSeed";
import { getSessionUser } from "@/lib/authz";
import {
  adminInitLimiter,
  checkLimit,
  clientKey,
} from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Seed the database with demo data so every page in the app has something
 * to render.
 *
 * Auth accepts either route:
 *   1. Logged-in ADMIN session — just visit while signed in.
 *   2. ?secret=<INIT_SECRET> — for automation / when no admin exists.
 *
 *   GET /api/admin/seed-demo             (idempotent — refuses if demo already seeded)
 *   GET /api/admin/seed-demo?reset=true  (wipes existing demo rows first)
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

  const me = await getSessionUser();
  const isAdmin = me?.role === "ADMIN";
  const hasSecret =
    process.env.INIT_SECRET && secret === process.env.INIT_SECRET;

  if (!isAdmin && !hasSecret) {
    return NextResponse.json(
      {
        error: "Forbidden",
        hint: "Sign in as an admin user and visit this URL, or pass ?secret=<INIT_SECRET>.",
      },
      { status: 403 },
    );
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
