"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { formatMoney } from "@/lib/numbers";
import { formatDate } from "@/lib/dates";
import { addPayAdjustmentAction, deletePayAdjustmentAction } from "../_actions";

export type AdjustmentRow = {
  id: string;
  date: string; // ISO
  kind: string;
  label: string;
  amount: number;
  note: string | null;
};

// Suggested categories. The amount's sign decides add vs deduct, so these are
// just labels — pick "Deduction" and enter a negative amount, etc.
const KINDS = ["Bonus", "Expense", "Holiday pay", "Deduction", "Correction", "Other"];

function todayLocalIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Manage the manual pay adjustments that land on this officer's payslip for the
 * chosen period: a list with delete, plus an add form. Amount is signed —
 * negative subtracts (a deduction), positive adds.
 */
export function PayAdjustmentsEditor({
  officerId,
  currency,
  adjustments,
  defaultDate,
}: {
  officerId: string;
  currency: string;
  adjustments: AdjustmentRow[];
  /** A sensible default date inside the current period (ISO yyyy-mm-dd). */
  defaultDate: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [date, setDate] = useState<string>(defaultDate || todayLocalIso());
  const [kind, setKind] = useState<string>(KINDS[0]);
  const [label, setLabel] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const total = adjustments.reduce((n, a) => n + a.amount, 0);

  function submit() {
    const amt = Number(amount);
    if (!label.trim()) {
      toast.show({ tone: "error", message: "Give the adjustment a short label." });
      return;
    }
    if (!Number.isFinite(amt) || amt === 0) {
      toast.show({
        tone: "error",
        message: "Enter a non-zero amount (negative to deduct).",
      });
      return;
    }
    start(async () => {
      const res = await addPayAdjustmentAction(officerId, {
        date,
        kind,
        label,
        amount: amt,
        note,
      });
      if (res.ok) {
        toast.show({ tone: "success", message: "Adjustment added." });
        setLabel("");
        setAmount("");
        setNote("");
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't save." });
      }
    });
  }

  async function remove(a: AdjustmentRow) {
    const ok = await confirm({
      title: "Delete this adjustment?",
      body: `${a.label} (${formatMoney(a.amount, { currency })}) will be removed from the payslip.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    start(async () => {
      const res = await deletePayAdjustmentAction(a.id, officerId);
      if (res.ok) {
        toast.show({ tone: "success", message: "Adjustment deleted." });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't delete." });
      }
    });
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-semibold text-brand-navy">Adjustments</h2>
          <p className="text-xs text-slate-500">
            Bonuses, expenses, holiday pay, deductions — dated into this period.
            Negative amounts subtract.
          </p>
        </div>
        {adjustments.length > 0 && (
          <span className="text-sm text-slate-500">
            Net{" "}
            <span
              className={
                "tabular-nums font-semibold " +
                (total < 0 ? "text-red-600" : "text-brand-navy")
              }
            >
              {formatMoney(total, { currency })}
            </span>
          </span>
        )}
      </div>

      {adjustments.length > 0 && (
        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Label</th>
                <th className="col-num">Amount</th>
                <th className="w-10" aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap tabular-nums">
                    {formatDate(a.date)}
                  </td>
                  <td>{a.kind}</td>
                  <td>
                    {a.label}
                    {a.note ? (
                      <span className="text-slate-500"> · {a.note}</span>
                    ) : null}
                  </td>
                  <td
                    className={
                      "col-num " + (a.amount < 0 ? "text-red-600" : "")
                    }
                  >
                    {formatMoney(a.amount, { currency })}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => remove(a)}
                      disabled={pending}
                      aria-label="Delete adjustment"
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

      <div className="border-t border-slate-100 pt-4">
        <p className="label mb-2">Add an adjustment</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="label" htmlFor="adj-date">
              Date
            </label>
            <input
              id="adj-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="adj-kind">
              Type
            </label>
            <select
              id="adj-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="input"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="adj-label">
              Label
            </label>
            <input
              id="adj-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="input"
              placeholder="e.g. Fuel expenses"
            />
          </div>
          <div>
            <label className="label" htmlFor="adj-amount">
              Amount
            </label>
            <input
              id="adj-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input"
              placeholder="e.g. 25 or -15"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="btn-primary text-sm w-full"
            >
              {pending ? "Saving…" : "Add"}
            </button>
          </div>
        </div>
        <div className="mt-3">
          <label className="label" htmlFor="adj-note">
            Note
          </label>
          <input
            id="adj-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input"
            placeholder="Optional"
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Tip: enter a negative amount for a deduction (e.g. an advance
          repayment).
        </p>
      </div>
    </div>
  );
}
