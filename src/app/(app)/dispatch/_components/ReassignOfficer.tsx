"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { useToast } from "@/components/Toast";
import { reassignJob, reassignVisit } from "../../patrols/_actions";

/**
 * Inline "change officer" control for a still-live activity (job or visit).
 * A person icon + a compact select that auto-submits on change — one gesture,
 * no separate save button, so it fits a dense row. Routes to reassignJob /
 * reassignVisit (which only flip pre-start status, never overwrite work in
 * progress) and refreshes on success.
 *
 * Only render this for activities that haven't been completed/closed — the
 * caller decides via `canReassign`.
 */
export function ReassignOfficer({
  kind,
  id,
  currentOfficerId,
  officers,
  size = "default",
}: {
  kind: "job" | "visit";
  id: string;
  currentOfficerId: string | null;
  officers: { id: string; name: string }[];
  size?: "default" | "small";
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const officerId = e.target.value;
    if (officerId === (currentOfficerId ?? "")) return;
    const fd = new FormData();
    fd.set(kind === "job" ? "jobId" : "visitId", id);
    fd.set("officerId", officerId);
    startTransition(async () => {
      const res = kind === "job" ? await reassignJob(fd) : await reassignVisit(fd);
      if (res.ok) {
        const name = officers.find((o) => o.id === officerId)?.name;
        toast.show({
          tone: "success",
          message: officerId ? `Reassigned to ${name}.` : "Officer unassigned.",
        });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't reassign." });
      }
    });
  }

  const textCls = size === "small" ? "text-[11px]" : "text-xs";

  return (
    <span
      className="inline-flex items-center gap-1 text-slate-500"
      title="Change officer"
    >
      <UserCog className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <label className="sr-only" htmlFor={`reassign-${id}`}>
        Change officer
      </label>
      <select
        id={`reassign-${id}`}
        value={currentOfficerId ?? ""}
        onChange={onChange}
        disabled={pending}
        className={`${textCls} max-w-[8.5rem] truncate rounded border border-slate-200 bg-white px-1 py-0.5 text-slate-700 hover:border-slate-300 focus:border-brand-blue focus:outline-none disabled:opacity-50`}
      >
        <option value="">Unassigned</option>
        {officers.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </span>
  );
}
