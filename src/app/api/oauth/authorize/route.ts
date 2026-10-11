import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/authz";
import { appOrigin } from "@/lib/mcp/config";
import {
  approveAuthorization,
  checkAuthorizeRequest,
  connectorAccessFor,
  denyAuthorization,
  type AuthorizeInput,
} from "@/lib/mcp/oauth";
import { checkLimit, clientKey, oauthLimiter } from "@/lib/ratelimit";

/**
 * Receives Allow / Cancel from the consent screen (/oauth/authorize) and
 * sends the browser back to Claude with a code (or access_denied).
 *
 * CSRF: the request must come from this site (Origin/Referer check) and carry
 * the signed-in session (NextAuth cookies are SameSite=Lax, so a cross-site
 * POST arrives without one). Everything is re-validated from scratch.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FIELDS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;

function sameSite(req: Request): boolean {
  const source = req.headers.get("origin") ?? req.headers.get("referer");
  if (!source) return false;
  let host: string;
  try {
    host = new URL(source).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>([new URL(appOrigin()).host]);
  const reqHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (reqHost) allowed.add(reqHost);
  return allowed.has(host);
}

function plain(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  const limit = await checkLimit(oauthLimiter, clientKey(req));
  if (!limit.allowed) return plain("Too many attempts. Try again shortly.", 429);
  if (!sameSite(req)) return plain("This request didn't come from the consent page.", 403);

  const form = await req.formData();
  const input: AuthorizeInput = {};
  for (const f of FIELDS) {
    const v = form.get(f);
    if (typeof v === "string") input[f] = v;
  }

  const check = await checkAuthorizeRequest(input);
  if (!check.ok) {
    return check.fatal
      ? plain(check.message, 400)
      : NextResponse.redirect(check.redirectTo, 303);
  }
  const { request } = check;

  const session = await getSessionUser();
  if (!session) {
    const qs = new URLSearchParams();
    for (const f of FIELDS) if (input[f] !== undefined) qs.set(f, input[f]!);
    const back = `/oauth/authorize?${qs.toString()}`;
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(back)}`, appOrigin()),
      303,
    );
  }

  if (form.get("decision") !== "allow") {
    return NextResponse.redirect(denyAuthorization(request), 303);
  }

  const access = await connectorAccessFor(prisma, session.id);
  if (!access.allowed) {
    return NextResponse.redirect(denyAuthorization(request), 303);
  }

  const to = await approveAuthorization(prisma, access.user.id, request);
  return NextResponse.redirect(to, 303);
}
