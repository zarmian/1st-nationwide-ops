"use client";

import { useEffect, useRef } from "react";

export function SearchBox({ defaultValue }: { defaultValue: string }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isModK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (!isModK) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative flex-1 min-w-[260px]">
      <input
        ref={ref}
        name="q"
        defaultValue={defaultValue}
        placeholder="Search by name, code, postcode, customer…"
        className="input pr-16"
      />
      <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">
        ⌘K
      </kbd>
    </div>
  );
}
