/**
 * Stable display colour for a customer or partner.
 *
 * Named brands get an explicit colour (Shurgard red, Nexus blue, etc.).
 * Anything else falls back to a deterministic palette indexed by a hash
 * of the entity's first name word — so new customers/partners get a
 * stable, distinct colour without any DB or admin step.
 *
 * If a brand becomes prominent enough to want its own colour, add it
 * to NAMED below; the rest of the app picks it up automatically.
 *
 * Lookup is by the first word of the name (lowercase). "Shurgard
 * Wandsworth" and "Shurgard Acton" both resolve to "shurgard" → red.
 * "Nexus Security Ltd" → "nexus" → blue.
 */

const NAMED: Record<string, string> = {
  shurgard: "#DC2626", // red-600
  nexus: "#2563EB", // blue-600
  keyholding: "#EA580C", // orange-600
  orbis: "#16A34A", // green-600
  aegis: "#7C3AED", // violet-600
};

const FALLBACK_PALETTE = [
  "#0EA5E9", // sky
  "#F59E0B", // amber
  "#EC4899", // pink
  "#14B8A6", // teal
  "#A855F7", // purple
  "#84CC16", // lime
  "#06B6D4", // cyan
  "#F97316", // orange
  "#22C55E", // green
  "#3B82F6", // blue
  "#D946EF", // fuchsia
  "#EF4444", // red
];

const UNASSIGNED_HEX = "#94A3B8"; // slate-400
const UNASSIGNED_KEY = "_none";
const UNASSIGNED_LABEL = "Unassigned";

export type EntityColor = {
  /** Hex colour for marker fill / chip background. */
  hex: string;
  /** Lowercase first-word key — stable filter token (e.g. "shurgard"). */
  key: string;
  /** Human-readable label (passes the entity's original name through). */
  label: string;
};

function normalize(name: string): string {
  return name.trim().toLowerCase().split(/[\s_/.-]+/)[0] ?? "";
}

function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function entityColor(
  input: { name: string } | null | undefined,
): EntityColor {
  if (!input?.name) {
    return { hex: UNASSIGNED_HEX, key: UNASSIGNED_KEY, label: UNASSIGNED_LABEL };
  }
  const key = normalize(input.name);
  const named = NAMED[key];
  if (named) return { hex: named, key, label: input.name };
  const idx = hashInt(key) % FALLBACK_PALETTE.length;
  return { hex: FALLBACK_PALETTE[idx], key, label: input.name };
}

/**
 * Pick an owner from a site for display purposes. Partner wins over
 * customer when both are set — partner-as-customer sites (e.g. Nexus's
 * London sites) are owned by the partner from the user's perspective.
 */
export function siteOwner(site: {
  customer?: { name: string } | null;
  partner?: { name: string } | null;
}): EntityColor {
  if (site.partner) return entityColor(site.partner);
  if (site.customer) return entityColor(site.customer);
  return entityColor(null);
}
