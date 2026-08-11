"use client";

import Link from "next/link";
import { useState } from "react";

const STATUS_LABEL: Record<string, string> = {
  WITH_US: "With us",
  WITH_OFFICER: "With officer",
  WITH_CUSTOMER: "With customer",
  LOST: "Lost",
  RETIRED: "Retired",
};

const STATUS_TONE: Record<string, string> = {
  WITH_US: "chip-mint",
  WITH_OFFICER: "chip-amber",
  WITH_CUSTOMER: "chip-slate",
  LOST: "chip-red",
  RETIRED: "chip-slate",
};

export type KeyRowKey = {
  id: string;
  internalNo: string | null;
  label: string;
  type: string;
  status: string;
  site: { id: string; name: string; code: string | null } | null;
  currentHolder: { id: string; name: string } | null;
};

export type SetRow = {
  kind: "set";
  setId: string;
  setLabel: string;
  setInternalNo: string | null;
  site: { id: string; name: string; code: string | null } | null;
  keys: KeyRowKey[];
};

export type LooseRow = {
  kind: "loose";
  key: KeyRowKey;
};

export type KeyTableRow = SetRow | LooseRow;

export function KeysTable({
  rows,
  footer,
  emptyState,
}: {
  rows: KeyTableRow[];
  footer?: string;
  emptyState: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-slate-500">
        {emptyState}
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="table-scroll">
        <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left w-8"></th>
            <th className="px-3 py-2 text-left">Code</th>
            <th className="px-3 py-2 text-left">Label</th>
            <th className="px-3 py-2 text-left">Type</th>
            <th className="px-3 py-2 text-left">Site</th>
            <th className="px-3 py-2 text-left">Holder</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            r.kind === "set" ? (
              <SetRowView key={`set:${r.setId}`} row={r} />
            ) : (
              <LooseRowView key={`key:${r.key.id}`} row={r} />
            ),
          )}
        </tbody>
        </table>
      </div>
      {footer && (
        <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
          {footer}
        </div>
      )}
    </div>
  );
}

function SetRowView({ row }: { row: SetRow }) {
  const [open, setOpen] = useState(false);
  const summary = summariseSet(row.keys);
  const count = row.keys.length;

  return (
    <>
      <tr className="border-t border-slate-200 hover:bg-slate-50">
        <td className="px-3 py-3 text-slate-400 text-center">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-grid place-items-center min-h-[2.75rem] min-w-[2.75rem] md:min-h-0 md:min-w-0 rounded hover:bg-slate-100"
          >
            <span aria-hidden>{open ? "▾" : "▸"}</span>
            <span className="sr-only">
              {open ? "Collapse" : "Expand"} set
            </span>
          </button>
        </td>
        <td
          className="px-3 py-3 font-mono text-xs text-slate-600 cursor-pointer"
          onClick={() => setOpen((v) => !v)}
        >
          {row.setInternalNo ?? "—"}
        </td>
        <td className="px-3 py-3">
          <Link
            href={`/key-sets/${row.setId}`}
            className="font-medium text-brand-navy hover:text-brand-blue-dark"
          >
            {row.setLabel}
          </Link>
          <div className="text-xs text-slate-500">
            Set · {count} key{count === 1 ? "" : "s"}
          </div>
        </td>
        <td className="px-3 py-3 text-slate-600">{summary.type}</td>
        <td className="px-3 py-3 text-slate-600">{row.site?.name ?? "—"}</td>
        <td className="px-3 py-3 text-slate-600">{summary.holder}</td>
        <td className="px-3 py-3">
          {summary.status === "MIXED" ? (
            <span className="chip-slate">Mixed</span>
          ) : (
            <span className={STATUS_TONE[summary.status] ?? "chip-slate"}>
              {STATUS_LABEL[summary.status] ?? summary.status}
            </span>
          )}
        </td>
        <td className="px-3 py-3 text-right whitespace-nowrap">
          <Link
            href={`/key-sets/${row.setId}`}
            className="text-xs text-brand-blue-dark hover:text-brand-navy underline"
          >
            Open set
          </Link>
        </td>
      </tr>
      {open &&
        row.keys.map((k) => (
          <tr
            key={k.id}
            className="border-t border-slate-100 bg-slate-50/40 hover:bg-slate-50"
          >
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2 pl-8 font-mono text-xs text-slate-600">
              {k.internalNo ?? "—"}
            </td>
            <td className="px-3 py-2">
              <Link
                href={`/keys/${k.id}`}
                className="text-brand-navy hover:text-brand-blue-dark"
              >
                {k.label}
              </Link>
            </td>
            <td className="px-3 py-2 text-slate-600">{titleCase(k.type)}</td>
            <td className="px-3 py-2 text-slate-500">
              {k.site?.name ?? "—"}
            </td>
            <td className="px-3 py-2 text-slate-500">
              {k.currentHolder?.name ?? "—"}
            </td>
            <td className="px-3 py-2">
              <span className={STATUS_TONE[k.status] ?? "chip-slate"}>
                {STATUS_LABEL[k.status] ?? k.status}
              </span>
            </td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              <Link
                href={`/keys/${k.id}`}
                className="text-xs text-brand-blue-dark hover:text-brand-navy underline mr-3"
              >
                Hand over
              </Link>
              <Link
                href={`/keys/${k.id}/edit`}
                className="text-xs text-brand-blue-dark hover:text-brand-navy underline"
              >
                Edit
              </Link>
            </td>
          </tr>
        ))}
    </>
  );
}

function LooseRowView({ row }: { row: LooseRow }) {
  const k = row.key;
  return (
    <tr className="border-t border-slate-200 hover:bg-slate-50">
      <td className="px-3 py-3"></td>
      <td className="px-3 py-3 font-mono text-xs text-slate-600">
        {k.internalNo ?? "—"}
      </td>
      <td className="px-3 py-3">
        <Link
          href={`/keys/${k.id}`}
          className="font-medium text-brand-navy hover:text-brand-blue-dark"
        >
          {k.label}
        </Link>
      </td>
      <td className="px-3 py-3 text-slate-600">{titleCase(k.type)}</td>
      <td className="px-3 py-3 text-slate-600">{k.site?.name ?? "—"}</td>
      <td className="px-3 py-3 text-slate-600">
        {k.currentHolder?.name ?? "—"}
      </td>
      <td className="px-3 py-3">
        <span className={STATUS_TONE[k.status] ?? "chip-slate"}>
          {STATUS_LABEL[k.status] ?? k.status}
        </span>
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap">
        <Link
          href={`/keys/${k.id}`}
          className="text-xs text-brand-blue-dark hover:text-brand-navy underline mr-3"
        >
          Hand over
        </Link>
        <Link
          href={`/keys/${k.id}/edit`}
          className="text-xs text-brand-blue-dark hover:text-brand-navy underline"
        >
          Edit
        </Link>
      </td>
    </tr>
  );
}

function summariseSet(keys: KeyRowKey[]): {
  type: string;
  status: string;
  holder: string;
} {
  if (keys.length === 0) {
    return { type: "—", status: "—", holder: "—" };
  }
  const types = new Set(keys.map((k) => k.type));
  const statuses = new Set(keys.map((k) => k.status));
  const holderIds = new Set(keys.map((k) => k.currentHolder?.id ?? "__none__"));

  return {
    type: types.size === 1 ? titleCase([...types][0]!) : "Mixed",
    status: statuses.size === 1 ? [...statuses][0]! : "MIXED",
    holder:
      holderIds.size === 1
        ? keys[0]!.currentHolder?.name ?? "—"
        : "Mixed",
  };
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
}
