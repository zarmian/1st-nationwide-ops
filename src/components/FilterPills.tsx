"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";

export type PillOption = {
  value: string;
  label: string;
  icon?: LucideIcon;
};

/**
 * One-tap toggle row in place of a <select>. Active pill fills with
 * brand-blue-100, idle pills hover to brand-blue-50. Updates the URL via
 * `router.replace` so back-button and shareable links work.
 *
 * If `paramKey` is provided, the active value is read from + written to
 * that URL search param. Use `value` + `onChange` for purely client-side
 * use. `defaultValue` falls back when the URL param is empty.
 */
export function FilterPills({
  paramKey,
  value,
  onChange,
  defaultValue,
  options,
  label,
}: {
  paramKey?: string;
  value?: string;
  onChange?: (value: string) => void;
  defaultValue?: string;
  options: PillOption[];
  label?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const current =
    value !== undefined
      ? value
      : paramKey
        ? searchParams?.get(paramKey) ?? defaultValue ?? ""
        : defaultValue ?? "";

  function select(next: string) {
    if (onChange) {
      onChange(next);
      return;
    }
    if (paramKey) {
      const sp = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
      if (next) sp.set(paramKey, next);
      else sp.delete(paramKey);
      // Reset to page 1 whenever the filter changes — old page numbers
      // make no sense against a new dataset.
      sp.delete("page");
      router.replace(`?${sp.toString()}`);
    }
  }

  return (
    <div>
      {label && <div className="label">{label}</div>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const Icon = o.icon;
          const active = o.value === current;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => select(o.value)}
              aria-pressed={active}
              className={active ? "pill-active" : "pill-idle"}
            >
              {Icon && <Icon size={12} />}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
