"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { HandoverState } from "../../../keys/_actions";

export function KeySetHandoverForm({
  action,
  currentHolderId,
  recipients,
  keyCount,
}: {
  action: (s: HandoverState, fd: FormData) => Promise<HandoverState>;
  currentHolderId: string | null;
  recipients: { id: string; name: string }[];
  keyCount: number;
}) {
  const [state, formAction] = useFormState(action, {});

  return (
    <form action={formAction} className="space-y-3">
      {state.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="rounded-xl border border-brand-mint/40 bg-brand-mint-light px-3 py-2 text-sm text-brand-mint-dark">
          All {keyCount} key{keyCount === 1 ? "" : "s"} handed over.
        </div>
      )}
      <div>
        <label className="label" htmlFor="toUserId">
          Hand to
        </label>
        <select id="toUserId" name="toUserId" className="input" defaultValue="">
          <option value="">— Back to us (no holder) —</option>
          {recipients.map((r) => (
            <option
              key={r.id}
              value={r.id}
              disabled={r.id === currentHolderId}
            >
              {r.name}
              {r.id === currentHolderId ? " (current holder)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="reason">
          Reason / note
        </label>
        <input
          id="reason"
          name="reason"
          className="input"
          placeholder="e.g. for tonight's lock-up at Five Ways"
        />
      </div>
      <SubmitButton keyCount={keyCount} />
    </form>
  );
}

function SubmitButton({ keyCount }: { keyCount: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-primary text-sm w-full"
      disabled={pending || keyCount === 0}
    >
      {pending
        ? "Recording…"
        : `Hand over ${keyCount} key${keyCount === 1 ? "" : "s"}`}
    </button>
  );
}
