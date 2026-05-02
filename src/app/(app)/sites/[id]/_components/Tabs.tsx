import Link from "next/link";

export type TabKey =
  | "overview"
  | "schedule"
  | "keys"
  | "activity"
  | "documents"
  | "settings";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "schedule", label: "Schedule" },
  { key: "keys", label: "Keys" },
  { key: "activity", label: "Activity" },
  { key: "documents", label: "Documents" },
  { key: "settings", label: "Settings" },
];

export function Tabs({
  siteId,
  active,
  counts,
}: {
  siteId: string;
  active: TabKey;
  counts: Partial<Record<TabKey, number>>;
}) {
  return (
    <div className="border-b border-slate-200">
      <nav className="-mb-px flex flex-wrap gap-1">
        {TABS.map((t) => {
          const isActive = t.key === active;
          const count = counts[t.key];
          return (
            <Link
              key={t.key}
              href={t.key === "overview" ? `/sites/${siteId}` : `/sites/${siteId}?tab=${t.key}`}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${
                isActive
                  ? "text-brand-navy border-brand-navy"
                  : "text-slate-500 border-transparent hover:text-brand-navy hover:border-slate-300"
              }`}
            >
              {t.label}
              {typeof count === "number" && count > 0 && (
                <span
                  className={`ml-1.5 text-xs ${
                    isActive ? "text-slate-600" : "text-slate-400"
                  }`}
                >
                  ({count})
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
