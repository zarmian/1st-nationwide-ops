import type { ActivityEvent } from "../_lib/activity";

const SEVERITY_BG: Record<ActivityEvent["severity"], string> = {
  ok: "bg-emerald-50 border-emerald-200",
  info: "bg-sky-50 border-sky-200",
  warn: "bg-amber-50 border-amber-200",
  danger: "bg-rose-50 border-rose-200",
};

const DOT: Record<ActivityEvent["severity"], string> = {
  ok: "bg-emerald-500",
  info: "bg-sky-500",
  warn: "bg-amber-500",
  danger: "bg-rose-500",
};

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
        No activity logged yet. Officer submissions, alarms, and patrol visits
        will appear here.
      </div>
    );
  }
  return (
    <ul className="space-y-2.5">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-3">
          <span className={`mt-2 size-2.5 rounded-full shrink-0 ${DOT[e.severity]}`} />
          <div
            className={`flex-1 rounded-xl border px-4 py-2.5 ${SEVERITY_BG[e.severity]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">
                {e.title}
              </div>
              <div className="text-xs text-slate-500 shrink-0 tabular-nums">
                {formatRelative(e.at)}
              </div>
            </div>
            {e.detail && (
              <p className="text-sm text-slate-700 mt-0.5">{e.detail}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatRelative(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  const day = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  return `${day} ${time}`;
}
