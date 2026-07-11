"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { cancelJob } from "../_actions";
import { cancelPatrolVisit } from "../../patrols/_actions";

/**
 * Cancel a still-live activity — a Job or a patrol/VPI Visit (the kind prop
 * discriminates). Both routes mark the record CANCELLED (kept for audit) and
 * reverse billing + officer pay. A cancelled visit won't be re-created by the
 * nightly schedule sync.
 */
export function CancelActivityButton({
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
      title: `Cancel "${label}"?`,
      body: (
        <>
          It&apos;ll be removed from the live list and marked{" "}
          <span className="font-medium">CANCELLED</span> (the record stays for
          audit). Billing and officer pay reverse out immediately
          {kind === "visit"
            ? ", and the nightly schedule won't re-create it."
            : "."}
        </>
      ),
      confirmLabel: kind === "visit" ? "Cancel patrol" : "Cancel job",
      cancelLabel: "Keep it",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const res =
        kind === "job" ? await cancelJob(id) : await cancelPatrolVisit(id);
      if (res.ok) {
        toast.show({ tone: "success", message: `"${label}" cancelled.` });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't cancel." });
      }
    });
  }

  const icon = size === "small" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={kind === "visit" ? "Cancel patrol" : "Cancel job"}
      aria-label={kind === "visit" ? "Cancel patrol" : "Cancel job"}
      className="inline-flex items-center justify-center rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 transition-colors"
    >
      {pending ? (
        <Loader2 className={`${icon} animate-spin`} aria-hidden />
      ) : (
        <X className={icon} aria-hidden />
      )}
    </button>
  );
}
