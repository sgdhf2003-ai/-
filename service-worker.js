
const CACHE_NAME = "jingyang-manager-pwa-v55-task-dashboard-v13";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=20260711-task-dashboard-v12",
  "./app.js?v=20260711-task-dashboard-v12",
  "./store-data.js?v=20260711-task-dashboard-v12",
  "./manifest.webmanifest?v=20260711-task-dashboard-v12",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Same-origin guard: ONLY process same-origin requests.
  // Cross-origin requests (e.g., script.google.com, script.googleusercontent.com)
  // MUST NOT be intercepted with respondWith, allowing the browser to handle them natively.
  try {
    const requestUrl = new URL(event.request.url);
    const host = requestUrl.hostname.toLowerCase();
    if (
      host.includes("script.google.com") ||
      host.includes("script.googleusercontent.com") ||
      requestUrl.origin !== self.location.origin
    ) {
      return;
    }
  } catch (_) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match("./index.html");
          return (
            cached ||
            new Response("Offline", {
              status: 503,
              statusText: "Service Unavailable",
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        return (
          cached ||
          new Response("Not found in cache", {
            status: 404,
            statusText: "Not Found",
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      })
  );
});
