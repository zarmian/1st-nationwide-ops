"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { ShiftFormState } from "../_actions";
import { FormError } from "@/components/FormError";

const TYPES = [
  { v: "STATIC_GUARDING", label: "Static guarding" },
  { v: "DOG_HANDLER", label: "Dog handler" },
];

export type ShiftFormInitial = {
  siteId: string;
  officerId: string | null;
  type: string;
  scheduledStartsAt: string; // "yyyy-MM-ddTHH:mm"
  scheduledEndsAt: string;
  checkIntervalMin: number;
  graceMinutes: number;
  notes: string | null;
};

export function NewShiftForm({
  action,
  sites,
  officers,
  partners,
  initial,
  submitLabel = "Create shift",
  cancelHref = "/shifts",
  lockedType,
}: {
  action: (s: ShiftFormState, fd: FormData) => Promise<ShiftFormState>;
  sites: { id: string; name: string; code: string | null; postcodeFormatted: string }[];
  officers: { id: string; name: string }[];
  /** When provided, the own-officer / partner handler toggle is shown
   *  (creation flow). Omitted on the edit form, which keeps the original
   *  own-officer-only layout. */
  partners?: { id: string; name: string }[];
  initial?: ShiftFormInitial;
  submitLabel?: string;
  cancelHref?: string;
  /** When set, the shift type is fixed (e.g. a "Static guarding" tab) — the
   *  dropdown is hidden and the value posted via a hidden input. */
  lockedType?: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};
  const showHandler = Array.isArray(partners);
  const [handlerKind, setHandlerKind] = useState<"own" | "partner">("own");

  return (
    <form action={formAction} className="space-y-6 max-w-2xl">
      <FormError message={state.error} />

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Basics</h2>

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

        {lockedType ? (
          <input type="hidden" name="type" value={lockedType} />
        ) : (
          <div>
            <label className="label" htmlFor="type">
              Type
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
        )}

        {/* ── Who is doing it ───────────────────────────────────────── */}
        {showHandler ? (
          <div className="space-y-3">
            <div>
              <span className="label">Who is doing this shift?</span>
              <div className="flex gap-2 mt-1">
                <label
                  className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-sm ${
                    handlerKind === "own"
                      ? "border-brand-mint bg-brand-mint/10 text-brand-navy font-medium"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="handlerKind"
                    value="own"
                    checked={handlerKind === "own"}
                    onChange={() => setHandlerKind("own")}
                    className="sr-only"
                  />
                  Our officer
                </label>
                <label
                  className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-sm ${
                    handlerKind === "partner"
                      ? "border-brand-mint bg-brand-mint/10 text-brand-navy font-medium"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="handlerKind"
                    value="partner"
                    checked={handlerKind === "partner"}
                    onChange={() => setHandlerKind("partner")}
                    className="sr-only"
                  />
                  Partner / subcontractor
                </label>
              </div>
            </div>

            {handlerKind === "own" ? (
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="officerId">
                    Officer
                  </label>
                  <select
                    id="officerId"
                    name="officerId"
                    className="input"
                    defaultValue={initial?.officerId ?? ""}
                  >
                    <option value="">— unassigned —</option>
                    {officers.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Leave unassigned — the officer types their name on the link.
                  </p>
                </div>
                <div>
                  <label className="label" htmlFor="linkPhone">
                    Mobile for link (optional)
                  </label>
                  <input
                    id="linkPhone"
                    name="linkPhone"
                    type="tel"
                    inputMode="tel"
                    placeholder="07700 900123"
                    className="input"
                  />
                  {fe.linkPhone && (
                    <p className="text-xs text-red-600 mt-1">
                      {fe.linkPhone.join(", ")}
                    </p>
                  )}
                  <p className="text-xs text-slate-500 mt-1">
                    We text the shift link here. Defaults to the officer&apos;s
                    number if they have one.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
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
                    {partners!.map((p) => (
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
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label" htmlFor="officerName">
                      Officer name (optional)
                    </label>
                    <input
                      id="officerName"
                      name="officerName"
                      type="text"
                      placeholder="e.g. J. Okafor"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="linkPhone">
                      Officer mobile <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="linkPhone"
                      name="linkPhone"
                      type="tel"
                      inputMode="tel"
                      placeholder="07700 900123"
                      className="input"
                    />
                    {fe.linkPhone && (
                      <p className="text-xs text-red-600 mt-1">
                        {fe.linkPhone.join(", ")}
                      </p>
                    )}
                    <p className="text-xs text-slate-500 mt-1">
                      We text the shift link to this number.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          // Edit form — original own-officer-only layout, unchanged.
          <div>
            <label className="label" htmlFor="officerId">
              Officer
            </label>
            <select
              id="officerId"
              name="officerId"
              className="input"
              defaultValue={initial?.officerId ?? ""}
            >
              <option value="">— unassigned —</option>
              {officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}

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
              defaultValue={initial?.scheduledStartsAt ?? ""}
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
              defaultValue={initial?.scheduledEndsAt ?? ""}
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
              defaultValue={initial?.checkIntervalMin ?? 60}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="graceMinutes">
              Grace / buffer (minutes)
            </label>
            <input
              id="graceMinutes"
              name="graceMinutes"
              type="number"
              min={0}
              max={120}
              defaultValue={initial?.graceMinutes ?? 15}
              className="input"
            />
            <p className="text-xs text-slate-500 mt-1">
              Buffer added to each hourly check-in before it counts as overdue.
            </p>
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
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        <Link href={cancelHref} className="btn-secondary">
          Cancel
        </Link>
      </div>
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
