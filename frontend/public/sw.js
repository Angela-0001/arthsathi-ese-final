/**
 * ArthSathi Service Worker — Offline-First PWA
 *
 * Caching strategy:
 *   App shell (HTML/JS/CSS) → Cache First (precached at install)
 *   API GETs (/api/schemes, /api/insurance, /api/i18n) → Stale-While-Revalidate
 *   API POSTs (writes, recommendations) → Network First, cache fallback
 *   Write failures (offline) → Queue in IndexedDB, retry on reconnect
 */

const CACHE_VERSION  = 'as-v5';
const SHELL_CACHE    = `${CACHE_VERSION}-shell`;
const API_CACHE      = `${CACHE_VERSION}-api`;

const PRECACHE_URLS  = ['/', '/auth', '/onboarding', '/results', '/document', '/manifest.json'];

// ── Install: precache app shell ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('as-') && k !== SHELL_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: routing ─────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept Next.js internal chunks
  if (url.pathname.startsWith('/_next/')) return;

  // Skip non-GET Chrome extensions etc.
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // API GETs → stale-while-revalidate
  if (url.pathname.startsWith('/api/') && request.method === 'GET') {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  // API POSTs/PUTs → network first, queue if offline
  if (url.pathname.startsWith('/api/') && ['POST', 'PUT'].includes(request.method)) {
    event.respondWith(networkFirstWithQueue(request));
    return;
  }

  // App shell / static → cache first
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (request.mode === 'navigate') {
      const root = await caches.match('/');
      return root || new Response('ArthSathi is offline.', { status: 503 });
    }
    return new Response('', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || (await fetchPromise) ||
    new Response(JSON.stringify({ offline: true, error: 'No cached data' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } });
}

async function networkFirstWithQueue(request) {
  try {
    const clone    = request.clone();
    const response = await fetch(clone, { signal: AbortSignal.timeout(10000) });
    return response;
  } catch {
    // Queue the request body for retry
    try {
      const body    = await request.text();
      const queued  = { url: request.url, method: request.method, body, ts: Date.now() };
      const clients = await self.clients.matchAll();
      clients.forEach(c => c.postMessage({ type: 'QUEUED', request: queued }));
    } catch {}

    return new Response(
      JSON.stringify({ queued: true, message: 'Saved offline — will sync when connected' }),
      { status: 202, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── Background Sync ────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'as-sync') {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SYNC_NOW' }))
      )
    );
  }
});
