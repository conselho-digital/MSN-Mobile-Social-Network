/* ============================================================
   sw.js — Service Worker do MSN (cache local para PWA)
   ============================================================ */

const CACHE = "msn-mobile-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./app.html",
  "./manifest.json",
  "./css/style.css",
  "./css/landing.css",
  "./js/app.js",
  "./js/landing.js",
  "./js/supabase-client.js",
  "./js/ui-manager.js",
  "./js/sound-manager.js",
  "./js/dashboard.js",
  "./assets/icons/favicon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/emblem.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Não interceptar chamadas externas (Supabase, CDN, sons dinâmicos)
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return resp;
        })
        .catch(() => {
          // Offline: cai para a página correspondente (landing ou app).
          const isApp = /app\.html$/.test(url.pathname);
          return caches.match(isApp ? "./app.html" : "./index.html");
        });
    })
  );
});
