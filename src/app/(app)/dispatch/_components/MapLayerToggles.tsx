"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronDown } from "lucide-react";

type LayerKey = "jobs" | "sites" | "lines";

const LABELS: Record<LayerKey, string> = {
  jobs: "Sites with live jobs",
  sites: "All active sites",
  lines: "Lines to next assignment",
};

/**
 * Map overlay picker — a compact dropdown of checkboxes rather than a row of
 * pills, so it stays out of the way until the user wants it. Each toggle
 * writes the `layers` search param; an empty value means "everything off on
 * purpose" (vs. absent = page defaults).
 */
export function MapLayerToggles({ active }: { active: Set<LayerKey> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function toggle(key: LayerKey) {
    const next = new Set(active);
    if (next.has(key)) next.delete(key);
    else next.add(key);

    const params = new URLSearchParams(searchParams.toString());
    if (next.size === 0) {
      params.set("layers", "");
    } else {
      params.set("layers", Array.from(next).join(","));
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/dispatch?${qs}` : "/dispatch", { scroll: false });
    });
  }

  return (
    <details className="relative inline-block">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-brand-blue-300 hover:bg-brand-blue-50 [&::-webkit-details-marker]:hidden">
        <span className="uppercase tracking-wider text-slate-500">
          Map overlays
        </span>
        <span className="rounded-full bg-brand-blue-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-brand-blue-dark">
          {active.size}
        </span>
        <ChevronDown size={14} className="text-slate-400" aria-hidden />
      </summary>
      <div className="absolute left-0 z-30 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
        {(Object.keys(LABELS) as LayerKey[]).map((key) => {
          const on = active.has(key);
          return (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-brand-navy hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(key)}
                disabled={pending}
                className="checkbox"
              />
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: on ? "#3B82F6" : "#cbd5e1" }}
                aria-hidden
              />
              <span>{LABELS[key]}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}
