"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function RetryButton({
  id,
  retry,
}: {
  id: string;
  retry: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function onClick() {
    startTransition(async () => {
      await retry(id);
      router.refresh();
    });
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="btn-ghost text-xs"
    >
      {pending ? "…" : "Retry"}
    </button>
  );
}

export function FlushButton({
  flush,
}: {
  flush: () => Promise<{
    ok: boolean;
    scanned: number;
    sent: number;
    failed: number;
    skipped: number;
  }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function onClick() {
    startTransition(async () => {
      await flush();
      router.refresh();
    });
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="btn-secondary text-sm"
    >
      {pending ? "Flushing…" : "Flush queue now"}
    </button>
  );
}
