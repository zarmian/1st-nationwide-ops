"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreJob } from "../_actions";

/**
 * Restores a CANCELLED Job back to its pre-cancel status and re-snapshots
 * billing + pay. Admin only — the server action gates on requireAdmin.
 */
export function RestoreJobButton({
  jobId,
  jobLabel,
  size = "default",
}: {
  jobId: string;
  jobLabel: string;
  size?: "default" | "small";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (
      !window.confirm(
        `Restore "${jobLabel}"? It returns to its previous status and ` +
          `billing + officer pay are re-snapshotted from the current rates.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await restoreJob(jobId);
      if (res.ok) router.refresh();
      else window.alert(res.error ?? "Couldn't restore.");
    });
  }

  const className =
    size === "small"
      ? "text-xs text-brand-mint-dark hover:text-brand-navy underline disabled:opacity-50"
      : "btn-secondary text-sm";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={className}
    >
      {pending ? "Restoring…" : "Restore"}
    </button>
  );
}
