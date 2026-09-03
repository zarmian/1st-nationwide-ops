"use client";

import dynamic from "next/dynamic";

// Leaflet touches window, so load the actual map client-only.
const Inner = dynamic(() => import("./ProofMiniMapInner"), {
  ssr: false,
  loading: () => (
    <div
      className="grid w-full place-items-center rounded-lg bg-slate-100 text-xs text-slate-400"
      style={{ height: 180 }}
    >
      Loading map…
    </div>
  ),
});

export function ProofMiniMap(props: { lat: number; lng: number }) {
  return <Inner {...props} />;
}
