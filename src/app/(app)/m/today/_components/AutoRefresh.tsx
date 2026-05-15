"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Refreshes server data on a recurring interval, but only while the tab is
 * actually visible. Saves battery and avoids RSC roundtrips when the phone
 * is asleep in the officer's pocket.
 *
 * Also forces a refresh the moment the tab regains visibility — so when the
 * officer wakes the phone, late visits / overdue check-ins / new jobs
 * appear immediately rather than waiting for the next tick.
 */
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (t) return;
      t = setInterval(() => {
        if (document.visibilityState === "visible") {
          router.refresh();
        }
      }, intervalMs);
    }
    function stop() {
      if (t) {
        clearInterval(t);
        t = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    }

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
