"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { closeJob } from "../_actions";
import { closePatrolVisit } from "../../patrols/_actions";

/**
 * Dispatcher "close" affordance — used when the officer didn't tick an
 * activity complete in the app but informed dispatch by phone/radio.
 * Routes to closeJob for Jobs and closePatrolVisit for PatrolVisits
 * (the kind prop discriminates). Both server actions stamp the
 * completion timestamps with "now", merge an audit note into the
 * activity's notes, and snapshot billing + officer pay.
 */
export function CloseActivityButton({
  kind,
  id,
  label,
  size = "small",
}: {
  kind: "job" | "visit";
  id: string;
  label: string;
  size?: "small" | "default";
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  async function onClick() {
    const ok = await confirm({
      title: `Mark "${label}" as complete?`,
      body: (
        <>
          Use this when the officer{" "}
          <span className="font-medium">told you by phone or radio</span>{" "}
          that the activity is done but didn't close it in the app. It'll
          be stamped complete with the current time and finance will pick
          it up — edit the times later if you need to adjust them.
        </>
      ),
      confirmLabel: "Mark complete",
      cancelLabel: "Keep open",
    });
    if (!ok) return;
    startTransition(async () => {
      const res =
        kind === "job"
          ? await closeJob(id)
          : await closePatrolVisit(id);
      if (res.ok) {
        toast.show({
          tone: "success",
          message: `"${label}" marked complete.`,
        });
        router.refresh();
      } else {
        toast.show({
          tone: "error",
          message: res.error ?? "Couldn't close.",
        });
      }
    });
  }

  const icon = size === "small" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Mark complete"
      aria-label="Mark complete"
      className="inline-flex items-center justify-center rounded p-1 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-50 transition-colors"
    >
      {pending ? (
        <Loader2 className={`${icon} animate-spin`} aria-hidden />
      ) : (
        <Check className={icon} aria-hidden />
      )}
    </button>
  );
}
