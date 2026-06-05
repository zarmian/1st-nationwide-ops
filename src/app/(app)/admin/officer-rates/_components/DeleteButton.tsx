"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";

export function DeleteRateButton({
  id,
  remove,
}: {
  id: string;
  remove: (id: string) => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  async function onClick() {
    const ok = await confirm({
      title: "Delete this rate?",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await remove(id);
      if (res.ok) {
        toast.show({ tone: "success", message: "Rate deleted." });
        router.refresh();
      }
    });
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="btn-ghost text-xs text-red-600"
    >
      {pending ? "…" : "Delete"}
    </button>
  );
}
