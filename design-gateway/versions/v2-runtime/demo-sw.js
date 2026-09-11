const CACHE_NAME = 'danjion-field-demo-v2';
const APP_SHELL = [
  '/',
  '/demo.html',
  '/admin.html',
  '/operations-review.html',
  '/promo.html',
  '/ending.html',
  '/verification.html',
  '/verification-admin.html'
];

function discoverLocalAssets(html) {
  const assets = new Set();
  const pattern = /(?:src|href)=["']([^"']+)["']/g;
  for (const match of html.matchAll(pattern)) {
    const path = match[1];
    if (path.startsWith('/assets/') || path.startsWith('/field-demo/')) assets.add(path);
  }
  return assets;
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const assets = new Set();

  for (const path of APP_SHELL) {
    const response = await fetch(path, { cache: 'reload' });
    if (!response.ok) throw new Error(`Failed to precache ${path}: ${response.status}`);
    await cache.put(path, response.clone());
    const html = await response.text();
    for (const asset of discoverLocalAssets(html)) assets.add(asset);
  }

  await Promise.all([...assets].map(async (path) => {
    const response = await fetch(path, { cache: 'reload' });
    if (response.ok) await cache.put(path, response);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function cacheKeyWithoutSearch(request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(cacheKeyWithoutSearch(request), copy)));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match(cacheKeyWithoutSearch(request))) || (await cache.match('/'));
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      });
    })
  );
});
