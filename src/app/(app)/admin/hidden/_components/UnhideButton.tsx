"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { setCustomerHidden } from "../../customers/_actions";
import { setPartnerHidden } from "../../partners/_actions";

/** One-click "un-hide" for the hidden-accounts settings page. */
export function UnhideButton({
  kind,
  id,
  name,
}: {
  kind: "customer" | "partner";
  id: string;
  name: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res =
            kind === "customer"
              ? await setCustomerHidden(id, false)
              : await setPartnerHidden(id, false);
          if (res.ok) {
            toast.show({ tone: "success", message: `${name} is visible again.` });
            router.refresh();
          }
        })
      }
      className="btn-secondary text-sm"
    >
      {pending ? "…" : "Un-hide"}
    </button>
  );
}
