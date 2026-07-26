"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  SERVICE_OPTIONS,
  UNIT_OPTIONS,
  type RateFormState,
} from "@/lib/rateMeta";

export type { RateFormState };

/**
 * Add / update one rate (service × amount × unit). Used by both the customer
 * default rate card and the per-site override editor — the page binds the
 * owning id into `action`, so this form is scope-agnostic. Saving the same
 * service overwrites the existing rate.
 */
export function RateCardForm({
  action,
  submitLabel = "Save rate",
}: {
  action: (s: RateFormState, fd: FormData) => Promise<RateFormState>;
  submitLabel?: string;
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
      {state.ok && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Rate saved.
        </div>
      )}
      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="label" htmlFor="service">
            Service
          </label>
          <select
            id="service"
            name="service"
            defaultValue="ALARM_RESPONSE"
            className="input"
          >
            {SERVICE_OPTIONS.map((s) => (
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
            {UNIT_OPTIONS.map((u) => (
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
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor="includedMinutes">
            Included minutes
          </label>
          <input
            id="includedMinutes"
            name="includedMinutes"
            type="number"
            min="0"
            max="1440"
            className="input"
            placeholder="e.g. 60"
          />
          <p className="text-xs text-slate-500 mt-1">
            Only for per-hour work. Beyond this, excess applies.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="excessRatePerMin">
            Excess rate / minute
          </label>
          <input
            id="excessRatePerMin"
            name="excessRatePerMin"
            type="number"
            min="0"
            step="0.01"
            className="input"
            placeholder="e.g. 0.50"
          />
        </div>
        <div>
          <label className="label" htmlFor="notes">
            Notes
          </label>
          <input id="notes" name="notes" className="input" />
        </div>
      </div>
      <SubmitButton label={submitLabel} />
      <p className="text-xs text-slate-500">
        Saving the same service overwrites its rate. Excess fields are optional
        — leave blank for a flat charge.
      </p>
    </form>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary text-sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </button>
  );
}
