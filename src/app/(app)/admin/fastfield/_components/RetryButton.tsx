"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { retryFastFieldMatching } from "../_actions";

/** Re-run matching now — for after an activity or a site has been added (the
 *  robot also does this by itself every 5 minutes). */
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
          try {
            const res = await retryFastFieldMatching();
            if (!res.ok) {
              toast.show({ tone: "error", message: res.error });
              return;
            }
            toast.show({ tone: res.data.tone, message: res.data.message });
            // The robot was matching, so this press changed nothing.
            if (res.data.busy) return;
          } catch {
            // Timed out or failed on the way back: what it attached before
            // that is kept, and the refresh below shows it.
            toast.show({
              tone: "error",
              message: "Matching didn't finish properly. Anything it attached is kept — try again in a minute.",
            });
          }
          // The action doesn't re-render this page itself (see
          // retryFastFieldMatching): fetch it fresh, as its own request.
          router.refresh();
        })
      }
    >
      {pending ? "Matching…" : "Try matching again"}
    </button>
  );
}
