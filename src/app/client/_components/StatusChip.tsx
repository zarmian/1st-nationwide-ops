import type { ClientActivityStatus } from "@/lib/clientPortal";

const MAP: Record<ClientActivityStatus, string> = {
  Completed: "chip-green",
  "In progress": "chip-info",
  Scheduled: "chip-slate",
};

export function StatusChip({ status }: { status: ClientActivityStatus }) {
  return <span className={MAP[status] ?? "chip-slate"}>{status}</span>;
}
