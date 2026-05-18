"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GeocodeActionResult } from "../_actions";

export function GeocodePanel({
  missing,
  geocode,
}: {
  missing: number;
  geocode: () => Promise<GeocodeActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<GeocodeActionResult | null>(null);

  function onClick() {
    startTransition(async () => {
      const r = await geocode();
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="card p-5 space-y-3">
      <div>
        <h2 className="font-semibold text-brand-navy">
          Geocode existing sites
        </h2>
        <p className="text-sm text-slate-500">
          Sites without coordinates won't appear on the dispatch map. We look
          them up by postcode using{" "}
          <a
            href="https://postcodes.io"
            target="_blank"
            rel="noreferrer"
            className="text-brand-mint-dark hover:underline"
          >
            postcodes.io
          </a>{" "}
          — free, UK-only, no key needed. Re-runs are safe.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClick}
          disabled={missing === 0 || pending}
          className={
            missing === 0
              ? "btn-primary text-sm opacity-50 cursor-not-allowed"
              : "btn-primary text-sm"
          }
        >
          {pending
            ? "Geocoding…"
            : missing === 0
              ? "All sites have coordinates"
              : `Geocode ${missing.toLocaleString("en-GB")} site${missing === 1 ? "" : "s"}`}
        </button>
        <span className="text-xs text-slate-500">
          {missing.toLocaleString("en-GB")} missing coordinates
        </span>
      </div>

      {result && !result.ok && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {result.error}
        </div>
      )}

      {result?.ok && (
        <div className="rounded-xl border border-brand-mint/40 bg-brand-mint-light p-3 text-sm space-y-1">
          <div className="text-brand-mint-dark font-medium">
            Geocoded {result.geocoded.toLocaleString("en-GB")} of{" "}
            {result.scanned.toLocaleString("en-GB")}.
          </div>
          {result.failed > 0 && (
            <div className="text-slate-700">
              {result.failed.toLocaleString("en-GB")} postcode
              {result.failed === 1 ? "" : "s"} didn't resolve — usually invalid
              or non-UK. Fix and re-run.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
