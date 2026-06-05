"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export type ActiveFilter = {
  label: string;
  /** Clear-link target — usually back to the bare list URL. */
  clearHref: string;
};

/**
 * Collapsible filter panel for list pages. Closed by default; opens when
 * the user taps "Filters" or when active filters are present.
 *
 * The summary shows a chip strip of currently-applied filters with a one-
 * click "Clear all" link. The actual form (children) is hidden until
 * expanded, freeing up vertical space on the list view.
 */
export function FilterPanel({
  activeFilters,
  children,
  clearAllHref,
}: {
  activeFilters: ActiveFilter[];
  children: React.ReactNode;
  /** Where "Clear all" sends the user. Usually the bare list page. */
  clearAllHref: string;
}) {
  const hasActive = activeFilters.length > 0;
  // Open if any filter is set on first render; once mounted the user can
  // toggle freely.
  const [open, setOpen] = useState(hasActive);

  // If the URL changes (filters get cleared from outside), reflect it.
  useEffect(() => {
    if (hasActive && !open) setOpen(true);
    // Don't auto-close on clear — the user might want to add a new one.
  }, [hasActive, open]);

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="btn-ghost text-sm flex items-center gap-1.5"
        >
          <FilterIcon />
          <span>{open ? "Hide filters" : "Filters"}</span>
          {hasActive && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-brand-blue text-white text-[10px] font-semibold tabular-nums">
              {activeFilters.length}
            </span>
          )}
        </button>
        {hasActive && (
          <>
            <ul className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
              {activeFilters.map((f, i) => (
                <li key={i}>
                  <Link
                    href={f.clearHref}
                    className="inline-flex items-center gap-1 chip-slate text-xs hover:bg-slate-200"
                    title={`Clear: ${f.label}`}
                  >
                    <span>{f.label}</span>
                    <span aria-hidden className="text-slate-500">×</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href={clearAllHref}
              className="btn-ghost text-xs text-red-600"
            >
              Clear all
            </Link>
          </>
        )}
      </div>
      {open && (
        <div className="border-t border-slate-100 p-3">{children}</div>
      )}
    </div>
  );
}

function FilterIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}
