import { protectedResourceMetadata } from "@/lib/mcp/config";
import { corsPreflight, publicJson } from "@/lib/mcp/http";

/**
 * RFC 9728 path-suffixed location for /api/mcp — the one our 401s point at
 * and the one clients try first.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return publicJson(protectedResourceMetadata());
}

export function OPTIONS() {
  return corsPreflight();
}
