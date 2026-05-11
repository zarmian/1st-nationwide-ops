import { describe, expect, it } from "vitest";
import { validatePayload, type FieldDef } from "./formTemplates";

function field(partial: Partial<FieldDef> & Pick<FieldDef, "key" | "label" | "type">): FieldDef {
  return { required: false, ...partial };
}

describe("validatePayload", () => {
  it("accepts a well-formed payload", () => {
    const fields: FieldDef[] = [
      field({ key: "main_gates", label: "Gates", type: "tri", required: true }),
      field({ key: "reason", label: "Reason", type: "textarea", required: true }),
    ];
    const result = validatePayload(fields, { main_gates: 1, reason: "  ok " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.main_gates).toBe(1);
      expect(result.payload.reason).toBe("ok");
    }
  });

  it("flags missing required fields", () => {
    const fields: FieldDef[] = [
      field({ key: "reason", label: "Reason", type: "textarea", required: true }),
    ];
    const result = validatePayload(fields, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.reason).toMatch(/required/i);
  });

  it("rejects tri values outside 0/1/2", () => {
    const fields: FieldDef[] = [
      field({ key: "g", label: "G", type: "tri", required: true }),
    ];
    const result = validatePayload(fields, { g: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.g).toMatch(/Yes, No, or N\/A/);
  });

  it("rejects select values outside options list", () => {
    const fields: FieldDef[] = [
      field({
        key: "outcome",
        label: "Outcome",
        type: "select",
        required: true,
        options: ["resolved", "escalated"],
      }),
    ];
    const ok = validatePayload(fields, { outcome: "resolved" });
    expect(ok.ok).toBe(true);
    const bad = validatePayload(fields, { outcome: "ignored" });
    expect(bad.ok).toBe(false);
  });

  it("validates a location object", () => {
    const fields: FieldDef[] = [
      field({ key: "loc", label: "Loc", type: "location", required: true }),
    ];
    const goodLoc = validatePayload(fields, {
      loc: { lat: 51.5, lng: -0.1, accuracy: 12 },
    });
    expect(goodLoc.ok).toBe(true);

    const badLoc = validatePayload(fields, { loc: { lat: "nope", lng: -0.1 } });
    expect(badLoc.ok).toBe(false);
  });

  it("rejects signature that isn't an https URL", () => {
    const fields: FieldDef[] = [
      field({ key: "sig", label: "Signature", type: "signature", required: true }),
    ];
    const bad = validatePayload(fields, { sig: "not-a-url" });
    expect(bad.ok).toBe(false);
    const ok = validatePayload(fields, {
      sig: "https://example.blob.vercel-storage.com/sig.png",
    });
    expect(ok.ok).toBe(true);
  });

  it("enforces multiphoto maxCount", () => {
    const fields: FieldDef[] = [
      field({
        key: "photos",
        label: "Photos",
        type: "multiphoto",
        meta: { maxCount: 2 },
      }),
    ];
    const photo = (n: number) => ({
      url: `https://example.blob.vercel-storage.com/p${n}.jpg`,
    });
    const ok = validatePayload(fields, { photos: [photo(1), photo(2)] });
    expect(ok.ok).toBe(true);

    const tooMany = validatePayload(fields, {
      photos: [photo(1), photo(2), photo(3)],
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.errors.photos).toMatch(/at most 2/);
  });

  it("ignores section fields entirely", () => {
    const fields: FieldDef[] = [
      field({ key: "sec_1", label: "Section 1", type: "section" }),
      field({ key: "x", label: "X", type: "text", required: true }),
    ];
    const result = validatePayload(fields, { x: "value" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("sec_1" in result.payload).toBe(false);
    }
  });
});
