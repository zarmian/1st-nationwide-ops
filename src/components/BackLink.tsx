"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { currentUrl, labelForUrl, previousPage, setPageTitle } from "@/lib/navHistory";

type Prev = { href: string; label: string; viaHistory: boolean };

/**
 * "← Back" to the page you actually came from — its name and exact address,
 * filters included — e.g. "← Activities" after opening a job from the
 * Activities log, "← Swail House" after opening it from the site. Falls back
 * to the page's usual parent when you arrived directly (new tab, bookmark,
 * a link in an email). When the page you came from is also the browser's
 * previous page, it goes back through history so your scroll position is kept.
 */
export function BackLink({
  fallbackHref,
  fallbackLabel,
  className,
}: {
  fallbackHref: string;
  fallbackLabel: string;
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [prev, setPrev] = useState<Prev | null>(null);

  useEffect(() => {
    const p = previousPage(currentUrl());
    setPrev(
      p
        ? { href: p.entry.url, label: p.entry.title ?? labelForUrl(p.entry.url), viaHistory: p.viaHistory }
        : null,
    );
  }, [pathname, searchParams]);

  return (
    <Link
      href={prev?.href ?? fallbackHref}
      className={`max-w-full ${className ?? ""}`}
      onClick={(e) => {
        if (!prev?.viaHistory || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        router.back();
      }}
    >
      <span aria-hidden="true">←&nbsp;</span>
      <span className="truncate">{prev?.label ?? fallbackLabel}</span>
    </Link>
  );
}

/** Records the page's title in the trail, so the next page's back link can
 *  name it. Renders nothing. */
export function PageTitleTracker({ title }: { title: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    setPageTitle(currentUrl(), title);
  }, [title, pathname, searchParams]);
  return null;
}
