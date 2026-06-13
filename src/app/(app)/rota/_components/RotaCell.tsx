"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { assignToRota, unassignFromRota } from "../_actions";

type Assigned = { id: string; officerId: string; officerName: string };
type Pickable = { id: string; name: string; homeRegion: boolean };

/**
 * One row of the rota board — one region, one (date, shift). Shows the
 * officers already assigned as removable chips, plus an inline picker
 * of officers who are available for the same date+shift but not yet
 * placed in any region.
 */
export function RotaCell({
  regionName,
  regionId,
  date,
  shift,
  assigned,
  pickable,
}: {
  regionName: string;
  regionId: number;
  date: string;
  shift: "DAY" | "NIGHT";
  assigned: Assigned[];
  pickable: Pickable[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [showPicker, setShowPicker] = useState(false);

  function handleAssign(officerId: string, officerName: string) {
    startTransition(async () => {
      const res = await assignToRota({ date, shift, regionId, officerId });
      if (res.ok) {
        toast.show({
          tone: "success",
          message: `${officerName} added to ${regionName} ${shift.toLowerCase()}`,
        });
        setShowPicker(false);
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't assign" });
      }
    });
  }

  function handleRemove(assignmentId: string, officerName: string) {
    startTransition(async () => {
      const res = await unassignFromRota({ assignmentId });
      if (res.ok) {
        toast.show({
          tone: "success",
          message: `${officerName} removed from rota`,
        });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't remove" });
      }
    });
  }

  // Sort pickable so the officers whose home region matches come first.
  const sortedPickable = [...pickable].sort((a, b) => {
    if (a.homeRegion !== b.homeRegion) return a.homeRegion ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="grid grid-cols-[140px_1fr_auto] gap-3 items-start py-1.5">
      <div className="text-sm font-medium text-brand-navy pt-1">
        {regionName}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {assigned.length === 0 ? (
          <span className="text-xs text-slate-400 italic pt-1">
            No one assigned
          </span>
        ) : (
          assigned.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 chip-mint text-xs"
            >
              {a.officerName}
              <button
                type="button"
                onClick={() => handleRemove(a.id, a.officerName)}
                disabled={pending}
                aria-label={`Remove ${a.officerName}`}
                className="hover:text-red-700 disabled:opacity-50"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <div className="relative">
        {showPicker ? (
          <div className="flex items-start gap-2">
            <div className="rounded-xl border border-slate-200 bg-white shadow-card p-1 min-w-[180px] max-h-48 overflow-y-auto">
              {sortedPickable.length === 0 ? (
                <p className="text-xs text-slate-500 italic px-2 py-1">
                  No one available
                </p>
              ) : (
                sortedPickable.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleAssign(p.id, p.name)}
                    disabled={pending}
                    className="w-full text-left px-2 py-1 text-xs rounded hover:bg-brand-blue-50 disabled:opacity-50"
                  >
                    {p.name}
                    {p.homeRegion && (
                      <span className="ml-1 text-[10px] text-brand-blue-dark">
                        · home
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowPicker(false)}
              className="text-xs text-slate-500 hover:text-brand-navy pt-1"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            disabled={pending || pickable.length === 0}
            className="text-xs text-brand-blue-dark hover:text-brand-navy underline disabled:text-slate-400 disabled:no-underline whitespace-nowrap"
          >
            + Add
            {pickable.length > 0 && (
              <span className="ml-1 text-slate-500">
                ({pickable.length})
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
