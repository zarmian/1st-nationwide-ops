"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";

export function DuplicateButton({
  id,
  duplicateAction,
}: {
  id: string;
  duplicateAction: (
    id: string,
  ) => Promise<{ ok: boolean; id?: string; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await duplicateAction(id);
      if (!res.ok || !res.id) {
        setError(res.error ?? "Could not duplicate");
        return;
      }
      router.push(`/admin/forms/${res.id}/edit`);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="btn-secondary text-sm"
      >
        {pending ? "Duplicating…" : "Duplicate template"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
      <span className="text-xs text-slate-500">
        Creates an inactive copy at Global scope so you can re-target it.
      </span>
    </div>
  );
}
