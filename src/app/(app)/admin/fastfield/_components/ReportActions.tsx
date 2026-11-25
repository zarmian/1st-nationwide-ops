"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import type { ActionResult } from "@/lib/actionResult";
import {
  createFastFieldJob,
  ignoreFastFieldReport,
  linkFastFieldReport,
  unlinkFastFieldReport,
} from "../_actions";
import { leaveFirstCheckReport, putBackFirstCheckReport } from "../_firstCheckActions";

const CREATE_OPTIONS: { value: string; label: string; noun: string }[] = [
  { value: "ALARM_RESPONSE", label: "Callout", noun: "callout" },
  { value: "PATROL", label: "Patrol", noun: "patrol job" },
  { value: "LOCK", label: "Lock-up", noun: "lock-up" },
  { value: "UNLOCK", label: "Unlock", noun: "unlock" },
  { value: "KEY_COLLECTION", label: "Key collection", noun: "key collection" },
  { value: "VPI", label: "VPI", noun: "VPI" },
  { value: "ADHOC", label: "Ad-hoc job", noun: "ad-hoc job" },
];

/** Runs a server action with a toast for the outcome, then refreshes the
 *  page. A thrown error (a timeout, a dropped connection) gets a toast too. */
function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  function run<T>(fn: () => Promise<ActionResult<T>>, done: string, after?: (data: T) => void) {
    start(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          toast.show({ tone: "success", message: done });
          after?.(res.data);
          router.refresh();
        } else {
          toast.show({ tone: "error", message: res.error || "Something went wrong." });
        }
      } catch {
        toast.show({
          tone: "error",
          message: "That didn't go through. Check your connection, reload the page and try again.",
        });
      }
    });
  }
  return { pending, run, toast };
}

function Busy({ pending }: { pending: boolean }) {
  return pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null;
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
      <span className="font-medium">Check: </span>
      {children}
    </p>
  );
}

/** What the confirmation before a hand link says about the activity. */
export type LinkConfirm = {
  title: string;
  /** What / When / Site / Client. */
  details: { term: string; value: string }[];
  /** Why the robot would skip it ("cancelled — linking won't reopen it"). */
  notes: string[];
  /** What linking does to it. */
  effect: string;
  /** It's a different client's activity. */
  warning: string | null;
};

export function LinkButton({
  reportId,
  kind,
  activityId,
  ariaLabel,
  confirm: c,
  done,
}: {
  reportId: string;
  kind: "job" | "visit" | "shift";
  activityId: string;
  /** "Link to the static shift 24 Nov, 19:00–07:00" — the list has a Link on every row. */
  ariaLabel: string;
  confirm: LinkConfirm;
  /** The toast once linked: what happened to the activity. */
  done: string;
}) {
  const { pending, run } = useAction();
  const confirm = useConfirm();
  return (
    <button
      type="button"
      className="btn btn-primary"
      disabled={pending}
      aria-label={ariaLabel}
      onClick={async () => {
        const yes = await confirm({
          title: c.title,
          body: (
            <div className="space-y-2">
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5">
                {c.details.map((d) => (
                  <div key={d.term} className="contents">
                    <dt className="text-slate-500">{d.term}</dt>
                    <dd className="text-slate-900 break-words">{d.value}</dd>
                  </div>
                ))}
              </dl>
              {c.notes.length > 0 && <p className="text-amber-900">Note: {c.notes.join("; ")}.</p>}
              <p>{c.effect}</p>
              {c.warning && <Warning>{c.warning}</Warning>}
            </div>
          ),
          confirmLabel: "Link it",
        });
        if (!yes) return;
        run(() => linkFastFieldReport(reportId, kind, activityId), done);
      }}
    >
      <Busy pending={pending} />
      Link
    </button>
  );
}

export function CreateJobForm({
  reportId,
  siteId,
  defaultType,
  siteName,
  clientName,
  warning,
}: {
  reportId: string;
  siteId: string;
  defaultType: string;
  siteName: string;
  clientName: string | null;
  /** The site is a different client's. */
  warning: string | null;
}) {
  const { pending, run } = useAction();
  const confirm = useConfirm();
  const [type, setType] = useState(
    CREATE_OPTIONS.some((o) => o.value === defaultType) ? defaultType : "ALARM_RESPONSE",
  );
  const noun = CREATE_OPTIONS.find((o) => o.value === type)?.noun ?? "job";
  return (
    <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100">
      <label htmlFor="ff-create-type" className="block">
        <span className="label">Or create the job it describes</span>
        <select
          id="ff-create-type"
          name="type"
          className="input w-auto"
          value={type}
          disabled={pending}
          onChange={(e) => setType(e.target.value)}
        >
          {CREATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={async () => {
          const yes = await confirm({
            title: `Create a ${noun} from this report?`,
            body: (
              <div className="space-y-2">
                <p>
                  A completed {noun} is made at {siteName}
                  {clientName ? ` (${clientName})` : ""} with the report&rsquo;s times, and it&rsquo;s
                  billed and paid like an officer&rsquo;s own report.
                </p>
                {warning && <Warning>{warning}</Warning>}
              </div>
            ),
            confirmLabel: "Create job",
          });
          if (!yes) return;
          run(() => createFastFieldJob(reportId, siteId, type), `The ${noun} was created from the report.`);
        }}
      >
        <Busy pending={pending} />
        Create job
      </button>
    </div>
  );
}

export function IgnoreButton({ reportId, ignored }: { reportId: string; ignored: boolean }) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={pending}
      onClick={() =>
        run(
          () => ignoreFastFieldReport(reportId, !ignored),
          ignored ? "Report brought back to the list." : "Report set aside.",
        )
      }
    >
      <Busy pending={pending} />
      {ignored ? "Bring back" : "Set aside"}
    </button>
  );
}

