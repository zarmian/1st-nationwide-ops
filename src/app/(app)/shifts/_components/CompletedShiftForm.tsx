"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import type { ShiftFormState } from "../_actions";
import { FormError } from "@/components/FormError";

const TYPES = [
  { v: "STATIC_GUARDING", label: "Static guarding" },
  { v: "DOG_HANDLER", label: "Dog handler" },
];

export type CompletedShiftFormInitial = {
  siteId: string;
  type: string;
  startedAt: string;
  endedAt: string;
  notes: string | null;
};

/**
 * Staff-side "Record completed shift" form. Same baseline fields as the
 * scheduled-shift form but anchored on actual times and with a
 * handler-kind toggle — same UX as /dispatch/callouts/new lets admin
 * pick "Our officer" or "Partner" for who actually attended.
 *
 * When Partner is picked, the partner's officer is NOT chosen here —
 * the partner will assign one of their own (private) officers on
 * /partner/activities. We only stamp the handler partnerId so the row
 * surfaces on their portal as "1NW logged".
 */
export function CompletedShiftForm({
  action,
  sites,
  officers,
  partners,
  initial,
}: {
  action: (s: ShiftFormState, fd: FormData) => Promise<ShiftFormState>;
  sites: {
    id: string;
    name: string;
    code: string | null;
    postcodeFormatted: string;
  }[];
  officers: { id: string; name: string }[];
  partners: { id: string; name: string }[];
  initial?: CompletedShiftFormInitial;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};
  const [handlerKind, setHandlerKind] = useState<"officer" | "partner">(
    "officer",
  );

  return (
    <form action={formAction} className="space-y-6 max-w-2xl">
      <FormError message={state.error} />

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Site + type</h2>

        <div>
          <label className="label" htmlFor="siteId">
            Site <span className="text-red-500">*</span>
          </label>
          <select
            id="siteId"
            name="siteId"
            className="input"
            required
            defaultValue={initial?.siteId ?? ""}
          >
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

        <div>
          <label className="label" htmlFor="type">
            Shift type
          </label>
          <select
            id="type"
            name="type"
            className="input"
            defaultValue={initial?.type ?? "STATIC_GUARDING"}
          >
            {TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Who attended?</h2>

        <input type="hidden" name="handlerKind" value={handlerKind} />
        <div className="flex gap-2">
          {(["officer", "partner"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setHandlerKind(k)}
              className={
                "px-3 py-1.5 rounded-xl text-sm border transition " +
                (handlerKind === k
                  ? "bg-brand-blue text-white border-brand-blue"
                  : "bg-white text-slate-700 border-slate-300 hover:border-brand-blue-300")
              }
              aria-pressed={handlerKind === k}
            >
              {k === "officer" ? "Our officer" : "Partner"}
            </button>
          ))}
        </div>

        {handlerKind === "officer" ? (
          <div>
            <label className="label" htmlFor="officerId">
              Officer <span className="text-red-500">*</span>
            </label>
            <select
              id="officerId"
              name="officerId"
              className="input"
              defaultValue=""
            >
              <option value="">— pick an officer —</option>
              {officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {fe.officerId && (
              <p className="text-xs text-red-600 mt-1">
                {fe.officerId.join(", ")}
              </p>
            )}
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="handlerPartnerId">
              Partner <span className="text-red-500">*</span>
            </label>
            <select
              id="handlerPartnerId"
              name="handlerPartnerId"
              className="input"
              defaultValue=""
            >
              <option value="">— pick a partner —</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {fe.handlerPartnerId && (
              <p className="text-xs text-red-600 mt-1">
                {fe.handlerPartnerId.join(", ")}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-1">
              The partner will assign which of their officers attended on
              their own portal — you don&apos;t need to pick one here.
            </p>
          </div>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">When</h2>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="startedAt">
              Started <span className="text-red-500">*</span>
            </label>
            <input
              id="startedAt"
              name="startedAt"
              type="datetime-local"
              className="input"
              required
              defaultValue={initial?.startedAt ?? ""}
            />
            {fe.startedAt && (
              <p className="text-xs text-red-600 mt-1">
                {fe.startedAt.join(", ")}
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="endedAt">
              Ended <span className="text-red-500">*</span>
            </label>
            <input
              id="endedAt"
              name="endedAt"
              type="datetime-local"
              className="input"
              required
              defaultValue={initial?.endedAt ?? ""}
            />
            {fe.endedAt && (
              <p className="text-xs text-red-600 mt-1">
                {fe.endedAt.join(", ")}
              </p>
            )}
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
            className="input"
            defaultValue={initial?.notes ?? ""}
            maxLength={2000}
          />
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
      {pending ? "Saving…" : "Record shift"}
    </button>
  );
}
