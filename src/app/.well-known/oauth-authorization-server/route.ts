import { authorizationServerMetadata } from "@/lib/mcp/config";
import { corsPreflight, publicJson } from "@/lib/mcp/http";

/** RFC 8414 metadata for the Claude connector's authorisation server. */
export const dynamic = "force-dynamic";

export function GET() {
  return publicJson(authorizationServerMetadata());
}

export function OPTIONS() {
  return corsPreflight();
}
