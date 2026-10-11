/**
 * Claude connector (MCP) — addresses, scopes and lifetimes shared by the
 * OAuth authorisation server (/oauth/authorize, /api/oauth/*), the discovery
 * documents (/.well-known/*) and the MCP endpoint itself (/api/mcp).
 *
 * The app is its own authorisation server: issuer = the app's origin, and
 * the one protected resource is `${origin}/api/mcp`. See
 * docs/system/17-claude-connector.md.
 */

export const MCP_PATH = "/api/mcp";

/** The only resource scope. Read-only by design — there is no write scope. */
export const MCP_SCOPE = "ops:read";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const AUTH_CODE_TTL_SECONDS = 5 * 60; // 5 minutes

/** Shown to Claude (initialize → serverInfo) and on the consent screen. */
export const CONNECTOR_NAME = "1st Nationwide Ops";

/**
 * The app's public origin (scheme + host, no trailing slash). NEXTAUTH_URL is
 * the canonical address in every environment we run (it's what sign-in
 * redirects already use); Vercel's production hostname and localhost are
 * fallbacks for previews and local runs.
 */
export function appOrigin(): string {
  const candidates = [
    process.env.NEXTAUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    "http://localhost:3000",
  ];
  for (const c of candidates) {
    if (!c?.trim()) continue;
    try {
      const u = new URL(c.trim());
      return `${u.protocol}//${u.host}`;
    } catch {
      // try the next candidate
    }
  }
  return "http://localhost:3000";
}

export function issuerUrl(): string {
  return appOrigin();
}

/** The MCP endpoint — what people paste into Claude, and the token audience. */
export function mcpResourceUrl(): string {
  return `${appOrigin()}${MCP_PATH}`;
}

/** RFC 9728 path-suffixed location (clients try this first for /api/mcp). */
export function protectedResourceMetadataUrl(): string {
  return `${appOrigin()}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

function canonical(uri: string): string | null {
  try {
    const u = new URL(uri.trim());
    if (u.hash) return null;
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return null;
  }
}

/**
 * RFC 8707: does this `resource` value name our MCP endpoint? Tolerates a
 * trailing slash and upper-case scheme/host, nothing else.
 */
export function isOurResource(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = canonical(value);
  return v !== null && v === canonical(mcpResourceUrl());
}

/** RFC 8414 authorisation server metadata. */
export function authorizationServerMetadata() {
  const origin = appOrigin();
  return {
    issuer: issuerUrl(),
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Claude's Client ID Metadata Document client is public (PKCE only).
    // Advertising "none" + the CIMD flag is what makes Claude use CIMD; there
    // is deliberately no registration_endpoint (no open client registration).
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    // offline_access only signals "please send a refresh token" — one is
    // always issued anyway.
    scopes_supported: [MCP_SCOPE, "offline_access"],
  };
}

/** RFC 9728 protected resource metadata for /api/mcp. */
export function protectedResourceMetadata() {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [issuerUrl()],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: CONNECTOR_NAME,
  };
}

/** `WWW-Authenticate` value for 401s from /api/mcp (RFC 6750 + RFC 9728). */
export function wwwAuthenticate(error?: {
  code: "invalid_token" | "insufficient_scope";
  description: string;
}): string {
  const parts: string[] = [];
  if (error) {
    parts.push(`error="${error.code}"`);
    parts.push(`error_description="${error.description.replace(/"/g, "'")}"`);
  }
  parts.push(`resource_metadata="${protectedResourceMetadataUrl()}"`);
  parts.push(`scope="${MCP_SCOPE}"`);
  return `Bearer ${parts.join(", ")}`;
}
