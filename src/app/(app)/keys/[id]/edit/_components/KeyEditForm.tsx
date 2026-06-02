"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import type { KeyUpdateState } from "../../../_actions";

const TYPE_OPTIONS = [
  { v: "KEY", label: "Key" },
  { v: "PADLOCK", label: "Padlock" },
  { v: "FOB", label: "Fob" },
  { v: "CARD", label: "Card" },
  { v: "CODE", label: "Code" },
  { v: "REMOTE", label: "Remote" },
  { v: "OTHER", label: "Other" },
];

const STATUS_OPTIONS = [
  { v: "WITH_US", label: "With us" },
  { v: "WITH_OFFICER", label: "With officer" },
  { v: "WITH_CUSTOMER", label: "With customer" },
  { v: "LOST", label: "Lost" },
  { v: "RETIRED", label: "Retired" },
];

export function KeyEditForm({
  action,
  initial,
  cancelHref,
}: {
  action: (state: KeyUpdateState, fd: FormData) => Promise<KeyUpdateState>;
  initial: {
    label: string;
    internalNo: string | null;
    type: string;
    status: string;
    notes: string | null;
    duplicable: boolean;
  };
  cancelHref: string;
}) {
  const [state, formAction] = useFormState(action, {});

  return (
    <form action={formAction} className="card p-5 space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="label">Label</label>
          <input
            id="label"
            name="label"
            defaultValue={initial.label}
            required
            maxLength={120}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="internalNo">Internal no.</label>
          <input
            id="internalNo"
            name="internalNo"
            defaultValue={initial.internalNo ?? ""}
            maxLength={60}
            className="input"
            placeholder="e.g. K-0042"
          />
        </div>
        <div>
          <label className="label" htmlFor="type">Type</label>
          <select id="type" name="type" defaultValue={initial.type} className="input">
            {TYPE_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select
            id="status"
            name="status"
            defaultValue={initial.status}
            className="input"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="notes">Notes</label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={initial.notes ?? ""}
          maxLength={2000}
          rows={4}
          className="input"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="duplicable"
          defaultChecked={initial.duplicable}
        />
        <span>Duplicable (we can have copies cut)</span>
      </label>

      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {state?.ok && (
        <p className="text-sm text-brand-mint-dark">Saved.</p>
      )}

      <div className="flex items-center gap-2 justify-end">
        <Link href={cancelHref} className="btn-ghost text-sm">Cancel</Link>
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary text-sm">
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
