/**
 * Single source of truth for human-facing date / time formatting.
 *
 * Rules of thumb:
 *   - Always en-GB. The UI is UK-only and British date order is expected.
 *   - Europe/London timezone for "absolute" formats — DB stores UTC but
 *     officers / admins think in local time.
 *   - "—" for null / missing values rather than empty strings, so columns
 *     stay aligned.
 */

const LOCALE = "en-GB";
const TZ = "Europe/London";

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return "—";
  return dt.toLocaleDateString(LOCALE, {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return "—";
  return dt.toLocaleString(LOCALE, {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return "—";
  return dt.toLocaleTimeString(LOCALE, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Relative-time formatter. Granular for fresh events ("just now", "5m ago",
 * "3h ago"), drops to dates for anything older than ~6 days.
 */
export function formatTimeAgo(
  d: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return "—";
  const diffMs = now.getTime() - dt.getTime();
  if (diffMs < 0) {
    // Future — flip the sign and prefix "in".
    return "in " + formatDuration(Math.abs(diffMs));
  }
  if (diffMs < 60_000) return "just now";
  if (diffMs < 60 * 60_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 24 * 60 * 60_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  if (diffMs < 6 * 24 * 60 * 60_000) {
    return `${Math.floor(diffMs / 86_400_000)}d ago`;
  }
  return formatDate(dt);
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.ceil(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) return `${Math.ceil(ms / 3_600_000)}h`;
  return `${Math.ceil(ms / 86_400_000)}d`;
}

/**
 * "YYYY-MM-DD" for HTML date inputs and URL params. Always local — never
 * shifts on a timezone change near midnight.
 */
export function toIsoDate(d: Date | null | undefined): string {
  if (!d) return "";
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parse "YYYY-MM-DD" from form input / URL into a local-midnight Date.
 * Returns null for missing / malformed inputs so callers can fall back.
 */
export function parseIsoDate(
  s: string | null | undefined,
  endOfDay = false,
): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}
