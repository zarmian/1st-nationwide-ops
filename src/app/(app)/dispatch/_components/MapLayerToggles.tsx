"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type LayerKey = "jobs" | "sites" | "lines";

const LABELS: Record<LayerKey, string> = {
  jobs: "Sites with live jobs",
  sites: "All active sites",
  lines: "Lines to next assignment",
};

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
      // Don't delete — that would re-enable the page's defaults.
      // Empty value signals "user turned everything off on purpose".
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
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-slate-500 mr-1">
        Map overlays:
      </span>
      {(Object.keys(LABELS) as LayerKey[]).map((key) => {
        const on = active.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            disabled={pending}
            className={
              "rounded-full px-3 py-1 text-xs font-medium border transition-colors " +
              (on
                ? "bg-brand-blue-light text-brand-blue-dark border-brand-blue/40"
                : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50")
            }
            aria-pressed={on}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
              style={{ background: on ? "#3B82F6" : "#cbd5e1" }}
            />
            {LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