/**
 * Take a report off what it's attached to. It goes back to Needs linking, and
 * the robot won't link it again. `from` says what it's on: a shift (the
 * default), a job or visit it was linked to, or the job made from it — for
 * those, what the link did is undone where that's safe, and anything to look
 * at afterwards stays on screen until dismissed.
 */
export function UnlinkButton({
  reportId,
  label = "Unlink",
  className = "btn btn-ghost",
  ariaLabel,
  from = "shift",
  what,
}: {
  reportId: string;
  label?: string;
  className?: string;
  /** Says which report or activity, where several Unlinks are listed. */
  ariaLabel?: string;
  from?: "shift" | "job" | "visit" | "created";
  /** "the callout at Riverside Storage" — for jobs, visits and created jobs. */
  what?: string;
}) {
  const { pending, run, toast } = useAction();
  const confirm = useConfirm();
  const thing = what ?? (from === "visit" ? "the patrol visit" : from === "shift" ? "the shift" : "the job");
  const after =
    "It goes back to Needs linking on Admin → FastField, and the robot won't link it again. Link it to the right activity there, or set it aside.";
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      aria-label={ariaLabel}
      onClick={async () => {
        const yes = await confirm({
          title: `Take this report off ${thing}?`,
          body:
            from === "shift" ? (
              <p>{after}</p>
            ) : (
              <div className="space-y-2">
                <p>
                  {from === "created"
                    ? `That job was made from this report, so it's cancelled and its bill and pay are cleared, unless it's on an invoice.`
                    : `It comes off ${thing}. If the link marked it done or billed it, that's undone where it's safe.`}{" "}
                  Anything that can&rsquo;t be undone is listed for you to check.
                </p>
                <p>{after}</p>
              </div>
            ),
          confirmLabel: "Unlink",
          tone: "danger",
        });
        if (!yes) return;
        run(
          () => unlinkFastFieldReport(reportId),
          from === "shift" ? "Report taken off the shift." : `Report taken off ${thing}.`,
          (data) => {
            if (data.check.length) {
              toast.show({ tone: "info", message: `Please check: ${data.check.join(" ")}`, duration: 0 });
            }
          },
        );
      }}
    >
      <Busy pending={pending} />
      {label}
    </button>
  );
}

/**
 * "Put back" / "Leave it" for a report the robot moved or took off on 24 Nov
 * (Admin → FastField → Checked by the robot on 24 Nov).
 */
export function FirstCheckActions({
  reportId,
  reportTime,
  shiftId,
  shiftHours,
  mode,
  fromHours,
}: {
  reportId: string;
  /** The report's own time, to name it in the buttons' accessible names. */
  reportTime: string;
  /** The shift it was on. */
  shiftId: string;
  shiftHours: string;
  mode: "link" | "move" | "keep" | null;
  /** `move`: the shift it comes off. */
  fromHours: string | null;
}) {
  const { pending, run } = useAction();
  const confirm = useConfirm();
  return (
    <div className="flex flex-wrap gap-2">
      {mode && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          aria-label={
            mode === "keep"
              ? `Keep the report from ${reportTime} on the shift ${shiftHours}`
              : `Put the report from ${reportTime} back on the shift ${shiftHours}`
          }
          onClick={async () => {
            const yes = await confirm({
              title:
                mode === "keep"
                  ? `Keep this report on the shift ${shiftHours}?`
                  : `Put this report back on the shift ${shiftHours}?`,
              body: (
                <div className="space-y-2">
                  {mode === "move" && fromHours && <p>It comes off the shift {fromHours}, with its patrol round.</p>}
                  <p>
                    It becomes a hand link, so the robot leaves it on that shift even if it doesn&rsquo;t fit
                    the shift&rsquo;s time. Nothing is billed.
                  </p>
                </div>
              ),
              confirmLabel: mode === "keep" ? "Keep it there" : "Put it back",
            });
            if (!yes) return;
            run(
              () => putBackFirstCheckReport(reportId, shiftId),
              mode === "keep" ? "Kept on the shift as a hand link." : "Put back on the shift as a hand link.",
            );
          }}
        >
          <Busy pending={pending} />
          {mode === "keep" ? "Keep it on this shift" : `Put back on ${shiftHours}`}
        </button>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        aria-label={`Leave the report from ${reportTime} as it is`}
        onClick={() =>
          run(() => leaveFirstCheckReport(reportId), "Left as it is. It won't be listed here again.")
        }
      >
        <Busy pending={pending} />
        Leave it
      </button>
    </div>
  );
}
