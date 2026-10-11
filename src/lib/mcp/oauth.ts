/**
 * OAuth 2.1 authorisation server for the Claude connector: authorisation
 * request checks, single-use codes with S256 PKCE, hashed bearer tokens with
 * refresh-token rotation, and revocation. Only SHA-256 hashes of codes and
 * tokens are ever stored.
 *
 * Who may connect: active ADMIN accounts, plus DISPATCHER accounts when an
 * admin has switched that on (McpSettings.allowDispatchers). Re-checked on
 * every token exchange and every MCP request, so demoting or deactivating a
 * user cuts Claude off immediately.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  MCP_SCOPE,
  REFRESH_TOKEN_TTL_SECONDS,
  isOurResource,
  issuerUrl,
  mcpResourceUrl,
} from "./config";
import {
  redirectUriMatches,
  resolveClient,
  type McpClient,
} from "./clients";

// ── Crypto helpers ─────────────────────────────────────────────────────────

const PREFIX = { code: "1nw_code_", access: "1nw_at_", refresh: "1nw_rt_" };

export function newSecret(kind: keyof typeof PREFIX): string {
  return PREFIX[kind] + randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeChallenge(challenge: string): boolean {
  return CHALLENGE_RE.test(challenge);
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) === challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!VERIFIER_RE.test(verifier) || !CHALLENGE_RE.test(challenge)) {
    return false;
  }
  const computed = Buffer.from(
    createHash("sha256").update(verifier).digest("base64url"),
  );
  const expected = Buffer.from(challenge);
  return (
    computed.length === expected.length && timingSafeEqual(computed, expected)
  );
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** An RFC 6749 §5.2 error for the token / revocation endpoints. */
export class OAuthError extends Error {
  constructor(
    public readonly code:
      | "invalid_request"
      | "invalid_client"
      | "invalid_grant"
      | "unsupported_grant_type"
      | "invalid_scope"
      | "invalid_target",
    public readonly description: string,
    public readonly status = 400,
  ) {
    super(description);
  }
}

// ── Who may connect ────────────────────────────────────────────────────────

export type ConnectorRole = "ADMIN" | "DISPATCHER";

export type ConnectorAccess =
  | {
      allowed: true;
      user: { id: string; name: string; email: string; role: ConnectorRole };
    }
  | { allowed: false; reason: string };

export async function getConnectorSettings(
  prisma: PrismaClient,
): Promise<{ allowDispatchers: boolean }> {
  const row = await prisma.mcpSettings.findUnique({ where: { id: 1 } });
  return { allowDispatchers: row?.allowDispatchers ?? false };
}

/** Can this user (re-read from the database, not the session) use Claude? */
export async function connectorAccessFor(
  prisma: PrismaClient,
  userId: string,
): Promise<ConnectorAccess> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user || !user.active) {
    return { allowed: false, reason: "This account is not active." };
  }
  if (user.role === "ADMIN") {
    return { allowed: true, user: { ...user, role: "ADMIN" } };
  }
  if (user.role === "DISPATCHER") {
    const { allowDispatchers } = await getConnectorSettings(prisma);
    if (allowDispatchers) {
      return { allowed: true, user: { ...user, role: "DISPATCHER" } };
    }
    return {
      allowed: false,
      reason:
        "Office accounts can't connect Claude yet. An admin can switch this on in Admin → Claude.",
    };
  }
  return {
    allowed: false,
    reason: "Only admin and office accounts can connect Claude.",
  };
}

// ── Authorisation request (/oauth/authorize) ───────────────────────────────

export type AuthorizeInput = Partial<
  Record<
    | "response_type"
    | "client_id"
    | "redirect_uri"
    | "code_challenge"
    | "code_challenge_method"
    | "state"
    | "scope"
    | "resource",
    string
  >
>;

export type AuthorizeRequest = {
  client: McpClient;
  redirectUri: string;
  codeChallenge: string;
  state: string | undefined;
  scope: string;
  resource: string;
};

export type AuthorizeCheck =
  | { ok: true; request: AuthorizeRequest }
  /** Can't trust the client or its redirect — show an error page, never redirect. */
  | { ok: false; fatal: true; message: string }
  /** Client + redirect are good; report the error back to the client. */
  | { ok: false; fatal: false; redirectTo: string };

/** Append params to a redirect URI (always including `iss`, RFC 9207). */
export function buildClientRedirect(
  redirectUri: string,
  params: Record<string, string | undefined>,
): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, v);
  }
  u.searchParams.set("iss", issuerUrl());
  return u.toString();
}

/** The scope we grant: always exactly the read scope (offline_access is implied). */
export function grantedScope(): string {
  return MCP_SCOPE;
}

