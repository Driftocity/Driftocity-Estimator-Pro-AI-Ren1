// Driftocity Estimate Pro — Service Worker v1.0

const CACHE_NAME = 'dep-v1.0.0';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        PRECACHE_ASSETS.map(url => cache.add(url).catch(err => console.warn('[SW] Skip:', url)))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Let API calls go straight to network
  if (url.hostname === 'api.anthropic.com') return;

  // Fonts: stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(req).then(cached => {
          const net = fetch(req).then(r => { if(r&&r.status===200) cache.put(req,r.clone()); return r; }).catch(()=>cached);
          return cached || net;
        })
      )
    );
    return;
  }

  // App shell: cache first
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(r => {
          if (r && r.status === 200) {
            caches.open(CACHE_NAME).then(c => c.put(req, r.clone()));
          }
          return r;
        }).catch(() => caches.match('./index.html'));
      })
    );
  }
});

console.log('[SW] Driftocity Estimate Pro v1.0 loaded');
