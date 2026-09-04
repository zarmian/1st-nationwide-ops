import { History } from "lucide-react";
import { formatDateTime } from "@/lib/dates";
import type { HistoryEvent } from "@/lib/activityHistory";

/** Human labels for the short audit verbs stored in ActivityLog.action. */
export const ACTION_LABEL: Record<string, string> = {
  created: "Created",
  recorded: "Recorded",
  edited: "Edited",
  edited_after_completion: "Edited after completion",
  closed: "Closed",
  cancelled: "Cancelled",
  restored: "Restored",
  reassigned: "Reassigned",
  unassigned: "Unassigned",
  ended: "Ended",
  started_on_duty: "Started (on duty)",
  ended_on_duty: "Ended (on duty)",
  link_sent: "Officer link sent",
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/_/g, " ");
}

/**
 * A vertical timeline of an activity's audit trail — who did what, when.
 * Reads the events already loaded by loadActivityHistory().
 */
export function ActivityHistory({ events }: { events: HistoryEvent[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <History size={15} className="text-brand-blue" aria-hidden />
        <h2 className="text-sm font-semibold text-brand-navy">History</h2>
      </div>
      {events.length === 0 ? (
        <p className="px-4 py-5 text-sm italic text-slate-400">
          No changes recorded yet.
        </p>
      ) : (
        <ol className="divide-y divide-slate-100">
          {events
            .slice()
            .reverse()
            .map((e) => (
              <li key={e.id} className="flex gap-3 px-4 py-2.5">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-blue"
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="text-sm text-brand-navy">
                    <span className="font-medium">{actionLabel(e.action)}</span>
                    {e.actorName ? (
                      <span className="text-slate-600"> by {e.actorName}</span>
                    ) : (
                      <span className="text-slate-400"> · system</span>
                    )}
                  </div>
                  {e.changedFields.length > 0 && (
                    <div className="text-xs text-slate-500">
                      Changed: {e.changedFields.join(", ")}
                    </div>
                  )}
                  <div className="text-xs text-slate-400 tabular-nums">
                    {formatDateTime(e.createdAt)}
                  </div>
                </div>
              </li>
            ))}
        </ol>
      )}
    </div>
  );
}
