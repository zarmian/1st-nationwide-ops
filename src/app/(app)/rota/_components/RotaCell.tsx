"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { assignToRota, unassignFromRota } from "../_actions";
import type { Availability, RotaPatrolCode, RotaShiftCode } from "@/lib/rota";

type Assigned = { id: string; officerId: string; officerName: string };

export type PickableOfficer = {
  id: string;
  name: string;
  /** How far the halves they marked on My rota cover this shift. */
  availability: Availability;
  /** e.g. "day only" when they marked one half of a 24-hour shift. */
  note: string | null;
};

const GROUPS: { key: Availability; title: string }[] = [
  { key: "full", title: "Available" },
  { key: "partial", title: "Partly available" },
  { key: "none", title: "Not marked available" },
];

/**
 * One shift on the rota board: one patrol, one day, one shift. Shows the
 * officers already on it as removable chips, plus a picker of everyone who
 * can still be added, the ones who marked themselves available first.
 */
export function RotaCell({
  date,
  patrol,
  shift,
  patrolLabel,
  shiftLabel,
  hours,
  assigned,
  pickable,
}: {
  date: string;
  patrol: RotaPatrolCode;
  shift: RotaShiftCode;
  patrolLabel: string;
  shiftLabel: string;
  hours: string;
  assigned: Assigned[];
  pickable: PickableOfficer[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [showPicker, setShowPicker] = useState(false);
  const where = `${patrolLabel}, ${shiftLabel.toLowerCase()}`;

  function handleAssign(officerId: string, officerName: string) {
    startTransition(async () => {
      const res = await assignToRota({ date, patrol, shift, officerId });
      if (res.ok) {
        toast.show({ tone: "success", message: `${officerName} is on ${where}` });
        setShowPicker(false);
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't add them" });
      }
    });
  }

  function handleRemove(assignmentId: string, officerName: string) {
    startTransition(async () => {
      const res = await unassignFromRota({ assignmentId });
      if (res.ok) {
        toast.show({ tone: "success", message: `${officerName} taken off ${where}` });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't remove them" });
      }
    });
  }

  const availableCount = pickable.filter((p) => p.availability === "full").length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr_auto] gap-2 sm:gap-3 items-start py-1.5">
      <div className="pt-1">
        <div className="text-sm font-medium text-brand-navy">{patrolLabel}</div>
        <div className="text-xs text-slate-500">
          {shiftLabel} · {hours}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {assigned.length === 0 ? (
          <span className="text-xs text-slate-400 italic pt-1">No one on</span>
        ) : (
          assigned.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 chip-mint text-xs">
              {a.officerName}
              <button
                type="button"
                onClick={() => handleRemove(a.id, a.officerName)}
                disabled={pending}
                aria-label={`Take ${a.officerName} off ${where}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-50"
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
            <div
              className="rounded-xl border border-slate-200 bg-white shadow-card p-1 min-w-[200px] max-h-64 overflow-y-auto overscroll-contain"
              role="group"
              aria-label={`Add an officer to ${where}`}
            >
              {pickable.length === 0 ? (
                <p className="text-xs text-slate-500 italic px-2 py-1">
                  No one free for this shift
                </p>
              ) : (
                GROUPS.map((g) => {
                  const list = pickable.filter((p) => p.availability === g.key);
                  if (list.length === 0) return null;
                  return (
                    <div key={g.key} className="py-0.5">
                      <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                        {g.title}
                      </div>
                      {list.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleAssign(p.id, p.name)}
                          disabled={pending}
                          className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-brand-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-50"
                        >
                          {p.name}
                          {p.note && (
                            <span className="ml-1 text-[10px] text-slate-500">· {p.note}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowPicker(false)}
              aria-label="Close"
              className="text-xs text-slate-500 hover:text-brand-navy pt-1 px-1"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            disabled={pending || pickable.length === 0}
            aria-label={`Add an officer to ${where}`}
            className="text-xs text-brand-blue-dark hover:text-brand-navy underline disabled:text-slate-400 disabled:no-underline whitespace-nowrap py-1"
          >
            + Add
            {availableCount > 0 && (
              <span className="ml-1 text-slate-500">({availableCount} available)</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
