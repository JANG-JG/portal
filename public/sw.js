const CACHE_NAME = 'jg-portal-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    // API 및 단기 티켓 SSO 리다이렉트는 캐시 없이 항상 네트워크로 직접 전송
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/go')) {
        return;
    }
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});

