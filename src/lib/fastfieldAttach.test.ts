import { describe, expect, it } from "vitest";
import {
  planCreatedJobUndo,
  planJobLink,
  planUnlinkUndo,
  planVisitLink,
  readLinkPrev,
  visitKind,
  type ActivityNow,
  type JobBefore,
  type LinkPrev,
  type ReportFill,
  type VisitBefore,
} from "./fastfieldAttach";

const T = (hhmm: string) => new Date(`2026-11-24T${hhmm}:00Z`);
const OFFICER = "11111111-1111-4111-8111-111111111111";
const OTHER_OFFICER = "22222222-2222-4222-8222-222222222222";

const fill = (over: Partial<ReportFill> = {}): ReportFill => ({
  arrived: T("02:10"),
  done: T("02:40"),
  lat: 51.5,
  lng: -0.1,
  locatedAt: T("02:10"),
  officerId: OFFICER,
  photoUrls: ["https://blob.example/a.jpg"],
  ...over,
});

const openJob = (over: Partial<JobBefore> = {}): JobBefore => ({
  status: "OPEN",
  startedAt: null,
  completedAt: null,
  lat: null,
  assignedToUserId: null,
  handledByPartnerId: null,
  responderType: null,
  ...over,
});

const pendingVisit = (over: Partial<VisitBefore> = {}): VisitBefore => ({
  status: "PENDING",
  officerId: null,
  arrivedAt: null,
  departedAt: null,
  lat: null,
  photoUrls: [],
  handledByPartnerId: null,
  ...over,
});

/** As the link's history row stores and reads it back. */
const viaHistory = (prev: LinkPrev) =>
  readLinkPrev(JSON.parse(JSON.stringify({ fastfieldReportId: "r1", byHand: true, prev })));

describe("planJobLink", () => {
  it("marks an open job done and fills its empty times, place and officer, recording each", () => {
    const { data, prev } = planJobLink(openJob(), fill(), true);
    expect(data).toEqual({
      status: "APPROVED",
      startedAt: T("02:10"),
      completedAt: T("02:40"),
      lat: 51.5,
      lng: -0.1,
      locatedAt: T("02:10"),
      assignedToUserId: OFFICER,
      responderType: "INTERNAL_OFFICER",
    });
    expect(prev).toEqual({
      status: "OPEN",
      statusAfter: "APPROVED",
      filled: {
        startedAt: T("02:10").toISOString(),
        completedAt: T("02:40").toISOString(),
        locatedAt: T("02:10").toISOString(),
        officerId: OFFICER,
        responderType: "INTERNAL_OFFICER",
      },
    });
  });

  it("changes nothing that's already set, and records nothing for it", () => {
    const { data, prev } = planJobLink(
      openJob({
        status: "APPROVED",
        startedAt: T("01:00"),
        completedAt: T("01:30"),
        lat: 52,
        assignedToUserId: OTHER_OFFICER,
        responderType: "INTERNAL_OFFICER",
      }),
      fill(),
      false,
    );
    expect(data).toEqual({});
    expect(prev).toEqual({ statusAfter: "APPROVED", filled: {} });
  });

  it("keeps a job's responder type, and never puts our officer on a partner's job", () => {
    expect(planJobLink(openJob({ responderType: "EXTERNAL_NAMED" }), fill(), true).data.responderType).toBeUndefined();
    const partner = planJobLink(openJob({ handledByPartnerId: "p1" }), fill(), true);
    expect(partner.data.assignedToUserId).toBeUndefined();
    expect(partner.prev.filled.officerId).toBeUndefined();
  });

  it("leaves the start empty when the report has no arrival", () => {
    const { data, prev } = planJobLink(openJob(), fill({ arrived: null }), true);
    expect(data.startedAt).toBeUndefined();
    expect(prev.filled.startedAt).toBeUndefined();
    expect(data.completedAt).toEqual(T("02:40"));
  });

  it("leaves a cancelled job exactly as it is", () => {
    expect(planJobLink(openJob({ status: "CANCELLED" }), fill(), true)).toEqual({
      data: {},
      prev: { statusAfter: "CANCELLED", cancelled: true, filled: {} },
    });
  });
});

