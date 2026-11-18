// Offline support: serve from cache, refresh cache in the background.
// Bump VERSION when you change the app files.
const VERSION = "stats-v56";
const FILES = ["./", "index.html", "style.css", "app.js", "demo.js", "settings.js", "welcome.js", "start.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "../fonts/ia-writer-mono-latin-400-normal.ttf", "../fonts/ia-writer-mono-latin-700-normal.ttf", "../fonts/ia-writer-mono-latin-400-italic.ttf"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
