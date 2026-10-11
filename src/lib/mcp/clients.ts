/**
 * OAuth clients for the Claude connector.
 *
 * Claude identifies itself with a Client ID Metadata Document (CIMD): its
 * `client_id` is an HTTPS URL that serves its registration JSON (name +
 * redirect URIs). We accept ONLY Anthropic's documents (claude.ai /
 * claude.com), so no other app can be connected to this system, and there is
 * no open client registration endpoint to abuse.
 *
 * Authorisation codes are only ever sent to a redirect URI that (a) is listed
 * in the client's document and (b) is Anthropic's https callback or a
 * loopback address (Claude Code on someone's own computer, RFC 8252).
 */

export type McpClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
};

const TRUSTED_CLIENT_HOSTS = new Set(["claude.ai", "claude.com"]);

/**
 * Copies of Anthropic's published documents (fetched 11 Oct 2026). Used only
 * when the live document can't be fetched, so a brief outage on Anthropic's
 * side doesn't block connecting. The live document wins whenever it loads.
 */
const KNOWN_CLAUDE_CLIENTS: Record<string, Omit<McpClient, "clientId">> = {
  // claude.ai on the web, Desktop, mobile and Cowork.
  "https://claude.ai/oauth/mcp-oauth-client-metadata": {
    clientName: "Claude",
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  },
  // Claude Code (loopback redirect on an ephemeral port).
  "https://claude.ai/oauth/claude-code-client-metadata": {
    clientName: "Claude Code",
    redirectUris: ["http://localhost/callback", "http://127.0.0.1/callback"],
  },
};

/** Is this client_id one of Anthropic's Client ID Metadata Document URLs? */
export function isTrustedClientId(clientId: string): boolean {
  let u: URL;
  try {
    u = new URL(clientId);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    TRUSTED_CLIENT_HOSTS.has(u.hostname) &&
    u.port === "" &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash &&
    u.pathname.startsWith("/oauth/")
  );
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * A redirect we would ever send a code to: Anthropic's https host, or a
 * loopback http URI. Anything else is refused even if a document lists it.
 */
export function isAcceptableRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") {
    return TRUSTED_CLIENT_HOSTS.has(u.hostname) && u.port === "";
  }
  return isLoopbackUri(uri);
}

/**
 * Exact match against the registered list, except loopback URIs, which
 * match with the port ignored (RFC 8252 §7.3 — Claude Code binds an
 * ephemeral port; Anthropic asks for the same treatment of `localhost`).
 */
export function redirectUriMatches(
  registered: string[],
  requested: string,
): boolean {
  if (!isAcceptableRedirect(requested)) return false;
  if (registered.includes(requested)) return true;
  if (!isLoopbackUri(requested)) return false;
  const r = new URL(requested);
  return registered.some((reg) => {
    if (!isLoopbackUri(reg)) return false;
    const g = new URL(reg);
    return (
      g.hostname === r.hostname &&
      g.pathname === r.pathname &&
      g.search === r.search
    );
  });
}

/** Validate a fetched Client ID Metadata Document. */
export function parseClientDocument(
  clientId: string,
  doc: unknown,
): McpClient | null {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  if (d.client_id !== clientId) return null;
  // Public clients only (PKCE, no secret) — that's what Claude registers as.
  const method = d.token_endpoint_auth_method ?? "none";
  if (method !== "none") return null;
  if (!Array.isArray(d.redirect_uris)) return null;
  const redirectUris = d.redirect_uris.filter(
    (u): u is string => typeof u === "string" && isAcceptableRedirect(u),
  );
  if (redirectUris.length === 0) return null;
  const name =
    typeof d.client_name === "string" && d.client_name.trim()
      ? d.client_name.trim().slice(0, 60)
      : new URL(clientId).hostname;
  return { clientId, clientName: name, redirectUris };
}

const cache = new Map<string, { client: McpClient; expiresAt: number }>();
const LIVE_CACHE_MS = 60 * 60 * 1000;
const FALLBACK_CACHE_MS = 5 * 60 * 1000;

async function fetchClientDocument(
  clientId: string,
  fetchImpl: typeof fetch,
): Promise<McpClient | null> {
  try {
    const res = await fetchImpl(clientId, {
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 20_000) return null;
    return parseClientDocument(clientId, JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Resolve a client_id to the client it names, or null if it isn't one of
 * Anthropic's or its document is invalid. Cached per server instance.
 */
export async function resolveClient(
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<McpClient | null> {
  if (!isTrustedClientId(clientId)) return null;
  const hit = cache.get(clientId);
  if (hit && hit.expiresAt > Date.now()) return hit.client;

  const live = await fetchClientDocument(clientId, fetchImpl);
  const known = KNOWN_CLAUDE_CLIENTS[clientId];
  const client = live ?? (known ? { clientId, ...known } : null);
  if (client) {
    cache.set(clientId, {
      client,
      expiresAt: Date.now() + (live ? LIVE_CACHE_MS : FALLBACK_CACHE_MS),
    });
  }
  return client;
}

/** Test hook: forget cached documents. */
export function clearClientCache(): void {
  cache.clear();
}
