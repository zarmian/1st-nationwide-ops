/**
 * Human-facing number / money formatting — the numeric sibling of lib/dates.
 *
 * Always en-GB. Use these instead of hand-rolled `toLocaleString` or
 * `£${n.toFixed(2)}` templating so figures render consistently across the app
 * (and pair with `tabular-nums` so columns line up).
 *
 *   - "—" for null / missing / non-finite, mirroring lib/dates, so table
 *     columns stay aligned rather than collapsing to empty cells.
 */

const LOCALE = "en-GB";

/** Currency, GBP by default. `£1,234.50`, or "—" when there's nothing to show. */
export function formatMoney(
  amount: number | string | null | undefined,
  opts: { currency?: string } = {},
): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: opts.currency ?? "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Plain number with locale grouping. `1,234`, or "—" when missing. */
export function formatNumber(
  value: number | string | null | undefined,
  opts: Intl.NumberFormatOptions = {},
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(LOCALE, opts).format(n);
}
