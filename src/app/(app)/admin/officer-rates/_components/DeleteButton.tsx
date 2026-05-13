"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function DeleteRateButton({
  id,
  remove,
}: {
  id: string;
  remove: (id: string) => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function onClick() {
    if (!window.confirm("Delete this rate?")) return;
    startTransition(async () => {
      await remove(id);
      router.refresh();
    });
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="btn-ghost text-xs text-red-600"
    >
      {pending ? "…" : "Delete"}
    </button>
  );
}
