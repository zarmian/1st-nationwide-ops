"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { ActivityFormState } from "../../../_actions";
import { FormError } from "@/components/FormError";

export function AssignOfficerForm({
  action,
  officers,
  initial,
}: {
  action: (
    prev: ActivityFormState,
    formData: FormData,
  ) => Promise<ActivityFormState>;
  officers: { id: string; name: string }[];
  initial: {
    partnerOfficerId: string | null;
    chargeToUs: number;
    payToOfficer: number;
    notes: string | null;
  };
}) {
  const [state, formAction] = useFormState<ActivityFormState, FormData>(
    action,
    {},
  );
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="card p-5 space-y-4">
      <FormError message={state.error} />
      {state.success && (
        <p className="text-sm text-success">{state.success}</p>
      )}

      <div>
        <label className="label" htmlFor="partnerOfficerId">
          Your officer
        </label>
        <select
          id="partnerOfficerId"
          name="partnerOfficerId"
          defaultValue={initial.partnerOfficerId ?? ""}
          className="input"
        >
          <option value="">Unassigned</option>
          {officers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {fe.partnerOfficerId?.[0] && (
          <p className="text-xs text-red-600 mt-1">
            {fe.partnerOfficerId[0]}
          </p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="chargeToUs">
            Charge to us
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
              £
            </span>
            <input
              id="chargeToUs"
              name="chargeToUs"
              type="number"
              step="0.01"
              min="0"
              defaultValue={initial.chargeToUs}
              className="input pl-7 tabular-nums"
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="payToOfficer">
            Pay to officer
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
              £
            </span>
            <input
              id="payToOfficer"
              name="payToOfficer"
              type="number"
              step="0.01"
              min="0"
              defaultValue={initial.payToOfficer}
              className="input pl-7 tabular-nums"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={initial.notes ?? ""}
          className="input"
          maxLength={2000}
        />
      </div>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
