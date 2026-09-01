"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { sendReminderAction } from "../_actions";

/**
 * Manually email an overdue-payment reminder for this invoice. Only shown for a
 * SENT (unpaid) invoice; the daily cron also sends these automatically.
 */
export function InvoiceReminderButton({
  id,
  to,
}: {
  id: string;
  to: string | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, start] = useTransition();

  async function onClick() {
    if (!to) {
      toast.show({
        tone: "error",
        message: "No contact email on this customer. Add one first.",
      });
      return;
    }
    const ok = await confirm({
      title: "Send a payment reminder?",
      body: `A reminder with the invoice attached will be emailed to ${to}.`,
      confirmLabel: "Send reminder",
    });
    if (!ok) return;
    start(async () => {
      const res = await sendReminderAction(id);
      if (res.ok) {
        toast.show({ tone: "success", message: `Reminder emailed to ${to}.` });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't send." });
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="btn-secondary text-sm inline-flex items-center gap-1.5"
    >
      <BellRing size={14} />
      {pending ? "Sending…" : "Send reminder"}
    </button>
  );
}
