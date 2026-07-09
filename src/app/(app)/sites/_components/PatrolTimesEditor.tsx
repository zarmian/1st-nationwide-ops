"use client";

import { useState } from "react";
import { Plus, Wand2, X } from "lucide-react";

/**
 * Editor for a day's list of patrol times. Two ways to fill it:
 *  - add/edit individual times (handles irregular patterns), or
 *  - the "evenly spaced" generator: a start time, every N hours, K patrols —
 *    e.g. 22:00 every 3h ×3 → 22:00, 01:00, 04:00.
 *
 * Times that run past midnight are fine: the schedule stores them in order and
 * the materialiser rolls them onto the next day while grouping them under the
 * night they started. Empty list → the site falls back to the kind default.
 */

function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function fmt(totalMin: number): string {
  const wrapped = ((totalMin % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function PatrolTimesEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (times: string[]) => void;
}) {
  const [start, setStart] = useState("22:00");
  const [everyHours, setEveryHours] = useState("3");
  const [count, setCount] = useState("3");

  const times = value ?? [];

  function setAt(i: number, t: string) {
    onChange(times.map((v, idx) => (idx === i ? t : v)));
  }
  function removeAt(i: number) {
    onChange(times.filter((_, idx) => idx !== i));
  }
  function addTime() {
    onChange([...times, ""]);
  }

  function generate() {
    const s = toMinutes(start);
    const every = Number.parseFloat(everyHours);
    const k = Number.parseInt(count, 10);
    if (s == null || !Number.isFinite(every) || every <= 0 || !Number.isFinite(k) || k <= 0) {
      return;
    }
    const step = Math.round(every * 60);
    const out: string[] = [];
    for (let i = 0; i < Math.min(k, 24); i++) out.push(fmt(s + i * step));
    onChange(out);
  }

  return (
    <div className="space-y-2">
      <label className="block text-[11px] uppercase tracking-wider text-slate-500">
        Patrol times (UK)
      </label>

      {times.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {times.map((t, i) => (
            <div
              key={i}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white pl-2 pr-1 py-1"
            >
              <span className="text-[11px] text-slate-400 tabular-nums">
                {i + 1}
              </span>
              <input
                type="time"
                className="w-[92px] border-0 p-0 text-sm text-slate-700 focus:outline-none focus:ring-0"
                value={t}
                onChange={(e) => setAt(i, e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                title="Remove time"
                aria-label="Remove time"
                className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          No times yet — add one, or use the generator below (defaults to the
          nightly patrol time if left empty).
        </p>
      )}

      <button
        type="button"
        onClick={addTime}
        className="inline-flex items-center gap-1 text-xs text-brand-blue-dark hover:text-brand-navy"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add time
      </button>

      {/* Evenly-spaced generator */}
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 flex flex-wrap items-end gap-2 text-sm">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
            Start
          </label>
          <input
            type="time"
            className="input py-1 w-[104px]"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
            Every (hrs)
          </label>
          <input
            type="number"
            min="0.5"
            step="0.5"
            className="input py-1 w-[80px]"
            value={everyHours}
            onChange={(e) => setEveryHours(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
            Patrols
          </label>
          <input
            type="number"
            min="1"
            max="24"
            className="input py-1 w-[72px]"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={generate}
          title="Replace the list with evenly-spaced times"
          className="inline-flex items-center gap-1 btn-secondary text-xs py-1.5"
        >
          <Wand2 className="h-3.5 w-3.5" aria-hidden /> Generate
        </button>
      </div>
    </div>
  );
}
