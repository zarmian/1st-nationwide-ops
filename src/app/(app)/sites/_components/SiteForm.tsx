"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { SiteFormState } from "../_actions";

type Lookup = { id: string | number; name: string };

const SITE_TYPES = [
  { v: "COMMERCIAL", label: "Commercial" },
  { v: "RESIDENTIAL", label: "Residential" },
  { v: "RETAIL", label: "Retail" },
  { v: "STORAGE", label: "Storage" },
  { v: "INDUSTRIAL", label: "Industrial" },
  { v: "OTHER", label: "Other" },
];

const RISK_LEVELS = [
  { v: "LOW", label: "Low" },
  { v: "MEDIUM", label: "Medium" },
  { v: "HIGH", label: "High" },
];

const SERVICES = [
  { v: "ALARM_RESPONSE", label: "Alarm response" },
  { v: "KEYHOLDING", label: "Keyholding" },
  { v: "PATROL", label: "Mobile patrol" },
  { v: "LOCKUP", label: "Lock-up" },
  { v: "UNLOCK", label: "Unlock" },
  { v: "VPI", label: "VPI" },
  { v: "STATIC_GUARDING", label: "Static guarding" },
  { v: "DOG_HANDLER", label: "Dog handler" },
  { v: "ADHOC", label: "Ad-hoc" },
];

const KEY_TYPES = [
  { v: "KEY", label: "Key" },
  { v: "FOB", label: "Fob" },
  { v: "PADLOCK", label: "Padlock" },
  { v: "CODE", label: "Code" },
];

const KEY_STATUSES = [
  { v: "WITH_US", label: "With us" },
  { v: "WITH_OFFICER", label: "With officer" },
  { v: "WITH_CUSTOMER", label: "With customer" },
  { v: "LOST", label: "Lost" },
  { v: "RETIRED", label: "Retired" },
];

const DAYS = [
  { v: "MON", label: "Mon" },
  { v: "TUE", label: "Tue" },
  { v: "WED", label: "Wed" },
  { v: "THU", label: "Thu" },
  { v: "FRI", label: "Fri" },
  { v: "SAT", label: "Sat" },
  { v: "SUN", label: "Sun" },
];

const FREQUENCIES = [
  { v: "WEEKLY", label: "Weekly" },
  { v: "FORTNIGHTLY", label: "Fortnightly" },
  { v: "MONTHLY", label: "Monthly" },
];

export type KeyRow = {
  id?: string;
  internalNo: string | null;
  label: string;
  type: string;
  status: string;
  notes: string | null;
};

export type ScheduleDay = {
  dayOfWeek: string;
  frequency: string;
};

export type SiteFormValues = {
  id?: string;
  code: string | null;
  name: string;
  addressLine: string;
  postcode: string;
  city: string | null;
  type: string;
  regionId: number | null;
  customerId: string | null;
  partnerId: string | null;
  services: string[];
  riskLevel: string;
  notes: string | null;
  active: boolean;

  keys: KeyRow[];
  lockUnlock: {
    days: string[];
    unlockTime: string | null;
    lockdownTime: string | null;
  };
  patrolDays: ScheduleDay[];
  vpiDays: ScheduleDay[];
  access: {
    alarmCode: string | null;
    padlockCode: string | null;
    entryStepsMd: string | null;
    lockboxId: string | null;
    hazards: string | null;
  };
};

