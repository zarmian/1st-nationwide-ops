"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { currentUrl, recordVisit } from "@/lib/navHistory";

/** Notes each page you visit in this tab, for back links that return you to
 *  the page you came from (lib/navHistory). Renders nothing. */
export function NavTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    recordVisit(currentUrl());
  }, [pathname, searchParams]);
  return null;
}
