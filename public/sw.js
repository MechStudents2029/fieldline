/* Fieldline service worker.
   Caches the install shell, content-hashed /_next/static files, and one
   user-agnostic offline clock document. Office HTML, RSC payloads, and /api
   stay on the network so one account cannot be served another account's page. */
const CACHE = "fieldline-shell-v2";
const OFFLINE_PATH = "/offline";
const OFFLINE_MARK = "fieldline-offline-shell";
const OFFICE_MARK = "fieldline-office-shell";
const PRECACHE = ["/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", OFFLINE_PATH];
const SHELL = new Set(["/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/sw.js"]);

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

function clockNavigation(pathname) {
  return pathname === "/" || pathname === "/time" || pathname === OFFLINE_PATH;
}

async function rememberOffline(response) {
  if (!response || !response.ok) return;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return;
  const body = await response.clone().text();
  if (!body.includes(OFFLINE_MARK) || body.includes(OFFICE_MARK)) return;
  const cache = await caches.open(CACHE);
  await cache.put(OFFLINE_PATH, response.clone());
}

async function fromShellCache(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    const type = response.headers.get("content-type") || "";
    const cacheable = response.ok && response.type === "basic" && !type.includes("text/html") && !type.includes("text/x-component");
    if (cacheable) await cache.put(request, response.clone());
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function offlineDocument() {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(OFFLINE_PATH);
  if (hit) return hit;
  return new Response("Open Time once while you have a signal.", { status: 503, headers: { "content-type": "text/plain" } });
}

async function networkOrClock(request) {
  const url = new URL(request.url);
  try {
    const response = await fetch(request);
    if (url.pathname === OFFLINE_PATH) await rememberOffline(response);
    return response;
  } catch {
    if (url.pathname === OFFLINE_PATH) return offlineDocument();
    const cached = await offlineDocument();
    if (cached.status === 503) return cached;
    return Response.redirect(new URL(OFFLINE_PATH, self.location.origin).href, 302);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.searchParams.has("_rsc")) return;
  if (request.mode === "navigate") {
    if (!clockNavigation(url.pathname)) return;
    event.respondWith(networkOrClock(request));
    return;
  }
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html") || accept.includes("text/x-component")) return;
  if (!isShell(url.pathname)) return;
  event.respondWith(fromShellCache(request));
});
