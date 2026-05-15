"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Shift = {
  id: string;
  type: string;
  status: string;
  siteName: string;
  siteId: string;
  scheduledStartsAt: string;
  scheduledEndsAt: string;
  actualStartedAt: string | null;
  checkIntervalMin: number;
  graceMinutes: number;
  lastCheckAt: string | null;
};

export function ShiftCard({
  shift,
  startShift,
  endShift,
}: {
  shift: Shift;
  startShift: (id: string) => Promise<{ ok: boolean; error?: string }>;
  endShift: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tick, setTick] = useState(0);

  // Re-render every 30s so the countdown stays fresh.
  useEffect(() => {
    if (shift.status !== "IN_PROGRESS") return;
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [shift.status]);

  const inProgress = shift.status === "IN_PROGRESS";
  const lastCheck = shift.lastCheckAt
    ? new Date(shift.lastCheckAt)
    : shift.actualStartedAt
      ? new Date(shift.actualStartedAt)
      : null;
  const nextDueMs = lastCheck
    ? lastCheck.getTime() + shift.checkIntervalMin * 60_000
    : null;
  const overdueAtMs = lastCheck
    ? lastCheck.getTime() + (shift.checkIntervalMin + shift.graceMinutes) * 60_000
    : null;
  const now = Date.now();
  const minsToNext = nextDueMs ? Math.round((nextDueMs - now) / 60000) : null;
  const overdue = overdueAtMs ? now > overdueAtMs : false;
  void tick;

  function onStart() {
    startTransition(async () => {
      await startShift(shift.id);
      router.refresh();
    });
  }
  function onEnd() {
    if (!window.confirm("End shift now?")) return;
    startTransition(async () => {
      await endShift(shift.id);
      router.refresh();
    });
  }

  return (
    <div
      className={
        "card p-4 space-y-3 " +
        (overdue
          ? "border-red-200 bg-red-50/50"
          : inProgress
            ? "border-brand-mint/40 bg-brand-mint-light/30"
            : "border-slate-200")
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">
            {shift.type.replace("_", " ").toLowerCase()}
          </div>
          <Link
            href={`/sites/${shift.siteId}`}
            className="font-medium text-brand-navy hover:text-brand-mint-dark"
          >
            {shift.siteName}
          </Link>
        </div>
        <span
          className={
            overdue
              ? "chip-red text-[10px]"
              : inProgress
                ? "chip-mint text-[10px]"
                : "chip-slate text-[10px]"
          }
        >
          {shift.status.toLowerCase().replace("_", " ")}
        </span>
      </div>

      <div className="text-xs text-slate-500">
        Scheduled {new Date(shift.scheduledStartsAt).toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
        {" → "}
        {new Date(shift.scheduledEndsAt).toLocaleString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>

      {inProgress && (
        <div
          className={
            overdue
              ? "text-sm text-red-700"
              : minsToNext != null && minsToNext < 5
                ? "text-sm text-amber-700"
                : "text-sm text-slate-700"
          }
        >
          {overdue ? (
            <>Hourly check is OVERDUE.</>
          ) : minsToNext != null ? (
            minsToNext <= 0 ? (
              <>Next check due now.</>
            ) : (
              <>Next check in {minsToNext} min.</>
            )
          ) : (
            <>Hourly check expected every {shift.checkIntervalMin} min.</>
          )}
        </div>
      )}

      <div className="flex gap-2">
        {!inProgress && shift.status === "PENDING" && (
          <button
            type="button"
            onClick={onStart}
            disabled={pending}
            className="btn-primary text-sm flex-1"
          >
            {pending ? "Starting…" : "Start shift"}
          </button>
        )}
        {inProgress && (
          <>
            <Link
              href={`/submit?siteId=${shift.siteId}&shiftId=${shift.id}`}
              className={
                "btn flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium " +
                (overdue
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-brand-navy text-white hover:bg-slate-800")
              }
            >
              Submit hourly check
            </Link>
            <button
              type="button"
              onClick={onEnd}
              disabled={pending}
              className="btn-secondary text-sm"
            >
              {pending ? "Ending…" : "End shift"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
