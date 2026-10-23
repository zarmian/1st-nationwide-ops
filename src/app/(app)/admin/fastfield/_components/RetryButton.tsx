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
          const res = await retryFastFieldMatching();
          if (!res.ok) {
            toast.show({ tone: "error", message: res.error });
            return;
          }
          const { attached, checked, notReached } = res.data;
          const more =
            notReached > 0
              ? ` Checked ${checked} — press again to check the other ${notReached}.`
              : "";
          toast.show({
            tone: attached > 0 ? "success" : "info",
            message:
              attached > 0
                ? `Attached ${attached} report${attached === 1 ? "" : "s"}.${more}`
                : `Nothing new matched.${more}`,
          });
          router.refresh();
        })
      }
    >
      {pending ? "Matching…" : "Try matching again"}
    </button>
  );
}
