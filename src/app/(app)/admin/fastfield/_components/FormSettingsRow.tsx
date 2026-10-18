"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { saveFastFieldForm } from "../_actions";

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "ALARM_RESPONSE", label: "Callouts" },
  { value: "ADHOC", label: "Ad-hoc jobs" },
  { value: "LOCK", label: "Lock-ups" },
  { value: "UNLOCK", label: "Unlocks" },
  { value: "KEY_COLLECTION", label: "Key collections" },
  { value: "VPI", label: "VPIs" },
];

type FormState = {
  formId: number;
  name: string;
  customerId: string | null;
  enabled: boolean;
  createJobs: boolean;
  jobType: string;
};

/** One FastField form: its client, import on/off, and create-callouts. */
export function FormSettingsRow({
  form,
  lastSeen,
  attached,
  unmatched,
  customers,
}: {
  form: FormState;
  lastSeen: string;
  attached: number;
  unmatched: number;
  customers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [customerId, setCustomerId] = useState(form.customerId ?? "");
  const [enabled, setEnabled] = useState(form.enabled);
  const [createJobs, setCreateJobs] = useState(form.createJobs);
  const [jobType, setJobType] = useState(
    TYPE_OPTIONS.some((o) => o.value === form.jobType) ? form.jobType : "ALARM_RESPONSE",
  );
  const dirty =
    customerId !== (form.customerId ?? "") ||
    enabled !== form.enabled ||
    createJobs !== form.createJobs ||
    jobType !== form.jobType;
  const idBase = `ff-form-${form.formId}`;

  function save() {
    start(async () => {
      const res = await saveFastFieldForm({ formId: form.formId, customerId, enabled, createJobs, jobType });
      if (res.ok) {
        toast.show({ tone: "success", message: `Saved “${form.name.trim()}”.` });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error });
      }
    });
  }

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-slate-900">{form.name.trim()}</span>
        <span className="text-xs text-slate-500">
          FastField form {form.formId} · seen {lastSeen} · {attached} attached
          {unmatched ? ` · ${unmatched} to link` : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label htmlFor={`${idBase}-client`} className="flex items-center gap-2">
          <span className="text-slate-600">Client</span>
          <select
            id={`${idBase}-client`}
            name="customerId"
            className="input py-1.5 w-auto max-w-[16rem]"
            value={customerId}
            disabled={pending}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">— not set —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 cursor-pointer min-h-[44px] sm:min-h-0">
          <input
            type="checkbox"
            name="enabled"
            className="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Import</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer min-h-[44px] sm:min-h-0">
          <input
            type="checkbox"
            name="createJobs"
            className="checkbox"
            checked={createJobs}
            disabled={pending}
            onChange={(e) => setCreateJobs(e.target.checked)}
          />
          <span>Create</span>
        </label>
        <label htmlFor={`${idBase}-type`} className="flex items-center gap-2">
          <span className="sr-only">Kind of job to create</span>
          <select
            id={`${idBase}-type`}
            name="jobType"
            className="input py-1.5 w-auto"
            value={jobType}
            disabled={pending || !createJobs}
            onChange={(e) => setJobType(e.target.value)}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-slate-600">when nothing matches</span>
        </label>
        <button
          type="button"
          className="btn btn-primary ml-auto"
          disabled={!dirty || pending}
          onClick={save}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
