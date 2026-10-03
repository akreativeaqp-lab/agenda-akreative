const CACHE_NAME = "agenda-akreative-v4";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./ICONO-AGENDA-AKREATIVE.png",
  "./fond.png",
  "./AKREATIVE BLANCO.png",
  "./supabase-bridge.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;

  // Para la página principal, obtenemos la versión actual y le inyectamos
  // el puente de Supabase. Si no hay red, usamos la copia guardada.
  if(req.mode === "navigate"){
    event.respondWith(
      fetch(req).then(async response => {
        const html = await response.text();
        const inyectado = html.replace(
          /<\\/body>/i,
          '<script src="./supabase-bridge.js"></script></body>'
        );
        return new Response(inyectado, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }).catch(async () => {
        const cached = await caches.match("./index.html");
        if(!cached) return fetch(req);
        const html = await cached.text();
        const inyectado = html.replace(
          /<\\/body>/i,
          '<script src="./supabase-bridge.js"></script></body>'
        );
        return new Response(inyectado, {
          status: 200,
          headers: {"Content-Type":"text/html; charset=utf-8"}
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(response => response || fetch(req))
  );
});
