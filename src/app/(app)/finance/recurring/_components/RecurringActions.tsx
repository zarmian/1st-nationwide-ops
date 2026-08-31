"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { toggleRecurringCharge, deleteRecurringCharge } from "../_actions";

export function RecurringActions({
  id,
  active,
  description,
}: {
  id: string;
  active: boolean;
  description: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, start] = useTransition();

  function onToggle() {
    start(async () => {
      await toggleRecurringCharge(id, !active);
      toast.show({
        tone: "success",
        message: active ? "Paused." : "Resumed.",
      });
      router.refresh();
    });
  }

  async function onDelete() {
    const ok = await confirm({
      title: "Remove this charge?",
      body: `“${description}” will stop billing. If it's already been invoiced it's kept but paused.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    start(async () => {
      const res = await deleteRecurringCharge(id);
      toast.show({
        tone: "success",
        message: res.deactivatedOnly ? "Paused (already billed)." : "Removed.",
      });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        className="btn-ghost text-xs"
      >
        {active ? "Pause" : "Resume"}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="btn-ghost text-xs text-red-600"
      >
        Remove
      </button>
    </div>
  );
}
