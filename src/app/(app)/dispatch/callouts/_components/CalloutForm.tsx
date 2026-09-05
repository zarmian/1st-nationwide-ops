"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { FormError } from "@/components/FormError";
import { DuplicateWarning } from "@/components/DuplicateWarning";
import { formatUkDateTimeLocal } from "@/lib/dates";
import type { CalloutState } from "../_actions";

type SiteOption = {
  id: string;
  name: string;
  code: string | null;
  postcodeFormatted: string;
};

type PickerOption = {
  id: string;
  code: string;
  label: string;
};

export function CalloutForm({
  action,
  sites,
  officers,
  partners,
  customerOnlyPartnerCount = 0,
  jobTypes,
  jobSources,
  defaultSiteId,
}: {
  action: (state: CalloutState, fd: FormData) => Promise<CalloutState>;
  sites: SiteOption[];
  officers: { id: string; name: string }[];
  partners: { id: string; name: string }[];
  customerOnlyPartnerCount?: number;
  jobTypes: PickerOption[];
  jobSources: PickerOption[];
  defaultSiteId?: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const fe = state.fieldErrors ?? {};

  const [siteSearch, setSiteSearch] = useState("");
  const [handlerKind, setHandlerKind] = useState<"officer" | "partner">(
    "officer",
  );
  // Track the picked type OPTION by its unique id — several options can share
  // a code (e.g. "Intruder alarm" / "Camera activation" both ALARM_RESPONSE),
  // so we can't key the <select> on the code or they'd be indistinguishable.
  const [typeId, setTypeId] = useState(
    () =>
      jobTypes.find((t) => t.code === "ALARM_RESPONSE")?.id ??
      jobTypes[0]?.id ??
      "",
  );
  const selectedType = jobTypes.find((t) => t.id === typeId);

  // Default times: callout typically just finished. Pre-fill end=now,
  // start = 30 minutes ago — dispatcher tweaks both.
  const defaults = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 60 * 1000);
    return {
      startedAt: formatUkDateTimeLocal(start),
      completedAt: formatUkDateTimeLocal(now),
      handedOffAt: formatUkDateTimeLocal(now),
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
      <DuplicateWarning warnings={state.warnings} />

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">What happened</h2>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="type">
              Type
            </label>
            <select
              id="type"
              className="input"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
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
            {fe.type?.[0] && <p className="text-xs text-red-600 mt-1">{fe.type[0]}</p>}
          </div>

          <div>
            <label className="label" htmlFor="source">
              Source
            </label>
            <select
              id="source"
              name="source"
              className="input"
              defaultValue={
                jobSources.find((s) => s.code === "ALARM")?.code ??
                jobSources[0]?.code ??
                ""
              }
            >
              {jobSources.map((s) => (
                <option key={s.id} value={s.code}>
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
          <label className="label" htmlFor="calloutSiteId">
            Site
          </label>
          <input
            type="search"
            placeholder="Search code, name, or postcode…"
            value={siteSearch}
            onChange={(e) => setSiteSearch(e.target.value)}
            className="input mb-2"
            aria-label="Search sites"
          />
          <select
            id="calloutSiteId"
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
          <div className="label">Who handled this?</div>
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
        </div>

        {handlerKind === "officer" ? (
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
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="handlerPartnerId">
                Partner we gave it to
              </label>
              {partners.length === 0 ? (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 space-y-1">
                  {customerOnlyPartnerCount > 0 ? (
                    <p>
                      You have {customerOnlyPartnerCount} partner
                      {customerOnlyPartnerCount === 1 ? "" : "s"} on file,
                      but none are configured as a subcontractor. Open the
                      partner and change its role to{" "}
                      <span className="font-medium">Subcontractor</span> or{" "}
                      <span className="font-medium">Both</span>.
                    </p>
                  ) : (
                    <p>
                      No subcontracting partners on file yet. Common ones
                      to add: Nexus Security, Keyholding Co.
                    </p>
                  )}
                  <p>
                    <a
                      href="/admin/partners"
                      target="_blank"
                      rel="noopener"
                      className="underline font-medium hover:text-amber-900"
                    >
                      Open Admin → Partners ↗
                    </a>
                    {" "}
                    {customerOnlyPartnerCount === 0 && (
                      <a
                        href="/admin/partners/new"
                        target="_blank"
                        rel="noopener"
                        className="underline font-medium hover:text-amber-900 ml-3"
                      >
                        + Add a partner ↗
                      </a>
                    )}
                  </p>
                </div>
              ) : (
                <select
                  id="handlerPartnerId"
                  name="handlerPartnerId"
                  className="input"
                  defaultValue=""
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
              <label className="label" htmlFor="partnerOfficerName">
                Their officer name (optional)
              </label>
              <input
                type="text"
                id="partnerOfficerName"
                name="partnerOfficerName"
                className="input"
                placeholder="e.g. James Smith — if you know it"
                maxLength={120}
              />
              <p className="text-xs text-slate-500 mt-1">
                Often blank until the partner sends their report. Leave
                empty if not known yet.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-brand-navy">When</h2>

        {handlerKind === "partner" && (
          <div>
            <label className="label" htmlFor="handedOffAt">
              When given to partner
            </label>
            <input
              type="datetime-local"
              id="handedOffAt"
              name="handedOffAt"
              className="input"
              defaultValue={defaults.handedOffAt}
            />
            {fe.handedOffAt?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.handedOffAt[0]}</p>
            )}
            <p className="text-xs text-slate-500 mt-1">
              Defaults to now. Adjust if you logged the callout later than
              you actually handed it over.
            </p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="startedAt">
              {handlerKind === "partner"
                ? "Their guard attended at (optional)"
                : "Started at"}
            </label>
            <input
              type="datetime-local"
              id="startedAt"
              name="startedAt"
              className="input"
              defaultValue={
                handlerKind === "partner" ? "" : defaults.startedAt
              }
              required={handlerKind === "officer"}
            />
            {fe.startedAt?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.startedAt[0]}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="completedAt">
              {handlerKind === "partner"
                ? "Their guard finished at (optional)"
                : "Finished at"}
            </label>
            <input
              type="datetime-local"
              id="completedAt"
              name="completedAt"
              className="input"
              defaultValue={
                handlerKind === "partner" ? "" : defaults.completedAt
              }
              required={handlerKind === "officer"}
            />
            {fe.completedAt?.[0] && (
              <p className="text-xs text-red-600 mt-1">{fe.completedAt[0]}</p>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {handlerKind === "partner"
            ? "Leave the attendance times blank if you don't know them yet — you'll fill them in when the partner sends their report."
            : "Backdated entries are allowed up to 30 days. Older callouts must be entered by an admin."}
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
