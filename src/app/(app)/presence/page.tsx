import Link from "next/link";
import { MapPin, Target, MapPinOff, HelpCircle } from "lucide-react";
import { requireStaff } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { formatDateTime } from "@/lib/dates";
import { ProofBadge } from "@/components/ProofOfPresence";
import { loadRecentPresence, summarisePresence, mapsLink } from "@/lib/proofOfPresence";
import { loadHiddenScope, hiddenSiteSet } from "@/lib/hiddenAccounts";
import type {
  OfficerPin,
  SitePin,
  AssignmentLine,
} from "@/components/map/MapInner";
import { PresenceMap } from "./_components/PresenceMap";

export const dynamic = "force-dynamic";

const WINDOWS = [7, 30, 90] as const;
const MAP_MAX = 80;

export default async function PresencePage({
  searchParams,
}: {
  searchParams: { days?: string; officerId?: string };
}) {
  const me = await requireStaff();

  const days = WINDOWS.find((w) => String(w) === searchParams.days) ?? 30;
  const officerId = searchParams.officerId?.trim() || null;

  const [rawPoints, officers, hidden] = await Promise.all([
    loadRecentPresence({ days, officerId }),
    prisma.user.findMany({
      where: { role: { in: ["OFFICER", "DISPATCHER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    loadHiddenScope(me.role === "ADMIN"),
  ]);

  // Admin-only declutter: drop attendances on hidden accounts' sites.
  const hiddenSites = hiddenSiteSet(hidden);
  const points = hidden.active
    ? rawPoints.filter((p) => !(p.siteId && hiddenSites.has(p.siteId)))
    : rawPoints;

  const summary = summarisePresence(points);
  const unverifiable = summary.total - summary.enforced;

  // Build the map pin set from the points that carry both a fix and site coords.
  const mapPoints = points.slice(0, MAP_MAX);
  const officerPins: OfficerPin[] = mapPoints.map((p) => ({
    id: p.id,
    name: p.officerName ?? "Officer",
    role: "",
    lat: p.gpsLat,
    lng: p.gpsLng,
    // Within the geofence → blue; outside/unverified → amber (a nudge to look).
    freshness: p.verdict.status === "within" ? "fresh" : "stale",
    lastSeenLabel: `${p.kind} · ${formatDateTime(p.at)}`,
  }));
  const siteMap = new Map<string, SitePin>();
  const lines: AssignmentLine[] = [];
  for (const p of mapPoints) {
    if (p.siteId && p.siteLat != null && p.siteLng != null) {
      if (!siteMap.has(p.siteId)) {
        siteMap.set(p.siteId, {
          id: p.siteId,
          name: p.siteName ?? "Site",
          lat: p.siteLat,
          lng: p.siteLng,
        });
      }
      lines.push({
        officerId: p.id,
        fromLat: p.gpsLat,
        fromLng: p.gpsLng,
        toLat: p.siteLat,
        toLng: p.siteLng,
        officerName: p.officerName ?? "Officer",
        siteName: p.siteName ?? "Site",
      });
    }
  }
  const sitePins = Array.from(siteMap.values());
  const hasMap = officerPins.length > 0;

  const activeOfficer = officerId
    ? officers.find((o) => o.id === officerId)?.name ?? null
    : null;

  const withDays = (extra: Record<string, string>) => {
    const sp = new URLSearchParams({ days: String(days), ...extra });
    if (officerId && !("officerId" in extra)) sp.set("officerId", officerId);
    return `/presence?${sp.toString()}`;
  };

  return (
    <div className="section">
      <PageHeader
        title="Proof of presence"
        subtitle="Where officers actually were when they attended — GPS fix vs the site geofence. Evidence you can stand behind with clients."
        actions={
          <Link href="/operations" className="btn-secondary text-sm">
            Operations →
          </Link>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">Last</span>
          {WINDOWS.map((w) => (
            <Link
              key={w}
              href={`/presence?days=${w}${officerId ? `&officerId=${officerId}` : ""}`}
              className={w === days ? "pill pill-active" : "pill pill-idle"}
            >
              {w} days
            </Link>
          ))}
        </div>
        <form className="flex items-end gap-2">
          <input type="hidden" name="days" value={days} />
          <div>
            <label className="label" htmlFor="officerId">
              Officer
            </label>
            <select
              id="officerId"
              name="officerId"
              defaultValue={officerId ?? ""}
              className="input"
            >
              <option value="">All officers</option>
              {officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-secondary text-sm">
            Apply
          </button>
        </form>
        {activeOfficer && (
          <span className="chip-info">
            {activeOfficer}
            <Link
              href={withDays({ officerId: "" })}
              className="ml-1.5"
              aria-label={`Clear ${activeOfficer} filter`}
            >
              ✕
            </Link>
          </span>
        )}
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          tone="blue"
          label="Attendances"
          value={summary.total.toLocaleString("en-GB")}
          hint="with a GPS fix"
          icon={MapPin}
        />
        <StatCard
          tone={summary.withinPct != null && summary.withinPct < 90 ? "amber" : "emerald"}
          label="Within geofence"
          value={summary.withinPct != null ? `${summary.withinPct}%` : "—"}
          hint="of verifiable fixes"
          icon={Target}
        />
        <StatCard
          tone={summary.outside > 0 ? "rose" : "emerald"}
          label="Outside geofence"
          value={summary.outside.toLocaleString("en-GB")}
          hint="fix beyond the radius"
          icon={MapPinOff}
        />
        <StatCard
          tone="indigo"
          label="Can’t verify"
          value={unverifiable.toLocaleString("en-GB")}
          hint="site has no coordinates"
          icon={HelpCircle}
        />
      </div>

      {hasMap && (
        <div className="card overflow-hidden">
          <PresenceMap points={officerPins} sites={sitePins} lines={lines} />
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">
            Attendances — last {days} days
          </h2>
          <p className="text-xs text-slate-500">
            {points.length} with a GPS fix
            {activeOfficer ? ` · ${activeOfficer}` : ""}
          </p>
        </div>
        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th>When</th>
                <th>Officer</th>
                <th>Site</th>
                <th>Activity</th>
                <th className="col-num">Distance</th>
                <th>Verdict</th>
                <th>Map</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">
                    <Link
                      href={p.href}
                      className="text-brand-navy hover:text-brand-blue-dark"
                    >
                      {formatDateTime(p.at)}
                    </Link>
                  </td>
                  <td className="text-slate-700 whitespace-nowrap">
                    {p.officerName ?? "—"}
                  </td>
                  <td>
                    {p.siteId ? (
                      <Link
                        href={`/sites/${p.siteId}/edit`}
                        className="font-medium text-brand-navy hover:text-brand-blue-dark"
                      >
                        {p.siteCode ? `${p.siteCode} · ` : ""}
                        {p.siteName}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="text-slate-600 whitespace-nowrap">{p.kind}</td>
                  <td className="col-num tabular-nums text-slate-700">
                    {p.verdict.distanceM != null ? `${p.verdict.distanceM} m` : "—"}
                  </td>
                  <td>
                    <ProofBadge verdict={p.verdict} />
                  </td>
                  <td className="whitespace-nowrap">
                    <a
                      href={mapsLink(p.gpsLat, p.gpsLng)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-blue-dark hover:underline text-xs"
                    >
                      Open ↗
                    </a>
                  </td>
                </tr>
              ))}
              {points.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No GPS-tagged attendances in the last {days} days
                    {activeOfficer ? ` for ${activeOfficer}` : ""}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
