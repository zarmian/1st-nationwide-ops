import { describe, expect, it, beforeEach } from "vitest";
import {
  clearClientCache,
  isAcceptableRedirect,
  isTrustedClientId,
  parseClientDocument,
  redirectUriMatches,
  resolveClient,
} from "./clients";

const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";

describe("isTrustedClientId", () => {
  it("accepts Anthropic's metadata document URLs only", () => {
    expect(isTrustedClientId(CLAUDE)).toBe(true);
    expect(isTrustedClientId(CLAUDE_CODE)).toBe(true);
    expect(isTrustedClientId("https://claude.com/oauth/whatever")).toBe(true);
  });
  it("rejects other hosts, schemes, ports, queries and paths", () => {
    expect(isTrustedClientId("https://evil.example/oauth/x")).toBe(false);
    expect(isTrustedClientId("https://claude.ai.evil.example/oauth/x")).toBe(false);
    expect(isTrustedClientId("http://claude.ai/oauth/x")).toBe(false);
    expect(isTrustedClientId("https://claude.ai:8443/oauth/x")).toBe(false);
    expect(isTrustedClientId("https://claude.ai/oauth/x?y=1")).toBe(false);
    expect(isTrustedClientId("https://claude.ai/api/other")).toBe(false);
    expect(isTrustedClientId("https://user@claude.ai/oauth/x")).toBe(false);
    expect(isTrustedClientId("not a url")).toBe(false);
  });
});

describe("redirect URIs", () => {
  it("only ever allows Anthropic https callbacks or loopback http", () => {
    expect(isAcceptableRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAcceptableRedirect("http://localhost:3118/callback")).toBe(true);
    expect(isAcceptableRedirect("http://127.0.0.1:9/callback")).toBe(true);
    expect(isAcceptableRedirect("https://evil.example/cb")).toBe(false);
    expect(isAcceptableRedirect("http://claude.ai/api/mcp/auth_callback")).toBe(false);
    expect(isAcceptableRedirect("https://claude.ai/cb#frag")).toBe(false);
  });
  it("matches exactly, except loopback which ignores the port", () => {
    const reg = ["https://claude.ai/api/mcp/auth_callback"];
    expect(redirectUriMatches(reg, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectUriMatches(reg, "https://claude.ai/api/mcp/auth_callback/")).toBe(false);
    const loop = ["http://localhost/callback", "http://127.0.0.1/callback"];
    expect(redirectUriMatches(loop, "http://localhost:51234/callback")).toBe(true);
    expect(redirectUriMatches(loop, "http://127.0.0.1:8080/callback")).toBe(true);
    expect(redirectUriMatches(loop, "http://localhost:51234/other")).toBe(false);
    expect(redirectUriMatches(loop, "https://claude.ai/api/mcp/auth_callback")).toBe(false);
  });
});

describe("parseClientDocument", () => {
  it("accepts a valid public-client document", () => {
    const c = parseClientDocument(CLAUDE, {
      client_id: CLAUDE,
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "https://evil.example/cb"],
      token_endpoint_auth_method: "none",
    });
    expect(c).toEqual({
      clientId: CLAUDE,
      clientName: "Claude",
      // the non-Anthropic redirect is dropped
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });
  });
  it("rejects a mismatched client_id, a confidential client or no usable redirects", () => {
    expect(parseClientDocument(CLAUDE, { client_id: CLAUDE_CODE, redirect_uris: [] })).toBeNull();
    expect(
      parseClientDocument(CLAUDE, {
        client_id: CLAUDE,
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    ).toBeNull();
    expect(
      parseClientDocument(CLAUDE, { client_id: CLAUDE, redirect_uris: ["https://evil.example/cb"] }),
    ).toBeNull();
  });
});

describe("resolveClient", () => {
  beforeEach(() => clearClientCache());

  it("uses the live document when it loads", async () => {
    const fake = (async () =>
      new Response(
        JSON.stringify({
          client_id: CLAUDE,
          client_name: "Claude",
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
          token_endpoint_auth_method: "none",
        }),
      )) as unknown as typeof fetch;
    const c = await resolveClient(CLAUDE, fake);
    expect(c?.clientName).toBe("Claude");
  });

  it("falls back to the built-in copy when the fetch fails", async () => {
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const c = await resolveClient(CLAUDE_CODE, failing);
    expect(c?.redirectUris).toEqual(["http://localhost/callback", "http://127.0.0.1/callback"]);
  });

  it("never resolves an untrusted client, even if it serves a document", async () => {
    let fetched = false;
    const spy = (async () => {
      fetched = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    expect(await resolveClient("https://evil.example/oauth/x", spy)).toBeNull();
    expect(fetched).toBe(false);
  });
});