describe("planVisitLink", () => {
  it("completes a pending visit and fills arrival, departure, place, photos and officer", () => {
    const { data, prev } = planVisitLink(pendingVisit(), fill(), true);
    expect(data).toEqual({
      status: "COMPLETED",
      arrivedAt: T("02:10"),
      departedAt: T("02:40"),
      lat: 51.5,
      lng: -0.1,
      locatedAt: T("02:10"),
      photoUrls: ["https://blob.example/a.jpg"],
      officerId: OFFICER,
    });
    expect(prev).toEqual({
      status: "PENDING",
      statusAfter: "COMPLETED",
      filled: {
        arrivedAt: T("02:10").toISOString(),
        departedAt: T("02:40").toISOString(),
        locatedAt: T("02:10").toISOString(),
        photos: true,
        officerId: OFFICER,
      },
    });
  });

  it("keeps the visit's own arrival (and dates the location from it), photos and officer", () => {
    const { data, prev } = planVisitLink(
      pendingVisit({ arrivedAt: T("01:55"), photoUrls: ["https://blob.example/own.jpg"], officerId: OTHER_OFFICER }),
      fill(),
      true,
    );
    expect(data.arrivedAt).toBeUndefined();
    expect(data.locatedAt).toEqual(T("01:55"));
    expect(data.photoUrls).toBeUndefined();
    expect(data.officerId).toBeUndefined();
    expect(prev.filled).toEqual({
      departedAt: T("02:40").toISOString(),
      locatedAt: T("01:55").toISOString(),
    });
  });

  it("uses the finish as the arrival when the report gives none", () => {
    expect(planVisitLink(pendingVisit(), fill({ arrived: null }), true).data.arrivedAt).toEqual(T("02:40"));
  });

  it("never puts our officer on a partner's visit, and leaves a cancelled visit alone", () => {
    expect(planVisitLink(pendingVisit({ handledByPartnerId: "p1" }), fill(), true).data.officerId).toBeUndefined();
    expect(planVisitLink(pendingVisit({ status: "CANCELLED" }), fill(), true)).toEqual({
      data: {},
      prev: { statusAfter: "CANCELLED", cancelled: true, filled: {} },
    });
  });
});

describe("visitKind", () => {
  it("files a VPI schedule's visit as a VPI, everything else as a patrol", () => {
    expect(visitKind("VPI")).toBe("VPI");
    expect(visitKind("PATROL")).toBe("PATROL");
    expect(visitKind(null)).toBe("PATROL");
    expect(visitKind(undefined)).toBe("PATROL");
  });
});

describe("readLinkPrev", () => {
  it("reads back what a link recorded", () => {
    const prev: LinkPrev = { status: "OPEN", statusAfter: "APPROVED", filled: { bill: true } };
    expect(viaHistory(prev)).toEqual(prev);
  });

  it("gives null for links with no usable record", () => {
    expect(readLinkPrev(null)).toBeNull();
    expect(readLinkPrev({ fastfieldReportId: "r1" })).toBeNull();
    expect(readLinkPrev({ prev: { filled: {} } })).toBeNull();
    expect(readLinkPrev({ prev: { statusAfter: "APPROVED" } })).toBeNull();
    expect(readLinkPrev({ prev: { statusAfter: "APPROVED", status: 3, filled: {} } })).toBeNull();
    expect(readLinkPrev("prev")).toBeNull();
  });
});

/** A job as it is straight after `planJobLink` + finance. */
function jobAfterLink(before: JobBefore, prev: LinkPrev, over: Partial<ActivityNow> = {}): ActivityNow {
  const f = prev.filled;
  return {
    status: prev.statusAfter,
    times: {
      startedAt: f.startedAt ? new Date(f.startedAt) : before.startedAt,
      completedAt: f.completedAt ? new Date(f.completedAt) : before.completedAt,
    },
    locatedAt: f.locatedAt ? new Date(f.locatedAt) : null,
    officerId: f.officerId ?? before.assignedToUserId,
    responderType: f.responderType ?? before.responderType,
    billed: !!f.bill,
    paid: !!f.pay,
    invoiceNumber: null,
    otherReports: 0,
    ...over,
  };
}

