import { describe, it, expect } from "vitest";
import { statusFor } from "./compliance";

const asOf = new Date("2026-06-01T12:00:00Z");
const daysFrom = (n: number) =>
  new Date(asOf.getTime() + n * 86_400_000);

describe("statusFor", () => {
  it("treats a null date as missing (a real gap to fill)", () => {
    expect(statusFor(null, asOf)).toBe("missing");
  });

  it("flags a past date as expired", () => {
    expect(statusFor(daysFrom(-1), asOf)).toBe("expired");
    expect(statusFor(daysFrom(-365), asOf)).toBe("expired");
  });

  it("flags a date inside the warning window as expiring", () => {
    expect(statusFor(daysFrom(1), asOf)).toBe("expiring");
    expect(statusFor(daysFrom(29), asOf)).toBe("expiring");
  });

  it("includes the warn-day boundary itself as expiring", () => {
    expect(statusFor(daysFrom(30), asOf, 30)).toBe("expiring");
  });

  it("treats anything beyond the window as valid", () => {
    expect(statusFor(daysFrom(31), asOf, 30)).toBe("valid");
    expect(statusFor(daysFrom(365), asOf)).toBe("valid");
  });

  it("honours a custom warning window", () => {
    // With a 7-day window, a date 10 days out is valid, not expiring.
    expect(statusFor(daysFrom(10), asOf, 7)).toBe("valid");
    expect(statusFor(daysFrom(7), asOf, 7)).toBe("expiring");
  });
});
