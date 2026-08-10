"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { NewJobState } from "../_actions";
import { FormError } from "@/components/FormError";

type PickerOption = { id: string; code: string; label: string };

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
  partners,
  jobTypes,
  jobSources,
  defaultSiteId,
}: {
  action: (state: NewJobState, fd: FormData) => Promise<NewJobState>;
  sites: { id: string; name: string; code: string | null; postcodeFormatted: string }[];
  officers: { id: string; name: string }[];
  partners: { id: string; name: string }[];
  jobTypes: PickerOption[];
  jobSources: PickerOption[];
  defaultSiteId?: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};
  // Key the picker on the option id — several options can share a code, so
  // keying on the code makes them indistinguishable in the <select>.
  const defaultTypeId =
    jobTypes.find((t) => t.code === "ADHOC")?.id ?? jobTypes[0]?.id ?? "";
  const [typeId, setTypeId] = useState(defaultTypeId);
  const selectedType = jobTypes.find((t) => t.id === typeId);
  const [handlerKind, setHandlerKind] = useState<"officer" | "partner">(
    "officer",
  );
  const [siteSearch, setSiteSearch] = useState("");
  const wantsAlarm = selectedType?.code === "ALARM_RESPONSE";

  const filteredSites = siteSearch
    ? sites.filter((s) =>
        `${s.code ?? ""} ${s.name} ${s.postcodeFormatted}`
          .toLowerCase()
          .includes(siteSearch.toLowerCase()),
      )
    : sites.slice(0, 50);

  return (
    <form action={formAction} className="space-y-6 max-w-3xl">
      <FormError message={state.error} />

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Basics</h2>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="type">
              Type
            </label>
            <select
              id="type"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="input"
            >
              {jobTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <input type="hidden" name="type" value={selectedType?.code ?? ""} />
            <input
              type="hidden"
              name="typeLabel"
              value={selectedType?.label ?? ""}
            />
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
              key={typeId}
            >
              {jobSources.map((s) => (
                <option key={s.id} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="siteId">
            Site
          </label>
          <input
            type="search"
            value={siteSearch}
            onChange={(e) => setSiteSearch(e.target.value)}
            placeholder="Search by name, code, or postcode…"
            className="input mb-2"
            aria-label="Search sites"
          />
          <select
            id="siteId"
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
            <div className="label">Handle by</div>
            <div className="flex gap-3 text-sm pt-1">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="handlerKind"
                  value="officer"
                  checked={handlerKind === "officer"}
                  onChange={() => setHandlerKind("officer")}
                />
                <span>Our officer</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="handlerKind"
                  value="partner"
                  checked={handlerKind === "partner"}
                  onChange={() => setHandlerKind("partner")}
                />
                <span>Partner</span>
              </label>
            </div>
          </div>
        </div>

        {handlerKind === "officer" ? (
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
            <p className="text-xs text-slate-500 mt-1">
              Leave blank to keep the job open for any officer to claim.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="handlerPartnerId">
                Partner we're giving it to
              </label>
              {partners.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  No subcontracting partners on file. Add Nexus or
                  Keyholding Co in Admin → Partners first.
                </p>
              ) : (
                <select
                  id="handlerPartnerId"
                  name="handlerPartnerId"
                  defaultValue=""
                  className="input"
                  required
                >
                  <option value="" disabled>
                    Pick a partner…
                  </option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              {fe.handlerPartnerId?.[0] && (
                <p className="text-xs text-red-600 mt-1">
                  {fe.handlerPartnerId[0]}
                </p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="handedOffAt">
                When handed off
              </label>
              <input
                id="handedOffAt"
                name="handedOffAt"
                type="datetime-local"
                className="input"
              />
              <p className="text-xs text-slate-500 mt-1">
                Leave blank for "now". No officer pay is recorded for
                sub'd jobs.
              </p>
            </div>
          </div>
        )}

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
            className="checkbox"
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
