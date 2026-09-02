"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import type { OfficerFormState } from "../_actions";
import { FormError } from "@/components/FormError";

const ROLES = [
  { v: "OFFICER", label: "Officer" },
  { v: "DISPATCHER", label: "Dispatcher" },
  { v: "ADMIN", label: "Admin" },
];

export type OfficerFormValues = {
  id?: string;
  name: string;
  email: string;
  phone: string | null;
  whatsappNumber: string | null;
  siaNumber: string | null;
  siaExpiry: string | null; // ISO yyyy-mm-dd
  rightToWorkExpiry: string | null; // ISO yyyy-mm-dd
  dbsCheckedOn: string | null; // ISO yyyy-mm-dd
  regionId: number | null;
  role: string;
  active: boolean;
};

export function OfficerForm({
  action,
  initial,
  regions,
  isCreate,
  submitLabel,
}: {
  action: (s: OfficerFormState, fd: FormData) => Promise<OfficerFormState>;
  initial: OfficerFormValues;
  regions: { id: number; name: string }[];
  isCreate: boolean;
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-6 max-w-3xl">
      <FormError message={state.error} />

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Identity</h2>
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
            {fe.name && <p className="text-xs text-red-600 mt-1">{fe.name.join(", ")}</p>}
          </div>
          <div>
            <label className="label" htmlFor="email">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              defaultValue={initial.email}
              className="input"
              required
            />
            {fe.email && <p className="text-xs text-red-600 mt-1">{fe.email.join(", ")}</p>}
          </div>
          <div>
            <label className="label" htmlFor="phone">
              Phone
            </label>
            <input
              id="phone"
              name="phone"
              defaultValue={initial.phone ?? ""}
              className="input"
              placeholder="+44 7…"
            />
          </div>
          <div>
            <label className="label" htmlFor="whatsappNumber">
              WhatsApp number
            </label>
            <input
              id="whatsappNumber"
              name="whatsappNumber"
              defaultValue={initial.whatsappNumber ?? ""}
              className="input"
              placeholder="07700 900123 or +44…"
            />
            {fe.whatsappNumber && (
              <p className="text-xs text-red-600 mt-1">
                {fe.whatsappNumber.join(", ")}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-1">
              Receives WhatsApp notifications for visits, alarms, and key
              handovers. Leave blank to opt out.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="siaNumber">
              SIA number
            </label>
            <input
              id="siaNumber"
              name="siaNumber"
              defaultValue={initial.siaNumber ?? ""}
              className="input font-mono text-xs"
              placeholder="e.g. 1010 2345 6789 0123"
            />
            {fe.siaNumber && (
              <p className="text-xs text-red-600 mt-1">{fe.siaNumber.join(", ")}</p>
            )}
            <p className="text-xs text-slate-500 mt-1">
              Shown next to officer name on /submit when set.
            </p>
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Role &amp; region</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="role">
              Role
            </label>
            <select
              id="role"
              name="role"
              defaultValue={initial.role}
              className="input"
            >
              {ROLES.map((r) => (
                <option key={r.v} value={r.v}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
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
              <option value="">— none —</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial.active}
            className="checkbox"
          />
          <span>Active — inactive accounts can't sign in.</span>
        </label>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-brand-navy">Compliance &amp; vetting</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Expiry dates drive the compliance register and its alerts. Leave a
            date blank if it doesn't apply (e.g. indefinite right to work).
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="siaExpiry">
              SIA licence expiry
            </label>
            <input
              id="siaExpiry"
              name="siaExpiry"
              type="date"
              defaultValue={initial.siaExpiry ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="rightToWorkExpiry">
              Right-to-work expiry
            </label>
            <input
              id="rightToWorkExpiry"
              name="rightToWorkExpiry"
              type="date"
              defaultValue={initial.rightToWorkExpiry ?? ""}
              className="input"
            />
            <p className="text-xs text-slate-500 mt-1">
              Blank = indefinite (settled / British).
            </p>
          </div>
          <div>
            <label className="label" htmlFor="dbsCheckedOn">
              DBS last checked
            </label>
            <input
              id="dbsCheckedOn"
              name="dbsCheckedOn"
              type="date"
              defaultValue={initial.dbsCheckedOn ?? ""}
              className="input"
            />
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">
          {isCreate ? "Initial password" : "Reset password"}
        </h2>
        <div>
          <label className="label" htmlFor="password">
            Password{isCreate && <span className="text-red-500"> *</span>}
          </label>
          <input
            id="password"
            name="password"
            type="text"
            className="input font-mono text-xs"
            placeholder={isCreate ? "Min 8 characters" : "Leave blank to keep current"}
            required={isCreate}
          />
          {fe.password && (
            <p className="text-xs text-red-600 mt-1">{fe.password.join(", ")}</p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            {isCreate
              ? "Share with the officer on first login. They can change it later."
              : "Leave blank to keep the current password."}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        <Link href="/officers" className="btn-secondary">
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
