/// Offline: the shell goes network-first (deploys land instantly, cache is the
/// fallback); word data goes cache-first (it never changes and it's heavy).

const CACHE = "liv-words-v1";
const SHELL = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/engine.js",
  "manifest.webmanifest",
  "wordlists/nwl2023-words.txt", // default dictionary works offline out of the box
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(p => new URL(p, self.location).href)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isData = url => url.pathname.includes("/wordlists/") || url.pathname.includes("/data/");

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(isData(url) ? cacheFirst(e.request) : networkFirst(e.request));
});

async function cacheFirst(request) {
  const hit = await caches.match(request);
  return hit ?? fetchInto(request);
}

async function networkFirst(request) {
  try {
    return await fetchInto(request);
  } catch {
    return caches.match(request, { ignoreSearch: true });
  }
}

async function fetchInto(request) {
  const resp = await fetch(request);
  if (resp.ok) {
    const copy = resp.clone();
    caches.open(CACHE).then(c => c.put(request, copy));
  }
  return resp;
}
