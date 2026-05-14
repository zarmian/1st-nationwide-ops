"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  FieldEditor,
  newField,
  newSection,
  type FieldRow,
} from "../../forms/_components/FieldEditor";
import { SUBMISSION_FORM_LABEL } from "@/lib/formTemplates";
import type { BlueprintFormState } from "../_actions";
import { FormError } from "@/components/FormError";

const JOB_TYPES = [
  "PATROL",
  "ALARM_RESPONSE",
  "LOCK",
  "UNLOCK",
  "KEY_COLLECTION",
  "KEY_DROPOFF",
  "VPI",
  "ADHOC",
] as const;

export type BlueprintFormValues = {
  id?: string;
  slug: string;
  name: string;
  description: string | null;
  jobType: string | null;
  source: string | null;
  fields: FieldRow[];
  active: boolean;
  builtin: boolean;
};

export function BlueprintForm({
  action,
  initial,
  submitLabel,
}: {
  action: (s: BlueprintFormState, fd: FormData) => Promise<BlueprintFormState>;
  initial: BlueprintFormValues;
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  const [fields, setFields] = useState<FieldRow[]>(initial.fields);
  const fieldsJson = useMemo(() => JSON.stringify(fields), [fields]);

  function addField() {
    setFields((rs) => [...rs, newField(rs.length + 1)]);
  }

  function addSection() {
    setFields((rs) => [
      ...rs,
      newSection(rs.filter((f) => f.type === "section").length + 1),
    ]);
  }

  function updateField(i: number, patch: Partial<FieldRow>) {
    setFields((rs) => rs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function removeField(i: number) {
    setFields((rs) => rs.filter((_, idx) => idx !== i));
  }

  function moveField(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = fields.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
  }

  return (
    <form action={formAction} className="space-y-6 max-w-4xl">
      <FormError message={state.error} />

      <div className="card p-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold text-brand-navy">Basics</h2>
          {initial.builtin && (
            <span className="chip-slate text-[10px]">Built-in</span>
          )}
        </div>

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
              placeholder="Shurgard mobile patrol"
              required
            />
            {fe.name && (
              <p className="text-xs text-red-600 mt-1">{fe.name.join(", ")}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="slug">
              Slug <span className="text-red-500">*</span>
            </label>
            <input
              id="slug"
              name="slug"
              defaultValue={initial.slug}
              className="input font-mono text-xs"
              placeholder="shurgard-mobile-patrol"
              required
            />
            {fe.slug && (
              <p className="text-xs text-red-600 mt-1">{fe.slug.join(", ")}</p>
            )}
            <p className="text-xs text-slate-500 mt-1">
              Stable identifier — never shown to officers.
            </p>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            defaultValue={initial.description ?? ""}
            className="input min-h-[60px]"
            placeholder="One line on when this template should be used."
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="jobType">
              Suggested job type
            </label>
            <select
              id="jobType"
              name="jobType"
              defaultValue={initial.jobType ?? ""}
              className="input"
            >
              <option value="">Any job type</option>
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SUBMISSION_FORM_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="source">
              Source
            </label>
            <input
              id="source"
              name="source"
              defaultValue={initial.source ?? ""}
              className="input"
              placeholder="FastField form 549243"
            />
            <p className="text-xs text-slate-500 mt-1">
              Optional — where the blueprint was modelled from.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial.active}
            className="rounded border-slate-300 text-brand-mint focus:ring-brand-mint/30"
          />
          <span>Active — only active blueprints show in the picker on /admin/forms/new.</span>
        </label>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-brand-navy">Fields</h2>
            <p className="text-sm text-slate-500">
              The starter questions. Admin can add or remove these per template
              after instantiating.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={addField} className="btn-secondary text-sm">
              + Add field
            </button>
            <button type="button" onClick={addSection} className="btn-secondary text-sm">
              + Section heading
            </button>
          </div>
        </div>

        {fields.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No fields yet.</p>
        ) : (
          <div className="space-y-3">
            {fields.map((f, i) => (
              <FieldEditor
                key={i}
                field={f}
                fieldIndex={i}
                isFirst={i === 0}
                isLast={i === fields.length - 1}
                fieldErrors={fe}
                onChange={(patch) => updateField(i, patch)}
                onRemove={() => removeField(i)}
                onMove={(dir) => moveField(i, dir)}
              />
            ))}
          </div>
        )}
      </div>

      <input type="hidden" name="fields_json" value={fieldsJson} readOnly />

      <div className="flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        <Link href="/admin/blueprints" className="btn-secondary">
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
