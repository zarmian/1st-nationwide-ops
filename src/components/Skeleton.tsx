/**
 * Skeleton placeholders for loading states. Uses the `.skeleton` utility
 * from globals.css (animated shimmer over a neutral slate). Pre-built
 * variants for the common cases: row, card, table.
 *
 * Drop these in while data is loading instead of blank space. The
 * shimmer respects prefers-reduced-motion globally.
 */
export function SkeletonLine({
  className = "h-4 w-full",
}: {
  className?: string;
}) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2">
      <SkeletonLine className="skeleton h-3 w-24" />
      <SkeletonLine className="skeleton h-3 flex-1" />
      <SkeletonLine className="skeleton h-3 w-16" />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card p-5 space-y-3">
      <SkeletonLine className="skeleton h-3 w-1/3" />
      <SkeletonLine className="skeleton h-8 w-2/3" />
      <SkeletonLine className="skeleton h-3 w-1/2" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
        <SkeletonLine className="skeleton h-3 w-32" />
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-4 py-3">
            <SkeletonRow />
          </div>
        ))}
      </div>
    </div>
  );
}
