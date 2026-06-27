"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import type { RecalcResult } from "../_actions";

/**
 * Scopes the recompute to the date window currently displayed on the
 * finance page (passed in via `from` / `to`). Stops a single click from
 * rebuilding billing on years of history as the row count grows.
 */
export function RecalcButton({
  recalc,
  from,
  to,
}: {
  recalc: (
    scope: "all" | "missing",
    window?: { from?: string; to?: string },
  ) => Promise<RecalcResult>;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [last, setLast] = useState<RecalcResult | null>(null);

  const rangeLabel =
    from && to
      ? `${from.slice(0, 10)} → ${to.slice(0, 10)}`
      : "all time";

  async function run(scope: "all" | "missing") {
    const ok = await confirm({
      title: scope === "all" ? "Recompute every snapshot?" : "Bill missing snapshots?",
      body:
        scope === "all"
          ? `This re-snapshots billing on every completed visit + job in ${rangeLabel}, overwriting existing values.`
          : `This bills visits + jobs in ${rangeLabel} that don't yet have a snapshot.`,
      confirmLabel: scope === "all" ? "Recompute" : "Bill missing",
      tone: scope === "all" ? "danger" : "default",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await recalc(scope, { from, to });
      setLast(r);
      const healedTail =
        r.jobsAccountBackfilled > 0
          ? ` · ${r.jobsAccountBackfilled} jobs reassigned to site owner`
          : "";
      toast.show({
        tone: "success",
        message: `${r.visitsBilled} visits · ${r.jobsBilled} jobs · ${r.shiftsBilled} shifts billed${healedTail}.`,
      });
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
          title={`Bill missing snapshots in ${rangeLabel}`}
        >
          {pending ? "Working…" : "Bill missing"}
        </button>
        <button
          type="button"
          onClick={() => run("all")}
          disabled={pending}
          className="btn-ghost text-sm"
          title={`Re-snapshot every visit + job in ${rangeLabel}`}
        >
          Recompute
        </button>
      </div>
      <p className="text-[11px] text-slate-400">
        Scope: {rangeLabel}
      </p>
      {last && (
        <p className="text-xs text-slate-500">
          {last.visitsBilled}/{last.visitsScanned} visits ·{" "}
          {last.jobsBilled}/{last.jobsScanned} jobs ·{" "}
          {last.shiftsBilled}/{last.shiftsScanned} shifts billed.
        </p>
      )}
    </div>
  );
}
