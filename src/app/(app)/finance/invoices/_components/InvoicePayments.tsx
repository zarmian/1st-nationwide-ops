"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { formatMoney } from "@/lib/numbers";
import { formatDate } from "@/lib/dates";
import { recordPaymentAction, deletePaymentAction } from "../_actions";

export type PaymentRow = {
  id: string;
  amount: number;
  paidOn: string; // ISO
  method: string | null;
  reference: string | null;
  notes: string | null;
};

const METHODS = ["Bank transfer", "Card", "Cash", "Cheque", "Direct debit", "Other"];

function todayLocalIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Payment tracking for one invoice: a balance summary, the list of payments
 * received, and a form to record a new (part) payment. Recording a payment
 * that covers the balance auto-marks the invoice PAID (server-side).
 */
export function InvoicePayments({
  invoiceId,
  currency,
  total,
  payments,
  locked,
}: {
  invoiceId: string;
  currency: string;
  total: number;
  payments: PaymentRow[];
  /** VOID invoices can't take payments. */
  locked: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, start] = useTransition();

  const paid = payments.reduce((n, p) => n + p.amount, 0);
  const balance = Math.round((total - paid) * 100) / 100;
  const settled = balance <= 0.009;

  const [amount, setAmount] = useState<string>(
    balance > 0 ? balance.toFixed(2) : "",
  );
  const [paidOn, setPaidOn] = useState<string>(todayLocalIso());
  const [method, setMethod] = useState<string>(METHODS[0]);
  const [reference, setReference] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.show({ tone: "error", message: "Enter a payment amount greater than zero." });
      return;
    }
    start(async () => {
      const res = await recordPaymentAction(invoiceId, {
        amount: amt,
        paidOn,
        method,
        reference,
        notes,
      });
      if (res.ok) {
        toast.show({ tone: "success", message: "Payment recorded." });
        setReference("");
        setNotes("");
        setAmount("");
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't record the payment." });
      }
    });
  }

  async function remove(p: PaymentRow) {
    const ok = await confirm({
      title: "Delete this payment?",
      body: `${formatMoney(p.amount, { currency })} received on ${formatDate(p.paidOn)} will be removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    start(async () => {
      const res = await deletePaymentAction(p.id, invoiceId);
      if (res.ok) {
        toast.show({ tone: "success", message: "Payment deleted." });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't delete the payment." });
      }
    });
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-brand-navy">Payments</h2>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
          <span className="text-slate-500">
            Paid{" "}
            <span className="tabular-nums text-brand-navy font-medium">
              {formatMoney(paid, { currency })}
            </span>
          </span>
          <span className="text-slate-500">
            Balance{" "}
            <span
              className={
                "tabular-nums font-semibold " +
                (settled ? "text-success" : "text-brand-navy")
              }
            >
              {formatMoney(balance, { currency })}
            </span>
          </span>
        </div>
      </div>

      {payments.length > 0 && (
        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th>Date</th>
                <th>Method</th>
                <th>Reference</th>
                <th className="col-num">Amount</th>
                <th className="w-10" aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap tabular-nums">
                    {formatDate(p.paidOn)}
                  </td>
                  <td>{p.method ?? "—"}</td>
                  <td className="text-slate-600">
                    {p.reference || (p.notes ? p.notes : "—")}
                  </td>
                  <td className="col-num">{formatMoney(p.amount, { currency })}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => remove(p)}
                      disabled={pending}
                      aria-label="Delete payment"
                      className="text-slate-400 hover:text-red-600 p-1"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {locked ? (
        <p className="text-sm text-slate-500">
          This invoice is voided. Un-void it to record a payment.
        </p>
      ) : settled && payments.length > 0 ? (
        <p className="text-sm text-success">Fully paid. Add another only if there's an overpayment or correction.</p>
      ) : null}

      {!locked && (
        <div className="border-t border-slate-100 pt-4">
          <p className="label mb-2">Record a payment</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="label" htmlFor="pay-amount">
                Amount
              </label>
              <input
                id="pay-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="label" htmlFor="pay-date">
                Date received
              </label>
              <input
                id="pay-date"
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor="pay-method">
                Method
              </label>
              <select
                id="pay-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="input"
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="pay-ref">
                Reference
              </label>
              <input
                id="pay-ref"
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="input"
                placeholder="Optional"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="btn-primary text-sm w-full"
              >
                {pending ? "Saving…" : "Record payment"}
              </button>
            </div>
          </div>
          <div className="mt-3">
            <label className="label" htmlFor="pay-notes">
              Notes
            </label>
            <input
              id="pay-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input"
              placeholder="Optional — anything worth remembering about this payment"
            />
          </div>
        </div>
      )}
    </div>
  );
}
