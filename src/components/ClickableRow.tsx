"use client";

import { createElement, type MouseEvent, type ReactNode } from "react";

/** Clicks on these keep their own behaviour instead of opening the row. */
const OWN_CLICK =
  "a, button, input, select, textarea, label, summary, dialog, [role='button'], [role='dialog'], [role='menu'], [role='listbox'], [data-row-ignore]";

/**
 * A table row or card that opens its activity when clicked anywhere — the
 * same on every page. It follows the row's main link (the element marked
 * `data-row-link`, which keyboard users tab to), so the route progress bar and
 * prefetching work as for any link. Its own buttons, links and fields keep
 * their behaviour; selecting text doesn't navigate; Ctrl/⌘-click or a
 * middle click opens it in a new tab.
 */
export function ClickableRow({
  as = "tr",
  href,
  className,
  children,
}: {
  as?: "tr" | "li" | "div";
  href: string;
  className?: string;
  children: ReactNode;
}) {
  function open(e: MouseEvent<HTMLElement>, newTab: boolean) {
    // Ignore clicks from a dialog or menu the row opened in a portal (React
    // bubbles those through the row), and on the row's own controls.
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest(OWN_CLICK)) return;
    if (window.getSelection()?.toString()) return;
    const link = e.currentTarget.querySelector<HTMLAnchorElement>("a[data-row-link]");
    if (newTab) {
      window.open(link?.href ?? href, "_blank", "noopener");
    } else if (link) {
      link.click();
    } else {
      window.location.assign(href);
    }
  }
  return createElement(
    as,
    {
      className: `cursor-pointer ${className ?? ""}`,
      onClick: (e: MouseEvent<HTMLElement>) => open(e, e.metaKey || e.ctrlKey),
      onAuxClick: (e: MouseEvent<HTMLElement>) => {
        if (e.button === 1) open(e, true);
      },
    },
    children,
  );
}