export function SiteForm({
  action,
  initial,
  regions,
  customers,
  partners,
  submitLabel,
}: {
  action: (state: SiteFormState, formData: FormData) => Promise<SiteFormState>;
  initial: SiteFormValues;
  regions: Lookup[];
  customers: Lookup[];
  partners: Lookup[];
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  const [services, setServices] = useState<string[]>(initial.services);
  const [keys, setKeys] = useState<KeyRow[]>(initial.keys);
  const [lockDays, setLockDays] = useState<string[]>(initial.lockUnlock.days);
  const [unlockTime, setUnlockTime] = useState(
    initial.lockUnlock.unlockTime ?? "",
  );
  const [lockdownTime, setLockdownTime] = useState(
    initial.lockUnlock.lockdownTime ?? "",
  );
  const [patrolDays, setPatrolDays] = useState<ScheduleDay[]>(
    initial.patrolDays,
  );
  const [vpiDays, setVpiDays] = useState<ScheduleDay[]>(initial.vpiDays);

  const wantsKeys = services.includes("KEYHOLDING");
  const wantsLockUnlock =
    services.includes("LOCKUP") || services.includes("UNLOCK");
  const wantsPatrol = services.includes("PATROL");
  const wantsVpi = services.includes("VPI");
  const wantsAccess = services.includes("ALARM_RESPONSE");

  const keysJson = useMemo(() => JSON.stringify(keys), [keys]);
  const patrolDaysJson = useMemo(
    () => JSON.stringify(patrolDays),
    [patrolDays],
  );
  const vpiDaysJson = useMemo(() => JSON.stringify(vpiDays), [vpiDays]);

  function toggleService(v: string, on: boolean) {
    setServices((s) => (on ? [...s, v] : s.filter((x) => x !== v)));
  }

  return (
    <form action={formAction} className="space-y-6 max-w-4xl">
      {state.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}

      {/* Basics */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Basics</h2>

        <div className="grid md:grid-cols-2 gap-4">
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
            />
            <FieldError messages={fe.name} />
          </div>
          <div>
            <label className="label" htmlFor="code">
              Site code
            </label>
            <input
              id="code"
              name="code"
              defaultValue={initial.code ?? ""}
              className="input"
              placeholder="Optional internal reference"
            />
            <FieldError messages={fe.code} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="addressLine">
            Address <span className="text-red-500">*</span>
          </label>
          <input
            id="addressLine"
            name="addressLine"
            defaultValue={initial.addressLine}
            className="input"
            required
          />
          <FieldError messages={fe.addressLine} />
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="postcode">
              Postcode <span className="text-red-500">*</span>
            </label>
            <input
              id="postcode"
              name="postcode"
              defaultValue={initial.postcode}
              className="input"
              required
            />
            <FieldError messages={fe.postcode} />
          </div>
          <div>
            <label className="label" htmlFor="city">
              City / town
            </label>
            <input
              id="city"
              name="city"
              defaultValue={initial.city ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="type">
              Type
            </label>
            <select
              id="type"
              name="type"
              defaultValue={initial.type}
              className="input"
            >
              {SITE_TYPES.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Ownership */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Ownership</h2>
        <p className="text-sm text-slate-500 -mt-2">
          A site can belong to a direct customer, or be operated for a partner —
          not both. Leave both blank for sites without a billing relationship
          yet.
        </p>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="regionId">
              Region
            </label>
            <select
              id="regionId"
              name="regionId"
              defaultValue={initial.regionId ?? ""}
              className="input"
            >
              <option value="">—</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="customerId">
              Customer
            </label>
            <select
              id="customerId"
              name="customerId"
              defaultValue={initial.customerId ?? ""}
              className="input"
            >
              <option value="">—</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="partnerId">
              Partner (operated for)
            </label>
            <select
              id="partnerId"
              name="partnerId"
              defaultValue={initial.partnerId ?? ""}
              className="input"
            >
              <option value="">—</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Services & risk */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Services & risk</h2>

        <div>
          <span className="label">Services provided</span>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-1">
            {SERVICES.map((s) => (
              <label
                key={s.v}
                className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  name="services"
                  value={s.v}
                  checked={services.includes(s.v)}
                  onChange={(e) => toggleService(s.v, e.target.checked)}
                  className="rounded border-slate-300 text-brand-mint focus:ring-brand-mint/30"
                />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="riskLevel">
              Risk level
            </label>
            <select
              id="riskLevel"
              name="riskLevel"
              defaultValue={initial.riskLevel}
              className="input"
            >
              {RISK_LEVELS.map((r) => (
                <option key={r.v} value={r.v}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                name="active"
                defaultChecked={initial.active}
                className="rounded border-slate-300 text-brand-mint focus:ring-brand-mint/30"
              />
              <span>Active — site is live and can have jobs</span>
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
            placeholder="Access quirks, parking, contact preferences, etc. Visible to officers."
          />
        </div>
      </div>

      {/* Conditional sections */}
      {wantsKeys && (
        <KeysSection keys={keys} setKeys={setKeys} />
      )}

      {wantsLockUnlock && (
        <LockUnlockSection
          days={lockDays}
          setDays={setLockDays}
          unlockTime={unlockTime}
          setUnlockTime={setUnlockTime}
          lockdownTime={lockdownTime}
          setLockdownTime={setLockdownTime}
        />
      )}

      {wantsPatrol && (
        <ScheduleSection
          title="Patrol schedule"
          blurb="One row per day we patrol. Pick a frequency for each. Officer assignment comes later."
          days={patrolDays}
          setDays={setPatrolDays}
        />
      )}

      {wantsVpi && (
        <ScheduleSection
          title="VPI schedule"
          blurb="Vacant property inspection cadence. Same day-of-week + frequency model as patrols."
          days={vpiDays}
          setDays={setVpiDays}
        />
      )}

      {wantsAccess && <AccessSection initial={initial.access} />}

      {/* Hidden serialized state */}
      <input type="hidden" name="keys_json" value={keysJson} readOnly />
      <input
        type="hidden"
        name="patrol_days_json"
        value={patrolDaysJson}
        readOnly
      />
      <input type="hidden" name="vpi_days_json" value={vpiDaysJson} readOnly />

      <div className="flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        <Link
          href={initial.id ? `/sites/${initial.id}` : "/sites"}
          className="btn-secondary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function KeysSection({
  keys,
  setKeys,
}: {
  keys: KeyRow[];
  setKeys: React.Dispatch<React.SetStateAction<KeyRow[]>>;
}) {
  function addRow() {
    setKeys((rows) => [
      ...rows,
      { internalNo: "", label: "", type: "KEY", status: "WITH_US", notes: "" },
    ]);
  }
  function update(i: number, patch: Partial<KeyRow>) {
    setKeys((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    setKeys((rows) => rows.filter((_, idx) => idx !== i));
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-brand-navy">Keys</h2>
          <p className="text-sm text-slate-500">
            Keys, fobs, padlocks, and codes we hold for this site.
          </p>
        </div>
        <button type="button" onClick={addRow} className="btn-secondary text-sm">
          + Add key
        </button>
      </div>

      {keys.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No keys yet. Click "Add key" to start the register.
        </p>
      ) : (
        <div className="space-y-2">
          {keys.map((k, i) => (
            <div
              key={i}
              className="grid md:grid-cols-[120px_1fr_120px_140px_auto] gap-2 items-end"
            >
              <div>
                <label className="label">Internal #</label>
                <input
                  className="input"
                  value={k.internalNo ?? ""}
                  onChange={(e) =>
                    update(i, { internalNo: e.target.value || null })
                  }
                  placeholder="NT01"
                />
              </div>
              <div>
                <label className="label">Label</label>
                <input
                  className="input"
                  value={k.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder="Front door, padlock 5444…"
                  required
                />
              </div>
              <div>
                <label className="label">Type</label>
                <select
                  className="input"
                  value={k.type}
                  onChange={(e) => update(i, { type: e.target.value })}
                >
                  {KEY_TYPES.map((t) => (
                    <option key={t.v} value={t.v}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select
                  className="input"
                  value={k.status}
                  onChange={(e) => update(i, { status: e.target.value })}
                >
                  {KEY_STATUSES.map((s) => (
                    <option key={s.v} value={s.v}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                className="btn-ghost text-sm text-red-600 self-end"
                aria-label="Remove key"
              >
                Remove
              </button>
              <div className="md:col-span-5">
                <input
                  className="input"
                  value={k.notes ?? ""}
                  onChange={(e) =>
                    update(i, { notes: e.target.value || null })
                  }
                  placeholder="Notes — access quirks, who else has a copy, etc."
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LockUnlockSection({
  days,
  setDays,
  unlockTime,
  setUnlockTime,
  lockdownTime,
  setLockdownTime,
}: {
  days: string[];
  setDays: React.Dispatch<React.SetStateAction<string[]>>;
  unlockTime: string;
  setUnlockTime: (v: string) => void;
  lockdownTime: string;
  setLockdownTime: (v: string) => void;
}) {
  function toggleDay(d: string, on: boolean) {
    setDays((arr) => (on ? [...arr, d] : arr.filter((x) => x !== d)));
  }
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-brand-navy">Lock-up / unlock</h2>
        <p className="text-sm text-slate-500">
          Days and times we open and secure the site. One schedule per site.
        </p>
      </div>

      <DayPicker
        selected={days}
        onToggle={toggleDay}
      />

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="lockunlock_unlock_time">
            Unlock time
          </label>
          <input
            id="lockunlock_unlock_time"
            name="lockunlock_unlock_time"
            type="time"
            value={unlockTime}
            onChange={(e) => setUnlockTime(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="lockunlock_lockdown_time">
            Lockdown time
          </label>
          <input
            id="lockunlock_lockdown_time"
            name="lockunlock_lockdown_time"
            type="time"
            value={lockdownTime}
            onChange={(e) => setLockdownTime(e.target.value)}
            className="input"
          />
        </div>
      </div>

      {/* Hidden inputs for the day checkboxes (component uses state) */}
      {days.map((d) => (
        <input key={d} type="hidden" name="lockunlock_days" value={d} />
      ))}
    </div>
  );
}

function ScheduleSection({
  title,
  blurb,
  days,
  setDays,
}: {
  title: string;
  blurb: string;
  days: ScheduleDay[];
  setDays: React.Dispatch<React.SetStateAction<ScheduleDay[]>>;
}) {
  const selectedDays = useMemo(() => days.map((d) => d.dayOfWeek), [days]);

  function toggle(day: string, on: boolean) {
    setDays((rows) => {
      if (on) {
        if (rows.some((r) => r.dayOfWeek === day)) return rows;
        return [...rows, { dayOfWeek: day, frequency: "WEEKLY" }];
      }
      return rows.filter((r) => r.dayOfWeek !== day);
    });
  }

  function setFrequency(day: string, freq: string) {
    setDays((rows) =>
      rows.map((r) => (r.dayOfWeek === day ? { ...r, frequency: freq } : r)),
    );
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-brand-navy">{title}</h2>
        <p className="text-sm text-slate-500">{blurb}</p>
      </div>

      <DayPicker selected={selectedDays} onToggle={toggle} />

      {days.length > 0 && (
        <div className="space-y-2">
          {days
            .slice()
            .sort(
              (a, b) =>
                DAYS.findIndex((d) => d.v === a.dayOfWeek) -
                DAYS.findIndex((d) => d.v === b.dayOfWeek),
            )
            .map((d) => (
              <div
                key={d.dayOfWeek}
                className="grid grid-cols-[100px_1fr] items-center gap-3 text-sm"
              >
                <span className="font-medium text-slate-700">
                  {DAYS.find((x) => x.v === d.dayOfWeek)?.label}
                </span>
                <select
                  className="input max-w-[180px]"
                  value={d.frequency}
                  onChange={(e) => setFrequency(d.dayOfWeek, e.target.value)}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f.v} value={f.v}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function DayPicker({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (day: string, on: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {DAYS.map((d) => {
        const on = selected.includes(d.v);
        return (
          <button
            key={d.v}
            type="button"
            onClick={() => onToggle(d.v, !on)}
            className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
              on
                ? "bg-brand-mint text-white border-brand-mint"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

function AccessSection({
  initial,
}: {
  initial: SiteFormValues["access"];
}) {
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-brand-navy">Access & alarm</h2>
        <p className="text-sm text-slate-500">
          Information officers need on-site for alarm response. Stored
          plaintext for now — encryption coming. Don't share outside dispatch.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="access_alarm_code">
            Alarm code
          </label>
          <input
            id="access_alarm_code"
            name="access_alarm_code"
            defaultValue={initial.alarmCode ?? ""}
            className="input"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="label" htmlFor="access_padlock_code">
            Padlock code
          </label>
          <input
            id="access_padlock_code"
            name="access_padlock_code"
            defaultValue={initial.padlockCode ?? ""}
            className="input"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="label" htmlFor="access_lockbox_id">
            Lockbox ID
          </label>
          <input
            id="access_lockbox_id"
            name="access_lockbox_id"
            defaultValue={initial.lockboxId ?? ""}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="access_hazards">
            Hazards / cautions
          </label>
          <input
            id="access_hazards"
            name="access_hazards"
            defaultValue={initial.hazards ?? ""}
            className="input"
            placeholder="Dog on site, asbestos, etc."
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="access_entry_steps">
          Entry steps
        </label>
        <textarea
          id="access_entry_steps"
          name="access_entry_steps"
          defaultValue={initial.entryStepsMd ?? ""}
          rows={4}
          className="input"
          placeholder="Step-by-step access instructions: park, gate, alarm panel location, code entry, etc."
        />
      </div>
    </div>
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

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="mt-1 text-xs text-red-600">{messages.join(", ")}</p>;
}
