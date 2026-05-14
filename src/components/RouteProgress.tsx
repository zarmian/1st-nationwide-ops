"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Thin progress bar that pulses across the top during route transitions
 * in the App Router. Next 14 doesn't expose router events the way the
 * Pages Router did, so we approximate: every Link / button click that's a
 * navigation triggers a click → we show progress until the new pathname
 * settles. Imperfect but useful — fills the "did my click do anything?"
 * gap without an external dependency.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest("a") as HTMLAnchorElement | null;
      if (!link) return;
      // Same-origin, no modifier keys, not a download, not target=_blank.
      if (link.target === "_blank") return;
      if (link.hasAttribute("download")) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!link.href) return;
      try {
        const url = new URL(link.href);
        if (url.origin !== location.origin) return;
        if (url.pathname === location.pathname && url.search === location.search) {
          return; // same place
        }
      } catch {
        return;
      }
      setActive(true);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Settle when the route changes.
  useEffect(() => {
    setActive(false);
  }, [pathname, searchParams]);

  return (
    <div
      className={
        "fixed top-0 left-0 right-0 z-50 h-0.5 pointer-events-none transition-opacity duration-200 " +
        (active ? "opacity-100" : "opacity-0")
      }
      aria-hidden
    >
      <div className="h-full bg-brand-mint animate-pulse" />
    </div>
  );
}
