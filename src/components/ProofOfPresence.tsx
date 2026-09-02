import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/dates";
import { PROOF_CHIP, mapsLink, type ProofVerdict } from "@/lib/proofOfPresence";

/** Small geofence-verdict chip (On site / Outside geofence / …). */
export function ProofBadge({ verdict }: { verdict: ProofVerdict }) {
  const chip = PROOF_CHIP[verdict.status];
  return <span className={chip.chip}>{chip.label}</span>;
}

/**
 * A card summarising the officer's captured location for one attendance: the
 * geofence verdict, distance from the site, capture time, and a link to the
 * exact point on a map. Renders on job / alarm / visit detail pages.
 */
export function ProofOfPresenceCard({
  verdict,
  title = "Proof of presence",
}: {
  verdict: ProofVerdict;
  title?: string;
}) {
  const chip = PROOF_CHIP[verdict.status];
  return (
    <div className="card p-4 space-y-2">
      <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
        {title}
      </h2>

      {!verdict.hasFix ? (
        <p className="text-sm text-slate-400 italic">
          No GPS was captured for this attendance.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={chip.chip}>{chip.label}</span>
            {verdict.distanceM != null && (
              <span className="text-sm text-slate-600">
                {verdict.distanceM} m from site (target {verdict.radiusM} m)
              </span>
            )}
          </div>
          <dl className="text-sm space-y-1">
            <Row label="Captured">
              {verdict.locatedAt ? formatDateTime(verdict.locatedAt) : "—"}
            </Row>
            <Row label="Location">
              <a
                href={mapsLink(verdict.gpsLat as number, verdict.gpsLng as number)}
                target="_blank"
                rel="noreferrer"
                className="text-brand-blue-dark hover:underline font-mono text-xs"
              >
                {(verdict.gpsLat as number).toFixed(5)},{" "}
                {(verdict.gpsLng as number).toFixed(5)} ↗
              </a>
            </Row>
          </dl>
          {verdict.status === "outside" && (
            <p className="text-xs text-red-600">
              This fix is outside the site geofence — worth checking with the
              officer.
            </p>
          )}
          {verdict.status === "no_site_coords" && (
            <p className="text-xs text-amber-700">
              The site has no saved location, so distance can’t be verified. Add
              coordinates to the site to switch on the geofence check.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-slate-500 w-28 shrink-0">{label}</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  );
}
