"use client";

import { useState, useTransition } from "react";
import { dedupePatrolVisits } from "../_actions";

export function PatrolCleanupButton() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="btn-secondary text-sm"
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              "Remove duplicate patrols? Where the same site has more than one patrol at the exact same time, this keeps one and cancels the extras (only ones not yet started). Safe to run any time.",
            )
          )
            return;
          setMsg(null);
          startTransition(async () => {
            const r = await dedupePatrolVisits();
            setMsg(
              r.ok
                ? r.cancelled
                  ? `Done — ${r.cancelled} duplicate patrol${r.cancelled === 1 ? "" : "s"} cancelled across ${r.groups} slot${r.groups === 1 ? "" : "s"}.`
                  : "No duplicate patrols found."
                : r.error ?? "Clean-up failed.",
            );
          });
        }}
      >
        {pending ? "Cleaning up…" : "Clean up duplicates"}
      </button>
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
    </div>
  );
}
