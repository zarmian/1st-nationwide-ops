"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAssignedActivityDone } from "../_actions";

export function MarkDoneButton({ encodedId }: { encodedId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm("Mark this activity done? Sets the end time to now.")) {
          return;
        }
        start(async () => {
          const res = await markAssignedActivityDone(encodedId);
          if (res.ok) router.refresh();
        });
      }}
      className="btn-primary text-sm"
    >
      {pending ? "Saving…" : "Mark done"}
    </button>
  );
}
