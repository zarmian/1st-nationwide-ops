"use client";

import dynamic from "next/dynamic";
import type {
  OfficerPin,
  SitePin,
  AssignmentLine,
} from "@/components/map/MapInner";

// Leaflet can't server-render — load the shared map client-side only.
const MapInner = dynamic(() => import("@/components/map/MapInner"), {
  ssr: false,
  loading: () => (
    <div
      className="card flex items-center justify-center text-sm text-slate-500"
      style={{ height: 420 }}
    >
      Loading map…
    </div>
  ),
});

/**
 * Proof-of-presence map: each attendance is an officer pin at the captured GPS
 * fix, joined to its site by a line (so the distance is visible at a glance).
 * Reuses the dispatch map component with a presence-shaped pin set.
 */
export function PresenceMap({
  points,
  sites,
  lines,
}: {
  points: OfficerPin[];
  sites: SitePin[];
  lines: AssignmentLine[];
}) {
  return (
    <MapInner
      officers={points}
      jobSites={sites}
      allSites={[]}
      lines={lines}
      layers={{ jobSites: true, allSites: false, lines: true }}
    />
  );
}
