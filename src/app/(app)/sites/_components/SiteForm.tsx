"use client";

import Link from "next/link";
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

  return (
    <form action={formAction} className="space-y-6 max-w-3xl">
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

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Ownership</h2>
        <p className="text-sm text-slate-500 -mt-2">
          A site can belong to a direct customer, or be operated for a partner —
          not both. Leave both blank for sites without a billing relationship yet.
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
                  defaultChecked={initial.services.includes(s.v)}
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
            rows={4}
            className="input"
            placeholder="Access quirks, alarm code hints, parking, etc. Visible to officers."
          />
        </div>
      </div>

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
