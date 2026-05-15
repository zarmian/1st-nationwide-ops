"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RecalcResult } from "../_actions";

export function RecalcButton({
  recalc,
}: {
  recalc: (scope: "all" | "missing") => Promise<RecalcResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [last, setLast] = useState<RecalcResult | null>(null);

  function run(scope: "all" | "missing") {
    const confirmText =
      scope === "all"
        ? "Recompute billing for EVERY completed visit and job (overwrites existing snapshots)?"
        : "Bill all visits and jobs that don't yet have a snapshot?";
    if (!window.confirm(confirmText)) return;
    startTransition(async () => {
      const r = await recalc(scope);
      setLast(r);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => run("missing")}
          disabled={pending}
          className="btn-secondary text-sm"
        >
          {pending ? "Working…" : "Bill missing"}
        </button>
        <button
          type="button"
          onClick={() => run("all")}
          disabled={pending}
          className="btn-ghost text-sm"
        >
          Recompute all
        </button>
      </div>
      {last && (
        <p className="text-xs text-slate-500">
          {last.visitsBilled}/{last.visitsScanned} visits ·{" "}
          {last.jobsBilled}/{last.jobsScanned} jobs billed.
        </p>
      )}
    </div>
  );
}
