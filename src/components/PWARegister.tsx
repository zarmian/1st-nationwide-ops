"use client";

import { useEffect } from "react";

/**
 * Registers the service worker. Mount once near the root of the app — the
 * (app) layout is the right home so we don't register on /login.
 *
 * Dev note: the SW is served from /public/sw.js. Changes to that file
 * require a hard reload (or `Application → Unregister` in DevTools) for
 * the new version to take over on a tab that already has the old one.
 */
export function PWARegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    // Don't try to register on localhost http (only matters for very early
    // dev — Vercel previews are https and fine).
    if (
      location.hostname !== "localhost" &&
      location.protocol !== "https:"
    ) {
      return;
    }
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        // Non-fatal — log so we can diagnose, but don't show the user.
        console.warn("SW registration failed", err);
      });
  }, []);

  return null;
}
