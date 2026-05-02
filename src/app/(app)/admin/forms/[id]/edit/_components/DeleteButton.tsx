"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteButton({
  id,
  submissions,
  deleteAction,
}: {
  id: string;
  submissions: number;
  deleteAction: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const willSoftDelete = submissions > 0;

  function onClick() {
    const msg = willSoftDelete
      ? `${submissions} submission${submissions === 1 ? " uses" : "s use"} this template — it will be deactivated, not deleted. Continue?`
      : "Delete this template?";
    if (!confirm(msg)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAction(id);
      if (!res.ok) {
        setError(res.error ?? "Failed");
        return;
      }
      router.push("/admin/forms");
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="btn-ghost text-sm text-red-600"
      >
        {pending ? "Removing…" : willSoftDelete ? "Deactivate template" : "Delete template"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
