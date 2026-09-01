"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { voidCreditNoteAction } from "../_actions";

/** Void a credit note — reverses its effect on receivables and the VAT return. */
export function VoidCreditNoteButton({ id }: { id: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, start] = useTransition();

  async function onClick() {
    const ok = await confirm({
      title: "Void this credit note?",
      body: "It stops reducing the customer's balance and the VAT return.",
      confirmLabel: "Void",
      tone: "danger",
    });
    if (!ok) return;
    start(async () => {
      const res = await voidCreditNoteAction(id);
      if (res.ok) {
        toast.show({ tone: "success", message: "Credit note voided." });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't void." });
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
      Void
    </button>
  );
}
