"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startOnboarding } from "../_actions";

const PROGRAMS = [
  { v: "SHURGARD", label: "Shurgard" },
  { v: "TESCO", label: "Tesco" },
  { v: "OTHER", label: "Other" },
];

export function StartOnboardingForm({
  sites,
}: {
  sites: { id: string; name: string; code: string | null; postcodeFormatted: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [siteId, setSiteId] = useState("");
  const [program, setProgram] = useState("OTHER");
  const [targetDate, setTargetDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSiteId("");
    setProgram("OTHER");
    setTargetDate("");
    setNotes("");
    setError(null);
  }

  function submit() {
    setError(null);
    if (!siteId) {
      setError("Pick a site.");
      return;
    }
    startTransition(async () => {
      const res = await startOnboarding({
        siteId,
        program: program as "SHURGARD" | "TESCO" | "OTHER",
        targetGoLiveDate: targetDate || null,
        notes: notes || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reset();
      setOpen(false);
      router.push(`/onboarding/${res.id}`);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary"
      >
        + Start onboarding
      </button>
    );
  }

  return (
    <div className="card p-4 space-y-3 max-w-3xl">
      <h2 className="font-semibold text-brand-navy">Start onboarding</h2>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="ob_site">
            Site
          </label>
          <select
            id="ob_site"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="input"
          >
            <option value="">— Pick a site —</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} · ` : ""}
                {s.name} · {s.postcodeFormatted}
              </option>
            ))}
          </select>
          {sites.length === 0 && (
            <p className="text-xs text-slate-500 mt-1">
              All active sites already have a pipeline in progress. Add a new
              site first, or finish the existing pipelines.
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="ob_program">
            Program
          </label>
          <select
            id="ob_program"
            value={program}
            onChange={(e) => setProgram(e.target.value)}
            className="input"
          >
            {PROGRAMS.map((p) => (
              <option key={p.v} value={p.v}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ob_target">
            Target go-live (optional)
          </label>
          <input
            id="ob_target"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="ob_notes">
            Notes (optional)
          </label>
          <input
            id="ob_notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input"
            placeholder="Anything dispatch needs to know"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || sites.length === 0}
          className="btn-primary"
        >
          {pending ? "Starting…" : "Start"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="btn-ghost text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
