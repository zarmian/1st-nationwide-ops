"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";

/**
 * Delete one rate row. Shared by the customer + site rate editors. For a
 * site override, deleting falls the site back to the customer default.
 */
export function DeleteRateButton({
  id,
  remove,
  label = "Delete",
}: {
  id: string;
  remove: (id: string) => Promise<{ ok: boolean }>;
  label?: string;
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
      aria-busy={pending}
      className="btn-ghost text-xs text-red-600"
    >
      {pending ? "Deleting…" : label}
    </button>
  );
}
