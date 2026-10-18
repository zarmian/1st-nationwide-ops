"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { retryFastFieldMatching } from "../_actions";

/** Re-run matching — for after an activity or a site has been added. */
export function RetryButton() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await retryFastFieldMatching();
          if (!res.ok) {
            toast.show({ tone: "error", message: res.error });
            return;
          }
          const { linked, created, left } = res.data;
          toast.show({
            tone: linked + created > 0 ? "success" : "info",
            message:
              linked + created > 0
                ? `Attached ${linked + created} report${linked + created === 1 ? "" : "s"}; ${left} still to link.`
                : "Nothing new matched.",
          });
          router.refresh();
        })
      }
    >
      {pending ? "Matching…" : "Try matching again"}
    </button>
  );
}
