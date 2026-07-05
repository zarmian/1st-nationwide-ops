"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { cancelJob } from "../_actions";

export function CancelJobButton({
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
      title: `Cancel "${jobLabel}"?`,
      body: (
        <>
          It'll be removed from the live dispatch list. The record stays in
          the database marked <span className="font-medium">CANCELLED</span>{" "}
          so audit history is preserved, and billing + officer pay reverse
          out immediately.
        </>
      ),
      confirmLabel: "Cancel job",
      cancelLabel: "Keep job",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await cancelJob(jobId);
      if (res.ok) {
        toast.show({
          tone: "success",
          message: `"${jobLabel}" cancelled. Billing reversed.`,
        });
        router.refresh();
      } else {
        toast.show({
          tone: "error",
          message: res.error ?? "Couldn't cancel.",
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
      title="Cancel job"
      aria-label="Cancel job"
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
