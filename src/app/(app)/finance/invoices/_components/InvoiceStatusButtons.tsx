"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { updateInvoiceStatus } from "../_actions";
import type { InvoiceStatusValue } from "@/lib/invoicing";

export function InvoiceStatusButtons({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, start] = useTransition();

  function run(next: InvoiceStatusValue, msg: string) {
    start(async () => {
      const res = await updateInvoiceStatus(id, next);
      if (res.ok) {
        toast.show({ tone: "success", message: msg });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't update." });
      }
    });
  }

  async function onVoid() {
    const ok = await confirm({
      title: "Void this invoice?",
      body: "It's marked void and its activities are freed to be invoiced again.",
      confirmLabel: "Void",
      tone: "danger",
    });
    if (ok) run("VOID", "Invoice voided.");
  }

  if (status === "VOID") {
    return <span className="text-xs text-slate-500">Voided</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "DRAFT" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run("SENT", "Marked as sent.")}
          className="btn-primary text-sm"
        >
          Mark sent
        </button>
      )}
      {status === "SENT" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run("PAID", "Marked as paid.")}
          className="btn-primary text-sm"
        >
          Mark paid
        </button>
      )}
      {status === "PAID" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run("SENT", "Reverted to sent.")}
          className="btn-secondary text-sm"
        >
          Mark unpaid
        </button>
      )}
      {status !== "PAID" && (
        <button
          type="button"
          disabled={pending}
          onClick={onVoid}
          className="btn-danger text-sm"
        >
          Void
        </button>
      )}
    </div>
  );
}
