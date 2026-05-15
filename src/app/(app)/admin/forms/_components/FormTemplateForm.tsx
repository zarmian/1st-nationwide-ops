"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { FormTemplateState } from "../_actions";
import { SUBMISSION_FORM_LABEL } from "@/lib/formTemplates";
import {
  FieldEditor,
  newField,
  newSection,
  type FieldRow,
} from "./FieldEditor";
import { FormError } from "@/components/FormError";

export type { FieldRow } from "./FieldEditor";

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

const SCOPES = [
  { v: "GLOBAL", label: "Global (default for the job type)" },
  { v: "CUSTOMER", label: "Customer (overrides global)" },
  { v: "PARTNER", label: "Partner (overrides global)" },
  { v: "SITE", label: "Site (overrides everything)" },
] as const;

export type TemplateFormValues = {
  id?: string;
  name: string;
  jobType: string | null;
  scope: string;
  customerId: string | null;
  partnerId: string | null;
  siteId: string | null;
  fields: FieldRow[];
  active: boolean;
};

export function FormTemplateForm({
  action,
  initial,
  customers,
  partners,
  sites,
  submitLabel,
  blueprintId,
}: {
  action: (s: FormTemplateState, fd: FormData) => Promise<FormTemplateState>;
  initial: TemplateFormValues;
  customers: { id: string; name: string }[];
  partners: { id: string; name: string }[];
  sites: { id: string; name: string; code: string | null }[];
  submitLabel: string;
  blueprintId?: string | null;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  const [scope, setScope] = useState(initial.scope);
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
              placeholder="Shurgard patrol form"
              required
            />
            {fe.name && (
              <p className="text-xs text-red-600 mt-1">{fe.name.join(", ")}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="jobType">
              Job type
            </label>
            <select
              id="jobType"
              name="jobType"
              defaultValue={initial.jobType ?? ""}
              className="input"
            >
              <option value="">Any job type (applies to all)</option>
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SUBMISSION_FORM_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="scope">
            Scope
          </label>
          <select
            id="scope"
            name="scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="input"
          >
            {SCOPES.map((s) => (
              <option key={s.v} value={s.v}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {scope === "CUSTOMER" && (
          <div>
            <label className="label" htmlFor="customerId">
              Customer <span className="text-red-500">*</span>
            </label>
            <select
              id="customerId"
              name="customerId"
              defaultValue={initial.customerId ?? ""}
              className="input"
            >
              <option value="">— pick customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {fe.customerId && (
              <p className="text-xs text-red-600 mt-1">
                {fe.customerId.join(", ")}
              </p>
            )}
          </div>
        )}

        {scope === "PARTNER" && (
          <div>
            <label className="label" htmlFor="partnerId">
              Partner <span className="text-red-500">*</span>
            </label>
            <select
              id="partnerId"
              name="partnerId"
              defaultValue={initial.partnerId ?? ""}
              className="input"
            >
              <option value="">— pick partner —</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {fe.partnerId && (
              <p className="text-xs text-red-600 mt-1">
                {fe.partnerId.join(", ")}
              </p>
            )}
          </div>
        )}

        {scope === "SITE" && (
          <div>
            <label className="label" htmlFor="siteId">
              Site <span className="text-red-500">*</span>
            </label>
            <select
              id="siteId"
              name="siteId"
              defaultValue={initial.siteId ?? ""}
              className="input"
            >
              <option value="">— pick site —</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code ? `${s.code} · ` : ""}
                  {s.name}
                </option>
              ))}
            </select>
            {fe.siteId && (
              <p className="text-xs text-red-600 mt-1">
                {fe.siteId.join(", ")}
              </p>
            )}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial.active}
            className="rounded border-slate-300 text-brand-mint focus:ring-brand-mint/30"
          />
          <span>
            Active — only active templates resolve when an officer opens
            /submit.
          </span>
        </label>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-brand-navy">Fields</h2>
            <p className="text-sm text-slate-500">
              The questions an officer answers. Order is the display order.
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
          <p className="text-sm text-slate-500 italic">
            No fields yet. The form will only capture name + arrived/departed.
          </p>
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
      {blueprintId && (
        <input type="hidden" name="blueprintId" value={blueprintId} readOnly />
      )}

      <div className="flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        <Link href="/admin/forms" className="btn-secondary">
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

