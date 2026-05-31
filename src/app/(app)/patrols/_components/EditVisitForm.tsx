"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { FormError } from "@/components/FormError";
import type { EditVisitState } from "../_actions";

const STATUSES = [
  { v: "PENDING", label: "Pending" },
  { v: "IN_PROGRESS", label: "In progress" },
  { v: "COMPLETED", label: "Completed" },
  { v: "LATE", label: "Late" },
  { v: "MISSED", label: "Missed" },
] as const;

export type EditableVisit = {
  id: string;
  scheduledAt: string;
  arrivedAt: string | null;
  departedAt: string | null;
  status: string;
  officerId: string | null;
  notes: string | null;
  siteName: string;
  siteCode: string | null;
  sitePostcode: string;
  kindLabel: string;
};

export function EditVisitForm({
  visit,
  officers,
  action,
}: {
  visit: EditableVisit;
  officers: { id: string; name: string }[];
  action: (state: EditVisitState, fd: FormData) => Promise<EditVisitState>;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-6 max-w-3xl">
      <FormError message={state.error} />

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Visit</h2>

        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-0.5">
            Site (locked) · {visit.kindLabel}
          </div>
          <div className="font-medium text-brand-navy">
            {visit.siteCode ? `${visit.siteCode} — ` : ""}
            {visit.siteName}
          </div>
          <div className="text-xs text-slate-500">{visit.sitePostcode}</div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="officerId">Officer</label>
            <select
              id="officerId"
              name="officerId"
              defaultValue={visit.officerId ?? ""}
              className="input"
            >
              <option value="">— unassigned —</option>
              {officers.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select
              id="status"
              name="status"
              defaultValue={visit.status}
              className="input"
            >
              {STATUSES.map((s) => (
                <option key={s.v} value={s.v}>{s.label}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Admin override — normally set by the officer's check-in /
              check-out, or the cron when a visit is missed.
            </p>
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">When</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="scheduledAt">Scheduled at</label>
            <input
              type="datetime-local"
              id="scheduledAt"
              name="scheduledAt"
              defaultValue={toLocalInput(visit.scheduledAt)}
              className="input"
              required
            />
            {fe.scheduledAt?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.scheduledAt[0]}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="arrivedAt">Arrived at</label>
            <input
              type="datetime-local"
              id="arrivedAt"
              name="arrivedAt"
              defaultValue={toLocalInput(visit.arrivedAt)}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="departedAt">Departed at</label>
            <input
              type="datetime-local"
              id="departedAt"
              name="departedAt"
              defaultValue={toLocalInput(visit.departedAt)}
              className="input"
            />
            {fe.departedAt?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.departedAt[0]}</p>
            )}
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Notes</h2>
        <textarea
          name="notes"
          rows={4}
          defaultValue={visit.notes ?? ""}
          className="input"
          maxLength={2000}
          placeholder="Anything noteworthy about this visit."
        />
      </div>

      <div className="flex items-center justify-between">
        <Link
          href={`/patrols/visits/${visit.id}`}
          className="text-sm text-slate-500 hover:text-brand-navy"
        >
          ← Cancel
        </Link>
        <SaveButton />
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
