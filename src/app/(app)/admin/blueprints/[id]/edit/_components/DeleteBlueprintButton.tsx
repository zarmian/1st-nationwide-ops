"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteBlueprintButton({
  id,
  builtin,
  templateCount,
  deleteAction,
}: {
  id: string;
  builtin: boolean;
  templateCount: number;
  deleteAction: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const willDeactivate = builtin || templateCount > 0;

  function onClick() {
    let msg: string;
    if (builtin) {
      msg = "This is a built-in blueprint — it'll be deactivated (hidden from pickers) instead of deleted. Continue?";
    } else if (templateCount > 0) {
      msg = `${templateCount} template${templateCount === 1 ? "" : "s"} reference this blueprint — it will be deactivated rather than deleted. Continue?`;
    } else {
      msg = "Delete this blueprint?";
    }
    if (!confirm(msg)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAction(id);
      if (!res.ok) {
        setError(res.error ?? "Failed");
        return;
      }
      router.push("/admin/blueprints");
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
        {pending
          ? "Removing…"
          : willDeactivate
            ? "Deactivate blueprint"
            : "Delete blueprint"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
