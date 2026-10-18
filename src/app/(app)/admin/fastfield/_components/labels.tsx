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
  SHIFT: "Static shift",
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

const PLURAL: Record<string, string> = {
  ALARM_RESPONSE: "callouts",
  PATROL: "patrol visits",
  LOCK: "lock-ups",
  UNLOCK: "unlocks",
  KEY_COLLECTION: "key collections",
  KEY_DROPOFF: "key drop-offs",
  SURVEY: "surveys",
  VPI: "VPIs",
  ADHOC: "ad-hoc jobs",
  SHIFT: "static-shift rounds",
};

const REASON: Record<string, string> = {
  site: "site not recognised",
  none: "nothing near the time",
  shift: "static shift on — callout?",
  taken: "already had a report",
  ambiguous: "two equally close",
};

/** One line for a form's last preview, e.g. "would link 40 (30 callouts,
 *  10 static-shift rounds), create 3; 5 to link by hand (2 site not
 *  recognised, 3 nothing near the time)". */
export function describePreview(raw: unknown): string {
  const c = (raw && typeof raw === "object" ? raw : {}) as {
    linked?: number;
    created?: number;
    linkedByType?: Record<string, number>;
    unmatched?: Record<string, number>;
  };
  const linked = c.linked ?? 0;
  const created = c.created ?? 0;
  const byType = Object.entries(c.linkedByType ?? {})
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${PLURAL[t] ?? t.toLowerCase()}`)
    .join(", ");
  const reasons = Object.entries(c.unmatched ?? {}).filter(([, n]) => n > 0);
  const toLink = reasons.reduce((n, [, x]) => n + x, 0);
  if (linked + created + toLink === 0) return "no new reports.";
  return (
    `would link ${linked}${byType ? ` (${byType})` : ""}, create ${created}` +
    (toLink
      ? `; ${toLink} to link by hand (${reasons.map(([r, n]) => `${n} ${REASON[r] ?? r}`).join(", ")})`
      : "") +
    "."
  );
}
