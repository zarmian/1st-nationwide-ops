import { describe, expect, it } from "vitest";
import { checkLimit, clientKey } from "./ratelimit";

describe("ratelimit", () => {
  describe("clientKey", () => {
    it("returns first IP from x-forwarded-for", () => {
      const req = new Request("https://example.com", {
        headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
      });
      expect(clientKey(req)).toBe("203.0.113.5");
    });

    it("falls back to x-real-ip", () => {
      const req = new Request("https://example.com", {
        headers: { "x-real-ip": "198.51.100.42" },
      });
      expect(clientKey(req)).toBe("198.51.100.42");
    });

    it("returns 'anon' when no header is present", () => {
      const req = new Request("https://example.com");
      expect(clientKey(req)).toBe("anon");
    });
  });

  describe("checkLimit", () => {
    it("allows when limiter is null (no env configured)", async () => {
      const result = await checkLimit(null, "any-key");
      expect(result).toEqual({ allowed: true });
    });
  });
});
