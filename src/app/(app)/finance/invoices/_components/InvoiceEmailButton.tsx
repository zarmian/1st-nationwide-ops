"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { sendInvoiceEmailAction } from "../_actions";

/**
 * Email-to-customer button on the invoice detail page. Confirms first (email is
 * hard to un-send), then calls the server action which renders the PDF and
 * sends it. Disabled when there's no contact email or the invoice is voided.
 */
export function InvoiceEmailButton({
  id,
  to,
  emailed,
  voided,
}: {
  id: string;
  to: string | null;
  emailed: boolean;
  voided: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, start] = useTransition();

  async function onClick() {
    if (!to) {
      toast.show({
        tone: "error",
        message: "No contact email on this customer. Add one on their record first.",
      });
      return;
    }
    const ok = await confirm({
      title: emailed ? "Re-send this invoice?" : "Email this invoice?",
      body: `The invoice PDF will be emailed to ${to}.`,
      confirmLabel: emailed ? "Re-send" : "Send",
    });
    if (!ok) return;
    start(async () => {
      const res = await sendInvoiceEmailAction(id);
      if (res.ok) {
        toast.show({ tone: "success", message: `Invoice emailed to ${to}.` });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't send the email." });
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || voided}
      className="btn-secondary text-sm inline-flex items-center gap-1.5"
    >
      <Mail size={14} />
      {pending ? "Sending…" : emailed ? "Re-send email" : "Email to customer"}
    </button>
  );
}
