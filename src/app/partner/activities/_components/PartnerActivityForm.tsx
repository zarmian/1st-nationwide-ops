"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { ActivityFormState } from "../_actions";
import { FormError } from "@/components/FormError";

type Customer = { id: string; name: string };
type Site = { id: string; name: string; code: string | null; customerId: string };
type Officer = { id: string; name: string };
type RateRow = {
  service: string;
  chargeToUs: number;
  payToOfficer: number;
  unit: string;
};

export type PartnerActivityInitial = {
  /// Encoded id ("uuid" for job, "shift-uuid" for shift). Undefined on /new.
  encodedId?: string;
  kind: "JOB" | "SHIFT";
  type: string;
  customerId: string;
  siteId: string;
  partnerOfficerId: string | null;
  chargeToUs: number;
  payToOfficer: number;
  notes: string | null;
  scheduledFor?: string | null; // datetime-local "YYYY-MM-DDTHH:mm"
  completedAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
};

const JOB_TYPES: { v: string; label: string }[] = [
  { v: "ALARM_RESPONSE", label: "Alarm response" },
  { v: "PATROL", label: "Patrol" },
  { v: "LOCK", label: "Lock-up" },
  { v: "UNLOCK", label: "Unlock" },
  { v: "VPI", label: "VPI" },
  { v: "KEY_COLLECTION", label: "Key collection" },
  { v: "KEY_DROPOFF", label: "Key drop-off" },
  { v: "SURVEY", label: "Survey" },
  { v: "ADHOC", label: "Ad-hoc" },
];
const SHIFT_TYPES: { v: string; label: string }[] = [
  { v: "STATIC_GUARDING", label: "Static guarding" },
  { v: "DOG_HANDLER", label: "Dog handler" },
];

// JobType → RateService. Mirrors the server-side mapping in _actions.ts;
// duplicated here so we can auto-fill without a round-trip.
const JOB_TO_RATE: Record<string, string> = {
  ALARM_RESPONSE: "ALARM_RESPONSE",
  PATROL: "PATROL",
  LOCK: "LOCKUP",
  UNLOCK: "UNLOCK",
  VPI: "VPI",
  KEY_COLLECTION: "KEYHOLDING",
  KEY_DROPOFF: "KEYHOLDING",
  SURVEY: "ADHOC",
  ADHOC: "ADHOC",
};
const SHIFT_TO_RATE: Record<string, string> = {
  STATIC_GUARDING: "STATIC_GUARDING",
  DOG_HANDLER: "DOG_HANDLER",
};

/**
 * Single form for both job and shift kinds. The kind toggle at the top
 * swaps between the two field sets. Rate columns auto-fill from the
 * partner's rate card based on the chosen type — the partner can still
 * override per-activity by editing the number.
 */
