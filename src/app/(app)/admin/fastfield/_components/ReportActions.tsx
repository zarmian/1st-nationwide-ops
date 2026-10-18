"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import {
  createFastFieldJob,
  ignoreFastFieldReport,
  linkFastFieldReport,
} from "../_actions";

const CREATE_OPTIONS: { value: string; label: string }[] = [
  { value: "ALARM_RESPONSE", label: "Callout" },
  { value: "ADHOC", label: "Ad-hoc job" },
  { value: "LOCK", label: "Lock-up" },
  { value: "UNLOCK", label: "Unlock" },
  { value: "KEY_COLLECTION", label: "Key collection" },
  { value: "VPI", label: "VPI" },
];

function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.show({ tone: "success", message: done });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Something went wrong." });
      }
    });
  return { pending, run };
}

export function LinkButton({
  reportId,
  kind,
  activityId,
}: {
  reportId: string;
  kind: "job" | "visit";
  activityId: string;
}) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      className="btn btn-primary"
      disabled={pending}
      onClick={() =>
        run(() => linkFastFieldReport(reportId, kind, activityId), "Report linked — the activity is marked done.")
      }
    >
      {pending ? "Linking…" : "Link"}
    </button>
  );
}

export function CreateJobForm({
  reportId,
  siteId,
  defaultType,
}: {
  reportId: string;
  siteId: string;
  defaultType: string;
}) {
  const { pending, run } = useAction();
  const [type, setType] = useState(
    CREATE_OPTIONS.some((o) => o.value === defaultType) ? defaultType : "ALARM_RESPONSE",
  );
  return (
    <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100">
      <label htmlFor="ff-create-type" className="block">
        <span className="label">Or create the job it describes</span>
        <select
          id="ff-create-type"
          name="type"
          className="input w-auto"
          value={type}
          disabled={pending}
          onChange={(e) => setType(e.target.value)}
        >
          {CREATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Create a completed job at this site from this report? It will be billed and paid.")) {
            return;
          }
          run(() => createFastFieldJob(reportId, siteId, type), "Job created from the report.");
        }}
      >
        {pending ? "Creating…" : "Create job"}
      </button>
    </div>
  );
}

export function IgnoreButton({ reportId, ignored }: { reportId: string; ignored: boolean }) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={pending}
      onClick={() =>
        run(
          () => ignoreFastFieldReport(reportId, !ignored),
          ignored ? "Report brought back to the list." : "Report set aside.",
        )
      }
    >
      {ignored ? "Bring back" : "Set aside"}
    </button>
  );
}
