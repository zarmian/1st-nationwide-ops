"use client";

import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { FormError } from "@/components/FormError";
import {
  createJobSourceOption,
  createJobTypeOption,
  deleteJobSourceOption,
  deleteJobTypeOption,
  toggleJobSourceOptionActive,
  toggleJobTypeOptionActive,
  updateJobSourceOption,
  updateJobTypeOption,
} from "../_actions";

type OptionRow = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
};

type Kind = "type" | "source";

const HUMANISED_CODE: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Mobile patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  VPI: "Void property inspection",
  ADHOC: "Ad-hoc / other",
  STATIC_GUARDING_SHIFT: "Static guarding shift",
  DOG_HANDLER_SHIFT: "Dog handler shift",
  SCHEDULED: "Scheduled",
  ALARM: "Alarm",
  PARTNER_REQUEST: "Partner request",
  CUSTOMER_REQUEST: "Customer request",
  ONBOARDING: "Onboarding",
  AD_HOC: "Ad-hoc",
};

export function OptionsManager({
  jobTypes,
  jobSources,
  jobTypeCodes,
  jobSourceCodes,
}: {
  jobTypes: OptionRow[];
  jobSources: OptionRow[];
  jobTypeCodes: string[];
  jobSourceCodes: string[];
}) {
  const [tab, setTab] = useState<Kind>("type");

  return (
    <div className="space-y-4">
      <div className="border-b border-slate-200 flex gap-2">
        <TabButton active={tab === "type"} onClick={() => setTab("type")}>
          Job types ({jobTypes.filter((o) => o.active).length} active)
        </TabButton>
        <TabButton active={tab === "source"} onClick={() => setTab("source")}>
          Job sources ({jobSources.filter((o) => o.active).length} active)
        </TabButton>
      </div>

      {tab === "type" ? (
        <OptionList
          kind="type"
          options={jobTypes}
          codes={jobTypeCodes}
          intro="Categories you can pick from when creating a callout or new job. Add a single label per category to rename it everywhere; add multiple labels under one category to create picker-only sub-types (the canonical category name is used on activity lists and the dispatch board)."
        />
      ) : (
        <OptionList
          kind="source"
          options={jobSources}
          codes={jobSourceCodes}
          intro="Where a job came from. Shown on the dispatch board and report templates. Same convention as job types — multiple labels under one source act as picker-only aliases."
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-4 py-2 text-sm font-medium transition border-b-2 -mb-px " +
        (active
          ? "border-brand-blue text-brand-navy"
          : "border-transparent text-slate-500 hover:text-brand-navy")
      }
    >
      {children}
    </button>
  );
}

function OptionList({
  kind,
  options,
  codes,
  intro,
}: {
  kind: Kind;
  options: OptionRow[];
  codes: string[];
  intro: string;
}) {
  // Group by code so the alias relationship is visible. Codes with no
  // existing option appear at the bottom with an empty bucket.
  const byCode = new Map<string, OptionRow[]>();
  for (const code of codes) byCode.set(code, []);
  for (const o of options) {
    const list = byCode.get(o.code);
    if (list) list.push(o);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 max-w-2xl">{intro}</p>

      <div className="card p-4">
        <h2 className="font-semibold text-brand-navy mb-3">Add a new label</h2>
        <NewOptionForm kind={kind} codes={codes} />
      </div>

      <div className="space-y-3">
        {Array.from(byCode.entries()).map(([code, rows]) => (
          <div key={code} className="card overflow-hidden">
            <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-baseline justify-between">
              <div>
                <span className="font-mono text-xs text-slate-500">{code}</span>
                <span className="ml-2 text-sm text-slate-600">
                  {HUMANISED_CODE[code] ?? code}
                </span>
              </div>
              <span className="text-xs text-slate-500">
                {rows.filter((r) => r.active).length} active
                {rows.length > rows.filter((r) => r.active).length &&
                  ` · ${rows.length - rows.filter((r) => r.active).length} hidden`}
              </span>
            </div>
            {rows.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-500 italic">
                No labels yet. This category won't appear in pickers — add
                one above to use it.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <OptionRowEditor row={r} kind={kind} codes={codes} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function NewOptionForm({
  kind,
  codes,
}: {
  kind: Kind;
  codes: string[];
}) {
  const create = kind === "type" ? createJobTypeOption : createJobSourceOption;
  const [state, formAction] = useFormState(create, {});
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="grid sm:grid-cols-12 gap-3 items-end">
      <FormError message={state.error} />
      <div className="sm:col-span-3">
        <label className="label" htmlFor="new-code">Category</label>
        <select id="new-code" name="code" className="input" required defaultValue="">
          <option value="" disabled>— pick —</option>
          {codes.map((c) => (
            <option key={c} value={c}>
              {HUMANISED_CODE[c] ?? c}
            </option>
          ))}
        </select>
        {fe.code?.[0] && <p className="text-xs text-red-600 mt-1">{fe.code[0]}</p>}
      </div>
      <div className="sm:col-span-4">
        <label className="label" htmlFor="new-label">Label</label>
        <input
          id="new-label"
          name="label"
          type="text"
          className="input"
          placeholder="e.g. Spot check"
          required
          maxLength={80}
        />
        {fe.label?.[0] && <p className="text-xs text-red-600 mt-1">{fe.label[0]}</p>}
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="new-sort">Sort</label>
        <input
          id="new-sort"
          name="sortOrder"
          type="number"
          className="input"
          defaultValue={100}
          min={0}
          max={9999}
        />
      </div>
      <div className="sm:col-span-2 flex items-center">
        <label className="flex items-center gap-2 text-sm text-slate-700 mt-5">
          <input type="checkbox" name="active" defaultChecked className="rounded" />
          Active
        </label>
      </div>
      <div className="sm:col-span-1">
        <SubmitButton label="Add" />
      </div>
    </form>
  );
}

function OptionRowEditor({
  row,
  kind,
  codes,
}: {
  row: OptionRow;
  kind: Kind;
  codes: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function onToggleActive() {
    const fn = kind === "type" ? toggleJobTypeOptionActive : toggleJobSourceOptionActive;
    startTransition(() => fn(row.id));
  }

  function onDelete() {
    if (!confirm(`Delete "${row.label}"? Existing jobs that use this code keep working — they'll just fall back to a default label.`)) {
      return;
    }
    const fn = kind === "type" ? deleteJobTypeOption : deleteJobSourceOption;
    startTransition(async () => {
      await fn(row.id);
    });
  }

  if (editing) {
    return (
      <EditRowForm
        row={row}
        kind={kind}
        codes={codes}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-xs text-slate-400 font-mono w-10 tabular-nums">
        #{row.sortOrder}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={"font-medium " + (row.active ? "text-brand-navy" : "text-slate-400 line-through")}>
            {row.label}
          </span>
          {!row.active && (
            <span className="chip-slate text-xs">Hidden</span>
          )}
        </div>
        {row.description && (
          <div className="text-xs text-slate-500 mt-0.5">{row.description}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-slate-600 hover:text-brand-navy underline"
          disabled={pending}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onToggleActive}
          className="text-xs text-slate-600 hover:text-brand-navy underline"
          disabled={pending}
        >
          {row.active ? "Hide" : "Show"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-red-600 hover:text-red-800 underline"
          disabled={pending}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function EditRowForm({
  row,
  kind,
  codes,
  onDone,
}: {
  row: OptionRow;
  kind: Kind;
  codes: string[];
  onDone: () => void;
}) {
  const update = kind === "type" ? updateJobTypeOption : updateJobSourceOption;
  const [state, formAction] = useFormState(
    update.bind(null, row.id),
    {},
  );
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="grid sm:grid-cols-12 gap-3 items-end">
      <FormError message={state.error} />
      <div className="sm:col-span-3">
        <label className="label" htmlFor={`opt-${row.id}-code`}>Category</label>
        <select
          id={`opt-${row.id}-code`}
          name="code"
          className="input"
          defaultValue={row.code}
          required
        >
          {codes.map((c) => (
            <option key={c} value={c}>
              {HUMANISED_CODE[c] ?? c}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-4">
        <label className="label" htmlFor={`opt-${row.id}-label`}>Label</label>
        <input
          id={`opt-${row.id}-label`}
          name="label"
          type="text"
          className="input"
          defaultValue={row.label}
          required
          maxLength={80}
        />
        {fe.label?.[0] && <p className="text-xs text-red-600 mt-1">{fe.label[0]}</p>}
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`opt-${row.id}-sortOrder`}>Sort</label>
        <input
          id={`opt-${row.id}-sortOrder`}
          name="sortOrder"
          type="number"
          className="input"
          defaultValue={row.sortOrder}
          min={0}
          max={9999}
        />
      </div>
      <div className="sm:col-span-2 flex items-center">
        <label className="flex items-center gap-2 text-sm text-slate-700 mt-5">
          <input
            type="checkbox"
            name="active"
            defaultChecked={row.active}
            className="rounded"
          />
          Active
        </label>
      </div>
      <div className="sm:col-span-1 flex items-center gap-2">
        <SubmitButton label="Save" onAfter={onDone} />
        <button
          type="button"
          onClick={onDone}
          className="text-xs text-slate-500 hover:text-brand-navy"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SubmitButton({ label, onAfter }: { label: string; onAfter?: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-primary text-sm"
      disabled={pending}
      onClick={() => {
        if (!pending && onAfter) {
          // Defer one tick so the form action commits first.
          setTimeout(onAfter, 0);
        }
      }}
    >
      {pending ? "…" : label}
    </button>
  );
}
