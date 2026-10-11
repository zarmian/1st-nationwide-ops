/**
 * Small HTTP helpers for the Claude connector's OAuth + discovery routes.
 */

/** Discovery documents are public and safe to cache briefly / read cross-origin. */
export function publicJson(body: unknown): Response {
  return Response.json(body, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/** RFC 6749 §5.1/5.2 responses must never be cached. */
export function tokenJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

/** Parse an OAuth form body (application/x-www-form-urlencoded), tolerating JSON. */
export async function readOAuthParams(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const json = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const params = new URLSearchParams();
    if (json && typeof json === "object") {
      for (const [k, v] of Object.entries(json)) {
        if (typeof v === "string") params.set(k, v);
      }
    }
    return params;
  }
  return new URLSearchParams(await req.text());
}

/**
 * client_id may arrive in the body (public clients) or as the user part of
 * HTTP Basic auth. We never issue secrets, so any secret is ignored.
 */
export function clientIdFrom(req: Request, params: URLSearchParams): string | undefined {
  const fromBody = params.get("client_id") ?? undefined;
  const auth = req.headers.get("authorization");
  if (!fromBody && auth?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
      const user = decoded.split(":")[0];
      return user ? decodeURIComponent(user) : undefined;
    } catch {
      return undefined;
    }
  }
  return fromBody;
}
