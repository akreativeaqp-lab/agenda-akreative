const CACHE_NAME = "agenda-akreative-v5";

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
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;

  if(req.mode === "navigate"){
    event.respondWith((async () => {
      try{
        // Always obtain a fresh HTML document before injecting the bridge.
        const response = await fetch(req, {cache:"no-store"});
        const html = await response.text();
        const inyectado = html.replace(
          /<\/body>/i,
          '<script src="./supabase-bridge.js?v=5"></script></body>'
        );

        // The body has already been decoded by fetch(). Do not forward
        // encoding/length metadata from the original compressed response.
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        headers.set("content-type", "text/html; charset=utf-8");
        headers.set("cache-control", "no-store");

        return new Response(inyectado, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }catch(err){
        const cached = await caches.match("./index.html");
        if(!cached) return fetch(req);

        const html = await cached.text();
        const inyectado = html.replace(
          /<\/body>/i,
          '<script src="./supabase-bridge.js?v=5"></script></body>'
        );
        return new Response(inyectado, {
          status: 200,
          headers: {
            "Content-Type":"text/html; charset=utf-8",
            "Cache-Control":"no-store"
          }
        });
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(req).then(response => response || fetch(req))
  );
});