describe("planUnlinkUndo — job", () => {
  const linked = () => {
    const { prev } = planJobLink(openJob(), fill(), true);
    prev.filled.bill = true;
    prev.filled.pay = true;
    return viaHistory(prev)!;
  };

  it("puts back everything the link changed when nothing else touched the job", () => {
    const prev = linked();
    const plan = planUnlinkUndo("job", "the callout", prev, jobAfterLink(openJob(), prev));
    expect(plan.data).toEqual({
      status: "OPEN",
      startedAt: null,
      completedAt: null,
      lat: null,
      lng: null,
      locatedAt: null,
      assignedToUserId: null,
      responderType: null,
      billedAmount: null,
      billedCurrency: null,
      billedAt: null,
      payRateUnit: null,
      paidAmount: null,
      paidCurrency: null,
      paidAt: null,
    });
    expect(plan.undone).toEqual(["status", "startedAt", "completedAt", "location", "officer", "bill", "pay"]);
    expect(plan.check).toEqual([]);
  });

  it("only clears the bill and pay the link filled", () => {
    const { prev } = planJobLink(openJob(), fill(), true);
    prev.filled.pay = true; // the job was billed before the link; the link only added the pay
    const p = viaHistory(prev)!;
    const plan = planUnlinkUndo("job", "the callout", p, jobAfterLink(openJob(), p, { billed: true }));
    expect(plan.undone).toContain("pay");
    expect(plan.undone).not.toContain("bill");
    expect(plan.data).not.toHaveProperty("billedAmount");
    expect(plan.data).toHaveProperty("paidAmount", null);
  });

  it("changes nothing for a link made before links kept a record, and says so", () => {
    const plan = planUnlinkUndo("job", "the callout", null, jobAfterLink(openJob(), linked()));
    expect(plan.data).toEqual({});
    expect(plan.check).toEqual([
      "The callout was linked before the app kept a record of what linking changes, so nothing on it was put back — check its status, times, officer and bill.",
    ]);
  });

  it("leaves an invoiced job alone and names the invoice", () => {
    const prev = linked();
    const plan = planUnlinkUndo("job", "the callout", prev, jobAfterLink(openJob(), prev, { invoiceNumber: "INV-1043" }));
    expect(plan.data).toEqual({});
    expect(plan.check).toEqual([
      "The callout is on invoice INV-1043, so it was left as it is — adjust the invoice if it shouldn't have been billed.",
    ]);
  });

  it("leaves a job with another report alone", () => {
    const prev = linked();
    const plan = planUnlinkUndo("job", "the callout", prev, jobAfterLink(openJob(), prev, { otherReports: 1 }));
    expect(plan.data).toEqual({});
    expect(plan.check).toEqual(["The callout has another report, so it was left as it is."]);
  });

  it("leaves a job someone moved on since alone", () => {
    const prev = linked();
    const plan = planUnlinkUndo("job", "the callout", prev, jobAfterLink(openJob(), prev, { status: "SENT_TO_CLIENT" }));
    expect(plan.data).toEqual({});
    expect(plan.check).toEqual([
      'The callout was changed to "sent to the client" after the link, so it was left as it is — check its times, officer and bill.',
    ]);
  });

  it("keeps a field someone changed after the link, and says so", () => {
    const prev = linked();
    const now = jobAfterLink(openJob(), prev, {
      times: { startedAt: T("02:05"), completedAt: T("02:40") },
      officerId: OTHER_OFFICER,
    });
    const plan = planUnlinkUndo("job", "the callout", prev, now);
    expect(plan.data).not.toHaveProperty("startedAt");
    expect(plan.data).not.toHaveProperty("assignedToUserId");
    expect(plan.data).toHaveProperty("completedAt", null);
    expect(plan.check).toEqual([
      "The start time on the callout was changed after the link, so it was kept.",
      "The officer on the callout was changed after the link, so they were kept.",
    ]);
  });

  it("does nothing for cancelled work a person linked (it was left alone)", () => {
    const { prev } = planJobLink(openJob({ status: "CANCELLED" }), fill(), true);
    const plan = planUnlinkUndo("job", "the callout", viaHistory(prev), jobAfterLink(openJob(), prev));
    expect(plan).toEqual({ data: {}, undone: [], check: [] });
  });

  it("round trip: link then unlink gives the job back as it was", () => {
    const before = openJob({ status: "ASSIGNED", startedAt: T("02:00") });
    const { data, prev } = planJobLink(before, fill(), true);
    prev.filled.bill = true;
    const after = { ...before, ...data };
    const p = viaHistory(prev)!;
    const plan = planUnlinkUndo("job", "the callout", p, {
      status: after.status,
      times: { startedAt: after.startedAt, completedAt: after.completedAt ?? null },
      locatedAt: after.locatedAt ?? null,
      officerId: after.assignedToUserId,
      responderType: after.responderType,
      billed: true,
      paid: false,
      invoiceNumber: null,
      otherReports: 0,
    });
    const restored = { ...after, ...plan.data };
    expect(restored.status).toBe("ASSIGNED");
    expect(restored.startedAt).toEqual(T("02:00")); // the job's own start: never touched
    expect(restored.completedAt).toBeNull();
    expect(restored.assignedToUserId).toBeNull();
    expect(restored.responderType).toBeNull();
    expect(restored.lat).toBeNull();
    expect(plan.check).toEqual([]);
  });
});

