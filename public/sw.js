const CACHE_NAME = 'dep-v2.1.0';
const PRECACHE = ['/', '/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(PRECACHE.map(url => cache.add(url).catch(()=>{})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the HTML shell so updates are picked up immediately,
// falling back to cache only if offline.
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  const isHTML = req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';

  if (isHTML) {
    event.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200) caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res && res.status === 200) caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
      return res;
    }))
  );
});
