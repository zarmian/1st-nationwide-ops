"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useTransition } from "react";
import type { RateFormState } from "../_actions";
import { FormError } from "@/components/FormError";

type Initial = {
  chargeToUs: number;
  payToOfficer: number;
  unit: string;
  notes: string | null;
} | null;

/**
 * One row in the rate card — one service per partner. Sits in a card
 * so the partner can scan their full rate sheet vertically without a
 * separate "add" flow. Empty rows show the same form pre-filled with
 * zeros + a chip that says "Not set".
 */
export function RateCardForm({
  service,
  label,
  initial,
  upsert,
  remove,
}: {
  service: string;
  label: string;
  initial: Initial;
  upsert: (
    prev: RateFormState,
    formData: FormData,
  ) => Promise<RateFormState>;
  remove: (() => Promise<{ ok: boolean }>) | null;
}) {
  const [state, formAction] = useFormState<RateFormState, FormData>(upsert, {});
  const fe = state.fieldErrors ?? {};
  const [removing, startRemove] = useTransition();

  return (
    <form
      action={formAction}
      className="card p-4 grid sm:grid-cols-[160px_1fr_1fr_120px_auto] gap-3 items-end"
    >
      <input type="hidden" name="service" value={service} />
      <div>
        <div className="text-xs uppercase tracking-wider text-slate-500">
          Service
        </div>
        <div className="font-medium text-brand-navy">{label}</div>
        {!initial && (
          <span className="chip-slate text-[10px] mt-0.5 inline-flex">
            Not set
          </span>
        )}
      </div>
      <div>
        <label className="label" htmlFor={`${service}-charge`}>
          Charge to us
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
            £
          </span>
          <input
            id={`${service}-charge`}
            name="chargeToUs"
            type="number"
            step="0.01"
            min="0"
            defaultValue={initial?.chargeToUs ?? 0}
            className="input pl-7 tabular-nums"
          />
        </div>
        {fe.chargeToUs?.[0] && (
          <p className="text-xs text-red-600 mt-1">{fe.chargeToUs[0]}</p>
        )}
      </div>
      <div>
        <label className="label" htmlFor={`${service}-pay`}>
          Pay to officer
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
            £
          </span>
          <input
            id={`${service}-pay`}
            name="payToOfficer"
            type="number"
            step="0.01"
            min="0"
            defaultValue={initial?.payToOfficer ?? 0}
            className="input pl-7 tabular-nums"
          />
        </div>
        {fe.payToOfficer?.[0] && (
          <p className="text-xs text-red-600 mt-1">{fe.payToOfficer[0]}</p>
        )}
      </div>
      <div>
        <label className="label" htmlFor={`${service}-unit`}>
          Unit
        </label>
        <select
          id={`${service}-unit`}
          name="unit"
          defaultValue={initial?.unit ?? "PER_VISIT"}
          className="input"
        >
          <option value="PER_VISIT">per visit</option>
          <option value="PER_HOUR">per hour</option>
          <option value="PER_MONTH">per month</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton hasExisting={!!initial} />
        {initial && remove && (
          <button
            type="button"
            disabled={removing}
            onClick={() => {
              if (!confirm(`Remove the ${label} rate?`)) return;
              startRemove(async () => {
                await remove();
              });
            }}
            className="btn-ghost text-xs text-red-600"
          >
            Remove
          </button>
        )}
      </div>
      <div className="sm:col-span-5 flex items-start justify-between gap-3">
        <FormError message={state.error} />
        {state.success && (
          <p role="status" aria-live="polite" className="text-xs text-success">
            {state.success}
          </p>
        )}
      </div>
    </form>
  );
}

function SubmitButton({ hasExisting }: { hasExisting: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-secondary text-sm" disabled={pending}>
      {pending ? "…" : hasExisting ? "Save" : "Add"}
    </button>
  );
}
