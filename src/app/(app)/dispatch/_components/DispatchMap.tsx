"use client";

import dynamic from "next/dynamic";
import type {
  OfficerPin,
  SitePin,
  AssignmentLine,
  Layers,
} from "./DispatchMapInner";

const DispatchMapInner = dynamic(() => import("./DispatchMapInner"), {
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

export function DispatchMap(props: {
  officers: OfficerPin[];
  jobSites: SitePin[];
  allSites: SitePin[];
  lines: AssignmentLine[];
  layers: Layers;
}) {
  return <DispatchMapInner {...props} />;
}
