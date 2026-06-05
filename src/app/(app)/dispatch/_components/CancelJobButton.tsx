"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { cancelJob } from "../_actions";

export function CancelJobButton({
  jobId,
  jobLabel,
}: {
  jobId: string;
  jobLabel: string;
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

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-xs text-red-600 hover:text-red-700 hover:underline"
    >
      {pending ? "Cancelling…" : "Cancel"}
    </button>
  );
}
