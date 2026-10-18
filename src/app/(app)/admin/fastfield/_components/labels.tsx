const ACTIVITY_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Callout",
  PATROL: "Patrol visit",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  VPI: "VPI",
  ADHOC: "Ad-hoc job",
};

export function activityLabel(type: string): string {
  return ACTIVITY_LABEL[type] ?? type.replace(/_/g, " ").toLowerCase();
}

export function ReportStatusChip({ status }: { status: string }) {
  if (status === "LINKED") return <span className="chip-mint">Linked</span>;
  if (status === "CREATED") return <span className="chip-info">Job created</span>;
  if (status === "IGNORED") return <span className="chip-slate">Set aside</span>;
  return <span className="chip-amber">Needs linking</span>;
}
