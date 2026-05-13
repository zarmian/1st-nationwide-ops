"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { NewJobState } from "../_actions";

const JOB_TYPES = [
  { v: "ALARM_RESPONSE", label: "Alarm response" },
  { v: "ADHOC", label: "Ad-hoc / one-off" },
  { v: "LOCK", label: "Lock-up" },
  { v: "UNLOCK", label: "Unlock" },
  { v: "KEY_COLLECTION", label: "Key collection" },
  { v: "KEY_DROPOFF", label: "Key drop-off" },
  { v: "VPI", label: "Void property inspection" },
  { v: "PATROL", label: "Mobile patrol (one-off)" },
];

const JOB_SOURCES = [
  { v: "CUSTOMER_REQUEST", label: "Customer call" },
  { v: "PARTNER_REQUEST", label: "Partner (Nexus / Keyholding Co)" },
  { v: "ALARM", label: "Alarm activation" },
  { v: "AD_HOC", label: "Ad-hoc" },
  { v: "SCHEDULED", label: "Scheduled" },
  { v: "ONBOARDING", label: "Onboarding" },
];

const ALARM_SOURCES = [
  { v: "ARC_EMAIL", label: "ARC — email" },
  { v: "ARC_PHONE", label: "ARC — phone" },
  { v: "PARTNER_EMAIL", label: "Partner — email" },
  { v: "PARTNER_PHONE", label: "Partner — phone" },
  { v: "CUSTOMER_PHONE", label: "Customer — phone" },
  { v: "MANUAL", label: "Manual entry" },
  { v: "WEBHOOK", label: "Webhook" },
];

const PRIORITIES = [
  { v: "LOW", label: "Low" },
  { v: "MEDIUM", label: "Medium" },
  { v: "HIGH", label: "High" },
];

export function NewJobForm({
  action,
  sites,
  officers,
  defaultSiteId,
}: {
  action: (state: NewJobState, fd: FormData) => Promise<NewJobState>;
  sites: { id: string; name: string; code: string | null; postcodeFormatted: string }[];
  officers: { id: string; name: string }[];
  defaultSiteId?: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};
  const [type, setType] = useState("ADHOC");
  const [siteSearch, setSiteSearch] = useState("");
  const wantsAlarm = type === "ALARM_RESPONSE";

  const filteredSites = siteSearch
    ? sites.filter((s) =>
        `${s.code ?? ""} ${s.name} ${s.postcodeFormatted}`
          .toLowerCase()
          .includes(siteSearch.toLowerCase()),
      )
    : sites.slice(0, 50);

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
            <label className="label" htmlFor="type">
              Type
            </label>
            <select
              id="type"
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="input"
            >
              {JOB_TYPES.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="source">
              Source
            </label>
            <select
              id="source"
              name="source"
              defaultValue={wantsAlarm ? "ALARM" : "CUSTOMER_REQUEST"}
              className="input"
              key={type}
            >
              {JOB_SOURCES.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Site</label>
          <input
            type="search"
            value={siteSearch}
            onChange={(e) => setSiteSearch(e.target.value)}
            placeholder="Search by name, code, or postcode…"
            className="input mb-2"
          />
          <select
            name="siteId"
            defaultValue={defaultSiteId ?? ""}
            className="input"
            required
          >
            <option value="">— pick a site —</option>
            {filteredSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} · ` : ""}
                {s.name}
                {s.postcodeFormatted ? ` · ${s.postcodeFormatted}` : ""}
              </option>
            ))}
          </select>
          {fe.siteId && (
            <p className="text-xs text-red-600 mt-1">{fe.siteId.join(", ")}</p>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="priority">
              Priority
            </label>
            <select
              id="priority"
              name="priority"
              defaultValue="MEDIUM"
              className="input"
            >
              {PRIORITIES.map((p) => (
                <option key={p.v} value={p.v}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="scheduledFor">
              Scheduled for
            </label>
            <input
              id="scheduledFor"
              name="scheduledFor"
              type="datetime-local"
              className="input"
            />
            <p className="text-xs text-slate-500 mt-1">
              Leave blank for "now".
            </p>
          </div>
          <div>
            <label className="label" htmlFor="assignedToUserId">
              Assign to
            </label>
            <select
              id="assignedToUserId"
              name="assignedToUserId"
              defaultValue=""
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
        </div>

        <div>
          <label className="label" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="input"
            placeholder="Anything dispatch / the attending officer needs to know."
          />
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="reportedViaPartnerApp"
            className="rounded border-slate-300 text-brand-mint focus:ring-brand-mint/30"
          />
          <span>
            Reported via partner app (Nexus / Keyholding Co) — officer fills
            their form, not ours.
          </span>
        </label>

        <div>
          <label className="label" htmlFor="partnerReportRef">
            Partner report reference
          </label>
          <input
            id="partnerReportRef"
            name="partnerReportRef"
            className="input"
            placeholder="e.g. Nexus PDF ref, only when reported via partner app"
          />
        </div>
      </div>

      {wantsAlarm && (
        <div className="card p-5 space-y-4 border border-amber-200 bg-amber-50/30">
          <div>
            <h2 className="font-semibold text-brand-navy">Alarm details</h2>
            <p className="text-sm text-slate-500">
              An <code className="text-xs bg-amber-100 px-1 rounded">AlarmEvent</code>{" "}
              row will be created and linked to this job.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="alarmSource">
                Alarm source <span className="text-red-500">*</span>
              </label>
              <select
                id="alarmSource"
                name="alarmSource"
                defaultValue=""
                className="input"
              >
                <option value="">—</option>
                {ALARM_SOURCES.map((s) => (
                  <option key={s.v} value={s.v}>
                    {s.label}
                  </option>
                ))}
              </select>
              {fe.alarmSource && (
                <p className="text-xs text-red-600 mt-1">
                  {fe.alarmSource.join(", ")}
                </p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="alarmZone">
                Zone
              </label>
              <input
                id="alarmZone"
                name="alarmZone"
                className="input"
                placeholder="e.g. Z3 — Rear shutter"
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="alarmRawSubject">
              Subject (if pasted from email)
            </label>
            <input
              id="alarmRawSubject"
              name="alarmRawSubject"
              className="input"
            />
          </div>

          <div>
            <label className="label" htmlFor="alarmRawBody">
              Raw body
            </label>
            <textarea
              id="alarmRawBody"
              name="alarmRawBody"
              rows={4}
              className="input"
              placeholder="Paste the email body / dispatcher notes here."
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <SubmitButton />
        <Link href="/dispatch" className="btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Creating…" : "Create job"}
    </button>
  );
}
