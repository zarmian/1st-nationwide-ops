"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { HandoverState } from "../../_actions";

export function HandoverForm({
  action,
  currentHolderId,
  recipients,
}: {
  action: (s: HandoverState, fd: FormData) => Promise<HandoverState>;
  currentHolderId: string | null;
  recipients: { id: string; name: string }[];
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
        <div className="rounded-xl border border-brand-blue/40 bg-brand-blue-light px-3 py-2 text-sm text-brand-blue-dark">
          Handover recorded.
        </div>
      )}
      <div>
        <label className="label" htmlFor="toUserId">
          Hand to
        </label>
        <select id="toUserId" name="toUserId" className="input" defaultValue="">
          <option value="">— Back to us (no holder) —</option>
          {recipients.map((r) => (
            <option key={r.id} value={r.id} disabled={r.id === currentHolderId}>
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
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary text-sm w-full" disabled={pending}>
      {pending ? "Recording…" : "Record handover"}
    </button>
  );
}
