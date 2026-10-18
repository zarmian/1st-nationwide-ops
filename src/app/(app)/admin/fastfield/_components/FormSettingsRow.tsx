"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { saveFastFieldForm } from "../_actions";

const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "OFF", label: "Off" },
  { value: "PREVIEW", label: "Preview only" },
  { value: "ON", label: "On" },
];

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "ALARM_RESPONSE", label: "Callouts" },
  { value: "PATROL", label: "Patrols / static shifts" },
  { value: "LOCK", label: "Lock-ups" },
  { value: "UNLOCK", label: "Unlocks" },
  { value: "KEY_COLLECTION", label: "Key collections" },
  { value: "VPI", label: "VPIs" },
  { value: "ADHOC", label: "Ad-hoc jobs" },
];

type FormState = {
  formId: number;
  name: string;
  mode: string;
  jobType: string;
  customerId: string | null;
  createCustomerId: string | null;
};

/** One FastField form: import mode, what it reports, whose sites it covers,
 *  and whose sites get a job made when a report matches nothing. */
export function FormSettingsRow({
  form,
  preview,
  lastSeen,
  attached,
  unmatched,
  customers,
}: {
  form: FormState;
  preview: string | null;
  lastSeen: string;
  attached: number;
  unmatched: number;
  customers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState(form.mode);
  const [jobType, setJobType] = useState(
    TYPE_OPTIONS.some((o) => o.value === form.jobType) ? form.jobType : "ALARM_RESPONSE",
  );
  const [customerId, setCustomerId] = useState(form.customerId ?? "");
  const [createCustomerId, setCreateCustomerId] = useState(form.createCustomerId ?? "");
  const dirty =
    mode !== form.mode ||
    jobType !== form.jobType ||
    customerId !== (form.customerId ?? "") ||
    createCustomerId !== (form.createCustomerId ?? "");
  const id = (field: string) => `ff-form-${form.formId}-${field}`;

  function save() {
    start(async () => {
      const res = await saveFastFieldForm({
        formId: form.formId,
        mode,
        jobType,
        customerId,
        createCustomerId,
      });
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
      <div className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-[auto_auto_1fr_1fr_auto] items-end">
        <label htmlFor={id("mode")} className="block">
          <span className="label">Import</span>
          <select
            id={id("mode")}
            name="mode"
            className="input py-1.5"
            value={mode}
            disabled={pending}
            onChange={(e) => setMode(e.target.value)}
          >
            {MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={id("type")} className="block">
          <span className="label">Reports</span>
          <select
            id={id("type")}
            name="jobType"
            className="input py-1.5"
            value={jobType}
            disabled={pending}
            onChange={(e) => setJobType(e.target.value)}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={id("client")} className="block">
          <span className="label">Sites</span>
          <select
            id={id("client")}
            name="customerId"
            className="input py-1.5"
            value={customerId}
            disabled={pending}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Any client</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                Only {c.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={id("create")} className="block">
          <span className="label">Make the job when nothing matches</span>
          <select
            id={id("create")}
            name="createCustomerId"
            className="input py-1.5"
            value={createCustomerId}
            disabled={pending}
            onChange={(e) => setCreateCustomerId(e.target.value)}
          >
            <option value="">Never — link by hand</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                At {c.name} sites
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || pending}
          onClick={save}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {preview && <p className="text-xs text-slate-600">{preview}</p>}
    </div>
  );
}
