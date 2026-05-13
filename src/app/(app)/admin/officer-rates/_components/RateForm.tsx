"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { RateState } from "../_actions";

const SERVICES = [
  { v: "ALARM_RESPONSE", label: "Alarm response" },
  { v: "PATROL", label: "Patrol" },
  { v: "LOCKUP", label: "Lock-up" },
  { v: "UNLOCK", label: "Unlock" },
  { v: "VPI", label: "VPI" },
  { v: "KEYHOLDING", label: "Keyholding" },
  { v: "STATIC_GUARDING", label: "Static guarding" },
  { v: "DOG_HANDLER", label: "Dog handler" },
  { v: "ADHOC", label: "Ad-hoc" },
  { v: "ANNUAL_SUBSCRIPTION", label: "Monthly retainer" },
  { v: "SITE_SETUP", label: "Site setup (one-off)" },
];

const UNITS = [
  { v: "PER_VISIT", label: "per visit" },
  { v: "PER_HOUR", label: "per hour" },
  { v: "PER_MONTH", label: "per month" },
  { v: "PER_YEAR", label: "per year" },
  { v: "FIXED", label: "fixed (one-off)" },
];

export function RateForm({
  action,
  officers,
}: {
  action: (s: RateState, fd: FormData) => Promise<RateState>;
  officers: { id: string; name: string }[];
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="card p-4 space-y-3">
      {state.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </div>
      )}
      <div className="grid sm:grid-cols-2 md:grid-cols-5 gap-3">
        <div>
          <label className="label" htmlFor="officerId">
            Officer
          </label>
          <select
            id="officerId"
            name="officerId"
            defaultValue="default"
            className="input"
          >
            <option value="default">— Company default —</option>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="service">
            Service
          </label>
          <select id="service" name="service" defaultValue="ALARM_RESPONSE" className="input">
            {SERVICES.map((s) => (
              <option key={s.v} value={s.v}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="amount">
            Amount
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue=""
            className="input"
            required
          />
          {fe.amount && (
            <p className="text-xs text-red-600 mt-1">{fe.amount.join(", ")}</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="unit">
            Unit
          </label>
          <select id="unit" name="unit" defaultValue="PER_VISIT" className="input">
            {UNITS.map((u) => (
              <option key={u.v} value={u.v}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="currency">
            Currency
          </label>
          <input
            id="currency"
            name="currency"
            defaultValue="GBP"
            className="input font-mono uppercase"
            maxLength={3}
            minLength={3}
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="notes">
          Notes
        </label>
        <input id="notes" name="notes" className="input" />
      </div>
      <SubmitButton />
      <p className="text-xs text-slate-500">
        Saving with the same (officer × service) pair overwrites the existing
        rate.
      </p>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary text-sm" disabled={pending}>
      {pending ? "Saving…" : "Save rate"}
    </button>
  );
}
