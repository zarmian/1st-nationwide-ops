import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { prisma } from "@/lib/db";
import { mcpResourceUrl, wwwAuthenticate } from "@/lib/mcp/config";
import { verifyAccessToken, type McpPrincipal } from "@/lib/mcp/oauth";
import { buildMcpServer } from "@/lib/mcp/server";
import { checkLimit, mcpLimiter } from "@/lib/ratelimit";

/**
 * The Claude connector's MCP endpoint (Streamable HTTP, stateless, JSON
 * responses). Every request needs a bearer token from our OAuth server;
 * without one we answer 401 + WWW-Authenticate so Claude starts sign-in.
 * Read-only tools — see src/lib/mcp/server.ts.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function unauthorized(description?: string): Response {
  return new Response(
    JSON.stringify({
      error: "invalid_token",
      error_description:
        description ?? "Sign in to 1st Nationwide Ops to use this connector.",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "WWW-Authenticate": wwwAuthenticate(
          description ? { code: "invalid_token", description } : undefined,
        ),
      },
    },
  );
}

async function authenticate(req: Request): Promise<McpPrincipal | Response> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  if (!token) return unauthorized();
  const principal = await verifyAccessToken(prisma, token);
  if (!principal) {
    return unauthorized("The access token is invalid, expired or was disconnected.");
  }
  return principal;
}

export async function POST(req: Request): Promise<Response> {
  const principal = await authenticate(req);
  if (principal instanceof Response) return principal;

  const limit = await checkLimit(mcpLimiter, principal.grantId);
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Too many requests. Wait a moment and try again." },
        id: null,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(limit.retryAfterSeconds),
        },
      },
    );
  }

  const server = await buildMcpServer(principal);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: one transport per request
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req, {
      authInfo: {
        token: principal.token,
        clientId: principal.clientId,
        scopes: principal.scopes,
        expiresAt: Math.floor(principal.expiresAt.getTime() / 1000),
        resource: new URL(mcpResourceUrl()),
        extra: { userId: principal.userId, role: principal.role },
      },
    });
  } finally {
    await server.close().catch(() => {});
  }
}

/**
 * No server-initiated stream in stateless mode (spec: GET may answer 405).
 * Still authenticate first, so an unauthenticated probe gets the 401 that
 * starts sign-in.
 */
async function methodNotAllowed(req: Request): Promise<Response> {
  const principal = await authenticate(req);
  if (principal instanceof Response) return principal;
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null,
    }),
    { status: 405, headers: { Allow: "POST", "Content-Type": "application/json" } },
  );
}

export async function GET(req: Request): Promise<Response> {
  return methodNotAllowed(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return methodNotAllowed(req);
}
