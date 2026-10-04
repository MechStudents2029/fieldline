/* Fieldline service worker.
   Caches the install shell and content-hashed /_next/static files only.
   Navigations, HTML, RSC payloads, and /api stay on the network so a stale
   page cannot pin the office or the Next.js dev server. */
const CACHE = "fieldline-shell-v1";
const PRECACHE = [
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];
const SHELL = new Set(PRECACHE.concat(["/sw.js"]));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function hashedStatic(pathname) {
  if (!pathname.startsWith("/_next/static/")) return false;
  if (pathname.includes("/development")) return false;
  return /[-.][A-Za-z0-9_-]{8,}\.(?:js|css|woff2|woff|ttf|png|jpg|jpeg|webp|svg|ico|gif)$/.test(pathname);
}

function isShell(pathname) {
  return SHELL.has(pathname) || hashedStatic(pathname);
}

async function fromShellCache(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    const type = response.headers.get("content-type") || "";
    const cacheable =
      response.ok &&
      response.type === "basic" &&
      !type.includes("text/html") &&
      !type.includes("text/x-component");
    if (cacheable) await cache.put(request, response.clone());
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.searchParams.has("_rsc")) return;
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html") || accept.includes("text/x-component")) return;
  if (!isShell(url.pathname)) return;
  event.respondWith(fromShellCache(request));
});
