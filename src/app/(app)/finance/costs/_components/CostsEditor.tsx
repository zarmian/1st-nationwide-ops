"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { formatMoney } from "@/lib/numbers";
import { formatDate } from "@/lib/dates";
import { addCostAction, deleteCostAction } from "../_actions";

export type CostRowView = {
  id: string;
  date: string; // ISO
  supplier: string;
  category: string;
  description: string | null;
  net: number;
  vatRate: number;
  vatAmount: number;
  gross: number;
  reference: string | null;
  reclaimable: boolean;
  notes: string | null;
};

const VAT_RATES = [
  { v: "0.2", label: "20% (standard)" },
  { v: "0.05", label: "5% (reduced)" },
  { v: "0", label: "0% / no VAT" },
];

function todayLocalIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The supplier-costs ledger for a period: a list with delete, and an add form.
 * VAT and gross are derived from net × the chosen rate server-side, so the form
 * only asks for the net amount.
 */
export function CostsEditor({
  categories,
  costs,
  defaultDate,
}: {
  categories: string[];
  costs: CostRowView[];
  /** ISO yyyy-mm-dd default inside the current period. */
  defaultDate: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [date, setDate] = useState(defaultDate || todayLocalIso());
  const [supplier, setSupplier] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [net, setNet] = useState("");
  const [vatRate, setVatRate] = useState(VAT_RATES[0].v);
  const [reclaimable, setReclaimable] = useState(true);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");

  const netNum = Number(net);
  const previewVat = Number.isFinite(netNum)
    ? Math.round(netNum * Number(vatRate) * 100) / 100
    : 0;
  const previewGross = Math.round((netNum + previewVat) * 100) / 100;

  function submit() {
    if (!supplier.trim()) {
      toast.show({ tone: "error", message: "Enter the supplier's name." });
      return;
    }
    if (!Number.isFinite(netNum) || netNum < 0) {
      toast.show({ tone: "error", message: "Enter the net amount (before VAT)." });
      return;
    }
    start(async () => {
      const res = await addCostAction({
        date,
        supplier,
        category,
        description,
        net: netNum,
        vatRate: Number(vatRate),
        reclaimable,
        reference,
      });
      if (res.ok) {
        toast.show({ tone: "success", message: "Cost added." });
        setSupplier("");
        setNet("");
        setReference("");
        setDescription("");
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't save." });
      }
    });
  }

  async function remove(c: CostRowView) {
    const ok = await confirm({
      title: "Delete this cost?",
      body: `${c.supplier} · ${formatMoney(c.gross)} on ${formatDate(c.date)} will be removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    start(async () => {
      const res = await deleteCostAction(c.id);
      if (res.ok) {
        toast.show({ tone: "success", message: "Cost deleted." });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't delete." });
      }
    });
  }

  return (
    <div className="card p-5 space-y-4">
      <h2 className="font-semibold text-brand-navy">Costs</h2>

      {costs.length > 0 && (
        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th>Date</th>
                <th>Supplier</th>
                <th>Category</th>
                <th className="col-num">Net</th>
                <th className="col-num">VAT</th>
                <th className="col-num">Gross</th>
                <th className="w-10" aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap tabular-nums">
                    {formatDate(c.date)}
                  </td>
                  <td>
                    {c.supplier}
                    {c.reference ? (
                      <span className="text-slate-500"> · {c.reference}</span>
                    ) : null}
                    {c.description ? (
                      <div className="text-xs text-slate-500">{c.description}</div>
                    ) : null}
                  </td>
                  <td>{c.category}</td>
                  <td className="col-num">{formatMoney(c.net)}</td>
                  <td className="col-num">
                    {formatMoney(c.vatAmount)}
                    {!c.reclaimable && c.vatAmount > 0 ? (
                      <span
                        className="text-amber-600"
                        title="VAT not reclaimable"
                      >
                        {" "}
                        *
                      </span>
                    ) : null}
                  </td>
                  <td className="col-num font-medium">{formatMoney(c.gross)}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      disabled={pending}
                      aria-label="Delete cost"
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
      {costs.some((c) => !c.reclaimable && c.vatAmount > 0) && (
        <p className="text-xs text-amber-600">
          * VAT marked not reclaimable — excluded from Box 4.
        </p>
      )}

      <div className="border-t border-slate-100 pt-4">
        <p className="label mb-2">Add a cost</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="c-date">
              Bill date
            </label>
            <input
              id="c-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="c-supplier">
              Supplier
            </label>
            <input
              id="c-supplier"
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              className="input"
              placeholder="e.g. Nexus Security"
            />
          </div>
          <div>
            <label className="label" htmlFor="c-category">
              Category
            </label>
            <select
              id="c-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="input"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="c-net">
              Net (before VAT)
            </label>
            <input
              id="c-net"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={net}
              onChange={(e) => setNet(e.target.value)}
              className="input"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="label" htmlFor="c-vat">
              VAT rate
            </label>
            <select
              id="c-vat"
              value={vatRate}
              onChange={(e) => setVatRate(e.target.value)}
              className="input"
            >
              {VAT_RATES.map((r) => (
                <option key={r.v} value={r.v}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="c-ref">
              Reference
            </label>
            <input
              id="c-ref"
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="input"
              placeholder="Supplier invoice no."
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="label" htmlFor="c-desc">
              Description
            </label>
            <input
              id="c-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
              {pending ? "Saving…" : "Add cost"}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={reclaimable}
              onChange={(e) => setReclaimable(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            VAT reclaimable (include in Box 4)
          </label>
          {net !== "" && Number.isFinite(netNum) && (
            <p className="text-xs text-slate-500 tabular-nums">
              VAT {formatMoney(previewVat)} · Gross {formatMoney(previewGross)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
