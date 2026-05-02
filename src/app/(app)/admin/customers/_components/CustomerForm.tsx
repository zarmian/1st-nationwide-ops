"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { CustomerFormState } from "../_actions";

const CUSTOMER_TYPES = [
  { v: "CORPORATE", label: "Corporate" },
  { v: "RESIDENTIAL", label: "Residential" },
  { v: "RESELLER", label: "Reseller" },
];

export type ContactRow = {
  id?: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  ref: string | null;
  notes: string | null;
};

export type CustomerFormValues = {
  id?: string;
  name: string;
  type: string;
  billingAddress: string | null;
  contractRef: string | null;
  contractStart: string | null; // YYYY-MM-DD
  contractEnd: string | null;
  notes: string | null;
  active: boolean;
  contacts: ContactRow[];
};

export function CustomerForm({
  action,
  initial,
  submitLabel,
}: {
  action: (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  initial: CustomerFormValues;
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  const [contacts, setContacts] = useState<ContactRow[]>(initial.contacts);
  const contactsJson = useMemo(() => JSON.stringify(contacts), [contacts]);

  function addContact() {
    setContacts((rs) => [
      ...rs,
      { name: "", role: "", email: "", phone: "", ref: "", notes: "" },
    ]);
  }
  function update(i: number, patch: Partial<ContactRow>) {
    setContacts((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    setContacts((rs) => rs.filter((_, idx) => idx !== i));
  }

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
            {fe.name && (
              <p className="text-xs text-red-600 mt-1">{fe.name.join(", ")}</p>
            )}
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
              {CUSTOMER_TYPES.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="billingAddress">
            Billing address
          </label>
          <textarea
            id="billingAddress"
            name="billingAddress"
            defaultValue={initial.billingAddress ?? ""}
            rows={2}
            className="input"
          />
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="contractRef">
              Contract ref
            </label>
            <input
              id="contractRef"
              name="contractRef"
              defaultValue={initial.contractRef ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="contractStart">
              Contract start
            </label>
            <input
              id="contractStart"
              name="contractStart"
              type="date"
              defaultValue={initial.contractStart ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="contractEnd">
              Contract end
            </label>
            <input
              id="contractEnd"
              name="contractEnd"
              type="date"
              defaultValue={initial.contractEnd ?? ""}
              className="input"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial.active}
            className="rounded border-slate-300 text-brand-mint focus:ring-brand-mint/30"
          />
          <span>Active — customer is live and can be assigned to sites</span>
        </label>

        <div>
          <label className="label" htmlFor="notes">
            Internal notes
          </label>
          <textarea
            id="notes"
            name="notes"
            defaultValue={initial.notes ?? ""}
            rows={3}
            className="input"
          />
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-brand-navy">Contacts</h2>
            <p className="text-sm text-slate-500">
              Site managers, regional contacts, alarm-receiving centres, etc.
            </p>
          </div>
          <button
            type="button"
            onClick={addContact}
            className="btn-secondary text-sm"
          >
            + Add contact
          </button>
        </div>

        {contacts.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No contacts yet.</p>
        ) : (
          <div className="space-y-2">
            {contacts.map((c, i) => (
              <div
                key={i}
                className="grid md:grid-cols-[1fr_140px_1fr_160px_auto] gap-2 items-end rounded-lg border border-slate-200 p-2 bg-slate-50/40"
              >
                <div>
                  <label className="label">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    className="input"
                    value={c.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Role</label>
                  <input
                    className="input"
                    value={c.role ?? ""}
                    onChange={(e) => update(i, { role: e.target.value || null })}
                    placeholder="Site manager"
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    className="input"
                    type="email"
                    value={c.email ?? ""}
                    onChange={(e) => update(i, { email: e.target.value || null })}
                  />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input
                    className="input"
                    value={c.phone ?? ""}
                    onChange={(e) => update(i, { phone: e.target.value || null })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="btn-ghost text-sm text-red-600"
                >
                  Remove
                </button>
                <div className="md:col-span-5 grid md:grid-cols-2 gap-2">
                  <input
                    className="input"
                    value={c.ref ?? ""}
                    onChange={(e) => update(i, { ref: e.target.value || null })}
                    placeholder="Reference (e.g. Chubb ref CR-22841)"
                  />
                  <input
                    className="input"
                    value={c.notes ?? ""}
                    onChange={(e) => update(i, { notes: e.target.value || null })}
                    placeholder="Notes"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <input type="hidden" name="contacts_json" value={contactsJson} readOnly />

      <div className="flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        <Link href="/admin/customers" className="btn-secondary">
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
