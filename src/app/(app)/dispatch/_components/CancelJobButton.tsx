"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelJob } from "../_actions";

export function CancelJobButton({
  jobId,
  jobLabel,
}: {
  jobId: string;
  jobLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (
      !window.confirm(
        `Cancel "${jobLabel}"? It'll be removed from the live dispatch list. ` +
          `The record stays in the database (marked CANCELLED) so audit history is preserved.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await cancelJob(jobId);
      if (res.ok) router.refresh();
      else window.alert(res.error ?? "Couldn't cancel.");
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
