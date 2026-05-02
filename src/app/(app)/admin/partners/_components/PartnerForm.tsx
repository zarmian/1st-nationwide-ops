"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { PartnerFormState } from "../_actions";

const PARTNER_ROLES = [
  { v: "CUSTOMER", label: "Customer (we work for them)" },
  { v: "SUBCONTRACTOR", label: "Subcontractor (we sub work to them)" },
  { v: "BOTH", label: "Both" },
];

const CHANNELS = [
  { v: "EMAIL", label: "Email" },
  { v: "PHONE", label: "Phone" },
  { v: "THEIR_APP", label: "Their app" },
  { v: "WHATSAPP", label: "WhatsApp" },
  { v: "PORTAL", label: "Portal" },
];

export type PartnerContactRow = {
  id?: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

export type PartnerFormValues = {
  id?: string;
  name: string;
  role: string;
  preferred: string;
  emailIntake: string | null;
  notes: string | null;
  active: boolean;
  contacts: PartnerContactRow[];
};

export function PartnerForm({
  action,
  initial,
  submitLabel,
}: {
  action: (state: PartnerFormState, formData: FormData) => Promise<PartnerFormState>;
  initial: PartnerFormValues;
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  const [contacts, setContacts] = useState<PartnerContactRow[]>(initial.contacts);
  const contactsJson = useMemo(() => JSON.stringify(contacts), [contacts]);

  function addContact() {
    setContacts((rs) => [
      ...rs,
      { name: "", role: "", email: "", phone: "", notes: "" },
    ]);
  }
  function update(i: number, patch: Partial<PartnerContactRow>) {
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

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="role">
              Relationship
            </label>
            <select
              id="role"
              name="role"
              defaultValue={initial.role}
              className="input"
            >
              {PARTNER_ROLES.map((r) => (
                <option key={r.v} value={r.v}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="preferred">
              Preferred channel
            </label>
            <select
              id="preferred"
              name="preferred"
              defaultValue={initial.preferred}
              className="input"
            >
              {CHANNELS.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="emailIntake">
            Intake email
          </label>
          <input
            id="emailIntake"
            name="emailIntake"
            type="email"
            defaultValue={initial.emailIntake ?? ""}
            className="input"
            placeholder="alarms@partner.example"
          />
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial.active}
            className="rounded border-slate-300 text-brand-mint focus:ring-brand-mint/30"
          />
          <span>Active</span>
        </label>

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
          />
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-brand-navy">Contacts</h2>
            <p className="text-sm text-slate-500">
              Dispatchers, account managers, accounts.
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
                <div className="md:col-span-5">
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
        <Link href="/admin/partners" className="btn-secondary">
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
