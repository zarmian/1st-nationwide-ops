import { describe, it, expect } from "vitest";
import { activitiesCsv, csvCell } from "./clientCsv";
import type { ClientActivity } from "./clientPortal";

describe("csvCell", () => {
  it("quotes commas, quotes and new lines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });
  it("stops a cell being run as a formula", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-1+1")).toBe("'-1+1");
  });
});

describe("activitiesCsv", () => {
  it("writes UK date and time, charge and report flag", () => {
    const row: ClientActivity = {
      id: "job:1",
      href: "/client/activities/job/1",
      kind: "Alarm response",
      group: "callout",
      siteId: "s1",
      siteName: "Croydon, Purley Way",
      siteCode: "CR1",
      at: new Date("2026-10-20T20:15:00.000Z"), // 21:15 BST
      status: "Completed",
      charge: 45,
      hasReport: true,
      hours: null,
    };
    const csv = activitiesCsv([
      row,
      { ...row, id: "job:2", charge: null, hasReport: false },
      { ...row, id: "shift:3", kind: "Static guarding", group: "guarding", hours: 11.75 },
    ]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Date,Time,Site code,Site,Activity,Hours,Status,Charge ex VAT (GBP),Report");
    expect(lines[1]).toBe('20/10/2026,21:15,CR1,"Croydon, Purley Way",Alarm response,,Completed,45.00,Yes');
    expect(lines[2]).toBe('20/10/2026,21:15,CR1,"Croydon, Purley Way",Alarm response,,Completed,,No');
    expect(lines[3]).toBe('20/10/2026,21:15,CR1,"Croydon, Purley Way",Static guarding,11.75,Completed,45.00,Yes');
  });
});
