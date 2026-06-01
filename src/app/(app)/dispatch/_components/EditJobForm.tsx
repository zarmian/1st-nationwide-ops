"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { FormError } from "@/components/FormError";
import { formatUkDateTimeLocal } from "@/lib/dates";
import type { EditJobState } from "../_actions";

type PickerOption = { id: string; code: string; label: string };

const PRIORITIES = [
  { v: "LOW", label: "Low" },
  { v: "MEDIUM", label: "Medium" },
  { v: "HIGH", label: "High" },
] as const;

export type EditableJob = {
  id: string;
  type: string;
  source: string;
  priority: string;
  status: string;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  handedOffAt: string | null;
  assignedToUserId: string | null;
  handledByPartnerId: string | null;
  externalResponder: string | null;
  notes: string | null;
  partnerReportRef: string | null;
  excludeFromClientReport: boolean;
  siteName: string;
  siteCode: string | null;
  sitePostcode: string;
};

/**
 * Admin-only edit form for any Job. Pre-filled from the existing record.
 * Most fields are editable; site is locked (changing it would orphan
 * billing/key-handover lineage — admin can cancel + recreate if they
 * really need to). Status is also non-editable here — that flows through
 * the cancel button, completion flow, or review queue so the state
 * machine stays honest.
 */
export function EditJobForm({
  job,
  jobTypes,
  jobSources,
  officers,
  partners,
  action,
}: {
  job: EditableJob;
  jobTypes: PickerOption[];
  jobSources: PickerOption[];
  officers: { id: string; name: string }[];
  partners: { id: string; name: string }[];
  action: (state: EditJobState, fd: FormData) => Promise<EditJobState>;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  const initialHandlerKind: "officer" | "partner" = job.handledByPartnerId
    ? "partner"
    : "officer";
  const [handlerKind, setHandlerKind] = useState<"officer" | "partner">(
    initialHandlerKind,
  );

  return (
    <form action={formAction} className="space-y-6 max-w-3xl">
      <FormError message={state.error} />

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Basics</h2>

        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-0.5">
            Site (locked)
          </div>
          <div className="font-medium text-brand-navy">
            {job.siteCode ? `${job.siteCode} — ` : ""}
            {job.siteName}
          </div>
          <div className="text-xs text-slate-500">{job.sitePostcode}</div>
          <p className="text-xs text-slate-500 mt-1">
            Changing site after creation would orphan billing + key-handover
            history. Cancel and recreate if you need to move a job.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="type">Type</label>
            <select
              id="type"
              name="type"
              defaultValue={job.type}
              className="input"
            >
              {jobTypes.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="source">Source</label>
            <select
              id="source"
              name="source"
              defaultValue={job.source}
              className="input"
            >
              {jobSources.map((s) => (
                <option key={s.id} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="priority">Priority</label>
            <select
              id="priority"
              name="priority"
              defaultValue={job.priority}
              className="input"
            >
              {PRIORITIES.map((p) => (
                <option key={p.v} value={p.v}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Who handled this</h2>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="handlerKind"
              value="officer"
              checked={handlerKind === "officer"}
              onChange={() => setHandlerKind("officer")}
            />
            <span>Our officer</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="handlerKind"
              value="partner"
              checked={handlerKind === "partner"}
              onChange={() => setHandlerKind("partner")}
            />
            <span>Given to a partner</span>
          </label>
        </div>

        {handlerKind === "officer" ? (
          <div>
            <label className="label" htmlFor="assignedToUserId">Officer</label>
            <select
              id="assignedToUserId"
              name="assignedToUserId"
              defaultValue={job.assignedToUserId ?? ""}
              className="input"
            >
              <option value="">— unassigned —</option>
              {officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="handlerPartnerId">Partner</label>
              {partners.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  No subcontracting partners on file. Add one in Admin → Partners.
                </p>
              ) : (
                <select
                  id="handlerPartnerId"
                  name="handlerPartnerId"
                  defaultValue={job.handledByPartnerId ?? ""}
                  className="input"
                  required
                >
                  <option value="" disabled>Pick a partner…</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              {fe.handlerPartnerId?.[0] && (
                <p className="text-xs text-red-600 mt-1">{fe.handlerPartnerId[0]}</p>
              )}
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="handedOffAt">
                  When given to partner
                </label>
                <input
                  type="datetime-local"
                  id="handedOffAt"
                  name="handedOffAt"
                  defaultValue={formatUkDateTimeLocal(job.handedOffAt)}
                  className="input"
                />
              </div>
              <div>
                <label className="label" htmlFor="partnerOfficerName">
                  Their officer name (optional)
                </label>
                <input
                  type="text"
                  id="partnerOfficerName"
                  name="partnerOfficerName"
                  defaultValue={job.externalResponder ?? ""}
                  className="input"
                  maxLength={120}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">When</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="scheduledFor">Scheduled for</label>
            <input
              type="datetime-local"
              id="scheduledFor"
              name="scheduledFor"
              defaultValue={formatUkDateTimeLocal(job.scheduledFor)}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="startedAt">Started at</label>
            <input
              type="datetime-local"
              id="startedAt"
              name="startedAt"
              defaultValue={formatUkDateTimeLocal(job.startedAt)}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="completedAt">Completed at</label>
            <input
              type="datetime-local"
              id="completedAt"
              name="completedAt"
              defaultValue={formatUkDateTimeLocal(job.completedAt)}
              className="input"
            />
            {fe.completedAt?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.completedAt[0]}</p>
            )}
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Notes & report</h2>
        <div>
          <label className="label" htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={job.notes ?? ""}
            className="input"
            maxLength={2000}
          />
        </div>
        <div>
          <label className="label" htmlFor="partnerReportRef">
            Partner report reference
          </label>
          <input
            type="text"
            id="partnerReportRef"
            name="partnerReportRef"
            defaultValue={job.partnerReportRef ?? ""}
            className="input"
            placeholder="e.g. Nexus PDF ref"
            maxLength={200}
          />
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="excludeFromClientReport"
            defaultChecked={job.excludeFromClientReport}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Keep internal only.</span>{" "}
            <span className="text-slate-500">
              Tick to keep this off the customer's daily email.
            </span>
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between">
        <Link
          href={`/dispatch/${job.id}`}
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

