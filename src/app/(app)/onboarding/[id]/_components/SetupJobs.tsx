"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSetupJob, closeSetupJob } from "../../_actions";

const SETUP_JOB_TYPES = [
  { v: "SURVEY", label: "Site survey" },
  { v: "KEY_COLLECTION", label: "Key collection" },
] as const;

const TYPE_LABEL: Record<string, string> = {
  SURVEY: "Site survey",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key dropoff",
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  REVIEW_PENDING: "Review",
  APPROVED: "Approved",
  SENT_TO_CLIENT: "Sent",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

const STATUS_TONE: Record<string, string> = {
  OPEN: "chip-amber",
  ASSIGNED: "chip-amber",
  IN_PROGRESS: "chip-amber",
  SUBMITTED: "chip-amber",
  REVIEW_PENDING: "chip-amber",
  APPROVED: "chip-mint",
  SENT_TO_CLIENT: "chip-mint",
  CLOSED: "chip-mint",
  CANCELLED: "chip-red",
};

export type SetupJob = {
  id: string;
  type: string;
  status: string;
  scheduledFor: Date | null;
  completedAt: Date | null;
  notes: string | null;
  assignee: string | null;
};

export function SetupJobs({
  pipelineId,
  currentStage,
  jobs,
  officers,
}: {
  pipelineId: string;
  currentStage: string;
  jobs: SetupJob[];
  officers: { id: string; name: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<"SURVEY" | "KEY_COLLECTION">(
    currentStage === "KEY_COLLECTION" ? "KEY_COLLECTION" : "SURVEY",
  );
  const [scheduledFor, setScheduledFor] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const closed = currentStage === "CANCELLED" || currentStage === "GO_LIVE";

  function reset() {
    setScheduledFor("");
    setAssignedToUserId("");
    setNotes("");
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await addSetupJob({
        pipelineId,
        type,
        scheduledFor: scheduledFor || null,
        assignedToUserId: assignedToUserId || null,
        notes: notes || null,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed");
        return;
      }
      reset();
      setAdding(false);
      router.refresh();
    });
  }

  function close(id: string) {
    if (!confirm("Mark this job closed?")) return;
    startTransition(async () => {
      const res = await closeSetupJob(id);
      if (!res.ok) setError(res.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-brand-navy">Setup jobs</h2>
          <p className="text-sm text-slate-500">
            Officer activities tied to this onboarding — survey visits, key
            collection. Each closed job moves the work forward.
          </p>
        </div>
        {!closed && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-secondary text-sm"
          >
            + Add job
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-xl border border-slate-200 p-3 space-y-3 bg-slate-50/40">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="label">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="input"
              >
                {SETUP_JOB_TYPES.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Assign to</label>
              <select
                value={assignedToUserId}
                onChange={(e) => setAssignedToUserId(e.target.value)}
                className="input"
              >
                <option value="">— Unassigned —</option>
                {officers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name ?? "—"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Scheduled for</label>
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Notes</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input"
                placeholder="What needs doing"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="btn-primary text-sm"
            >
              {pending ? "Adding…" : "Add job"}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setAdding(false);
              }}
              className="btn-ghost text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {jobs.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No setup jobs yet. Add one to give an officer the work.
        </p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((j) => (
            <li
              key={j.id}
              className="rounded-xl border border-slate-200 p-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-brand-navy">
                    {TYPE_LABEL[j.type] ?? j.type}
                  </span>
                  <span className={STATUS_TONE[j.status] ?? "chip-slate"}>
                    {STATUS_LABEL[j.status] ?? j.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {j.assignee ? `Assigned to ${j.assignee}` : "Unassigned"}
                  {j.scheduledFor && (
                    <>
                      {" · "}
                      Scheduled{" "}
                      {j.scheduledFor.toISOString().slice(0, 16).replace("T", " ")}
                    </>
                  )}
                  {j.completedAt && (
                    <>
                      {" · "}
                      Completed{" "}
                      {j.completedAt.toISOString().slice(0, 16).replace("T", " ")}
                    </>
                  )}
                </div>
                {j.notes && (
                  <p className="text-sm text-slate-700 mt-1">{j.notes}</p>
                )}
              </div>
              {j.status !== "CLOSED" && j.status !== "CANCELLED" && !closed && (
                <button
                  type="button"
                  onClick={() => close(j.id)}
                  disabled={pending}
                  className="btn-ghost text-sm"
                >
                  Mark closed
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
