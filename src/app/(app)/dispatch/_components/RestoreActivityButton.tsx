"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { restoreJob } from "../_actions";
import { restorePatrolVisit } from "../../patrols/_actions";

/**
 * Restore a cancelled Job or patrol/VPI Visit back to its pre-cancel status
 * (kind discriminates). Admin only — the server actions gate on requireAdmin.
 */
export function RestoreActivityButton({
  kind,
  id,
  label,
  size = "default",
}: {
  kind: "job" | "visit";
  id: string;
  label: string;
  size?: "default" | "small";
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  async function onClick() {
    const ok = await confirm({
      title: `Restore "${label}"?`,
      body: (
        <>
          It returns to its previous status. Billing + officer pay are
          re-applied if it comes back as completed work.
        </>
      ),
      confirmLabel: "Restore",
    });
    if (!ok) return;
    startTransition(async () => {
      const res =
        kind === "job" ? await restoreJob(id) : await restorePatrolVisit(id);
      if (res.ok) {
        toast.show({ tone: "success", message: `"${label}" restored.` });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't restore." });
      }
    });
  }

  const icon = size === "small" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Restore"
      aria-label="Restore"
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
