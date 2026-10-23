import type { ActivityGroup } from "@/lib/clientPortal";

/**
 * One colour per kind of work, the same everywhere in the client portal —
 * chart segments, legends, the type table and the activity log. Fixed order
 * (callouts first), never reassigned when a filter hides a type, and checked
 * for colour-blind separation between neighbours (dataviz validate_palette:
 * all checks pass on white). Aqua, yellow and pink are under 3:1 against
 * white, so colour never carries text: a label always sits beside it, and
 * the chart has a table view.
 */
export const GROUP_COLOR: Record<ActivityGroup, string> = {
  callout: "#2a78d6",
  lockup: "#eb6834",
  unlock: "#1baf7a",
  guarding: "#eda100",
  patrol: "#e87ba4",
  other: "#008300",
};

/** A small colour key beside a type's name. */
export function GroupDot({ group, className = "" }: { group: ActivityGroup; className?: string }) {
  return (
    <span
      aria-hidden
      className={"inline-block h-2.5 w-2.5 shrink-0 rounded-sm " + className}
      style={{ backgroundColor: GROUP_COLOR[group] }}
    />
  );
}
