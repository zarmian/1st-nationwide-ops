"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { emailPayslipAction } from "../_actions";

/** Email the current payslip PDF to the officer's own email. */
export function PayslipEmailButton({
  officerId,
  email,
  from,
  to,
}: {
  officerId: string;
  email: string | null;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, start] = useTransition();

  async function onClick() {
    if (!email) {
      toast.show({
        tone: "error",
        message: "No email on this officer's record. Add one first.",
      });
      return;
    }
    const ok = await confirm({
      title: "Email this payslip?",
      body: `The payslip PDF for this period will be emailed to ${email}.`,
      confirmLabel: "Send",
    });
    if (!ok) return;
    start(async () => {
      const res = await emailPayslipAction(officerId, from, to);
      if (res.ok) {
        toast.show({ tone: "success", message: `Payslip emailed to ${email}.` });
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
      <Mail size={14} />
      {pending ? "Sending…" : "Email to officer"}
    </button>
  );
}
