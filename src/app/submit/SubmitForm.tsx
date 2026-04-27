"use client";

import { useState } from "react";

type Site = { id: string; name: string; postcode: string | null };

const FORM_TYPES = [
  { value: "PATROL", label: "Mobile patrol visit" },
  { value: "ALARM_RESPONSE", label: "Alarm response" },
  { value: "LOCK", label: "Lock-up" },
  { value: "UNLOCK", label: "Unlock" },
  { value: "KEY_COLLECTION", label: "Key collection" },
  { value: "KEY_DROPOFF", label: "Key drop-off" },
  { value: "VPI", label: "Void property inspection" },
  { value: "ADHOC", label: "Other / ad-hoc" },
];

export function SubmitForm({
  sites,
  officerName,
  isInternal,
  prefilledSiteId,
  prefilledJobId,
  prefilledJobType,
}: {
  sites: Site[];
  officerName: string;
  isInternal: boolean;
  prefilledSiteId: string | null;
  prefilledJobId: string | null;
  prefilledJobType: string | null;
}) {
  const [siteId, setSiteId] = useState(prefilledSiteId ?? "");
  const [siteSearch, setSiteSearch] = useState("");
  const [formType, setFormType] = useState(
    mapJobTypeToForm(prefilledJobType) ?? "PATROL",
  );
  const [name, setName] = useState(officerName);
  const [arrivedAt, setArrivedAt] = useState(localNow());
  const [departedAt, setDepartedAt] = useState("");
  const [findings, setFindings] = useState("");
  const [actionsTaken, setActionsTaken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredSites = siteSearch
    ? sites.filter(
        (s) =>
          s.name.toLowerCase().includes(siteSearch.toLowerCase()) ||
          (s.postcode ?? "").toLowerCase().includes(siteSearch.toLowerCase()),
      )
    : sites.slice(0, 20);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!siteId) {
      setError("Please pick a site.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          jobId: prefilledJobId,
          form: formType,
          officerNameRaw: name,
          arrivedAt: arrivedAt ? new Date(arrivedAt).toISOString() : null,
          departedAt: departedAt ? new Date(departedAt).toISOString() : null,
          payload: {
            findings,
            actionsTaken,
          },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "Could not save the report");
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="card p-6 text-center">
        <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-brand-mint-light text-brand-mint-dark grid place-items-center text-2xl">
          ✓
        </div>
        <h2 className="text-lg font-semibold text-brand-navy">
          Report submitted
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Thanks{name ? `, ${name.split(" ")[0]}` : ""}. Our admin will review and
          send the client copy.
        </p>
        <button
          onClick={() => {
            setSubmitted(false);
            setSiteId("");
            setFindings("");
            setActionsTaken("");
            setArrivedAt(localNow());
            setDepartedAt("");
          }}
          className="btn-primary mt-5"
        >
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form className="card p-6 space-y-4" onSubmit={onSubmit}>
      <div>
        <label className="label">Type of job</label>
        <select
          value={formType}
          onChange={(e) => setFormType(e.target.value)}
          className="input"
        >
          {FORM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Site</label>
        <input
          type="search"
          placeholder="Search site name or postcode…"
          value={siteSearch}
          onChange={(e) => setSiteSearch(e.target.value)}
          className="input mb-2"
        />
        <select
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          className="input"
          required
        >
          <option value="">— pick a site —</option>
          {filteredSites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.postcode ? ` · ${s.postcode}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Your name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="input"
          required
          readOnly={isInternal && !!officerName}
        />
        {isInternal && (
          <p className="text-xs text-slate-500 mt-1">
            Pre-filled from your account.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Arrived</label>
          <input
            type="datetime-local"
            value={arrivedAt}
            onChange={(e) => setArrivedAt(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label">Departed</label>
          <input
            type="datetime-local"
            value={departedAt}
            onChange={(e) => setDepartedAt(e.target.value)}
            className="input"
          />
        </div>
      </div>

      <div>
        <label className="label">What did you see?</label>
        <textarea
          value={findings}
          onChange={(e) => setFindings(e.target.value)}
          placeholder="Site secure, no issues observed. OR: front door open, alarm sounding…"
          className="input min-h-[100px]"
          required
        />
      </div>

      <div>
        <label className="label">Actions taken</label>
        <textarea
          value={actionsTaken}
          onChange={(e) => setActionsTaken(e.target.value)}
          placeholder="Locked up, reset alarm, contacted keyholder…"
          className="input min-h-[80px]"
        />
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        className="btn-primary w-full"
        disabled={submitting}
      >
        {submitting ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}

function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function mapJobTypeToForm(t: string | null): string | null {
  if (!t) return null;
  const map: Record<string, string> = {
    ALARM_RESPONSE: "ALARM_RESPONSE",
    PATROL: "PATROL",
    LOCK: "LOCK",
    UNLOCK: "UNLOCK",
    KEY_COLLECTION: "KEY_COLLECTION",
    KEY_DROPOFF: "KEY_DROPOFF",
    VPI: "VPI",
  };
  return map[t] ?? "ADHOC";
}
