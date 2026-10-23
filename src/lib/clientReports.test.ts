import { describe, it, expect } from "vitest";
import { clientReportBody, formatFormDateTime, humaniseKey } from "./clientReports";
import type { FieldDef } from "./formTemplates";

const IMG = "https://store.public.blob.vercel-storage.com/uploads/a-1.jpg";
const IMG2 = "https://store.public.blob.vercel-storage.com/uploads/a-2.png";
const SIG = "https://store.public.blob.vercel-storage.com/uploads/sig.png";

const field = (key: string, label: string, type: FieldDef["type"]): FieldDef =>
  ({ key, label, type, required: false }) as FieldDef;

describe("clientReportBody", () => {
  it("drops our own bookkeeping — GPS, geofence, slot, import details", () => {
    const body = clientReportBody({
      kind: "hourly_check",
      slotIndex: 3,
      dueAt: "2026-10-20T21:00:00.000Z",
      gps: { lat: 51.5, lng: -0.1, accuracy: 8 },
      distanceM: 12,
      withinGeofence: true,
      source: "fastfield",
      fastfield: { submissionId: "x" },
      _internal: "y",
      photoUrl: IMG,
    });
    expect(body.fields).toEqual([]);
    expect(body.photos).toEqual([{ url: IMG, caption: null }]);
  });

  it("keeps answers with the template's labels, in its order", () => {
    const fields = [
      field("outcome", "What happened", "textarea"),
      field("police", "Police called?", "tri"),
      field("people", "People on site", "number"),
      field("when_left", "Left at", "datetime"),
      field("sec", "Section", "section"),
    ];
    const body = clientReportBody(
      {
        people: 2,
        outcome: "False alarm, zone 3 reset.",
        police: 0,
        when_left: "2026-10-20T21:15",
        extra_note: "Gate was open",
      },
      fields,
    );
    expect(body.fields).toEqual([
      { label: "What happened", value: "False alarm, zone 3 reset." },
      { label: "Police called?", value: "No" },
      { label: "People on site", value: "2" },
      { label: "Left at", value: "20 Oct 2026, 21:15" },
      { label: "Extra note", value: "Gate was open" },
    ]);
  });

  it("doesn't read a plain number as No/Yes/N/A without a template", () => {
    expect(clientReportBody({ people: 2 }).fields).toEqual([{ label: "People", value: "2" }]);
  });

  it("collects photos and the signature, once each", () => {
    const body = clientReportBody(
      {
        photos: [{ url: IMG, name: "Front door" }, { url: IMG2 }],
        photoUrls: [IMG, IMG2],
        signatureUrl: SIG,
        signed: SIG,
      },
      [field("signed", "Signature", "signature")],
    );
    expect(body.photos).toEqual([
      { url: IMG, caption: "Front door" },
      { url: IMG2, caption: null },
    ]);
    expect(body.signatureUrl).toBe(SIG);
    expect(body.fields).toEqual([]);
  });

  it("joins multi-choice answers and skips locations and odd objects", () => {
    const body = clientReportBody({
      checks: ["Doors", "Windows"],
      where: { lat: 51.5, lng: -0.1 },
      blob: { a: 1 },
      empty: "  ",
      ok: true,
    });
    expect(body.fields).toEqual([
      { label: "Checks", value: "Doors, Windows" },
      { label: "Ok", value: "Yes" },
    ]);
  });

  it("is empty for a missing or odd payload", () => {
    expect(clientReportBody(null)).toEqual({ fields: [], photos: [], signatureUrl: null });
    expect(clientReportBody([1, 2])).toEqual({ fields: [], photos: [], signatureUrl: null });
  });
});

describe("labels and dates", () => {
  it("humanises keys", () => {
    expect(humaniseKey("arrived_at")).toBe("Arrived at");
    expect(humaniseKey("officerNotes")).toBe("Officer notes");
  });
  it("formats a form's own date text without moving time zones", () => {
    expect(formatFormDateTime("2026-10-20T21:15")).toBe("20 Oct 2026, 21:15");
    expect(formatFormDateTime("2026-03-01")).toBe("1 Mar 2026");
    expect(formatFormDateTime("tomorrow")).toBe("tomorrow");
  });
});
