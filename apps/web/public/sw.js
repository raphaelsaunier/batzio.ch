/**
 * Batzio's service worker: the app keeps opening, and the pages you have
 * visited keep working, when the connection drops.
 *
 *   build assets (/_next/static/…, hashed)   cache first, they never change
 *   catalog (/i18n/…?v=), fonts, brand art   stale-while-revalidate
 *   pages (navigations)                      network first (3 s), then the last copy, then /offline.html
 *
 * RSC navigations and the API pass straight through: a failed RSC fetch makes
 * the router fall back to a full navigation (served from here), and records
 * live in the app's own local store (TanStack Query + IndexedDB).
 *
 * The sign-in page wipes the "batzio-pages" cache together with that store.
 */
const STATIC = "batzio-static-v1";
const PAGES = "batzio-pages";
const OFFLINE = "/offline.html";
const NETWORK_TIMEOUT = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((cache) => cache.addAll([OFFLINE, "/favicon.svg", "/brand/coin-front-160.webp"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("batzio-static-") && key !== STATIC) await caches.delete(key);
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname.includes("/_next/static/")) return event.respondWith(cacheFirst(request));
  if (url.pathname.startsWith("/i18n/") || url.pathname.startsWith("/brand/") || /\.(woff2?|ttf|svg|png|webp|avif|ico)$/.test(url.pathname)) {
    return event.respondWith(staleWhileRevalidate(event, request));
  }
  if (request.mode === "navigate") return event.respondWith(page(event));
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trim(cache, 400);
  }
  return response;
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  const refresh = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  return refresh;
}

async function page(event) {
  const cache = await caches.open(PAGES);
  try {
    const response = await withTimeout(
      (async () => (await event.preloadResponse) || fetch(event.request))(),
      NETWORK_TIMEOUT,
    );
    if (response.ok && !response.redirected) {
      event.waitUntil(cache.put(event.request.url, response.clone()).then(() => trim(cache, 80)));
    }
    return response;
  } catch {
    return (await cache.match(event.request.url)) || (await caches.match(OFFLINE)) || Response.error();
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Oldest entries go first (the Cache API keeps insertion order). */
async function trim(cache, max) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}
