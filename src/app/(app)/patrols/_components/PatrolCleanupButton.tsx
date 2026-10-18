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
              "Remove duplicate patrols? Where the same site has more than one patrol at the exact same time, this keeps one and cancels the extras (only ones not yet started). It also merges this month's Nexus copies of patrols on our schedule into the patrol itself. Safe to run any time.",
            )
          )
            return;
          setMsg(null);
          startTransition(async () => {
            const r = await dedupePatrolVisits();
            if (!r.ok) {
              setMsg(r.error ?? "Clean-up failed.");
              return;
            }
            const parts: string[] = [];
            if (r.cancelled) {
              parts.push(
                `${r.cancelled} duplicate patrol${r.cancelled === 1 ? "" : "s"} cancelled across ${r.groups} slot${r.groups === 1 ? "" : "s"}`,
              );
            }
            if (r.nexusMerged) {
              parts.push(
                `${r.nexusMerged} Nexus cop${r.nexusMerged === 1 ? "y" : "ies"} merged into our patrols`,
              );
            }
            if (r.nexusKept) {
              parts.push(
                `${r.nexusKept} Nexus cop${r.nexusKept === 1 ? "y" : "ies"} left for you to check (marked ⚠)`,
              );
            }
            setMsg(parts.length ? `Done — ${parts.join("; ")}.` : "No duplicate patrols found.");
          });
        }}
      >
        {pending ? "Cleaning up…" : "Clean up duplicates"}
      </button>
      <span className="text-xs text-slate-600" role="status" aria-live="polite">
        {msg}
      </span>
    </div>
  );
}
