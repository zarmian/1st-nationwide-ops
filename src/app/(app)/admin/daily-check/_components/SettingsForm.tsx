"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { runDailyCheckNow, saveDailyCheckSettings } from "../_actions";

/** On/off and recipients for the morning email, plus "Run the check now". */
export function SettingsForm({
  enabled: enabled0,
  recipients: recipients0,
  fallback,
}: {
  enabled: boolean;
  recipients: string;
  /** Who gets it when no addresses are set (the app's admin email). */
  fallback: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [saving, startSave] = useTransition();
  const [running, startRun] = useTransition();
  const [enabled, setEnabled] = useState(enabled0);
  const [recipients, setRecipients] = useState(recipients0);
  const dirty = enabled !== enabled0 || recipients.trim() !== recipients0;

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          name="enabled"
          className="checkbox mt-0.5"
          checked={enabled}
          disabled={saving}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>
          <span className="font-medium text-slate-900">Run the check every morning and email it</span>
          <span className="block text-sm text-slate-500">
            At about 7:30, after the early-morning syncs.
          </span>
        </span>
      </label>
      <label htmlFor="dc-recipients" className="block">
        <span className="label">Send it to</span>
        <input
          id="dc-recipients"
          name="recipients"
          type="text"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          className="input"
          placeholder={fallback ? `${fallback} (the admin email)` : "office@example.co.uk"}
          value={recipients}
          disabled={saving}
          onChange={(e) => setRecipients(e.target.value)}
        />
        <span className="block text-xs text-slate-500 mt-1">
          One or more addresses, separated by commas. Leave empty to use the admin email.
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || saving}
          onClick={() =>
            startSave(async () => {
              const res = await saveDailyCheckSettings({ enabled, recipients: recipients.trim() });
              if (res.ok) {
                toast.show({ tone: "success", message: "Saved." });
                router.refresh();
              } else toast.show({ tone: "error", message: res.error });
            })
          }
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={running}
          onClick={() =>
            startRun(async () => {
              const res = await runDailyCheckNow();
              if (res.ok) {
                toast.show({
                  tone: res.data.total ? "info" : "success",
                  message: res.data.total ? `Done — ${res.data.total} to look at.` : "Done — all clear.",
                });
                router.push(`/admin/daily-check?id=${res.data.id}`);
                router.refresh();
              } else toast.show({ tone: "error", message: res.error });
            })
          }
        >
          {running ? "Checking…" : "Run the check now"}
        </button>
      </div>
    </div>
  );
}
