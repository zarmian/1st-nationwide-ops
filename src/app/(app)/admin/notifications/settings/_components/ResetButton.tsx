"use client";

import { useState, useTransition } from "react";
import { resetNotificationSettings } from "../_actions";

export function ResetButton() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="btn-secondary text-sm"
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              "Reset every notification back to the recommended defaults? This clears any changes you've saved.",
            )
          )
            return;
          startTransition(async () => {
            await resetNotificationSettings();
            setDone(true);
          });
        }}
      >
        {pending ? "Resetting…" : "Reset to recommended defaults"}
      </button>
      {done && <span className="text-xs text-emerald-700">Reset done.</span>}
    </div>
  );
}
