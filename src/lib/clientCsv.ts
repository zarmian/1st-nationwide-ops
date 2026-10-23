/**
 * The client activity log as CSV — pure, unit-tested. Dates and times are UK
 * local. Cells that a spreadsheet would run as a formula get a leading
 * apostrophe.
 */
import type { ClientActivity } from "@/lib/clientPortal";

const DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function csvCell(v: string | number | null): string {
  if (v === null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function activitiesCsv(rows: ClientActivity[]): string {
  const head = [
    "Date",
    "Time",
    "Site code",
    "Site",
    "Activity",
    "Hours",
    "Status",
    "Charge ex VAT (GBP)",
    "Report",
  ];
  const lines = [head.map(csvCell).join(",")];
  for (const a of rows) {
    lines.push(
      [
        DATE.format(a.at),
        TIME.format(a.at),
        a.siteCode,
        a.siteName,
        a.kind,
        a.hours == null ? null : a.hours.toFixed(2),
        a.status,
        a.charge == null ? null : a.charge.toFixed(2),
        a.hasReport ? "Yes" : "No",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
