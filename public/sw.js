/* Fieldline service worker.
   Installable, and intentionally without a fetch handler so pages and
   the Next.js dev server are never served from a stale cache. */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
