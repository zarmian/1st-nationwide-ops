"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { ReviewActionState } from "../../_actions";

type Action = (
  state: ReviewActionState,
  formData: FormData,
) => Promise<ReviewActionState>;

export function ApproveForm({
  action,
  initialOfficer,
  initialArrivedAt,
  initialDepartedAt,
  reportable,
  toAddress,
}: {
  action: Action;
  initialOfficer: string;
  initialArrivedAt: string;
  initialDepartedAt: string;
  reportable: boolean;
  toAddress: string | null;
}) {
  const [state, formAction] = useFormState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className="label" htmlFor="officerNameRaw">
            Officer name
          </label>
          <input
            id="officerNameRaw"
            name="officerNameRaw"
            defaultValue={initialOfficer}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="arrivedAt">
            Arrived
          </label>
          <input
            id="arrivedAt"
            name="arrivedAt"
            type="datetime-local"
            defaultValue={initialArrivedAt}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="departedAt">
            Departed
          </label>
          <input
            id="departedAt"
            name="departedAt"
            type="datetime-local"
            defaultValue={initialDepartedAt}
            className="input"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="reviewerNotes">
          Internal note (optional)
        </label>
        <textarea
          id="reviewerNotes"
          name="reviewerNotes"
          rows={2}
          className="input"
          placeholder="Why you edited, anything to flag…"
        />
      </div>

      <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-600">
        {reportable ? (
          <>
            On approve, a pending client report will be queued to{" "}
            <span className="font-medium text-brand-navy">{toAddress}</span>.
          </>
        ) : (
          <>
            No client report will be created — this submission isn’t for a
            direct-customer job (partner-app job, no customer, or no customer
            email on file).
          </>
        )}
      </div>

      {state.error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <ApproveButton />
    </form>
  );
}

function ApproveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Approving…" : "Approve"}
    </button>
  );
}

export function RejectForm({ action }: { action: Action }) {
  const [state, formAction] = useFormState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label className="label" htmlFor="rejectNotes">
          Reason
        </label>
        <textarea
          id="rejectNotes"
          name="reviewerNotes"
          rows={3}
          required
          className="input"
          placeholder="What needs fixing? Visible to dispatch, not the client."
        />
      </div>
      {state.error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <RejectButton />
    </form>
  );
}

function RejectButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
    >
      {pending ? "Rejecting…" : "Reject"}
    </button>
  );
}