export async function checkAuthorizeRequest(
  input: AuthorizeInput,
  fetchImpl?: typeof fetch,
): Promise<AuthorizeCheck> {
  const clientId = input.client_id?.trim();
  if (!clientId) {
    return {
      ok: false,
      fatal: true,
      message: "This request didn't say which app is asking to connect.",
    };
  }
  const client = await resolveClient(clientId, fetchImpl);
  if (!client) {
    return {
      ok: false,
      fatal: true,
      message:
        "Only Claude can connect to 1st Nationwide Ops, and this request didn't come from Claude.",
    };
  }
  const redirectUri = input.redirect_uri?.trim();
  if (!redirectUri || !redirectUriMatches(client.redirectUris, redirectUri)) {
    return {
      ok: false,
      fatal: true,
      message:
        "The return address in this request doesn't belong to Claude, so we stopped here.",
    };
  }

  const state = input.state;
  const fail = (error: string, description: string): AuthorizeCheck => ({
    ok: false,
    fatal: false,
    redirectTo: buildClientRedirect(redirectUri, {
      error,
      error_description: description,
      state,
    }),
  });

  if (input.response_type !== "code") {
    return fail("unsupported_response_type", "Only response_type=code is supported.");
  }
  const codeChallenge = input.code_challenge?.trim() ?? "";
  if (input.code_challenge_method !== "S256" || !isValidCodeChallenge(codeChallenge)) {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  if (input.resource && !isOurResource(input.resource)) {
    return fail("invalid_target", `This server only issues tokens for ${mcpResourceUrl()}.`);
  }

  return {
    ok: true,
    request: {
      client,
      redirectUri,
      codeChallenge,
      state,
      scope: grantedScope(),
      resource: mcpResourceUrl(),
    },
  };
}

/**
 * The user clicked Allow: record the connection and mint a single-use code.
 * Returns the URL to send the browser back to Claude with.
 */
export async function approveAuthorization(
  prisma: PrismaClient,
  userId: string,
  request: AuthorizeRequest,
): Promise<string> {
  const code = newSecret("code");
  await prisma.mcpGrant.create({
    data: {
      userId,
      clientId: request.client.clientId,
      clientName: request.client.clientName,
      redirectHost: new URL(request.redirectUri).hostname,
      scope: request.scope,
      resource: request.resource,
      codes: {
        create: {
          codeHash: sha256Hex(code),
          redirectUri: request.redirectUri,
          codeChallenge: request.codeChallenge,
          expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000),
        },
      },
    },
  });
  // Tidy up: connections abandoned before Claude collected the code.
  await prisma.mcpGrant
    .deleteMany({
      where: {
        tokens: { none: {} },
        createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    })
    .catch(() => {});
  return buildClientRedirect(request.redirectUri, { code, state: request.state });
}

export function denyAuthorization(request: AuthorizeRequest): string {
  return buildClientRedirect(request.redirectUri, {
    error: "access_denied",
    error_description: "The user declined to connect Claude.",
    state: request.state,
  });
}

// ── Token endpoint (/api/oauth/token) ──────────────────────────────────────

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

async function issueTokens(
  prisma: PrismaClient,
  grant: { id: string; scope: string },
): Promise<TokenResponse> {
  const access = newSecret("access");
  const refresh = newSecret("refresh");
  const now = Date.now();
  await prisma.mcpToken.createMany({
    data: [
      {
        tokenHash: sha256Hex(access),
        kind: "ACCESS",
        grantId: grant.id,
        expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
      },
      {
        tokenHash: sha256Hex(refresh),
        kind: "REFRESH",
        grantId: grant.id,
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    ],
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh,
    scope: grant.scope,
  };
}

/** Disconnect: revoke the connection and every token issued under it. */
export async function revokeGrant(
  prisma: PrismaClient,
  grantId: string,
  byUserId: string | null,
): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mcpGrant.updateMany({
      where: { id: grantId, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: byUserId },
    }),
    prisma.mcpToken.updateMany({
      where: { grantId, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
}

export async function exchangeAuthorizationCode(
  prisma: PrismaClient,
  p: {
    code?: string;
    redirectUri?: string;
    clientId?: string;
    codeVerifier?: string;
    resource?: string;
  },
): Promise<TokenResponse> {
  if (!p.code || !p.redirectUri || !p.clientId || !p.codeVerifier) {
    throw new OAuthError(
      "invalid_request",
      "code, redirect_uri, client_id and code_verifier are required.",
    );
  }
  const row = await prisma.mcpAuthCode.findUnique({
    where: { codeHash: sha256Hex(p.code) },
    include: { grant: true },
  });
  if (!row) throw new OAuthError("invalid_grant", "Unknown authorization code.");
  if (row.usedAt) {
    // Replay: OAuth 2.1 says revoke what the code already produced.
    await revokeGrant(prisma, row.grantId, null);
    throw new OAuthError("invalid_grant", "Authorization code already used.");
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new OAuthError("invalid_grant", "Authorization code expired.");
  }
  if (row.grant.revokedAt) {
    throw new OAuthError("invalid_grant", "This connection was disconnected.");
  }
  if (row.grant.clientId !== p.clientId) {
    throw new OAuthError("invalid_grant", "Code was issued to a different client.");
  }
  if (row.redirectUri !== p.redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri doesn't match the authorization request.");
  }
  if (!verifyPkceS256(p.codeVerifier, row.codeChallenge)) {
    throw new OAuthError("invalid_grant", "PKCE verification failed.");
  }
  if (p.resource && !isOurResource(p.resource)) {
    throw new OAuthError("invalid_target", `Tokens are only issued for ${mcpResourceUrl()}.`);
  }

  // Claim the code atomically so two racing exchanges can't both succeed.
  const claimed = await prisma.mcpAuthCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) {
    await revokeGrant(prisma, row.grantId, null);
    throw new OAuthError("invalid_grant", "Authorization code already used.");
  }

  const access = await connectorAccessFor(prisma, row.grant.userId);
  if (!access.allowed) {
    await revokeGrant(prisma, row.grantId, null);
    throw new OAuthError("invalid_grant", access.reason);
  }
  return issueTokens(prisma, row.grant);
}

/** A rotated-out refresh token reused this long after rotation = likely stolen. */
const REFRESH_REUSE_GRACE_MS = 2 * 60 * 1000;

export async function refreshAccessToken(
  prisma: PrismaClient,
  p: { refreshToken?: string; clientId?: string; resource?: string },
): Promise<TokenResponse> {
  if (!p.refreshToken) {
    throw new OAuthError("invalid_request", "refresh_token is required.");
  }
  const row = await prisma.mcpToken.findUnique({
    where: { tokenHash: sha256Hex(p.refreshToken) },
    include: { grant: true },
  });
  if (!row || row.kind !== "REFRESH") {
    throw new OAuthError("invalid_grant", "Unknown refresh token.");
  }
  if (p.clientId && p.clientId !== row.grant.clientId) {
    throw new OAuthError("invalid_grant", "Refresh token was issued to a different client.");
  }
  if (row.grant.revokedAt) {
    throw new OAuthError("invalid_grant", "This connection was disconnected.");
  }
  if (row.revokedAt) {
    if (Date.now() - row.revokedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
      await revokeGrant(prisma, row.grantId, null);
    }
    throw new OAuthError("invalid_grant", "Refresh token has already been used.");
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new OAuthError("invalid_grant", "Refresh token expired. Reconnect Claude.");
  }
  if (p.resource && !isOurResource(p.resource)) {
    throw new OAuthError("invalid_target", `Tokens are only issued for ${mcpResourceUrl()}.`);
  }
  const access = await connectorAccessFor(prisma, row.grant.userId);
  if (!access.allowed) {
    await revokeGrant(prisma, row.grantId, null);
    throw new OAuthError("invalid_grant", access.reason);
  }
  // Rotate: retire this refresh token, issue a new pair.
  const claimed = await prisma.mcpToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count !== 1) {
    throw new OAuthError("invalid_grant", "Refresh token has already been used.");
  }
  return issueTokens(prisma, row.grant);
}

/** RFC 7009 revocation. Revoking a refresh token disconnects the whole grant. */
export async function revokeToken(
  prisma: PrismaClient,
  token: string,
): Promise<void> {
  const row = await prisma.mcpToken.findUnique({
    where: { tokenHash: sha256Hex(token) },
    select: { id: true, kind: true, grantId: true },
  });
  if (!row) return;
  if (row.kind === "REFRESH") {
    await revokeGrant(prisma, row.grantId, null);
  } else {
    await prisma.mcpToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

// ── Resource server: verify a bearer token on /api/mcp ─────────────────────

export type McpPrincipal = {
  userId: string;
  userName: string;
  role: ConnectorRole;
  grantId: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  token: string;
  expiresAt: Date;
};

const TOUCH_EVERY_MS = 5 * 60 * 1000;

export async function verifyAccessToken(
  prisma: PrismaClient,
  token: string,
): Promise<McpPrincipal | null> {
  if (!token.startsWith(PREFIX.access)) return null;
  const row = await prisma.mcpToken.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { grant: true },
  });
  if (
    !row ||
    row.kind !== "ACCESS" ||
    row.revokedAt ||
    row.expiresAt.getTime() <= Date.now() ||
    row.grant.revokedAt ||
    // Audience: only tokens minted for this MCP endpoint.
    !isOurResource(row.grant.resource)
  ) {
    return null;
  }
  const access = await connectorAccessFor(prisma, row.grant.userId);
  if (!access.allowed) return null;

  const last = row.grant.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - last > TOUCH_EVERY_MS) {
    await prisma.mcpGrant
      .update({ where: { id: row.grantId }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }

  return {
    userId: access.user.id,
    userName: access.user.name,
    role: access.user.role,
    grantId: row.grantId,
    clientId: row.grant.clientId,
    clientName: row.grant.clientName,
    scopes: row.grant.scope.split(/\s+/).filter(Boolean),
    token,
    expiresAt: row.expiresAt,
  };
}
