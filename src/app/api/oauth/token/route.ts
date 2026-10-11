import { prisma } from "@/lib/db";
import { clientIdFrom, readOAuthParams, tokenJson } from "@/lib/mcp/http";
import {
  OAuthError,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from "@/lib/mcp/oauth";
import { checkLimit, clientKey, oauthLimiter } from "@/lib/ratelimit";

/**
 * OAuth 2.1 token endpoint for the Claude connector: authorization_code
 * (with S256 PKCE) and refresh_token (rotating). Public clients only.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const limit = await checkLimit(oauthLimiter, clientKey(req));
  if (!limit.allowed) {
    return tokenJson(
      { error: "slow_down", error_description: "Too many requests. Try again shortly." },
      429,
    );
  }

  const params = await readOAuthParams(req);
  const clientId = clientIdFrom(req, params);
  const resource = params.get("resource") ?? undefined;

  try {
    switch (params.get("grant_type")) {
      case "authorization_code":
        return tokenJson(
          await exchangeAuthorizationCode(prisma, {
            code: params.get("code") ?? undefined,
            redirectUri: params.get("redirect_uri") ?? undefined,
            clientId,
            codeVerifier: params.get("code_verifier") ?? undefined,
            resource,
          }),
        );
      case "refresh_token":
        return tokenJson(
          await refreshAccessToken(prisma, {
            refreshToken: params.get("refresh_token") ?? undefined,
            clientId,
            resource,
          }),
        );
      default:
        throw new OAuthError(
          "unsupported_grant_type",
          "Use grant_type=authorization_code or refresh_token.",
        );
    }
  } catch (e) {
    if (e instanceof OAuthError) {
      return tokenJson({ error: e.code, error_description: e.description }, e.status);
    }
    console.error("oauth token endpoint failed", e instanceof Error ? e.message : e);
    return tokenJson(
      { error: "server_error", error_description: "Something went wrong. Try again." },
      500,
    );
  }
}
