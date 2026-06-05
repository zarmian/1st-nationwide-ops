"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { deleteShift } from "../_actions";

export function DeleteShiftButton({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  async function onClick() {
    const ok = await confirm({
      title: "Delete this shift?",
      body: "Check-in submissions stay in the system but will no longer be linked to a shift.",
      confirmLabel: "Delete shift",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteShift(shiftId);
      if (res.ok) {
        toast.show({ tone: "success", message: "Shift deleted." });
        router.push("/shifts");
      } else {
        toast.show({
          tone: "error",
          message: res.error ?? "Couldn't delete.",
        });
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="btn-danger text-sm"
    >
      {pending ? "Deleting…" : "Delete shift"}
    </button>
  );
}
