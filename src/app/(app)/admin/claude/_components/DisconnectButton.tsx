"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { disconnectClaude } from "../_actions";

/** Revoke one Claude connection (its tokens stop working immediately). */
export function DisconnectButton({ grantId, who }: { grantId: string; who: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Disconnect Claude for ${who}? They'll need to connect again to use it.`)) {
          return;
        }
        start(async () => {
          const res = await disconnectClaude(grantId);
          if (res.ok) {
            toast.show({ tone: "success", message: `Disconnected Claude for ${who}.` });
            router.refresh();
          } else {
            toast.show({ tone: "error", message: res.error });
          }
        });
      }}
      className="btn-danger text-sm"
    >
      {pending ? "…" : "Disconnect"}
    </button>
  );
}
