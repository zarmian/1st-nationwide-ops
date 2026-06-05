"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
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
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  async function onClick() {
    const ok = await confirm({
      title: `Restore "${jobLabel}"?`,
      body: (
        <>
          It returns to its previous status and billing + officer pay are
          re-snapshotted from the current rates.
        </>
      ),
      confirmLabel: "Restore",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await restoreJob(jobId);
      if (res.ok) {
        toast.show({
          tone: "success",
          message: `"${jobLabel}" restored. Billing re-applied.`,
        });
        router.refresh();
      } else {
        toast.show({
          tone: "error",
          message: res.error ?? "Couldn't restore.",
        });
      }
    });
  }

  const className =
    size === "small"
      ? "text-xs text-brand-blue-dark hover:text-brand-navy underline disabled:opacity-50"
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
