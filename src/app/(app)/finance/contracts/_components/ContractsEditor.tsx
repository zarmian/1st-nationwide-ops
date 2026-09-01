"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { formatMoney } from "@/lib/numbers";
import { formatDate } from "@/lib/dates";
import {
  addContractAction,
  updateContractStatusAction,
  deleteContractAction,
} from "../_actions";

export type ContractRowView = {
  id: string;
  customerName: string;
  title: string;
  value: number;
  cadence: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  annualised: number;
  startDate: string; // ISO
  endDate: string | null; // ISO
  status: "ACTIVE" | "EXPIRED" | "CANCELLED";
  daysUntilRenewal: number | null;
  renewingSoon: boolean;
  notes: string | null;
};

const CADENCES = [
  { v: "MONTHLY", label: "per month" },
  { v: "QUARTERLY", label: "per quarter" },
  { v: "ANNUAL", label: "per year" },
];
const CADENCE_SHORT: Record<string, string> = {
  MONTHLY: "/mo",
  QUARTERLY: "/qtr",
  ANNUAL: "/yr",
};
const STATUS_CHIP: Record<string, string> = {
  ACTIVE: "chip-green",
  EXPIRED: "chip-slate",
  CANCELLED: "chip-red",
};

function todayLocalIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function renewalLabel(r: ContractRowView): {
  text: string;
  cls: string;
} {
  if (r.status !== "ACTIVE") return { text: "—", cls: "text-slate-400" };
  if (r.endDate == null) return { text: "Open-ended", cls: "text-slate-500" };
  const d = r.daysUntilRenewal ?? 0;
  if (d < 0) return { text: `Overdue ${Math.abs(d)}d`, cls: "text-red-600 font-medium" };
  if (r.renewingSoon) return { text: `Renews in ${d}d`, cls: "text-amber-700 font-medium" };
  return { text: `${formatDate(r.endDate)}`, cls: "text-slate-600" };
}

export function ContractsEditor({
  customers,
  contracts,
}: {
  customers: { id: string; name: string }[];
  contracts: ContractRowView[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [cadence, setCadence] = useState("MONTHLY");
  const [startDate, setStartDate] = useState(todayLocalIso());
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");

  function submit() {
    if (!customerId) {
      toast.show({ tone: "error", message: "Pick a customer." });
      return;
    }
    if (!title.trim()) {
      toast.show({ tone: "error", message: "Give the contract a title." });
      return;
    }
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0) {
      toast.show({ tone: "error", message: "Enter the contract value." });
      return;
    }
    start(async () => {
      const res = await addContractAction({
        customerId,
        title,
        value: v,
        cadence,
        startDate,
        endDate: endDate || null,
        notes,
      });
      if (res.ok) {
        toast.show({ tone: "success", message: "Contract added." });
        setTitle("");
        setValue("");
        setEndDate("");
        setNotes("");
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't save." });
      }
    });
  }

  function setStatus(id: string, status: ContractRowView["status"], msg: string) {
    start(async () => {
      const res = await updateContractStatusAction(id, status);
      if (res.ok) {
        toast.show({ tone: "success", message: msg });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't update." });
      }
    });
  }

  async function remove(r: ContractRowView) {
    const ok = await confirm({
      title: "Delete this contract?",
      body: `${r.title} · ${r.customerName} will be removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    start(async () => {
      const res = await deleteContractAction(r.id);
      if (res.ok) {
        toast.show({ tone: "success", message: "Contract deleted." });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't delete." });
      }
    });
  }

  return (
    <div className="card p-5 space-y-4">
      <h2 className="font-semibold text-brand-navy">All contracts</h2>

      {contracts.length > 0 && (
        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th>Contract</th>
                <th className="col-num">Value</th>
                <th className="col-num">Per year</th>
                <th>Renewal</th>
                <th>Status</th>
                <th className="w-10" aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((r) => {
                const ren = renewalLabel(r);
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium text-brand-navy">{r.title}</div>
                      <div className="text-xs text-slate-500">
                        {r.customerName} · from {formatDate(r.startDate)}
                        {r.notes ? ` · ${r.notes}` : ""}
                      </div>
                    </td>
                    <td className="col-num whitespace-nowrap">
                      {formatMoney(r.value)}
                      <span className="text-slate-400">
                        {CADENCE_SHORT[r.cadence]}
                      </span>
                    </td>
                    <td className="col-num">{formatMoney(r.annualised)}</td>
                    <td className={"whitespace-nowrap " + ren.cls}>{ren.text}</td>
                    <td>
                      <span className={STATUS_CHIP[r.status] ?? "chip-slate"}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {r.status === "ACTIVE" ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              setStatus(r.id, "EXPIRED", "Marked not renewed.")
                            }
                            className="text-xs text-slate-500 hover:text-brand-navy px-1 whitespace-nowrap"
                          >
                            Not renewed
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              setStatus(r.id, "ACTIVE", "Reactivated.")
                            }
                            className="text-xs text-slate-500 hover:text-brand-navy px-1"
                          >
                            Reactivate
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(r)}
                          disabled={pending}
                          aria-label="Delete contract"
                          className="text-slate-400 hover:text-red-600 p-1"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-slate-100 pt-4">
        <p className="label mb-2">Add a contract</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label" htmlFor="ct-customer">
              Customer
            </label>
            <select
              id="ct-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="input"
            >
              <option value="">— pick a customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ct-title">
              Title
            </label>
            <input
              id="ct-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input"
              placeholder="e.g. Keyholding & alarm response"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="ct-value">
                Value
              </label>
              <input
                id="ct-value"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="input"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="label" htmlFor="ct-cadence">
                Per
              </label>
              <select
                id="ct-cadence"
                value={cadence}
                onChange={(e) => setCadence(e.target.value)}
                className="input"
              >
                {CADENCES.map((c) => (
                  <option key={c.v} value={c.v}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="ct-start">
              Start date
            </label>
            <input
              id="ct-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="ct-end">
              Renewal / end date
            </label>
            <input
              id="ct-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="btn-primary text-sm w-full"
            >
              {pending ? "Saving…" : "Add contract"}
            </button>
          </div>
        </div>
        <div className="mt-3">
          <label className="label" htmlFor="ct-notes">
            Notes
          </label>
          <input
            id="ct-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input"
            placeholder="Optional — sites covered, terms, contact…"
          />
        </div>
      </div>
    </div>
  );
}
