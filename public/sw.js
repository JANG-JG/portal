const CACHE_NAME = 'jg-portal-v20261127_235339';

// 오프라인 및 고속 로딩을 위한 필수 정적 에셋 프리캐시 목록
const PRECACHE_ASSETS = [
    '/offline.html',
    '/css/pretendard.css',
    '/css/unified-nav.css',
    '/css/pokemon-meadow.css',
    '/js/pokemon-meadow.js',
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
    '/icons/notif/default-192.png',
    '/icons/notif/health-192.png',
    '/icons/notif/album-192.png',
    '/icons/notif/study-192.png',
    '/icons/notif/calendar-192.png',
    '/icons/notif/news-192.png',
    '/icons/notif/asset-192.png',
    '/icons/notif/system-192.png',
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

function respondCacheFirst(event, cacheName, req) {
    event.respondWith(
        caches.open(cacheName).then((cache) =>
            cache.match(req).then((cached) => {
                if (cached) return cached;
                return fetch(req).then((networkRes) => {
                    if (networkRes && networkRes.status === 200) {
                        cache.put(req, networkRes.clone()).catch(() => {});
                    }
                    return networkRes;
                });
            })
        )
    );
}

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

    // 2. HTML 문서: 항상 최신 버전 우선 (Network-First)
    if (req.mode === 'navigate') {
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
                    return caches.match('/offline.html');
                })
        );
        return;
    }

    // 3. 버전(?v=) 정적 에셋 및 웹폰트: Cache-First (0ms 로컬 캐시 즉시 응답, Cloudflare 왕복 제거)
    const isVersionedAsset = url.origin === self.location.origin && (
        (url.searchParams.has('v') && url.pathname.match(/\.(css|js|png|svg|jpg|jpeg|webp|ico|woff2?|ttf|otf)$/i)) ||
        url.pathname.match(/\/fonts\/.*\.(woff2?|ttf|otf)$/i)
    );
    if (isVersionedAsset) {
        respondCacheFirst(event, CACHE_NAME, req);
        return;
    }

    // 4. 버전 없는 CSS/JS 코드: 항상 최신 버전 우선 (Network-First)
    if (url.pathname.match(/\.(css|js)$/i) || url.pathname.includes('unified-nav') || url.pathname.includes('news-ticker')) {
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
                    return new Response('', { status: 408 });
                })
        );
        return;
    }

    // 5. 기타 버전 없는 정적 미디어 에셋 (이미지, 아이콘): Stale-While-Revalidate
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

    // 모노크롬/구버전 아이콘 배제, 동일 오리진 프리캐시 PNG 우선 적용 (삼성 인터넷 절전 시 0ms 렌더링)
    let iconUrl = '/icons/notif/default-192.png';
    if (payload.icon && typeof payload.icon === 'string' && !payload.icon.includes('monochrome') && !payload.icon.includes('/icon-192.png')) {
        try {
            const parsedIcon = new URL(payload.icon, self.location.origin);
            iconUrl = parsedIcon.origin === self.location.origin ? parsedIcon.pathname : payload.icon;
        } catch (e) {
            iconUrl = payload.icon;
        }
    }
    const badgeUrl = '/badge-monochrome.png';

    const options = {
        body,
        icon: iconUrl,
        badge: badgeUrl,
        tag: safeTag,
        renotify: true,
        requireInteraction: true,
        vibrate: [200, 100, 200],
        timestamp: Date.now(),
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
                body: JSON.stringify({ status: 'shown', title, tag: safeTag, notifId, swVersion: CACHE_NAME })
            }).catch(() => {}))
            .catch((err) => {
                fetch('/api/notification/sw-ack', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'error', title, tag: safeTag, notifId, swVersion: CACHE_NAME, error: String((err && err.message) || err) })
                }).catch(() => {});
                return self.registration.showNotification(title, {
                    body,
                    icon: '/icons/notif/default-192.png',
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

function swUrlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const out = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
    return out;
}

// 브라우저/OS가 백그라운드에서 푸시 토큰을 갱신했을 때 탭 유무와 무관하게 SW가 직접 무중단 회전
self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil((async () => {
        try {
            const oldSub = event.oldSubscription;
            const oldJson = oldSub && typeof oldSub.toJSON === 'function' ? oldSub.toJSON() : null;
            let subscribeOpts = (oldSub && oldSub.options && oldSub.options.applicationServerKey)
                ? { userVisibleOnly: true, applicationServerKey: oldSub.options.applicationServerKey }
                : null;

            if (!subscribeOpts) {
                const keyRes = await fetch('/api/notification/vapid-key');
                if (keyRes.ok) {
                    const keyData = await keyRes.json();
                    if (keyData && keyData.publicKey) {
                        subscribeOpts = {
                            userVisibleOnly: true,
                            applicationServerKey: swUrlBase64ToUint8Array(keyData.publicKey)
                        };
                    }
                }
            }

            const newSub = event.newSubscription || (subscribeOpts ? await self.registration.pushManager.subscribe(subscribeOpts) : null);
            if (newSub && oldJson && oldJson.endpoint && oldJson.keys && oldJson.keys.auth) {
                await fetch('/api/notification/rotate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        oldEndpoint: oldJson.endpoint,
                        oldAuth: oldJson.keys.auth,
                        newSubscription: newSub.toJSON ? newSub.toJSON() : newSub,
                        swVersion: CACHE_NAME
                    })
                }).catch(() => {});
            }
        } catch (e) {}

        const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        list.forEach((client) => {
            try { client.postMessage({ type: 'JG_PUSH_RESUBSCRIBE_NEEDED' }); } catch (e) {}
        });
    })());
});
