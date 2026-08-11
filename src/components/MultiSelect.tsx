"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export type MultiOption = { value: string; label: string };

/**
 * Searchable multi-select popover. Reads + writes a comma-separated
 * list of values to `paramKey` in the URL. Each toggle navigates via
 * router.replace so back-button and shareable links work.
 *
 * Use `defaultLabel` (e.g. "All customers") for the empty state; when
 * one or more options are selected the button surfaces the first one
 * plus a "+N more" pill.
 */
export function MultiSelect({
  paramKey,
  label,
  options,
  defaultLabel,
}: {
  paramKey: string;
  label?: string;
  options: MultiOption[];
  defaultLabel: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const raw = searchParams?.get(paramKey) ?? "";
  const selected = useMemo(
    () =>
      raw
        ? raw.split(",").map((s) => s.trim()).filter(Boolean)
        : ([] as string[]),
    [raw],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function writeSelection(next: string[]) {
    const sp = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
    if (next.length > 0) sp.set(paramKey, next.join(","));
    else sp.delete(paramKey);
    sp.delete("page");
    router.replace(`?${sp.toString()}`);
  }

  function toggle(value: string) {
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    writeSelection(Array.from(next));
  }

  function clearAll() {
    writeSelection([]);
  }

  function selectAllFiltered() {
    const next = new Set(selectedSet);
    for (const o of filtered) next.add(o.value);
    writeSelection(Array.from(next));
  }

  // Button label — show first selected option then "+N more" so the
  // chip stays compact regardless of selection size.
  const buttonLabel = useMemo(() => {
    if (selected.length === 0) return defaultLabel;
    const first = options.find((o) => o.value === selected[0]);
    const firstLabel = first?.label ?? selected[0];
    if (selected.length === 1) return firstLabel;
    return `${firstLabel} +${selected.length - 1} more`;
  }, [selected, options, defaultLabel]);

  return (
    <div ref={wrapperRef} className="relative">
      {label && <div className="label">{label}</div>}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input text-left flex items-center justify-between"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span
          className={
            "min-w-0 truncate " +
            (selected.length === 0 ? "text-slate-500" : "text-brand-navy")
          }
        >
          {buttonLabel}
        </span>
        <span aria-hidden className="ml-2 text-slate-400">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-[16rem] max-w-[28rem] bg-white border border-slate-200 rounded-lg shadow-lg p-2">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              autoComplete="off"
              spellCheck={false}
              className="input flex-1"
            />
            {selected.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-brand-blue-dark hover:underline whitespace-nowrap"
              >
                Clear ({selected.length})
              </button>
            )}
          </div>
          {query && filtered.length > 0 && (
            <div className="px-1 pb-1">
              <button
                type="button"
                onClick={selectAllFiltered}
                className="text-xs text-brand-blue-dark hover:underline"
              >
                Select all {filtered.length} matching
              </button>
            </div>
          )}
          <div className="max-h-64 overflow-y-auto overscroll-contain">
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-sm text-slate-500">
                No matches.
              </div>
            )}
            {filtered.map((o) => {
              const checked = selectedSet.has(o.value);
              return (
                <label
                  key={o.value}
                  className={
                    "flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-sm" +
                    (filtered.length > 50 ? " cv-row" : "")
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(o.value)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-blue focus:ring-brand-blue"
                  />
                  <span className="truncate text-brand-navy">{o.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
