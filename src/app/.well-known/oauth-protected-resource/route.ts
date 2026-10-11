import { protectedResourceMetadata } from "@/lib/mcp/config";
import { corsPreflight, publicJson } from "@/lib/mcp/http";

/** RFC 9728 metadata for the MCP endpoint (root location). */
export const dynamic = "force-dynamic";

export function GET() {
  return publicJson(protectedResourceMetadata());
}

export function OPTIONS() {
  return corsPreflight();
}
