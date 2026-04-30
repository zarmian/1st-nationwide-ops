"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import {
  createRegion,
  updateRegion,
  deleteRegion,
  type RegionFormState,
} from "../_actions";

export type RegionRow = {
  id: number;
  name: string;
  notes: string | null;
  siteCount: number;
};

export function RegionsManager({ regions }: { regions: RegionRow[] }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Name
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Notes
              </th>
              <th className="text-right px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Sites
              </th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {regions.map((r) =>
              editingId === r.id ? (
                <EditRow
                  key={r.id}
                  region={r}
                  onDone={() => setEditingId(null)}
                />
              ) : (
                <DisplayRow
                  key={r.id}
                  region={r}
                  onEdit={() => setEditingId(r.id)}
                />
              ),
            )}
            {regions.length === 0 && !adding && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  No regions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding ? (
        <AddRow onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="btn-secondary"
        >
          + Add region
        </button>
      )}
    </div>
  );
}

function DisplayRow({
  region,
  onEdit,
}: {
  region: RegionRow;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    if (!confirm(`Delete region "${region.name}"?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteRegion(region.id);
      if (!res.ok) setError(res.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-2.5 font-medium text-brand-navy">{region.name}</td>
      <td className="px-4 py-2.5 text-slate-600">{region.notes ?? "—"}</td>
      <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">
        {region.siteCount}
      </td>
      <td className="px-4 py-2.5 text-right">
        {error && <span className="text-xs text-red-600 mr-2">{error}</span>}
        <button
          type="button"
          onClick={onEdit}
          className="btn-ghost text-sm mr-1"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending || region.siteCount > 0}
          className="btn-ghost text-sm text-red-600 disabled:text-slate-300"
          title={
            region.siteCount > 0
              ? "Reassign sites first"
              : "Delete this region"
          }
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

function EditRow({ region, onDone }: { region: RegionRow; onDone: () => void }) {
  const router = useRouter();
  const action = updateRegion.bind(null, region.id);
  const [state, formAction] = useFormState<RegionFormState, FormData>(
    async (prev, fd) => {
      const res = await action(prev, fd);
      if (!res.error && !res.fieldErrors) {
        onDone();
        router.refresh();
      }
      return res;
    },
    {},
  );

  return (
    <tr className="bg-slate-50">
      <td colSpan={4} className="px-4 py-3">
        <form action={formAction} className="flex flex-wrap gap-2 items-end">
          <div className="min-w-[200px]">
            <label className="label text-xs">Name</label>
            <input
              name="name"
              defaultValue={region.name}
              className="input"
              required
            />
            {state.fieldErrors?.name && (
              <p className="text-xs text-red-600 mt-1">
                {state.fieldErrors.name.join(", ")}
              </p>
            )}
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="label text-xs">Notes</label>
            <input
              name="notes"
              defaultValue={region.notes ?? ""}
              className="input"
            />
          </div>
          <SaveButton />
          <button
            type="button"
            onClick={onDone}
            className="btn-ghost text-sm"
          >
            Cancel
          </button>
          {state.error && (
            <p className="w-full text-xs text-red-600">{state.error}</p>
          )}
        </form>
      </td>
    </tr>
  );
}

function AddRow({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [state, formAction] = useFormState<RegionFormState, FormData>(
    async (prev, fd) => {
      const res = await createRegion(prev, fd);
      if (!res.error && !res.fieldErrors) {
        onDone();
        router.refresh();
      }
      return res;
    },
    {},
  );

  return (
    <form action={formAction} className="card p-3 flex flex-wrap gap-2 items-end">
      <div className="min-w-[200px]">
        <label className="label text-xs">Name</label>
        <input name="name" className="input" required autoFocus />
        {state.fieldErrors?.name && (
          <p className="text-xs text-red-600 mt-1">
            {state.fieldErrors.name.join(", ")}
          </p>
        )}
      </div>
      <div className="flex-1 min-w-[200px]">
        <label className="label text-xs">Notes</label>
        <input name="notes" className="input" />
      </div>
      <SaveButton label="Add" />
      <button type="button" onClick={onDone} className="btn-ghost text-sm">
        Cancel
      </button>
      {state.error && (
        <p className="w-full text-xs text-red-600">{state.error}</p>
      )}
    </form>
  );
}

function SaveButton({ label = "Save" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary text-sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </button>
  );
}
