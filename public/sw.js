// Minimal service worker. Its main job is to make the site installable
// as a PWA — Chrome / Edge require a registered SW to offer "Install
// this app". It also caches the shell so the app opens instantly even on
// flaky signal, and serves a tiny offline fallback when the network is
// gone.
//
// Deliberately small surface: no fancy strategies for API or RSC payloads
// (those are dynamic, caching them is more trouble than it's worth). If
// background-sync queueing for /api/submissions ever becomes important,
// that's a separate workbox-backed rewrite.

const CACHE = "1nw-shell-v2";
const OFFLINE_URL = "/offline";
const SHELL = [OFFLINE_URL, "/icon.svg", "/icon-maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {
        /* offline at install time → nothing to cache yet */
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin (e.g. blob)
  if (url.pathname.startsWith("/api/")) return; // dynamic — let it through
  if (url.pathname.startsWith("/_next/")) return; // Next.js hashed assets handle caching themselves

  // Network-first for navigations so officers always get fresh data when
  // the connection is healthy; offline page as the safety net.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches
          .match(OFFLINE_URL)
          .then((cached) => cached ?? new Response("Offline", { status: 503 })),
      ),
    );
    return;
  }

  // Cache-first for the icons we explicitly pre-cached.
  event.respondWith(
    caches.match(req).then((cached) => cached ?? fetch(req)),
  );
});
