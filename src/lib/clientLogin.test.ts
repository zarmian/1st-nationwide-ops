import { describe, it, expect } from "vitest";
import {
  clientLinkEmail,
  emailDomain,
  hashLinkToken,
  isAllowedDomain,
  nameFromEmail,
  normaliseEmail,
  parseDomains,
} from "./clientLogin";

describe("normaliseEmail", () => {
  it("trims and lower-cases", () => {
    expect(normaliseEmail("  John.Smith@Shurgard.CO.UK ")).toBe("john.smith@shurgard.co.uk");
  });
  it("rejects what isn't an email", () => {
    expect(normaliseEmail("john")).toBeNull();
    expect(normaliseEmail("john@shurgard")).toBeNull();
    expect(normaliseEmail("a b@shurgard.co.uk")).toBeNull();
    expect(normaliseEmail(`${"a".repeat(250)}@x.co`)).toBeNull();
  });
});

describe("isAllowedDomain", () => {
  const domains = ["shurgard.co.uk", "shurgard.com"];
  it("allows an exact domain", () => {
    expect(isAllowedDomain("jo@shurgard.co.uk", domains)).toBe(true);
    expect(isAllowedDomain("jo@SHURGARD.COM", domains)).toBe(true);
  });
  it("refuses look-alikes and subdomains", () => {
    expect(isAllowedDomain("jo@shurgard.co.uk.example.com", domains)).toBe(false);
    expect(isAllowedDomain("jo@evilshurgard.com", domains)).toBe(false);
    expect(isAllowedDomain("jo@mail.shurgard.com", domains)).toBe(false);
    expect(isAllowedDomain("shurgard.com@gmail.com", domains)).toBe(false);
  });
  it("refuses everything when no domains are set", () => {
    expect(isAllowedDomain("jo@shurgard.co.uk", [])).toBe(false);
  });
  it("reads the domain after the last @", () => {
    expect(emailDomain('"a@b"@shurgard.com')).toBe("shurgard.com");
  });
});

describe("parseDomains", () => {
  it("takes commas, spaces and a leading @", () => {
    expect(parseDomains("shurgard.co.uk, @Shurgard.com  shurgard.com;")).toEqual({
      domains: ["shurgard.co.uk", "shurgard.com"],
      invalid: [],
    });
  });
  it("reports what isn't a domain", () => {
    expect(parseDomains("shurgard, jo@shurgard.com, -bad.com")).toEqual({
      domains: [],
      invalid: ["shurgard", "jo@shurgard.com", "-bad.com"],
    });
  });
  it("is empty for an empty box", () => {
    expect(parseDomains("  ")).toEqual({ domains: [], invalid: [] });
  });
});

describe("nameFromEmail", () => {
  it("makes a name from the part before the @", () => {
    expect(nameFromEmail("john.smith@shurgard.co.uk")).toBe("John Smith");
    expect(nameFromEmail("mary_o-neil@shurgard.com")).toBe("Mary O-Neil");
    expect(nameFromEmail("ops+portal@shurgard.com")).toBe("Ops");
  });
});

describe("sign-in link", () => {
  it("stores a hash, not the token", () => {
    const h = hashLinkToken("abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashLinkToken("abc"));
    expect(h).not.toBe(hashLinkToken("abd"));
  });
  it("puts the link in the email and escapes the name", () => {
    const m = clientLinkEmail("https://x.test/login/client/verify?token=t&x=1", "A&B <Ltd>");
    expect(m.text).toContain("https://x.test/login/client/verify?token=t&x=1");
    expect(m.html).toContain("token=t&amp;x=1");
    expect(m.html).toContain("A&amp;B &lt;Ltd&gt;");
    expect(m.text).toContain("15 minutes");
  });
});
