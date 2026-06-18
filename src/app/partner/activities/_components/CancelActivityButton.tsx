"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelPartnerActivity } from "../_actions";

export function CancelActivityButton({
  encodedId,
  kind,
}: {
  encodedId: string;
  kind: "JOB" | "SHIFT";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            kind === "SHIFT"
              ? "Delete this shift record? This can't be undone."
              : "Cancel this job record? It'll be marked CANCELLED.",
          )
        ) {
          return;
        }
        start(async () => {
          const res = await cancelPartnerActivity(encodedId);
          if (res.ok) router.push("/partner/activities");
        });
      }}
      className="btn-danger text-sm"
    >
      {pending ? "Working…" : kind === "SHIFT" ? "Delete" : "Cancel"}
    </button>
  );
}
