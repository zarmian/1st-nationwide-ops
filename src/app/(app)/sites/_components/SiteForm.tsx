"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { upload } from "@vercel/blob/client";
import type { SiteFormState } from "../_actions";
import { FormError } from "@/components/FormError";

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
  duplicable: boolean;
  notes: string | null;
};

export type KeySetRow = {
  id?: string;
  internalNo: string | null;
  label: string;
  notes: string | null;
  // Reference photo of the physical key bunch. Vercel Blob URL or null.
  photoUrl?: string | null;
  keys: KeyRow[];
};

export type ScheduleDay = {
  dayOfWeek: string;
  frequency: string;
  timeOfDay?: string;       // "HH:MM" UK wall-clock
  startsOn?: string;        // "YYYY-MM-DD" anchor
  endsOn?: string;          // "YYYY-MM-DD" stop date
  assignedOfficerId?: string; // per-day officer
  intervalWeeks?: number;   // overrides frequency: "every N weeks"
  exceptionDates?: string[]; // YYYY-MM-DD skips
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
  partnerReference: string | null;
  partnerSin: string | null;
  sapRef: string | null;
  opsUnit: string | null;
  what3words: string | null;
  partnerStatus: string | null;
  startDate: string | null;
  terminationDate: string | null;
  dne: boolean;
  hsMarkers: boolean;

  keySets: KeySetRow[];
  lockUnlock: {
    days: string[];
    unlockTime: string | null;
    lockdownTime: string | null;
    assignedOfficerId: string | null;
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
  officers,
  submitLabel,
}: {
  action: (state: SiteFormState, formData: FormData) => Promise<SiteFormState>;
  initial: SiteFormValues;
  regions: Lookup[];
  customers: Lookup[];
  partners: Lookup[];
  officers: Lookup[];
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  const [services, setServices] = useState<string[]>(initial.services);
  const [keySets, setKeySets] = useState<KeySetRow[]>(initial.keySets);
  const [lockDays, setLockDays] = useState<string[]>(initial.lockUnlock.days);
  const [unlockTime, setUnlockTime] = useState(
    initial.lockUnlock.unlockTime ?? "",
  );
  const [lockdownTime, setLockdownTime] = useState(
    initial.lockUnlock.lockdownTime ?? "",
  );
  const [lockOfficerId, setLockOfficerId] = useState<string>(
    initial.lockUnlock.assignedOfficerId ?? "",
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

  const keySetsJson = useMemo(() => JSON.stringify(keySets), [keySets]);
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
      <FormError message={state.error} />

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

      {/* Partner reference & flags */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">
          Partner reference & flags
        </h2>
        <p className="text-sm text-slate-500 -mt-2">
          Partner-supplied identifiers and contractual dates. The Nexus CSV
          importer fills these in automatically; edit by hand when the partner
          notifies you of a change.
        </p>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="partnerReference">
              Partner reference
            </label>
            <input
              id="partnerReference"
              name="partnerReference"
              defaultValue={initial.partnerReference ?? ""}
              className="input font-mono text-xs"
              placeholder="SITE-113341"
            />
          </div>
          <div>
            <label className="label" htmlFor="partnerSin">
              SIN
            </label>
            <input
              id="partnerSin"
              name="partnerSin"
              defaultValue={initial.partnerSin ?? ""}
              className="input font-mono text-xs"
            />
          </div>
          <div>
            <label className="label" htmlFor="partnerStatus">
              Status (per partner)
            </label>
            <input
              id="partnerStatus"
              name="partnerStatus"
              defaultValue={initial.partnerStatus ?? ""}
              className="input"
              placeholder="Active"
            />
          </div>
          <div>
            <label className="label" htmlFor="sapRef">
              SAP ref
            </label>
            <input
              id="sapRef"
              name="sapRef"
              defaultValue={initial.sapRef ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="opsUnit">
              OPS unit
            </label>
            <input
              id="opsUnit"
              name="opsUnit"
              defaultValue={initial.opsUnit ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="what3words">
              what3words
            </label>
            <input
              id="what3words"
              name="what3words"
              defaultValue={initial.what3words ?? ""}
              className="input font-mono text-xs"
              placeholder="filled.count.soap"
            />
          </div>
          <div>
            <label className="label" htmlFor="startDate">
              Site start date
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={initial.startDate ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="terminationDate">
              Termination date
            </label>
            <input
              id="terminationDate"
              name="terminationDate"
              type="date"
              defaultValue={initial.terminationDate ?? ""}
              className="input"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              name="dne"
              defaultChecked={initial.dne}
              className="checkbox"
            />
            <span>DNE — Do not engage</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              name="hsMarkers"
              defaultChecked={initial.hsMarkers}
              className="checkbox"
            />
            <span>HS markers — Health & safety hazards on site</span>
          </label>
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
                  className="checkbox"
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
                className="checkbox"
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
        <KeysSection
          keySets={keySets}
          setKeySets={setKeySets}
          siteId={initial.id ?? null}
        />
      )}

      {wantsLockUnlock && (
        <LockUnlockSection
          days={lockDays}
          setDays={setLockDays}
          unlockTime={unlockTime}
          setUnlockTime={setUnlockTime}
          lockdownTime={lockdownTime}
          setLockdownTime={setLockdownTime}
          officerId={lockOfficerId}
          setOfficerId={setLockOfficerId}
          officers={officers}
        />
      )}

      {wantsPatrol && (
        <ScheduleSection
          anchorId="patrol-section"
          title="Patrol schedule"
          blurb="One row per day we patrol. Pick day, frequency, and time; expand Advanced for per-day officer, end date, custom interval, and skip dates."
          days={patrolDays}
          setDays={setPatrolDays}
          officers={officers}
        />
      )}

      {wantsVpi && (
        <ScheduleSection
          anchorId="vpi-section"
          title="VPI schedule"
          blurb="Vacant property inspection cadence. Same controls as patrols."
          days={vpiDays}
          setDays={setVpiDays}
          officers={officers}
        />
      )}

      {wantsAccess && <AccessSection initial={initial.access} />}

      {/* Hidden serialized state */}
      <input
        type="hidden"
        name="keysets_json"
        value={keySetsJson}
        readOnly
      />
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
  keySets,
  setKeySets,
  siteId,
}: {
  keySets: KeySetRow[];
  setKeySets: React.Dispatch<React.SetStateAction<KeySetRow[]>>;
  siteId: string | null;
}) {
  function addSet() {
    setKeySets((sets) => [
      ...sets,
      {
        internalNo: "",
        label: "",
        notes: "",
        keys: [
          {
            internalNo: "",
            label: "",
            type: "KEY",
            status: "WITH_US",
            duplicable: true,
            notes: "",
          },
        ],
      },
    ]);
  }

  function updateSet(i: number, patch: Partial<KeySetRow>) {
    setKeySets((sets) =>
      sets.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );
  }

  function removeSet(i: number) {
    setKeySets((sets) => sets.filter((_, idx) => idx !== i));
  }

  function addKey(setIdx: number) {
    setKeySets((sets) =>
      sets.map((s, idx) =>
        idx === setIdx
          ? {
              ...s,
              keys: [
                ...s.keys,
                {
                  internalNo: "",
                  label: "",
                  type: "KEY",
                  status: "WITH_US",
                  duplicable: true,
                  notes: "",
                },
              ],
            }
          : s,
      ),
    );
  }

  function updateKey(
    setIdx: number,
    keyIdx: number,
    patch: Partial<KeyRow>,
  ) {
    setKeySets((sets) =>
      sets.map((s, idx) =>
        idx === setIdx
          ? {
              ...s,
              keys: s.keys.map((k, kIdx) =>
                kIdx === keyIdx ? { ...k, ...patch } : k,
              ),
            }
          : s,
      ),
    );
  }

  function removeKey(setIdx: number, keyIdx: number) {
    setKeySets((sets) =>
      sets.map((s, idx) =>
        idx === setIdx
          ? { ...s, keys: s.keys.filter((_, kIdx) => kIdx !== keyIdx) }
          : s,
      ),
    );
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-brand-navy">Keys</h2>
          <p className="text-sm text-slate-500">
            Keys are grouped into sets — e.g. <span className="font-mono">NT01</span> = 2
            keys + 1 fob + padlock 5444. Mark a key non-duplicable for fobs
            that can't be copied.
          </p>
        </div>
        <button type="button" onClick={addSet} className="btn-secondary text-sm">
          + Add key set
        </button>
      </div>

      {keySets.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No key sets yet. Click "Add key set" to start.
        </p>
      ) : (
        <div className="space-y-4">
          {keySets.map((set, sIdx) => (
            <div
              key={sIdx}
              className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50/40"
            >
              <div className="grid md:grid-cols-[140px_1fr_auto] gap-2 items-end">
                <div>
                  <label className="label">Set #</label>
                  <input
                    className="input"
                    value={set.internalNo ?? ""}
                    onChange={(e) =>
                      updateSet(sIdx, { internalNo: e.target.value || null })
                    }
                    placeholder="NT01"
                  />
                </div>
                <div>
                  <label className="label">
                    Label <span className="text-red-500">*</span>
                  </label>
                  <input
                    className="input"
                    value={set.label}
                    onChange={(e) => updateSet(sIdx, { label: e.target.value })}
                    placeholder="Front door bundle, shutter set…"
                    required
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeSet(sIdx)}
                  className="btn-ghost text-sm text-red-600"
                  aria-label="Remove set"
                >
                  Remove set
                </button>
              </div>

              <input
                className="input"
                value={set.notes ?? ""}
                onChange={(e) =>
                  updateSet(sIdx, { notes: e.target.value || null })
                }
                placeholder="Set notes (optional)"
              />

              <SetPhotoField
                value={set.photoUrl ?? null}
                onChange={(url) => updateSet(sIdx, { photoUrl: url })}
                siteId={siteId}
              />

              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-slate-500 font-medium">
                  Keys in this set
                </div>
                {set.keys.length === 0 && (
                  <p className="text-sm text-slate-500 italic">
                    No keys in this set yet.
                  </p>
                )}
                {set.keys.map((k, kIdx) => (
                  <div
                    key={kIdx}
                    className="grid md:grid-cols-[1fr_120px_130px_120px_auto] gap-2 items-end card-subtle p-2"
                  >
                    <div>
                      <label className="label">
                        Label <span className="text-red-500">*</span>
                      </label>
                      <input
                        className="input"
                        value={k.label}
                        onChange={(e) =>
                          updateKey(sIdx, kIdx, { label: e.target.value })
                        }
                        placeholder="Front door, padlock 5444…"
                        required
                      />
                    </div>
                    <div>
                      <label className="label">Type</label>
                      <select
                        className="input"
                        value={k.type}
                        onChange={(e) =>
                          updateKey(sIdx, kIdx, { type: e.target.value })
                        }
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
                        onChange={(e) =>
                          updateKey(sIdx, kIdx, { status: e.target.value })
                        }
                      >
                        {KEY_STATUSES.map((s) => (
                          <option key={s.v} value={s.v}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={k.duplicable}
                        onChange={(e) =>
                          updateKey(sIdx, kIdx, {
                            duplicable: e.target.checked,
                          })
                        }
                        className="checkbox"
                      />
                      <span>Duplicable</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => removeKey(sIdx, kIdx)}
                      className="btn-ghost text-sm text-red-600"
                      aria-label="Remove key"
                    >
                      Remove
                    </button>
                    <div className="md:col-span-5">
                      <input
                        className="input"
                        value={k.notes ?? ""}
                        onChange={(e) =>
                          updateKey(sIdx, kIdx, {
                            notes: e.target.value || null,
                          })
                        }
                        placeholder="Notes — copy of which key, who has another copy, etc."
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addKey(sIdx)}
                  className="btn-ghost text-sm"
                >
                  + Add key to set
                </button>
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
  officerId,
  setOfficerId,
  officers,
}: {
  days: string[];
  setDays: React.Dispatch<React.SetStateAction<string[]>>;
  unlockTime: string;
  setUnlockTime: (v: string) => void;
  lockdownTime: string;
  setLockdownTime: (v: string) => void;
  officerId: string;
  setOfficerId: (v: string) => void;
  officers: Lookup[];
}) {
  function toggleDay(d: string, on: boolean) {
    setDays((arr) => (on ? [...arr, d] : arr.filter((x) => x !== d)));
  }
  return (
    <div id="lockunlock-section" className="card p-5 space-y-4 scroll-mt-20">
      <div>
        <h2 className="font-semibold text-brand-navy">Lock-up / unlock</h2>
        <p className="text-sm text-slate-500">
          Days and times we open and secure the site, plus the officer who
          covers it. One schedule per site — every daily lock/unlock job
          inherits this officer.
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

      <div>
        <label className="label" htmlFor="lockunlock_officer">
          Assigned officer
        </label>
        <select
          id="lockunlock_officer"
          name="lockunlock_assigned_officer_id"
          value={officerId}
          onChange={(e) => setOfficerId(e.target.value)}
          className="input"
        >
          <option value="">— Unassigned —</option>
          {officers.map((o) => (
            <option key={o.id} value={String(o.id)}>
              {o.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500 mt-1">
          Each daily lock/unlock job created from this schedule will be
          pre-assigned to this officer. You can still reassign a single job
          from /dispatch or /schedules.
        </p>
      </div>

      {/* Hidden inputs for the day checkboxes (component uses state) */}
      {days.map((d) => (
        <input key={d} type="hidden" name="lockunlock_days" value={d} />
      ))}
    </div>
  );
}

function ScheduleSection({
  anchorId,
  title,
  blurb,
  days,
  setDays,
  officers,
}: {
  anchorId: string;
  title: string;
  blurb: string;
  days: ScheduleDay[];
  setDays: React.Dispatch<React.SetStateAction<ScheduleDay[]>>;
  officers: Lookup[];
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

  function setTimeOfDay(day: string, t: string) {
    setDays((rows) =>
      rows.map((r) =>
        r.dayOfWeek === day ? { ...r, timeOfDay: t || undefined } : r,
      ),
    );
  }

  function setStartsOn(day: string, s: string) {
    setDays((rows) =>
      rows.map((r) =>
        r.dayOfWeek === day ? { ...r, startsOn: s || undefined } : r,
      ),
    );
  }

  function setEndsOn(day: string, s: string) {
    setDays((rows) =>
      rows.map((r) =>
        r.dayOfWeek === day ? { ...r, endsOn: s || undefined } : r,
      ),
    );
  }

  function setOfficer(day: string, id: string) {
    setDays((rows) =>
      rows.map((r) =>
        r.dayOfWeek === day ? { ...r, assignedOfficerId: id || undefined } : r,
      ),
    );
  }

  function setIntervalWeeks(day: string, n: string) {
    setDays((rows) =>
      rows.map((r) => {
        if (r.dayOfWeek !== day) return r;
        const parsed = Number.parseInt(n, 10);
        return {
          ...r,
          intervalWeeks: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
        };
      }),
    );
  }

  function addException(day: string, date: string) {
    if (!date) return;
    setDays((rows) =>
      rows.map((r) => {
        if (r.dayOfWeek !== day) return r;
        const set = new Set(r.exceptionDates ?? []);
        set.add(date);
        return { ...r, exceptionDates: Array.from(set).sort() };
      }),
    );
  }

  function removeException(day: string, date: string) {
    setDays((rows) =>
      rows.map((r) => {
        if (r.dayOfWeek !== day) return r;
        return {
          ...r,
          exceptionDates: (r.exceptionDates ?? []).filter((d) => d !== date),
        };
      }),
    );
  }

  return (
    <div id={anchorId} className="card p-5 space-y-4 scroll-mt-20">
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
            .map((d) => {
              const fortnightly = d.frequency === "FORTNIGHTLY";
              const customInterval = d.intervalWeeks != null;
              return (
                <div
                  key={d.dayOfWeek}
                  className="rounded-xl border border-slate-200 p-3 space-y-3"
                >
                  <div className="grid grid-cols-[80px_repeat(3,minmax(0,1fr))] items-end gap-3 text-sm">
                    <span className="font-medium text-slate-700 self-center">
                      {DAYS.find((x) => x.v === d.dayOfWeek)?.label}
                    </span>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
                        Frequency
                      </label>
                      <select
                        className="input"
                        value={customInterval ? "CUSTOM" : d.frequency}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "CUSTOM") {
                            setIntervalWeeks(d.dayOfWeek, "2");
                          } else {
                            // Clear the custom override when picking an enum.
                            setIntervalWeeks(d.dayOfWeek, "");
                            setFrequency(d.dayOfWeek, v);
                          }
                        }}
                      >
                        {FREQUENCIES.map((f) => (
                          <option key={f.v} value={f.v}>
                            {f.label}
                          </option>
                        ))}
                        <option value="CUSTOM">Every N weeks…</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
                        Time (UK)
                      </label>
                      <input
                        type="time"
                        className="input"
                        value={d.timeOfDay ?? ""}
                        onChange={(e) =>
                          setTimeOfDay(d.dayOfWeek, e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label
                        className="block text-[11px] uppercase tracking-wider text-slate-500 mb-0.5"
                        title={
                          fortnightly || customInterval
                            ? "Anchors recurrence parity. Leave blank to use today."
                            : "Skip occurrences before this date."
                        }
                      >
                        {fortnightly || customInterval
                          ? "Starts on"
                          : "Start date"}
                      </label>
                      <input
                        type="date"
                        className="input"
                        value={d.startsOn ?? ""}
                        onChange={(e) =>
                          setStartsOn(d.dayOfWeek, e.target.value)
                        }
                      />
                    </div>
                  </div>

                  <details className="group">
                    <summary className="cursor-pointer text-xs text-slate-500 hover:text-brand-navy select-none">
                      Advanced ▾
                    </summary>
                    <div className="mt-3 grid grid-cols-[80px_repeat(3,minmax(0,1fr))] items-end gap-3 text-sm">
                      <span></span>
                      <div>
                        <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
                          Officer
                        </label>
                        <select
                          className="input"
                          value={d.assignedOfficerId ?? ""}
                          onChange={(e) =>
                            setOfficer(d.dayOfWeek, e.target.value)
                          }
                        >
                          <option value="">— unassigned —</option>
                          {officers.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
                          End date
                        </label>
                        <input
                          type="date"
                          className="input"
                          value={d.endsOn ?? ""}
                          onChange={(e) =>
                            setEndsOn(d.dayOfWeek, e.target.value)
                          }
                        />
                      </div>
                      {customInterval ? (
                        <div>
                          <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
                            Every N weeks
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={52}
                            step={1}
                            className="input"
                            value={d.intervalWeeks ?? ""}
                            onChange={(e) =>
                              setIntervalWeeks(d.dayOfWeek, e.target.value)
                            }
                          />
                        </div>
                      ) : (
                        <div />
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-[80px_1fr] items-start gap-3 text-sm">
                      <span></span>
                      <div className="space-y-1.5">
                        <label className="block text-[11px] uppercase tracking-wider text-slate-500">
                          Skip these dates
                        </label>
                        {(d.exceptionDates ?? []).length > 0 && (
                          <ul className="flex flex-wrap gap-1.5">
                            {(d.exceptionDates ?? []).map((ex) => (
                              <li key={ex}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeException(d.dayOfWeek, ex)
                                  }
                                  className="chip-slate hover:bg-red-100 hover:text-red-700 inline-flex items-center gap-1"
                                  title="Click to remove"
                                >
                                  {ex} ×
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            className="input"
                            aria-label="Add skip date"
                            onChange={(e) => {
                              if (e.target.value) {
                                addException(d.dayOfWeek, e.target.value);
                                e.target.value = "";
                              }
                            }}
                          />
                          <span className="text-xs text-slate-400">
                            Holidays, one-off pauses
                          </span>
                        </div>
                      </div>
                    </div>
                  </details>
                </div>
              );
            })}
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
                ? "bg-brand-blue text-white border-brand-blue"
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

/**
 * Reference-photo uploader per key set. Uses the same Vercel Blob client
 * + /api/blob/upload-token route as KeySetForm + PhotoGrid, so the
 * server-side validation (allowed content types, size cap, siteId
 * check) doesn't need touching.
 *
 * siteId can be null when the site is being CREATED (no UUID yet). In
 * that case we disable upload — the operator can save the site first
 * then add photos via /key-sets/[id]. Same trade-off the photo flow
 * has had since PR #15; uploading before the parent row exists would
 * orphan blobs in storage if the form fails server-side validation.
 */
function SetPhotoField({
  value,
  onChange,
  siteId,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  siteId: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !siteId) return;
    setUploading(true);
    setError(null);
    try {
      const result = await upload(`uploads/key-sets/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload-token",
        clientPayload: JSON.stringify({ siteId }),
      });
      onChange(result.url);
    } catch (err: any) {
      setError(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="label">Reference photo</label>
      <p className="text-xs text-slate-500 mb-2">
        One photo of the physical bunch — helps officers recognise the set
        on arrival.
      </p>
      {value ? (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Key set"
            className="rounded-xl border border-slate-200 max-h-32"
          />
          <div className="flex flex-col gap-1.5">
            <label className="btn-secondary text-xs cursor-pointer inline-block">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={onFile}
                disabled={!siteId || uploading}
                className="hidden"
              />
              {uploading ? "Uploading…" : "Replace"}
            </label>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="btn-ghost text-xs text-red-600"
            >
              Remove
            </button>
          </div>
        </div>
      ) : siteId ? (
        <label className="btn-secondary text-sm cursor-pointer inline-block">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFile}
            disabled={uploading}
            className="hidden"
          />
          {uploading ? "Uploading…" : "Upload photo"}
        </label>
      ) : (
        <p className="text-xs text-slate-500 italic">
          Save the site first to upload a reference photo for this set.
        </p>
      )}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
