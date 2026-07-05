/**
 * Status indicator for the activities log + dispatch board. Renders a
 * colour-coded chip so status reads at a glance in a dense table:
 *   red   → missed / abandoned / cancelled
 *   green → completed / approved / closed / sent to client
 *   blue  → in progress (pulsing "live" dot)
 *   amber → late (pulsing) / submitted / review pending
 *   slate → not started (open / assigned / pending)
 */

const DANGER = new Set(["MISSED", "ABANDONED", "CANCELLED"]);
const GREEN = new Set(["COMPLETED", "APPROVED", "CLOSED", "SENT_TO_CLIENT"]);
const AMBER = new Set(["LATE", "SUBMITTED", "REVIEW_PENDING"]);
const BLUE = new Set(["IN_PROGRESS"]);

function toneFor(status: string): { chip: string; pulse: boolean } {
  const s = status.toUpperCase();
  if (DANGER.has(s)) return { chip: "chip-red", pulse: false };
  if (GREEN.has(s)) return { chip: "chip-green", pulse: false };
  if (BLUE.has(s)) return { chip: "chip-info", pulse: true };
  if (AMBER.has(s)) return { chip: "chip-amber", pulse: s === "LATE" };
  return { chip: "chip-slate", pulse: false };
}

export function ActivityStatus({ status }: { status: string }) {
  const { chip, pulse } = toneFor(status);
  const label = status.toLowerCase().replace(/_/g, " ");
  return (
    <span className={`${chip} text-[10px] whitespace-nowrap`}>
      {pulse && (
        <span aria-hidden className="relative inline-flex h-1.5 w-1.5">
          <span className="absolute inset-0 rounded-full bg-current opacity-60 animate-pulse-dot" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {label}
    </span>
  );
}