export function PartnerActivityForm({
  action,
  initial,
  customers,
  sites,
  officers,
  rates,
  submitLabel,
}: {
  action: (
    prev: ActivityFormState,
    formData: FormData,
  ) => Promise<ActivityFormState>;
  initial: PartnerActivityInitial;
  customers: Customer[];
  sites: Site[];
  officers: Officer[];
  rates: RateRow[];
  submitLabel: string;
}) {
  const [state, formAction] = useFormState<ActivityFormState, FormData>(
    action,
    {},
  );
  const fe = state.fieldErrors ?? {};

  const [kind, setKind] = useState<"JOB" | "SHIFT">(initial.kind);
  const [type, setType] = useState(initial.type);
  const [customerId, setCustomerId] = useState(initial.customerId);
  // Rate auto-fill: track whether the partner has manually overridden
  // these inputs — only auto-fill when they're still at their default
  // (or empty), so we don't keep overwriting their edits.
  const [chargeToUs, setChargeToUs] = useState<number | string>(
    initial.chargeToUs,
  );
  const [payToOfficer, setPayToOfficer] = useState<number | string>(
    initial.payToOfficer,
  );
  const [rateTouched, setRateTouched] = useState(false);

  const rateMap = useMemo(() => {
    const m = new Map<string, RateRow>();
    for (const r of rates) m.set(r.service, r);
    return m;
  }, [rates]);

  // When kind / type changes, pre-fill from the rate card unless the
  // partner has already edited the numbers themselves.
  useEffect(() => {
    if (rateTouched) return;
    const service =
      kind === "JOB" ? JOB_TO_RATE[type] : SHIFT_TO_RATE[type];
    if (!service) return;
    const r = rateMap.get(service);
    if (r) {
      setChargeToUs(r.chargeToUs);
      setPayToOfficer(r.payToOfficer);
    }
  }, [kind, type, rateMap, rateTouched]);

  // Site list narrows to the chosen customer.
  const sitesForCustomer = useMemo(
    () => sites.filter((s) => s.customerId === customerId),
    [sites, customerId],
  );

  const typeOptions = kind === "JOB" ? JOB_TYPES : SHIFT_TYPES;
  const rateServiceLabel = kind === "JOB" ? "(per visit by default)" : "(per hour by default)";

  return (
    <form action={formAction} className="card p-5 space-y-5">
      <FormError message={state.error} />
      {state.success && (
        <p className="text-sm text-success">{state.success}</p>
      )}

      <input type="hidden" name="kind" value={kind} />

      <div>
        <div className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">
          Activity kind
        </div>
        <div className="flex gap-2">
          {(["JOB", "SHIFT"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                // Reset type to the first option for the new kind so
                // the form doesn't keep a JobType when SHIFT is picked.
                setType(
                  k === "JOB" ? JOB_TYPES[0].v : SHIFT_TYPES[0].v,
                );
                setRateTouched(false);
              }}
              className={
                "px-3 py-1.5 rounded-xl text-sm border transition " +
                (kind === k
                  ? "bg-brand-blue text-white border-brand-blue"
                  : "bg-white text-slate-700 border-slate-300 hover:border-brand-blue-300")
              }
              aria-pressed={kind === k}
            >
              {k === "JOB" ? "Job / callout" : "Shift (guarding)"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="type">
            {kind === "JOB" ? "Job type" : "Shift type"}{" "}
            <span className="text-red-500">*</span>
          </label>
          <select
            id="type"
            name="type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setRateTouched(false);
            }}
            className="input"
          >
            {typeOptions.map((t) => (
              <option key={t.v} value={t.v}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="customerId">
            Customer <span className="text-red-500">*</span>
          </label>
          <select
            id="customerId"
            name="customerId"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            required
            className="input"
          >
            <option value="">— Select customer —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {fe.customerId?.[0] && (
            <p className="text-xs text-red-600 mt-1">{fe.customerId[0]}</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="siteId">
            Site <span className="text-red-500">*</span>
          </label>
          <select
            id="siteId"
            name="siteId"
            defaultValue={initial.siteId}
            required
            className="input"
            disabled={!customerId}
          >
            <option value="">
              {customerId ? "— Select site —" : "Pick a customer first"}
            </option>
            {sitesForCustomer.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} · ${s.name}` : s.name}
              </option>
            ))}
          </select>
          {fe.siteId?.[0] && (
            <p className="text-xs text-red-600 mt-1">{fe.siteId[0]}</p>
          )}
        </div>
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
          <p className="text-xs text-slate-500 mt-1">
            From your private roster · not shared with 1NW staff.
          </p>
        </div>
      </div>

      {kind === "JOB" ? (
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="scheduledFor">
              Scheduled / arrived
            </label>
            <input
              id="scheduledFor"
              name="scheduledFor"
              type="datetime-local"
              defaultValue={initial.scheduledFor ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="completedAt">
              Completed
            </label>
            <input
              id="completedAt"
              name="completedAt"
              type="datetime-local"
              defaultValue={initial.completedAt ?? ""}
              className="input"
            />
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="startedAt">
              Started <span className="text-red-500">*</span>
            </label>
            <input
              id="startedAt"
              name="startedAt"
              type="datetime-local"
              defaultValue={initial.startedAt ?? ""}
              required
              className="input"
            />
            {fe.startedAt?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.startedAt[0]}</p>
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
              defaultValue={initial.endedAt ?? ""}
              required
              className="input"
            />
            {fe.endedAt?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.endedAt[0]}</p>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">
          Rates {rateServiceLabel}
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
                value={chargeToUs}
                onChange={(e) => {
                  setChargeToUs(e.target.value);
                  setRateTouched(true);
                }}
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
                value={payToOfficer}
                onChange={(e) => {
                  setPayToOfficer(e.target.value);
                  setRateTouched(true);
                }}
                className="input pl-7 tabular-nums"
              />
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Auto-filled from your rate card — edit if this activity was
          priced differently.
        </p>
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
          maxLength={2000}
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
