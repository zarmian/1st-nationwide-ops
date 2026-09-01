import { describe, it, expect } from "vitest";
import { ageBucket, BUCKET_ORDER } from "./receivables";

describe("ageBucket", () => {
  it("puts not-yet-due and same-day balances in 'current'", () => {
    expect(ageBucket(-5)).toBe("current");
    expect(ageBucket(0)).toBe("current");
  });

  it("buckets by the standard 30-day ageing bands", () => {
    expect(ageBucket(1)).toBe("d1_30");
    expect(ageBucket(30)).toBe("d1_30");
    expect(ageBucket(31)).toBe("d31_60");
    expect(ageBucket(60)).toBe("d31_60");
    expect(ageBucket(61)).toBe("d61_90");
    expect(ageBucket(90)).toBe("d61_90");
    expect(ageBucket(91)).toBe("d90_plus");
    expect(ageBucket(365)).toBe("d90_plus");
  });

  it("only ever returns a known bucket", () => {
    for (const d of [-1, 0, 1, 15, 45, 75, 200]) {
      expect(BUCKET_ORDER).toContain(ageBucket(d));
    }
  });
});
