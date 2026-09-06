"use client";

import { useState, useTransition } from "react";
import { consolidateBonlineCalls } from "../_actions";

export function CleanupButton() {
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
              "Merge duplicate call rows? This groups each call's legs into a single row. Safe to run any time.",
            )
          )
            return;
          setMsg(null);
          startTransition(async () => {
            const r = await consolidateBonlineCalls();
            setMsg(
              r.ok
                ? `Done — ${r.groups} call${r.groups === 1 ? "" : "s"}, ${r.removed} duplicate row${r.removed === 1 ? "" : "s"} removed.`
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
