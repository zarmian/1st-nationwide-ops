/**
 * Pure formatting for the bot's "day rundown" — resolving which day was
 * asked for, and turning a list of activities into a Telegram message. Kept
 * DB-free so the day-math and layout are unit-tested without a database; the
 * loader that fills these rows lives in lib/dayActivities.
 */
import { ukDayPlus } from "@/lib/dates";
import { escapeHtml } from "@/lib/telegram";

const TZ = "Europe/London";

/** One row of the rundown, already normalised across job / visit / shift. */
export type DayActivity = {
  at: Date;
  endsAt: Date | null; // shifts show a start–end range
  kindLabel: string;
  siteName: string;
  who: string; // officer name, "X (partner)", or "Unassigned"
  status: string; // raw enum value (mapped to friendly text below)
  source: "JOB" | "VISIT" | "SHIFT";
};

export const ACTIVITY_KIND_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  VPI: "VPI",
  ADHOC: "Ad-hoc",
  STATIC_GUARDING_SHIFT: "Static guarding",
  DOG_HANDLER_SHIFT: "Dog handler",
  VISIT_PATROL: "Patrol",
  VISIT_VPI: "VPI",
};

export type DayTarget = {
  year: number;
  month: number;
  day: number;
  label: string;
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
  sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

type Ymd = { year: number; month: number; day: number };

/** A real calendar date, or null. Round-trips to reject e.g. 31 Feb. */
function validYmd(year: number, month: number, day: number): Ymd | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * Parse an explicit date in the formats a UK dispatcher actually types:
 * ISO (2026-08-03), day-first numeric (3/8, 03-08-2026), and spoken
 * ("3 August", "3rd aug 2025", "august 3"). Missing year → the current UK
 * year. Returns null when it isn't a date.
 */
function parseUkDateString(key: string, now: Date): Ymd | null {
  const s = key.trim().toLowerCase();
  const curYear = ukDayPlus(now, 0).year;
  const fullYear = (y: string | undefined): number => {
    if (!y) return curYear;
    const n = Number(y);
    return n < 100 ? 2000 + n : n;
  };

  // ISO: YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);

  // Day-first numeric: DD/MM[/YYYY] with / . or - separators
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?$/);
  if (m) return validYmd(fullYear(m[3]), +m[2], +m[1]);

  // Spoken, ordinals stripped ("3rd" → "3")
  const t = s.replace(/(\d+)(st|nd|rd|th)\b/g, "$1");
  // "3 august [2026]"
  m = t.match(/^(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{2,4}))?$/);
  if (m && MONTHS[m[2]]) return validYmd(fullYear(m[3]), MONTHS[m[2]], +m[1]);
  // "august 3 [2026]"
  m = t.match(/^([a-z]+)\.?\s+(\d{1,2})(?:\s+(\d{2,4}))?$/);
  if (m && MONTHS[m[1]]) return validYmd(fullYear(m[3]), MONTHS[m[1]], +m[2]);

  return null;
}

/**
 * Resolve a day keyword ("today"/"yesterday"/"tomorrow") or an explicit date
 * (ISO, day-first numeric, or spoken like "3 August") into a UK calendar
 * target + a human label. Returns null when it isn't a day/date.
 */
export function resolveDayTarget(
  input: string,
  now: Date = new Date(),
): DayTarget | null {
  const key = input.trim().toLowerCase();
  let ymd: Ymd | null = null;
  if (key === "today" || key === "") ymd = ukDayPlus(now, 0);
  else if (key === "yesterday") ymd = ukDayPlus(now, -1);
  else if (key === "tomorrow") ymd = ukDayPlus(now, 1);
  else ymd = parseUkDateString(key, now);
  if (!ymd) return null;
  return { ...ymd, label: dayLabel(ymd) };
}

function dayLabel(t: { year: number; month: number; day: number }): string {
  // Noon UTC of the target day — safely inside the UK day for either DST
  // offset, so the formatted weekday/date is correct.
  const noon = new Date(Date.UTC(t.year, t.month - 1, t.day, 12));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(noon);
}

function timeLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

// Friendly status text + a leading dot so the state reads at a glance.
const STATUS_TEXT: Record<string, string> = {
  OPEN: "scheduled",
  ASSIGNED: "scheduled",
  PENDING: "scheduled",
  IN_PROGRESS: "in progress",
  LATE: "running late",
  SUBMITTED: "in review",
  REVIEW_PENDING: "in review",
  COMPLETED: "done",
  APPROVED: "done",
  SENT_TO_CLIENT: "done",
  CLOSED: "done",
  MISSED: "missed",
  ABANDONED: "abandoned",
};

function statusDot(status: string): string {
  if (["COMPLETED", "APPROVED", "SENT_TO_CLIENT", "CLOSED"].includes(status))
    return "🟢";
  if (["MISSED", "ABANDONED"].includes(status)) return "🔴";
  if (["IN_PROGRESS", "LATE", "SUBMITTED", "REVIEW_PENDING"].includes(status))
    return "🔵";
  return "⚪"; // scheduled / not started
}

const MAX_ROWS = 40;

/**
 * Render the rundown as Telegram HTML. `rows` should already be sorted by
 * time. Caps the list so a very busy day can't blow Telegram's message-size
 * limit, noting how many were hidden.
 */
export function formatDayActivitiesMessage(
  rows: DayActivity[],
  dayLabelText: string,
  siteNote?: string,
): string {
  const head = `<b>${escapeHtml(dayLabelText)}</b>`;
  if (rows.length === 0) {
    return `${head}\n\nNothing scheduled or logged${siteNote ? ` ${escapeHtml(siteNote)}` : ""}.`;
  }

  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;

  const lines = [
    `${head} — ${rows.length} ${rows.length === 1 ? "activity" : "activities"}${siteNote ? ` ${escapeHtml(siteNote)}` : ""}`,
    "",
  ];
  for (const r of shown) {
    const time = r.endsAt
      ? `${timeLabel(r.at)}–${timeLabel(r.endsAt)}`
      : timeLabel(r.at);
    const statusText = STATUS_TEXT[r.status] ?? r.status.toLowerCase();
    lines.push(
      `${statusDot(r.status)} <b>${escapeHtml(time)}</b> · ${escapeHtml(r.kindLabel)} · ${escapeHtml(statusText)}`,
    );
    lines.push(`   ${escapeHtml(r.siteName)} — ${escapeHtml(r.who)}`);
  }
  if (hidden > 0) {
    lines.push("", `…and ${hidden} more — see the app for the full list.`);
  }
  return lines.join("\n");
}

function nowLine(r: DayActivity): string {
  const time = r.endsAt
    ? `${timeLabel(r.at)}–${timeLabel(r.endsAt)}`
    : timeLabel(r.at);
  return `• <b>${escapeHtml(time)}</b> · ${escapeHtml(r.kindLabel)} — ${escapeHtml(r.siteName)} · ${escapeHtml(r.who)}`;
}

/**
 * Render the live "on now" snapshot: what's in progress right now, and what's
 * overdue / not started. `nowLabel` is the current time, already formatted.
 */
export function formatNowMessage(
  active: DayActivity[],
  overdue: DayActivity[],
  nowLabel: string,
): string {
  const head = `<b>On now</b> · ${escapeHtml(nowLabel)}`;
  if (active.length === 0 && overdue.length === 0) {
    return `${head}\n\n✅ All quiet — nothing in progress or overdue right now.`;
  }
  const lines = [head];
  if (active.length > 0) {
    lines.push("", `🔵 <b>In progress (${active.length})</b>`);
    for (const r of active.slice(0, MAX_ROWS)) lines.push(nowLine(r));
  }
  if (overdue.length > 0) {
    lines.push("", `🔴 <b>Overdue / not started (${overdue.length})</b>`);
    for (const r of overdue.slice(0, MAX_ROWS)) lines.push(nowLine(r));
  }
  return lines.join("\n");
}
