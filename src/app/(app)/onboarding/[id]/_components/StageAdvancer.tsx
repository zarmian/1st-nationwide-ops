"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advanceStage } from "../../_actions";

const STAGES = [
  { v: "PROPOSED", label: "Proposed" },
  { v: "SURVEY", label: "Site survey" },
  { v: "KEY_COLLECTION", label: "Key collection" },
  { v: "GO_LIVE", label: "Live" },
] as const;

export function StageAdvancer({
  pipelineId,
  currentStage,
}: {
  pipelineId: string;
  currentStage: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (currentStage === "CANCELLED" || currentStage === "GO_LIVE") {
    return (
      <div className="card p-4">
        <div className="text-sm text-slate-700">
          Pipeline closed at{" "}
          <span className="font-medium">
            {currentStage === "GO_LIVE" ? "Live" : "Cancelled"}
          </span>
          .
        </div>
      </div>
    );
  }

  function move(toStage: string) {
    setError(null);
    startTransition(async () => {
      const res = await advanceStage({ pipelineId, toStage: toStage as any });
      if (!res.ok) {
        setError(res.error ?? "Failed");
        return;
      }
      router.refresh();
    });
  }

  function doCancel() {
    setError(null);
    if (reason.trim().length < 3) {
      setError("Add a short reason for cancelling.");
      return;
    }
    startTransition(async () => {
      const res = await advanceStage({
        pipelineId,
        toStage: "CANCELLED",
        notes: reason.trim(),
      });
      if (!res.ok) {
        setError(res.error ?? "Failed");
        return;
      }
      setCancelling(false);
      setReason("");
      router.refresh();
    });
  }

  const currentIdx = STAGES.findIndex((s) => s.v === currentStage);

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-brand-navy">Stage</h2>
        <p className="text-sm text-slate-500">
          Advance manually as setup work completes. You can also step back if
          something needs redoing.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2">
        {STAGES.map((s, i) => {
          const active = i === currentIdx;
          const done = i < currentIdx;
          return (
            <li key={s.v}>
              <button
                type="button"
                onClick={() => i !== currentIdx && move(s.v)}
                disabled={pending}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                  active
                    ? "bg-brand-navy text-white border-brand-navy"
                    : done
                      ? "bg-brand-mint-light text-brand-mint-dark border-brand-mint-light hover:bg-brand-mint hover:text-white"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                }`}
              >
                {i + 1}. {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!cancelling ? (
        <button
          type="button"
          onClick={() => setCancelling(true)}
          className="btn-ghost text-sm text-red-600"
        >
          Cancel onboarding
        </button>
      ) : (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50/40 p-3">
          <label className="label" htmlFor="cancel_reason">
            Reason
          </label>
          <textarea
            id="cancel_reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="input"
            placeholder="Why are we cancelling?"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={doCancel}
              disabled={pending}
              className="btn inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? "Cancelling…" : "Confirm cancel"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCancelling(false);
                setReason("");
              }}
              className="btn-ghost text-sm"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
