import { prisma } from "@/lib/db";
import { readOAuthParams } from "@/lib/mcp/http";
import { revokeToken } from "@/lib/mcp/oauth";
import { checkLimit, clientKey, oauthLimiter } from "@/lib/ratelimit";

/**
 * RFC 7009 token revocation for the Claude connector. Always answers 200
 * (so it can't be used to probe which tokens exist). Revoking a refresh token
 * disconnects the whole connection.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const limit = await checkLimit(oauthLimiter, clientKey(req));
  if (!limit.allowed) return new Response(null, { status: 429 });
  const params = await readOAuthParams(req);
  const token = params.get("token");
  if (token) {
    await revokeToken(prisma, token).catch((e) =>
      console.error("oauth revoke failed", e instanceof Error ? e.message : e),
    );
  }
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
