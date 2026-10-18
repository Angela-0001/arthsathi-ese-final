// ArthSathi Service Worker v7 — minimal, safe
const CACHE_VERSION = 'as-v7';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Only cache API GET responses — never touch /_next/ or page navigations
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Pass everything through to network — no caching logic that can break things
  if (url.pathname.startsWith('/_next/')) return;
  if (url.pathname.startsWith('/api/') && event.request.method !== 'GET') return;
  // Everything else — just fetch from network
  return;
});
