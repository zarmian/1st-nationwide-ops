"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { FormTemplateState } from "../_actions";
import { SUBMISSION_FORM_LABEL } from "@/lib/formTemplates";

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

const FIELD_TYPES = [
  { v: "text", label: "Short text" },
  { v: "textarea", label: "Long text" },
  { v: "checkbox", label: "Checkbox" },
  { v: "select", label: "Drop-down" },
  { v: "number", label: "Number" },
  { v: "date", label: "Date" },
  { v: "time", label: "Time" },
  { v: "datetime", label: "Date + time" },
] as const;

export type FieldRow = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  helpText?: string | null;
};

export type TemplateFormValues = {
  id?: string;
  name: string;
  jobType: string;
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
}: {
  action: (s: FormTemplateState, fd: FormData) => Promise<FormTemplateState>;
  initial: TemplateFormValues;
  customers: { id: string; name: string }[];
  partners: { id: string; name: string }[];
  sites: { id: string; name: string; code: string | null }[];
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  const [scope, setScope] = useState(initial.scope);
  const [fields, setFields] = useState<FieldRow[]>(initial.fields);
  const fieldsJson = useMemo(() => JSON.stringify(fields), [fields]);

  function addField() {
    const n = fields.length + 1;
    setFields((rs) => [
      ...rs,
      {
        key: `field_${n}`,
        label: "",
        type: "text",
        required: false,
      },
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
      {state.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}

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
              defaultValue={initial.jobType}
              className="input"
            >
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
          <button type="button" onClick={addField} className="btn-secondary text-sm">
            + Add field
          </button>
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

      <div className="flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        <Link href="/admin/forms" className="btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function FieldEditor({
  field,
  fieldIndex,
  isFirst,
  isLast,
  fieldErrors,
  onChange,
  onRemove,
  onMove,
}: {
  field: FieldRow;
  fieldIndex: number;
  isFirst: boolean;
  isLast: boolean;
  fieldErrors: Record<string, string[]>;
  onChange: (patch: Partial<FieldRow>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const errKey = (suffix: string) =>
    fieldErrors[`fields.${fieldIndex}.${suffix}`]?.join(", ");

  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-3 bg-slate-50/40">
      <div className="grid md:grid-cols-[1fr_180px_140px_120px_auto] gap-2 items-end">
        <div>
          <label className="label">
            Label <span className="text-red-500">*</span>
          </label>
          <input
            className="input"
            value={field.label}
            onChange={(e) => {
              const label = e.target.value;
              const patch: Partial<FieldRow> = { label };
              // Auto-fill key from label if user hasn't customised it.
              if (
                !field.key ||
                field.key === slugify(field.label) ||
                /^field_\d+$/.test(field.key)
              ) {
                patch.key = slugify(label) || field.key;
              }
              onChange(patch);
            }}
            placeholder="All clear?"
            required
          />
          {errKey("label") && (
            <p className="text-xs text-red-600 mt-1">{errKey("label")}</p>
          )}
        </div>
        <div>
          <label className="label">
            Key <span className="text-red-500">*</span>
          </label>
          <input
            className="input font-mono text-xs"
            value={field.key}
            onChange={(e) => onChange({ key: e.target.value })}
            placeholder="all_clear"
            required
          />
          {errKey("key") && (
            <p className="text-xs text-red-600 mt-1">{errKey("key")}</p>
          )}
        </div>
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={field.type}
            onChange={(e) => onChange({ type: e.target.value })}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onChange({ required: e.target.checked })}
            className="rounded border-slate-300 text-brand-mint focus:ring-brand-mint/30"
          />
          <span>Required</span>
        </label>
        <div className="flex flex-col items-stretch gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={isFirst}
            className="btn-ghost text-xs disabled:text-slate-300"
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={isLast}
            className="btn-ghost text-xs disabled:text-slate-300"
            aria-label="Move down"
          >
            ↓
          </button>
        </div>
      </div>

      {field.type === "select" && (
        <div>
          <label className="label">
            Options (one per line) <span className="text-red-500">*</span>
          </label>
          <textarea
            className="input min-h-[80px]"
            value={(field.options ?? []).join("\n")}
            onChange={(e) =>
              onChange({
                options: e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder={"Yes\nNo\nN/A"}
          />
          {errKey("options") && (
            <p className="text-xs text-red-600 mt-1">{errKey("options")}</p>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-[1fr_auto] gap-2 items-end">
        <div>
          <label className="label">Help text</label>
          <input
            className="input"
            value={field.helpText ?? ""}
            onChange={(e) =>
              onChange({ helpText: e.target.value || null })
            }
            placeholder="Optional hint shown under the field"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="btn-ghost text-sm text-red-600"
        >
          Remove field
        </button>
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}
