"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { setOfficeStaffClaude } from "../_actions";

/** Admin switch: may office (dispatcher) accounts connect Claude? */
export function OfficeStaffToggle({ allowed }: { allowed: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        className="checkbox mt-0.5"
        checked={allowed}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          if (
            !next &&
            !window.confirm("Turn this off? Office staff who already connected Claude will be disconnected.")
          ) {
            return;
          }
          start(async () => {
            const res = await setOfficeStaffClaude(next);
            if (res.ok) {
              toast.show({
                tone: "success",
                message: next ? "Office staff can now connect Claude." : "Office staff can no longer connect Claude.",
              });
              router.refresh();
            } else {
              toast.show({ tone: "error", message: res.error });
            }
          });
        }}
      />
      <span>
        <span className="font-medium text-slate-900">Let office staff connect Claude</span>
        <span className="block text-sm text-slate-500">
          Off by default. When on, office accounts can connect their own Claude and see what they
          can see in the app — never finance, compliance or the customer list. Turning it off
          disconnects them.
        </span>
      </span>
    </label>
  );
}
