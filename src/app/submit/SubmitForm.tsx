"use client";

import { useMemo, useState } from "react";
import type { FieldDef } from "@/lib/formTemplates";

type Site = {
  id: string;
  name: string;
  postcode: string | null;
  customerId: string | null;
  partnerId: string | null;
};

export type SubmitTemplate = {
  id: string;
  name: string;
  jobType: string;
  scope: "GLOBAL" | "CUSTOMER" | "PARTNER" | "SITE";
  customerId: string | null;
  partnerId: string | null;
  siteId: string | null;
  fields: FieldDef[];
};

const FORM_TYPES = [
  { value: "PATROL", label: "Mobile patrol visit" },
  { value: "ALARM_RESPONSE", label: "Alarm response" },
  { value: "LOCK", label: "Lock-up" },
  { value: "UNLOCK", label: "Unlock" },
  { value: "KEY_COLLECTION", label: "Key collection" },
  { value: "KEY_DROPOFF", label: "Key drop-off" },
  { value: "VPI", label: "Void property inspection" },
  { value: "ADHOC", label: "Other / ad-hoc" },
];

export function SubmitForm({
  sites,
  templates,
  officerName,
  isInternal,
  prefilledSiteId,
  prefilledJobId,
  prefilledJobType,
}: {
  sites: Site[];
  templates: SubmitTemplate[];
  officerName: string;
  isInternal: boolean;
  prefilledSiteId: string | null;
  prefilledJobId: string | null;
  prefilledJobType: string | null;
}) {
  const [siteId, setSiteId] = useState(prefilledSiteId ?? "");
  const [siteSearch, setSiteSearch] = useState("");
  const [formType, setFormType] = useState(
    mapJobTypeToForm(prefilledJobType) ?? "PATROL",
  );
  const [name, setName] = useState(officerName);
  const [arrivedAt, setArrivedAt] = useState(localNow());
  const [departedAt, setDepartedAt] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const filteredSites = siteSearch
    ? sites.filter(
        (s) =>
          s.name.toLowerCase().includes(siteSearch.toLowerCase()) ||
          (s.postcode ?? "").toLowerCase().includes(siteSearch.toLowerCase()),
      )
    : sites.slice(0, 20);

  const template = useMemo(
    () => resolveTemplate(siteId, formType, sites, templates),
    [siteId, formType, sites, templates],
  );

  function setField(key: string, v: unknown) {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (fieldErrors[key]) {
      const next = { ...fieldErrors };
      delete next[key];
      setFieldErrors(next);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!siteId) {
      setError("Please pick a site.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          jobId: prefilledJobId,
          form: formType,
          formTemplateId: template?.id ?? null,
          officerNameRaw: name,
          arrivedAt: arrivedAt ? new Date(arrivedAt).toISOString() : null,
          departedAt: departedAt ? new Date(departedAt).toISOString() : null,
          payload: values,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        if (j?.fieldErrors) setFieldErrors(j.fieldErrors);
        throw new Error(j?.error ?? "Could not save the report");
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="card p-6 text-center">
        <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-brand-mint-light text-brand-mint-dark grid place-items-center text-2xl">
          ✓
        </div>
        <h2 className="text-lg font-semibold text-brand-navy">
          Report submitted
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Thanks{name ? `, ${name.split(" ")[0]}` : ""}. Our admin will review and
          send the client copy.
        </p>
        <button
          onClick={() => {
            setSubmitted(false);
            setSiteId("");
            setValues({});
            setArrivedAt(localNow());
            setDepartedAt("");
          }}
          className="btn-primary mt-5"
        >
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form className="card p-6 space-y-4" onSubmit={onSubmit}>
      <div>
        <label className="label">Type of job</label>
        <select
          value={formType}
          onChange={(e) => {
            setFormType(e.target.value);
            setValues({});
            setFieldErrors({});
          }}
          className="input"
        >
          {FORM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Site</label>
        <input
          type="search"
          placeholder="Search site name or postcode…"
          value={siteSearch}
          onChange={(e) => setSiteSearch(e.target.value)}
          className="input mb-2"
        />
        <select
          value={siteId}
          onChange={(e) => {
            setSiteId(e.target.value);
            setValues({});
            setFieldErrors({});
          }}
          className="input"
          required
        >
          <option value="">— pick a site —</option>
          {filteredSites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.postcode ? ` · ${s.postcode}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Your name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="input"
          required
          readOnly={isInternal && !!officerName}
        />
        {isInternal && (
          <p className="text-xs text-slate-500 mt-1">
            Pre-filled from your account.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Arrived</label>
          <input
            type="datetime-local"
            value={arrivedAt}
            onChange={(e) => setArrivedAt(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label">Departed</label>
          <input
            type="datetime-local"
            value={departedAt}
            onChange={(e) => setDepartedAt(e.target.value)}
            className="input"
          />
        </div>
      </div>

      {siteId && (
        <TemplateBody
          template={template}
          values={values}
          setField={setField}
          fieldErrors={fieldErrors}
        />
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        className="btn-primary w-full"
        disabled={submitting || !siteId}
      >
        {submitting ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}

function TemplateBody({
  template,
  values,
  setField,
  fieldErrors,
}: {
  template: SubmitTemplate | null;
  values: Record<string, unknown>;
  setField: (k: string, v: unknown) => void;
  fieldErrors: Record<string, string>;
}) {
  if (!template) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        No form template configured for this site + job type. Submission will
        save with just officer name and arrival/departure. Tell admin to set up
        a template at /admin/forms.
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-slate-200 pt-4">
      <div className="text-xs uppercase tracking-wider text-slate-500">
        {template.name}
      </div>
      {template.fields.length === 0 && (
        <p className="text-sm text-slate-500 italic">
          This template has no fields yet.
        </p>
      )}
      {template.fields.map((f) => (
        <FieldInput
          key={f.key}
          field={f}
          value={values[f.key]}
          onChange={(v) => setField(f.key, v)}
          error={fieldErrors[f.key]}
        />
      ))}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  error,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
}) {
  const id = `f_${field.key}`;
  const labelEl = (
    <label className="label" htmlFor={id}>
      {field.label}
      {field.required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
  const helpEl = field.helpText ? (
    <p className="text-xs text-slate-500 mt-1">{field.helpText}</p>
  ) : null;
  const errorEl = error ? (
    <p className="text-xs text-red-600 mt-1">{error}</p>
  ) : null;

  switch (field.type) {
    case "checkbox":
      return (
        <div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              id={id}
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              className="rounded border-slate-300 text-brand-mint focus:ring-brand-mint/30"
            />
            <span>
              {field.label}
              {field.required && <span className="text-red-500 ml-0.5">*</span>}
            </span>
          </label>
          {helpEl}
          {errorEl}
        </div>
      );
    case "textarea":
      return (
        <div>
          {labelEl}
          <textarea
            id={id}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="input min-h-[100px]"
            required={field.required}
          />
          {helpEl}
          {errorEl}
        </div>
      );
    case "select":
      return (
        <div>
          {labelEl}
          <select
            id={id}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="input"
            required={field.required}
          >
            <option value="">— select —</option>
            {field.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {helpEl}
          {errorEl}
        </div>
      );
    case "number":
      return (
        <div>
          {labelEl}
          <input
            id={id}
            type="number"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="input"
            required={field.required}
          />
          {helpEl}
          {errorEl}
        </div>
      );
    case "date":
    case "time":
    case "datetime":
      return (
        <div>
          {labelEl}
          <input
            id={id}
            type={field.type === "datetime" ? "datetime-local" : field.type}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="input"
            required={field.required}
          />
          {helpEl}
          {errorEl}
        </div>
      );
    case "text":
    default:
      return (
        <div>
          {labelEl}
          <input
            id={id}
            type="text"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="input"
            required={field.required}
          />
          {helpEl}
          {errorEl}
        </div>
      );
  }
}

function resolveTemplate(
  siteId: string,
  jobType: string,
  sites: Site[],
  templates: SubmitTemplate[],
): SubmitTemplate | null {
  const site = sites.find((s) => s.id === siteId);
  if (siteId) {
    const t = templates.find(
      (x) => x.scope === "SITE" && x.siteId === siteId && x.jobType === jobType,
    );
    if (t) return t;
  }
  if (site?.customerId) {
    const t = templates.find(
      (x) =>
        x.scope === "CUSTOMER" &&
        x.customerId === site.customerId &&
        x.jobType === jobType,
    );
    if (t) return t;
  }
  if (site?.partnerId) {
    const t = templates.find(
      (x) =>
        x.scope === "PARTNER" &&
        x.partnerId === site.partnerId &&
        x.jobType === jobType,
    );
    if (t) return t;
  }
  const g = templates.find(
    (x) => x.scope === "GLOBAL" && x.jobType === jobType,
  );
  return g ?? null;
}

function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function mapJobTypeToForm(t: string | null): string | null {
  if (!t) return null;
  const map: Record<string, string> = {
    ALARM_RESPONSE: "ALARM_RESPONSE",
    PATROL: "PATROL",
    LOCK: "LOCK",
    UNLOCK: "UNLOCK",
    KEY_COLLECTION: "KEY_COLLECTION",
    KEY_DROPOFF: "KEY_DROPOFF",
    VPI: "VPI",
    SURVEY: "ADHOC",
  };
  return map[t] ?? "ADHOC";
}