describe("planUnlinkUndo — visit", () => {
  const linkedVisit = () => {
    const { prev } = planVisitLink(pendingVisit(), fill(), true);
    prev.filled.bill = true;
    return viaHistory(prev)!;
  };
  const now = (prev: LinkPrev, over: Partial<ActivityNow> = {}): ActivityNow => ({
    status: prev.statusAfter,
    times: { arrivedAt: T("02:10"), departedAt: T("02:40") },
    locatedAt: T("02:10"),
    officerId: OFFICER,
    photosAreReports: true,
    billed: true,
    paid: false,
    invoiceNumber: null,
    otherReports: 0,
    ...over,
  });

  it("puts a visit back to how it was", () => {
    const prev = linkedVisit();
    const plan = planUnlinkUndo("visit", "the patrol visit", prev, now(prev));
    expect(plan.data).toEqual({
      status: "PENDING",
      arrivedAt: null,
      departedAt: null,
      lat: null,
      lng: null,
      locatedAt: null,
      officerId: null,
      photoUrls: [],
      billedAmount: null,
      billedCurrency: null,
      billedAt: null,
      payRateUnit: null,
    });
    expect(plan.undone).toEqual(["status", "arrivedAt", "departedAt", "location", "officer", "photos", "bill"]);
    expect(plan.check).toEqual([]);
  });

  it("keeps photos someone changed since", () => {
    const prev = linkedVisit();
    const plan = planUnlinkUndo("visit", "the patrol visit", prev, now(prev, { photosAreReports: false }));
    expect(plan.data).not.toHaveProperty("photoUrls");
    expect(plan.check).toEqual(["The photos on the patrol visit were changed after the link, so they were kept."]);
  });

  it("leaves a visit with an officer's own report marked done", () => {
    const prev = linkedVisit();
    const plan = planUnlinkUndo("visit", "the patrol visit", prev, now(prev, { otherReports: 1 }));
    expect(plan.data).toEqual({});
    expect(plan.check).toEqual(["The patrol visit has another report, so it was left as it is."]);
  });
});

describe("planCreatedJobUndo", () => {
  const AT = T("09:00");
  const what = "the callout made from this report";

  it("cancels the job the report made and clears its bill and pay", () => {
    const plan = planCreatedJobUndo(
      what,
      { status: "APPROVED", billed: true, paid: true, invoiceNumber: null, otherReports: 0 },
      { userId: OFFICER, at: AT },
    );
    expect(plan.data).toEqual({
      status: "CANCELLED",
      cancelledAt: AT,
      cancelledByUserId: OFFICER,
      statusBeforeCancel: "APPROVED",
      billedAmount: null,
      billedCurrency: null,
      billedAt: null,
      payRateUnit: null,
      paidAmount: null,
      paidCurrency: null,
      paidAt: null,
    });
    expect(plan.undone).toEqual(["cancelled", "bill", "pay"]);
    expect(plan.check).toEqual([]);
  });

  it("records no canceller when it isn't known", () => {
    const plan = planCreatedJobUndo(
      what,
      { status: "APPROVED", billed: false, paid: false, invoiceNumber: null, otherReports: 0 },
      { userId: null, at: AT },
    );
    expect(plan.data).not.toHaveProperty("cancelledByUserId");
    expect(plan.undone).toEqual(["cancelled"]);
  });

  it("doesn't cancel an invoiced, shared or closed job, and says why", () => {
    const base = { status: "APPROVED", billed: true, paid: true, invoiceNumber: null, otherReports: 0 };
    const by = { userId: OFFICER, at: AT };
    expect(planCreatedJobUndo(what, { ...base, invoiceNumber: "INV-7" }, by)).toEqual({
      data: {},
      undone: [],
      check: [
        "The callout made from this report is on invoice INV-7, so it wasn't cancelled — adjust the invoice, then cancel it by hand if it shouldn't be there.",
      ],
    });
    expect(planCreatedJobUndo(what, { ...base, otherReports: 2 }, by).check).toEqual([
      "The callout made from this report has another report, so it wasn't cancelled.",
    ]);
    expect(planCreatedJobUndo(what, { ...base, status: "CLOSED" }, by).check).toEqual([
      "The callout made from this report was closed after it was made, so it wasn't cancelled — cancel it by hand if it shouldn't be there.",
    ]);
  });

  it("leaves an already-cancelled job alone", () => {
    expect(
      planCreatedJobUndo(
        what,
        { status: "CANCELLED", billed: false, paid: false, invoiceNumber: null, otherReports: 0 },
        { userId: OFFICER, at: AT },
      ),
    ).toEqual({ data: {}, undone: [], check: [] });
  });
});
