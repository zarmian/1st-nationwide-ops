/**
 * Shared plumbing for the Claude connector's read-only tools: the per-request
 * context, UK date handling (the app's rule: date filters mean the SCHEDULED
 * UK day), name → id resolution for filters, and result formatting.
 */
import type { HiddenScope } from "@/lib/hiddenAccounts";
import { prisma } from "@/lib/db";
import { parseIsoDate, ukDayPlus, ukDayString } from "@/lib/dates";
import { STATUS_GROUPS } from "@/lib/reports/activitiesReport";
import type { McpPrincipal } from "../oauth";

export type ToolContext = {
  principal: McpPrincipal;
  isAdmin: boolean;
  /** Admin-only "hidden accounts" declutter — inert for office staff (as in the app). */
  hidden: HiddenScope;
  now: Date;
};

/** A problem with the caller's input — returned to Claude as a readable error. */
export class ToolInputError extends Error {}

// ── Dates ──────────────────────────────────────────────────────────────────

const TZ = "Europe/London";

/** UK local time with its UTC offset, e.g. "2026-10-11T19:30+01:00". */
export function ukIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  const wall = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(hour),
    Number(get("minute")),
  );
  const offsetMin = Math.round((wall - Math.floor(d.getTime() / 60000) * 60000) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}${off}`;
}

/** UK calendar date "YYYY-MM-DD" (null-safe). */
export function ukDate(d: Date | null | undefined): string | null {
  return d ? ukDayString(d) : null;
}

export function ukToday(now: Date): string {
  return ukDayString(now);
}

/** UK calendar date `days` away from `now` ("YYYY-MM-DD"). */
export function ukDayOffset(now: Date, days: number): string {
  const d = ukDayPlus(now, days);
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

export type DayRange = { from: string; to: string; fromDate: Date; toDate: Date };

/**
 * Parse a "YYYY-MM-DD" UK day strictly: the date must exist (no 2026-13-45 or
 * 31 April quietly rolling over), returning the start or inclusive end
 * instant of that Europe/London day.
 */
export function parseUkDay(s: string, endOfDay = false): Date | null {
  const d = parseIsoDate(s, endOfDay);
  return d && ukDayString(d) === s ? d : null;
}

/**
 * Resolve an inclusive UK-day window. Missing `to` = same as `from`; missing
 * both = the defaults. Rejects bad dates, reversed windows and spans longer
 * than `maxDays`, with messages Claude can act on.
 */
export function resolveDayRange(
  input: { from?: string; to?: string },
  defaults: { from: string; to: string },
  maxDays: number,
): DayRange {
  const from = input.from ?? (input.to ? input.to : defaults.from);
  const to = input.to ?? (input.from ? input.from : defaults.to);
  const fromDate = parseUkDay(from);
  const toDate = parseUkDay(to, true);
  if (!fromDate) throw new ToolInputError(`"from" must be a date like 2026-10-11 (got "${from}").`);
  if (!toDate) throw new ToolInputError(`"to" must be a date like 2026-10-11 (got "${to}").`);
  if (toDate < fromDate) throw new ToolInputError(`"to" (${to}) is before "from" (${from}).`);
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
  if (days > maxDays) {
    throw new ToolInputError(
      `That window is ${days} days; the most this tool covers at once is ${maxDays}. Split it into smaller windows.`,
    );
  }
  return { from, to, fromDate, toDate };
}

// ── Status groups (same buckets as the Activities log) ─────────────────────

export const STATUS_GROUP_KEYS = [
  "scheduled",
  "in_progress",
  "completed",
  "missed",
  "cancelled",
] as const;
export type StatusGroup = (typeof STATUS_GROUP_KEYS)[number];

export function statusGroupOf(status: string): StatusGroup | "other" {
  for (const g of STATUS_GROUP_KEYS) if (STATUS_GROUPS[g]?.has(status)) return g;
  return "other";
}

/** Raw statuses of one record type that fall in the chosen groups (null = no filter). */
export function statusesFor(
  groups: readonly StatusGroup[] | undefined,
  valid: readonly string[],
): string[] | null {
  if (!groups?.length) return null;
  const wanted = new Set<string>();
  for (const g of groups) for (const s of STATUS_GROUPS[g] ?? []) wanted.add(s);
  return valid.filter((s) => wanted.has(s));
}

// ── Name → id resolution for filters ───────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: string): boolean {
  return UUID_RE.test(v.trim());
}

type Match<Id = string> = { ids: Id[]; names: string[] };

function notFound(what: string, text: string, hint: string): never {
  throw new ToolInputError(`No ${what} matches "${text}". ${hint}`);
}

export async function matchCustomers(text: string): Promise<Match> {
  const t = text.trim();
  const rows = await prisma.customer.findMany({
    where: isUuid(t) ? { id: t } : { name: { contains: t, mode: "insensitive" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 25,
  });
  if (!rows.length) notFound("customer", t, "Try part of the name, or list_accounts (admins) to see names.");
  return { ids: rows.map((r) => r.id), names: rows.map((r) => r.name) };
}

export async function matchPartners(text: string): Promise<Match> {
  const t = text.trim();
  const rows = await prisma.partner.findMany({
    where: isUuid(t) ? { id: t } : { name: { contains: t, mode: "insensitive" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 25,
  });
  if (!rows.length) notFound("partner", t, "Try part of the name.");
  return { ids: rows.map((r) => r.id), names: rows.map((r) => r.name) };
}

/** Staff and officers (anyone work can be assigned to). */
export async function matchPeople(text: string): Promise<Match> {
  const t = text.trim();
  const rows = await prisma.user.findMany({
    where: {
      role: { in: ["OFFICER", "DISPATCHER", "ADMIN"] },
      ...(isUuid(t) ? { id: t } : { name: { contains: t, mode: "insensitive" } }),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 25,
  });
  if (!rows.length) notFound("officer", t, "Try part of their name, or list_officers to see names.");
  return { ids: rows.map((r) => r.id), names: rows.map((r) => r.name) };
}

export async function matchRegions(text: string): Promise<Match<number>> {
  const t = text.trim();
  const rows = await prisma.region.findMany({
    where: { name: { contains: t, mode: "insensitive" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (!rows.length) {
    const all = await prisma.region.findMany({ select: { name: true }, orderBy: { name: "asc" } });
    notFound("region", t, `Regions are: ${all.map((r) => r.name).join(", ") || "none set up"}.`);
  }
  return { ids: rows.map((r) => r.id), names: rows.map((r) => r.name) };
}

/** A site by id, exact code, or part of its name / postcode / address. */
export async function matchSites(text: string, take = 50): Promise<Match> {
  const t = text.trim();
  if (isUuid(t)) {
    const s = await prisma.site.findUnique({ where: { id: t }, select: { id: true, name: true, code: true } });
    if (!s) notFound("site", t, "Check the id, or search by name.");
    return { ids: [s.id], names: [siteLabel(s)] };
  }
  const byCode = await prisma.site.findFirst({
    where: { code: { equals: t, mode: "insensitive" } },
    select: { id: true, name: true, code: true },
  });
  if (byCode) return { ids: [byCode.id], names: [siteLabel(byCode)] };
  const rows = await prisma.site.findMany({
    where: {
      OR: [
        { name: { contains: t, mode: "insensitive" } },
        { postcode: { contains: t.replace(/\s+/g, ""), mode: "insensitive" } },
        { addressLine: { contains: t, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, code: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    take,
  });
  if (!rows.length) notFound("site", t, "Try part of the name or the postcode, or use search_sites.");
  return { ids: rows.map((r) => r.id), names: rows.map(siteLabel) };
}

export function siteLabel(s: { code?: string | null; name: string }): string {
  return s.code ? `${s.name} (${s.code})` : s.name;
}

// ── Values ─────────────────────────────────────────────────────────────────

/** Prisma Decimal / number → number rounded to pence (null-safe). */
export function money(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function clampLimit(limit: number | undefined, def: number, max: number): number {
  if (!limit || !Number.isFinite(limit)) return def;
  return Math.max(1, Math.min(max, Math.floor(limit)));
}
