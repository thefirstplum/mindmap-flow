// MindFlow PWA service worker — network-first for app code so updates ship instantly.
// Cache is only used as offline fallback for static assets.
//
// Strategy:
//   - Same-origin HTML/JS/CSS: network first, fallback to cache if offline
//   - Updates: skipWaiting + clients.claim so a fresh deploy takes over right away
//   - Old caches purged on activate
//   - 사장님 PWA에서 옛 SW가 캐시 잡고 있던 케이스 대응: install·activate 시 ALL 캐시
//     삭제 + 클라이언트에 reload 메시지 전송 (controllerchange 발생 시 main.js가 reload)

const CACHE_NAME = 'mindflow-cache-v21'; // 홈 클릭 이동 수정 + 필터 잔류 해소

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // 모든 옛 캐시를 명시적으로 비움 (CACHE_NAME 같든 다르든 전부)
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 안전망: activate 단계에서도 한번 더 cleanup
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    );
    await self.clients.claim();
    // 모든 클라이언트에 reload 시그널 전송 — 옛 코드가 떠 있는 PWA·탭 즉시 새로고침
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      try { c.postMessage({ type: 'SW_RELOAD', reason: 'new-version' }); } catch {}
    }
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
