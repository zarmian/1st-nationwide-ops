"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { OfficerFormState } from "../_actions";
import { FormError } from "@/components/FormError";

export type PartnerOfficerInitial = {
  id?: string;
  name: string;
  phone: string | null;
  siaNumber: string | null;
  notes: string | null;
  active: boolean;
};

export function PartnerOfficerForm({
  action,
  initial,
  submitLabel,
}: {
  action: (
    prev: OfficerFormState,
    formData: FormData,
  ) => Promise<OfficerFormState>;
  initial: PartnerOfficerInitial;
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="card p-5 space-y-4">
      <FormError message={state.error} />

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="name">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="name"
            name="name"
            defaultValue={initial.name}
            className="input"
            required
            maxLength={120}
          />
          {fe.name?.[0] && (
            <p className="text-xs text-red-600 mt-1">{fe.name[0]}</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={initial.phone ?? ""}
            className="input"
            maxLength={40}
            autoComplete="tel"
          />
        </div>
        <div>
          <label className="label" htmlFor="siaNumber">
            SIA number
          </label>
          <input
            id="siaNumber"
            name="siaNumber"
            defaultValue={initial.siaNumber ?? ""}
            className="input"
            maxLength={40}
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              name="active"
              defaultChecked={initial.active}
              className="checkbox"
            />
            <span>Active</span>
          </label>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={initial.notes ?? ""}
          rows={3}
          className="input"
          maxLength={1000}
          placeholder="Anything you want to remember — preferred shifts, gear, contact preferences."
        />
      </div>

      <SubmitButton label={submitLabel} />
    </form>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : label}
    </button>
  );
}
