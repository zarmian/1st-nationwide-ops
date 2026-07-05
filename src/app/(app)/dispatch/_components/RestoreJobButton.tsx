"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
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

  const icon = size === "small" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Restore job"
      aria-label="Restore job"
      className="inline-flex items-center justify-center rounded p-1 text-brand-blue-dark hover:bg-brand-blue-50 hover:text-brand-navy disabled:opacity-50 transition-colors"
    >
      {pending ? (
        <Loader2 className={`${icon} animate-spin`} aria-hidden />
      ) : (
        <RotateCcw className={icon} aria-hidden />
      )}
    </button>
  );
}
