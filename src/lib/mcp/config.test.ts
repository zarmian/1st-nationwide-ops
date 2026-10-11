import { describe, expect, it } from "vitest";

process.env.NEXTAUTH_URL = "https://ops.example.co.uk/";

describe("connector config", async () => {
  const c = await import("./config");

  it("derives every address from the app origin", () => {
    expect(c.appOrigin()).toBe("https://ops.example.co.uk");
    expect(c.mcpResourceUrl()).toBe("https://ops.example.co.uk/api/mcp");
    expect(c.protectedResourceMetadataUrl()).toBe(
      "https://ops.example.co.uk/.well-known/oauth-protected-resource/api/mcp",
    );
  });

  it("recognises our resource, tolerating case and a trailing slash only", () => {
    expect(c.isOurResource("https://ops.example.co.uk/api/mcp")).toBe(true);
    expect(c.isOurResource("HTTPS://OPS.EXAMPLE.CO.UK/api/mcp/")).toBe(true);
    expect(c.isOurResource("https://ops.example.co.uk/api/other")).toBe(false);
    expect(c.isOurResource("https://ops.example.co.uk")).toBe(false);
    expect(c.isOurResource("https://ops.example.co.uk/api/mcp#x")).toBe(false);
    expect(c.isOurResource(undefined)).toBe(false);
  });

  it("advertises CIMD + public clients + S256, and no open registration", () => {
    const m = c.authorizationServerMetadata();
    expect(m.issuer).toBe("https://ops.example.co.uk");
    expect(m.client_id_metadata_document_supported).toBe(true);
    expect(m.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.authorization_response_iss_parameter_supported).toBe(true);
    expect("registration_endpoint" in m).toBe(false);
  });

  it("points the 401 challenge at the protected resource metadata", () => {
    const prm = c.protectedResourceMetadata();
    expect(prm.resource).toBe("https://ops.example.co.uk/api/mcp");
    expect(prm.authorization_servers).toEqual(["https://ops.example.co.uk"]);
    const h = c.wwwAuthenticate({ code: "invalid_token", description: 'bad "token"' });
    expect(h).toContain('resource_metadata="https://ops.example.co.uk/.well-known/oauth-protected-resource/api/mcp"');
    expect(h).toContain('scope="ops:read"');
    expect(h).toContain('error="invalid_token"');
    expect(h).not.toContain('"token""');
  });
});
