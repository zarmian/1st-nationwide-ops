"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { FormError } from "@/components/FormError";
import type { CalloutState } from "../_actions";

const JOB_TYPES = [
  { v: "ALARM_RESPONSE", label: "Alarm response" },
  { v: "PATROL", label: "Mobile patrol" },
  { v: "LOCK", label: "Lock-up" },
  { v: "UNLOCK", label: "Unlock" },
  { v: "VPI", label: "Void property inspection" },
  { v: "ADHOC", label: "Ad-hoc / other" },
];

const SOURCES = [
  { v: "ALARM", label: "Alarm activation" },
  { v: "CUSTOMER_REQUEST", label: "Customer call" },
  { v: "PARTNER_REQUEST", label: "Partner (Nexus / Keyholding Co)" },
  { v: "AD_HOC", label: "Ad-hoc" },
];

type SiteOption = {
  id: string;
  name: string;
  code: string | null;
  postcodeFormatted: string;
};

/**
 * Format a Date for an <input type="datetime-local">.
 * Avoids the toISOString() pitfall (which yields UTC) by composing
 * the local-time string ourselves.
 */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CalloutForm({
  action,
  sites,
  officers,
  defaultSiteId,
}: {
  action: (state: CalloutState, fd: FormData) => Promise<CalloutState>;
  sites: SiteOption[];
  officers: { id: string; name: string }[];
  defaultSiteId?: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  const [siteSearch, setSiteSearch] = useState("");

  // Default times: callout typically just finished. Pre-fill end=now,
  // start = 30 minutes ago — dispatcher tweaks both.
  const defaults = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 60 * 1000);
    return {
      startedAt: toLocalInputValue(start),
      completedAt: toLocalInputValue(now),
    };
  }, []);

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
        <h2 className="font-semibold text-brand-navy">What happened</h2>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="type">
              Type
            </label>
            <select id="type" name="type" className="input" defaultValue="ALARM_RESPONSE">
              {JOB_TYPES.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </select>
            {fe.type?.[0] && <p className="text-xs text-red-600 mt-1">{fe.type[0]}</p>}
          </div>

          <div>
            <label className="label" htmlFor="source">
              Source
            </label>
            <select id="source" name="source" className="input" defaultValue="ALARM">
              {SOURCES.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.label}
                </option>
              ))}
            </select>
            {fe.source?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.source[0]}</p>
            )}
          </div>
        </div>

        <div>
          <label className="label">Site</label>
          <input
            type="search"
            placeholder="Search code, name, or postcode…"
            value={siteSearch}
            onChange={(e) => setSiteSearch(e.target.value)}
            className="input mb-2"
            aria-label="Search sites"
          />
          <select
            name="siteId"
            className="input"
            defaultValue={defaultSiteId ?? ""}
            required
          >
            <option value="" disabled>
              Pick a site…
            </option>
            {filteredSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} — ` : ""}{s.name} · {s.postcodeFormatted}
              </option>
            ))}
          </select>
          {fe.siteId?.[0] && (
            <p className="text-xs text-red-600 mt-1">{fe.siteId[0]}</p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="officerId">
            Officer who attended
          </label>
          <select id="officerId" name="officerId" className="input" defaultValue="" required>
            <option value="" disabled>
              Pick an officer…
            </option>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {fe.officerId?.[0] && (
            <p className="text-xs text-red-600 mt-1">{fe.officerId[0]}</p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            Pay rate is looked up from the officer's per-callout rate for
            this service.
          </p>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">When</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="startedAt">
              Started at
            </label>
            <input
              type="datetime-local"
              id="startedAt"
              name="startedAt"
              className="input"
              defaultValue={defaults.startedAt}
              required
            />
            {fe.startedAt?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.startedAt[0]}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="completedAt">
              Finished at
            </label>
            <input
              type="datetime-local"
              id="completedAt"
              name="completedAt"
              className="input"
              defaultValue={defaults.completedAt}
              required
            />
            {fe.completedAt?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.completedAt[0]}</p>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Backdated entries are allowed up to 30 days. Older callouts must
          be entered by an admin.
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">Notes & report</h2>

        <div>
          <label className="label" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            className="input"
            placeholder="What did the officer find / do? Anything the customer should know."
          />
        </div>

        <div>
          <label className="label" htmlFor="partnerReportRef">
            Partner report reference (optional)
          </label>
          <input
            type="text"
            id="partnerReportRef"
            name="partnerReportRef"
            className="input"
            placeholder="e.g. Nexus PDF ref, alarm activation ID"
          />
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="excludeFromClientReport"
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Keep internal only.</span>{" "}
            <span className="text-slate-500">
              By default, this callout will be included in the daily client
              report. Tick to keep it off the email and use it for internal
              record-keeping / pay only.
            </span>
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between">
        <Link href="/dispatch" className="text-sm text-slate-500 hover:text-brand-navy">
          ← Cancel
        </Link>
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Recording…" : "Record callout"}
    </button>
  );
}
