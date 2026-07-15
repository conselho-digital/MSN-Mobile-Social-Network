/* ============================================================
   sw.js — Service Worker do MSN (cache local para PWA)
   ------------------------------------------------------------
   Estratégia: network-first (tenta a rede primeiro e atualiza o
   cache; só usa o cache se a rede falhar). Isso garante que uma
   nova versão publicada apareça assim que o usuário reabrir o
   app com internet, em vez de ficar presa numa versão antiga.
   ============================================================ */

const CACHE = "msn-mobile-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/supabase-client.js",
  "./js/ui-manager.js",
  "./js/sound-manager.js",
  "./js/dashboard.js",
  "./assets/icons/favicon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
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
    fetch(request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return resp;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("./index.html"))
      )
  );
});
