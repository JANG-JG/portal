const CACHE_NAME = 'jg-portal-v20261113_115538';

// 오프라인 및 고속 로딩을 위한 필수 정적 에셋 프리캐시 목록
const PRECACHE_ASSETS = [
    '/offline.html',
    '/css/pretendard.css',
    '/css/unified-nav.css',
    '/fonts/Pretendard-Regular.subset.woff2',
    '/fonts/Pretendard-Medium.subset.woff2',
    '/fonts/Pretendard-SemiBold.subset.woff2',
    '/fonts/Pretendard-Bold.subset.woff2',
    '/favicon.ico',
    '/favicon-v2.svg',
    '/favicon-v2.png',
    '/icon-v2-192.png',
    '/icon-v2-512.png',
    '/badge-monochrome.png',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => Promise.all(
            PRECACHE_ASSETS.map((assetUrl) =>
                fetch(new Request(assetUrl, { cache: 'reload' }))
                    .then((res) => (res && res.status === 200) ? cache.put(assetUrl, res) : null)
                    .catch(() => null)
            )
        )).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 1. GET 이외 요청 및 API, SSO 리다이렉트, 소켓 요청은 캐싱 제외
    if (req.method !== 'GET' ||
        url.pathname.startsWith('/api') ||
        url.pathname.startsWith('/go') ||
        url.pathname.startsWith('/socket.io')) {
        return;
    }

    // 2. HTML 문서 및 CSS/JS 코드: 항상 최신 버전 우선 (Network-First)
    if (req.mode === 'navigate' || url.pathname.match(/\.(css|js)$/i) || url.pathname.includes('unified-nav') || url.pathname.includes('news-ticker')) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res && res.status === 200) {
                        const clone = res.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
                    }
                    return res;
                })
                .catch(async () => {
                    const cached = await caches.match(req);
                    if (cached) return cached;
                    if (req.mode === 'navigate') return caches.match('/offline.html');
                    return new Response('', { status: 408 });
                })
        );
        return;
    }

    // 3. 정적 미디어 에셋 (이미지, 폰트, 아이콘): Stale-While-Revalidate
    const isStaticAsset = url.pathname.match(/\.(png|svg|jpg|jpeg|webp|woff2?|ico)$/i) || PRECACHE_ASSETS.includes(url.pathname);
    if (isStaticAsset) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cachedRes = await cache.match(req);
                const fetchPromise = fetch(req)
                    .then((networkRes) => {
                        if (networkRes && networkRes.status === 200) cache.put(req, networkRes.clone());
                        return networkRes;
                    })
                    .catch(() => cachedRes);
                return cachedRes || fetchPromise;
            })
        );
        return;
    }

    event.respondWith(fetch(req).catch(() => caches.match(req)));
});

// 🔔 [순정 웹 표준 Web Push 수신 핸들러]
// 모든 브라우저 및 설치형 웹앱(WebAPK/PWA)에서 100% 호환되는 최소 표준 옵션만 사용합니다.
self.addEventListener('push', (event) => {
    let payload = {};
    if (event.data) {
        try {
            payload = event.data.json() || {};
        } catch (e) {
            payload = { title: '🔔 알림', body: event.data.text() };
        }
    }

    const title = String(payload.title || '🔔 알림').trim();
    const body = String(payload.body || '새로운 알림이 도착했습니다.').trim();
    const safeTag = payload.tag ? String(payload.tag) : ('jg-push-' + Date.now());
    const payloadData = (payload.data && typeof payload.data === 'object') ? payload.data : {};
    const targetUrl = payloadData.url || 'https://j-jg.cc/';
    const notifId = payloadData.notifId || null;

    // 모노크롬/구버전 아이콘 배제, 검증된 정적 PNG 아이콘 표준 적용 (배지는 모노크롬 PNG 사용)
    let iconUrl = '/icon-v2-192.png';
    if (payload.icon && typeof payload.icon === 'string' && !payload.icon.includes('monochrome') && !payload.icon.includes('/icon-192.png')) {
        iconUrl = payload.icon;
    }
    const badgeUrl = (payload.badge && typeof payload.badge === 'string') ? payload.badge : '/badge-monochrome.png';

    const options = {
        body,
        icon: iconUrl,
        badge: badgeUrl,
        tag: safeTag,
        renotify: true,
        data: {
            url: targetUrl,
            notifId
        }
    };
    if (payload.image && typeof payload.image === 'string') {
        options.image = payload.image;
    }

    event.waitUntil(
        self.registration.showNotification(title, options)
            .then(() => fetch('/api/notification/sw-ack', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'shown', title, tag: safeTag })
            }).catch(() => {}))
            .catch((err) => {
                fetch('/api/notification/sw-ack', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'error', title, tag: safeTag, error: String((err && err.message) || err) })
                }).catch(() => {});
                return self.registration.showNotification(title, {
                    body,
                    icon: '/icon-v2-192.png',
                    badge: '/badge-monochrome.png',
                    tag: safeTag,
                    data: { url: targetUrl, notifId }
                }).catch(() => {});
            })
    );
});

// 🔔 알림 클릭 시 읽음 처리 및 대상 화면 열기
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const notifData = event.notification.data || {};
    const rawUrl = notifData.url || 'https://j-jg.cc/';
    const notifId = notifData.notifId;

    let targetUrl = rawUrl;
    if (rawUrl.startsWith('/')) {
        if (rawUrl.includes('dashboard') || rawUrl.includes('hospital')) {
            targetUrl = `https://blood.j-jg.cc${rawUrl}`;
        } else if (rawUrl.includes('album') || rawUrl.startsWith('/photos')) {
            targetUrl = `https://album.j-jg.cc${rawUrl}`;
        } else {
            targetUrl = `https://j-jg.cc${rawUrl}`;
        }
    }

    const markReadPromise = notifId
        ? fetch(`https://j-jg.cc/api/notification/history/${notifId}/read`, {
            method: 'POST',
            credentials: 'include',
            keepalive: true
        }).catch(() => {})
        : Promise.resolve();

    const openWindowPromise = clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        try {
            const targetOrigin = new URL(targetUrl).origin;
            for (const client of clientList) {
                if (client.url && client.url.startsWith(targetOrigin) && 'focus' in client) {
                    if ('navigate' in client) client.navigate(targetUrl);
                    return client.focus();
                }
            }
        } catch (e) {}

        if (clients.openWindow) {
            return clients.openWindow(targetUrl);
        }
    });

    event.waitUntil(Promise.all([markReadPromise, openWindowPromise]));
});

// 브라우저/OS가 백그라운드에서 푸시 토큰을 갱신했을 때 열려 있는 탭에 동기화 요청
self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            list.forEach((client) => {
                try { client.postMessage({ type: 'JG_PUSH_RESUBSCRIBE_NEEDED' }); } catch (e) {}
            });
        })
    );
});
