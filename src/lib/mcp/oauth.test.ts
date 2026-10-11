import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import {
  buildClientRedirect,
  checkAuthorizeRequest,
  isValidCodeChallenge,
  newSecret,
  sha256Hex,
  verifyPkceS256,
} from "./oauth";

process.env.NEXTAUTH_URL = "https://ops.example.co.uk";

const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const offline = (async () => {
  throw new Error("offline");
}) as unknown as typeof fetch;

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

describe("PKCE", () => {
  it("accepts the matching verifier and rejects anything else", () => {
    const { verifier, challenge } = pkcePair();
    expect(isValidCodeChallenge(challenge)).toBe(true);
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256(pkcePair().verifier, challenge)).toBe(false);
    expect(verifyPkceS256("short", challenge)).toBe(false);
    expect(verifyPkceS256(verifier, "not-a-challenge")).toBe(false);
  });
});

describe("secrets", () => {
  it("are long, prefixed, random and stored only as hashes", () => {
    const a = newSecret("access");
    const b = newSecret("access");
    expect(a.startsWith("1nw_at_")).toBe(true);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(40);
    expect(sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("buildClientRedirect", () => {
  it("adds params and the issuer (RFC 9207)", () => {
    const u = new URL(buildClientRedirect(CALLBACK, { code: "abc", state: "s1", nope: undefined }));
    expect(u.origin + u.pathname).toBe(CALLBACK);
    expect(u.searchParams.get("code")).toBe("abc");
    expect(u.searchParams.get("state")).toBe("s1");
    expect(u.searchParams.has("nope")).toBe(false);
    expect(u.searchParams.get("iss")).toBe("https://ops.example.co.uk");
  });
});

describe("checkAuthorizeRequest", () => {
  const { challenge } = pkcePair();
  const good = {
    response_type: "code",
    client_id: CLAUDE,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    resource: "https://ops.example.co.uk/api/mcp",
  };

  it("accepts Claude's standard request", async () => {
    const r = await checkAuthorizeRequest(good, offline);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.client.clientName).toBe("Claude");
      expect(r.request.scope).toBe("ops:read");
      expect(r.request.resource).toBe("https://ops.example.co.uk/api/mcp");
    }
  });

  it("refuses unknown apps and foreign redirects without redirecting", async () => {
    const r1 = await checkAuthorizeRequest({ ...good, client_id: "https://evil.example/oauth/x" }, offline);
    expect(r1).toMatchObject({ ok: false, fatal: true });
    const r2 = await checkAuthorizeRequest({ ...good, redirect_uri: "https://evil.example/cb" }, offline);
    expect(r2).toMatchObject({ ok: false, fatal: true });
    const r3 = await checkAuthorizeRequest({ ...good, client_id: undefined }, offline);
    expect(r3).toMatchObject({ ok: false, fatal: true });
  });

  it("reports protocol errors back to Claude", async () => {
    const noPkce = await checkAuthorizeRequest({ ...good, code_challenge: undefined }, offline);
    expect(noPkce.ok).toBe(false);
    if (!noPkce.ok && !noPkce.fatal) {
      const u = new URL(noPkce.redirectTo);
      expect(u.searchParams.get("error")).toBe("invalid_request");
      expect(u.searchParams.get("state")).toBe("xyz");
    } else throw new Error("expected a redirect error");

    const plain = await checkAuthorizeRequest({ ...good, code_challenge_method: "plain" }, offline);
    expect(plain).toMatchObject({ ok: false, fatal: false });

    const wrongResource = await checkAuthorizeRequest({ ...good, resource: "https://other.example/mcp" }, offline);
    if (!wrongResource.ok && !wrongResource.fatal) {
      expect(new URL(wrongResource.redirectTo).searchParams.get("error")).toBe("invalid_target");
    } else throw new Error("expected invalid_target");

    const token = await checkAuthorizeRequest({ ...good, response_type: "token" }, offline);
    if (!token.ok && !token.fatal) {
      expect(new URL(token.redirectTo).searchParams.get("error")).toBe("unsupported_response_type");
    } else throw new Error("expected unsupported_response_type");
  });
});
