// MindFlow PWA service worker — network-first for app code so updates ship instantly.
// Cache is only used as offline fallback for static assets.
//
// Strategy:
//   - Same-origin HTML/JS/CSS: network first, fallback to cache if offline
//   - Updates: skipWaiting + clients.claim so a fresh deploy takes over right away
//   - Old caches purged on activate

const CACHE_NAME = 'mindflow-cache-v2'; // bump → 옛 캐시 강제 무효화 (2026-06-05)

self.addEventListener('install', (event) => {
  // Take over immediately on first install — don't wait for tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop any stale caches from older SW versions
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    );
    // Claim all open tabs/PWA windows so the new SW controls them this session
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET; let everything else go to the network unmodified
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't intercept Google APIs (Drive, fonts, GSI) — they handle their own caching
  if (url.origin !== self.location.origin) return;

  // Don't cache the manifest or anything dynamic — pure passthrough
  if (url.pathname.endsWith('/manifest.json')) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: 'no-cache' });
      // Update cache silently in the background
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (e) {
      // Offline → serve last cached copy if we have one
      const cached = await caches.match(req);
      if (cached) return cached;
      throw e;
    }
  })());
});

// Allow clients to ping us to skip waiting (used by the in-app "update available" prompt)
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
