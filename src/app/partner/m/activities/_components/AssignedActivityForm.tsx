"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { CompletionFormState } from "../_actions";
import { FormError } from "@/components/FormError";

export type AssignedActivityInitial =
  | {
      kind: "JOB";
      arrivedAt: string | null;
      departedAt: string | null;
      notes: string | null;
    }
  | {
      kind: "SHIFT";
      startedAt: string | null;
      endedAt: string | null;
      notes: string | null;
    };

/**
 * Single form for the two variants. Job → arrived/departed.
 * Shift → started/ended. Both share notes. Officer can't change site,
 * customer, type, or the rate snapshots — those are partner-admin
 * fields enforced by the server action's where clause.
 */
export function AssignedActivityForm({
  action,
  kind,
  initial,
}: {
  action: (
    prev: CompletionFormState,
    formData: FormData,
  ) => Promise<CompletionFormState>;
  kind: "JOB" | "SHIFT";
  initial: AssignedActivityInitial;
}) {
  const [state, formAction] = useFormState<CompletionFormState, FormData>(
    action,
    {},
  );
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="card p-4 space-y-4">
      <input type="hidden" name="kind" value={kind} />
      <FormError message={state.error} />
      {state.success && (
        <p className="text-sm text-success">{state.success}</p>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {kind === "JOB" && initial.kind === "JOB" ? (
          <>
            <div>
              <label className="label" htmlFor="arrivedAt">
                Arrived at site
              </label>
              <input
                id="arrivedAt"
                name="arrivedAt"
                type="datetime-local"
                defaultValue={initial.arrivedAt ?? ""}
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor="departedAt">
                Departed site
              </label>
              <input
                id="departedAt"
                name="departedAt"
                type="datetime-local"
                defaultValue={initial.departedAt ?? ""}
                className="input"
              />
              {fe.departedAt?.[0] && (
                <p className="text-xs text-red-600 mt-1">{fe.departedAt[0]}</p>
              )}
            </div>
          </>
        ) : initial.kind === "SHIFT" ? (
          <>
            <div>
              <label className="label" htmlFor="startedAt">
                Actually started
              </label>
              <input
                id="startedAt"
                name="startedAt"
                type="datetime-local"
                defaultValue={initial.startedAt ?? ""}
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor="endedAt">
                Actually ended
              </label>
              <input
                id="endedAt"
                name="endedAt"
                type="datetime-local"
                defaultValue={initial.endedAt ?? ""}
                className="input"
              />
              {fe.endedAt?.[0] && (
                <p className="text-xs text-red-600 mt-1">{fe.endedAt[0]}</p>
              )}
            </div>
          </>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={initial.notes ?? ""}
          rows={4}
          className="input"
          maxLength={2000}
          placeholder="Anything to flag — partial coverage, issues on site, hand-over."
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
