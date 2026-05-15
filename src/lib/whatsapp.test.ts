import { describe, expect, it } from "vitest";
import { normaliseE164 } from "./whatsapp";

describe("normaliseE164", () => {
  it("normalises UK mobile starting with 0 to +44", () => {
    expect(normaliseE164("07700900123")).toBe("+447700900123");
  });

  it("accepts already-E.164 numbers", () => {
    expect(normaliseE164("+447700900123")).toBe("+447700900123");
  });

  it("strips spaces, parens, and hyphens before validating", () => {
    expect(normaliseE164("+44 (7700) 900-123")).toBe("+447700900123");
    expect(normaliseE164("0 7700  900 123")).toBe("+447700900123");
  });

  it("rejects non-E.164 inputs", () => {
    expect(normaliseE164("")).toBeNull();
    expect(normaliseE164("not a number")).toBeNull();
    // Missing + and not a 0… UK format:
    expect(normaliseE164("447700900123")).toBeNull();
    expect(normaliseE164("+")).toBeNull();
    // Country code can't start with 0 in E.164:
    expect(normaliseE164("+0447700900123")).toBeNull();
  });
});
