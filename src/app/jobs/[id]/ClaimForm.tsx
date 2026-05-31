"use client";

import { useState, useTransition } from "react";
import { claimJob } from "../_actions";

export function ClaimForm({ jobId }: { jobId: string }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }
    startTransition(async () => {
      const res = await claimJob({ jobId, officerName: name.trim() });
      // On success the action redirects; we only land here on error.
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="card p-4 space-y-3">
      <div>
        <label className="label" htmlFor="claim-name">
          Your full name
        </label>
        <input
          id="claim-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Joe Bloggs"
          className="input"
          autoComplete="name"
          autoCapitalize="words"
          required
        />
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Claiming…" : "Claim & start report"}
      </button>
      <p className="text-xs text-slate-500 text-center">
        Once you claim, the job is yours and you'll be taken to the report form.
      </p>
    </form>
  );
}
