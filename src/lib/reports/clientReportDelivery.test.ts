import { describe, it, expect } from "vitest";
import { buildReportHtml, buildReportText } from "./clientReportDelivery";
import type { ShurgardReportData } from "./shurgardReport";

const sample: ShurgardReportData = {
  dateLabel: "Monday, 01 September 2026",
  shurgardFound: true,
  jobSites: ["Norbury (Lock and Unlock)", "Neasden (Nexus)"],
  shifts: [{ label: "Croydon", hours: "18:00 – 06:00" }],
  generatedAt: "Tue, 02 Sep 2026, 07:00",
};

const empty: ShurgardReportData = {
  dateLabel: "Tuesday, 02 September 2026",
  shurgardFound: true,
  jobSites: [],
  shifts: [],
  generatedAt: "Wed, 03 Sep 2026, 07:00",
};

describe("buildReportText", () => {
  it("lists job sites and shift hours", () => {
    const t = buildReportText(sample);
    expect(t).toContain("Monday, 01 September 2026");
    expect(t).toContain("Norbury (Lock and Unlock)");
    expect(t).toContain("Neasden (Nexus)");
    expect(t).toContain("Croydon: 18:00 – 06:00");
  });

  it("shows (none) when a section is empty", () => {
    const t = buildReportText(empty);
    // Both the callouts and static-guarding sections fall back to "(none)".
    expect(t.match(/\(none\)/g)?.length).toBe(2);
  });
});

describe("buildReportHtml", () => {
  it("includes the date, sites and hours", () => {
    const h = buildReportHtml(sample);
    expect(h).toContain("Monday, 01 September 2026");
    expect(h).toContain("Norbury (Lock and Unlock)");
    expect(h).toContain("18:00 – 06:00");
  });

  it("escapes HTML-significant characters in labels", () => {
    const h = buildReportHtml({
      ...sample,
      jobSites: ["Tom & Jerry <Site>"],
    });
    expect(h).toContain("Tom &amp; Jerry &lt;Site&gt;");
    expect(h).not.toContain("<Site>");
  });

  it("renders empty-state copy when there's nothing to report", () => {
    const h = buildReportHtml(empty);
    expect(h).toContain("No callouts or lock-ups recorded.");
    expect(h).toContain("No static guarding shifts recorded.");
  });
});
