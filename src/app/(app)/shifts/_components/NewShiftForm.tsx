"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import type { ShiftFormState } from "../_actions";

const TYPES = [
  { v: "STATIC_GUARDING", label: "Static guarding" },
  { v: "DOG_HANDLER", label: "Dog handler" },
];

export function NewShiftForm({
  action,
  sites,
  officers,
}: {
  action: (s: ShiftFormState, fd: FormData) => Promise<ShiftFormState>;
  sites: { id: string; name: string; code: string | null; postcodeFormatted: string }[];
  officers: { id: string; name: string }[];
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-6 max-w-2xl">
      {state.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Basics</h2>

        <div>
          <label className="label" htmlFor="siteId">
            Site <span className="text-red-500">*</span>
          </label>
          <select id="siteId" name="siteId" className="input" required defaultValue="">
            <option value="">— pick a site —</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} · ` : ""}
                {s.name} · {s.postcodeFormatted}
              </option>
            ))}
          </select>
          {fe.siteId && (
            <p className="text-xs text-red-600 mt-1">{fe.siteId.join(", ")}</p>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="type">
              Type
            </label>
            <select id="type" name="type" className="input" defaultValue="STATIC_GUARDING">
              {TYPES.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="officerId">
              Officer
            </label>
            <select id="officerId" name="officerId" className="input" defaultValue="">
              <option value="">— unassigned —</option>
              {officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="scheduledStartsAt">
              Starts <span className="text-red-500">*</span>
            </label>
            <input
              id="scheduledStartsAt"
              name="scheduledStartsAt"
              type="datetime-local"
              className="input"
              required
            />
            {fe.scheduledStartsAt && (
              <p className="text-xs text-red-600 mt-1">{fe.scheduledStartsAt.join(", ")}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="scheduledEndsAt">
              Ends <span className="text-red-500">*</span>
            </label>
            <input
              id="scheduledEndsAt"
              name="scheduledEndsAt"
              type="datetime-local"
              className="input"
              required
            />
            {fe.scheduledEndsAt && (
              <p className="text-xs text-red-600 mt-1">{fe.scheduledEndsAt.join(", ")}</p>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="checkIntervalMin">
              Check every (minutes)
            </label>
            <input
              id="checkIntervalMin"
              name="checkIntervalMin"
              type="number"
              min={5}
              max={720}
              defaultValue={60}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="graceMinutes">
              Grace (minutes)
            </label>
            <input
              id="graceMinutes"
              name="graceMinutes"
              type="number"
              min={0}
              max={120}
              defaultValue={15}
              className="input"
            />
            <p className="text-xs text-slate-500 mt-1">
              Dispatcher alerted after interval + grace.
            </p>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="notes">
            Notes
          </label>
          <textarea id="notes" name="notes" rows={3} className="input" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
        <Link href="/shifts" className="btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Creating…" : "Create shift"}
    </button>
  );
}
