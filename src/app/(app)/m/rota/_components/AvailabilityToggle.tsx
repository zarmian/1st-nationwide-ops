"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { setMyAvailability } from "../../../rota/_actions";

/**
 * One toggle button on /m/rota — represents a single (date, half) slot:
 * Day (09:00–18:00) or Night (18:00–09:00). Optimistic UI flips
 * immediately; the server action persists the OfficerAvailability row.
 *
 * If the office has already put the officer on a rota shift that takes
 * this half (North Mobile's 24 hours take both), we show the patrol as a
 * chip and disable the toggle — removing yourself from a confirmed rota
 * is intentionally not a self-service action.
 */
export function AvailabilityToggle({
  date,
  shift,
  initialAvailable,
  assignedTo,
}: {
  date: string;
  shift: "DAY" | "NIGHT";
  initialAvailable: boolean;
  /** Patrols the officer is already on for this half. */
  assignedTo: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [available, setAvailable] = useState(initialAvailable);

  const locked = assignedTo.length > 0;

  function onToggle() {
    if (locked) return;
    const next = !available;
    setAvailable(next); // optimistic
    startTransition(async () => {
      const res = await setMyAvailability({
        date,
        shift,
        available: next,
      });
      if (!res.ok) {
        setAvailable(!next); // revert
        toast.show({
          tone: "error",
          message: res.error ?? "Couldn't update availability",
        });
      } else {
        router.refresh();
      }
    });
  }

  const label = shift === "DAY" ? "Day" : "Night";

  if (locked) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="chip-mint text-[10px]">
          {[...new Set(assignedTo)].join(", ")}
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      className={
        "px-3 py-1.5 rounded-xl text-sm font-medium transition border " +
        (available
          ? "bg-brand-blue text-white border-brand-blue hover:bg-brand-blue-dark"
          : "bg-white text-slate-600 border-slate-300 hover:border-brand-blue-dark hover:text-brand-navy")
      }
      aria-pressed={available}
      aria-label={`${label}, ${shift === "DAY" ? "09:00 to 18:00" : "18:00 to 09:00"}`}
    >
      {label}
      <span className="block text-[10px] leading-none mt-0.5">
        {available ? "Available" : "Tap to add"}
      </span>
    </button>
  );
}
