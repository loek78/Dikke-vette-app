// Offline-first cache. Verhoog VERSION bij elke release.
const VERSION = "dva-v2";
const ASSETS = [
  "./", "index.html", "styles.css", "app.js", "data.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
  // v2: online Infiltrant
  "vendor/mqtt.min.js", "vendor/qrcode.js",
  "online/words.js", "online/engine.js", "online/net.js", "online/ui.js", "online/online.css", "online/preview.js",
  "fonts/unbounded-latin-500-normal.woff2", "fonts/unbounded-latin-700-normal.woff2", "fonts/unbounded-latin-900-normal.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Netwerk eerst (zodat updates direct binnenkomen), cache als fallback.
// Alleen GET binnen dezelfde origin: MQTT-WebSockets (wss://broker…) lopen nooit via de service worker.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
