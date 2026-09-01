"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { markCostPaidAction } from "../../costs/_actions";

/** Mark a supplier bill paid (today), clearing it from payables. */
export function MarkPaidButton({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await markCostPaidAction(id);
          if (res.ok) {
            toast.show({ tone: "success", message: "Marked paid." });
            router.refresh();
          } else {
            toast.show({ tone: "error", message: res.error ?? "Couldn't update." });
          }
        })
      }
      className="btn-secondary text-xs"
    >
      {pending ? "Saving…" : "Mark paid"}
    </button>
  );
}
