"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { SitePin } from "@/components/map/MapInner";

const MapInner = dynamic(() => import("@/components/map/MapInner"), {
  ssr: false,
  loading: () => (
    <div
      className="card flex items-center justify-center text-sm text-slate-500"
      style={{ height: 380 }}
    >
      Loading map…
    </div>
  ),
});

export type OwnerLegend = {
  key: string;
  label: string;
  hex: string;
  count: number;
};

/**
 * Sites map for /sites. Renders the shared MapInner with sites only —
 * no officers, no live-job overlay, no lines — and adds a checkbox
 * legend so the user can toggle customer/partner groups on and off.
 *
 * State is client-side only. URL search params on /sites still filter
 * the underlying dataset (search, region, service, type); this filter
 * just hides/shows pins within whatever the page already loaded.
 */
export function SitesMap({
  pins,
  legend,
}: {
  pins: SitePin[];
  legend: OwnerLegend[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => pins.filter((p) => !hidden.has(p.ownerKey ?? "_none")),
    [pins, hidden],
  );

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allHidden = hidden.size === legend.length && legend.length > 0;
  const noneHidden = hidden.size === 0;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-brand-navy">Map</h2>
        <p className="text-xs text-slate-500">
          {visible.length} of {pins.length} site
          {pins.length === 1 ? "" : "s"} with coordinates
        </p>
      </div>

      {legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {legend.map((g) => {
            const isOff = hidden.has(g.key);
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => toggle(g.key)}
                aria-pressed={!isOff}
                className={
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition " +
                  (isOff
                    ? "bg-slate-50 border-slate-200 text-slate-400"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50")
                }
                title={
                  isOff
                    ? `Show ${g.label} sites`
                    : `Hide ${g.label} sites`
                }
              >
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{
                    background: g.hex,
                    opacity: isOff ? 0.25 : 1,
                  }}
                />
                <span className="font-medium">{g.label}</span>
                <span
                  className={
                    "tabular-nums " + (isOff ? "text-slate-400" : "text-slate-500")
                  }
                >
                  {g.count}
                </span>
              </button>
            );
          })}
          {!noneHidden && (
            <button
              type="button"
              onClick={() => setHidden(new Set())}
              className="text-xs text-brand-blue-dark hover:underline ml-1"
            >
              Show all
            </button>
          )}
          {!allHidden && legend.length > 1 && (
            <button
              type="button"
              onClick={() => setHidden(new Set(legend.map((g) => g.key)))}
              className="text-xs text-slate-500 hover:underline"
            >
              Hide all
            </button>
          )}
        </div>
      )}

      <MapInner
        officers={[]}
        jobSites={[]}
        allSites={visible}
        lines={[]}
        layers={{ jobSites: false, allSites: true, lines: false }}
        height={380}
      />
    </div>
  );
}
