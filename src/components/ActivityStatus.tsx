import { StatusDot } from "./StatusDot";

/**
 * Status cell renderer for the activities log + dispatch board. Maps a
 * Job/Visit status string onto the StatusDot tone so the colour reads
 * consistently across pages: live jobs pulse, terminal states show a
 * static muted dot, errors/cancellations go red.
 */
export function ActivityStatus({ status }: { status: string }) {
  const tone =
    status === "IN_PROGRESS"
      ? "live"
      : status === "LATE"
        ? "warn"
        : status === "MISSED" || status === "CANCELLED"
          ? "danger"
          : status === "COMPLETED" ||
              status === "APPROVED" ||
              status === "CLOSED" ||
              status === "SENT_TO_CLIENT"
            ? "active"
            : "muted";
  const pulse = status === "IN_PROGRESS" || status === "LATE";
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot tone={tone} pulse={pulse} />
      <span className="text-xs text-slate-700">
        {status.toLowerCase().replace(/_/g, " ")}
      </span>
    </span>
  );
}
