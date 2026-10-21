const CACHE_NAME = 'jg-portal-v20261021_200941';

// 오프라인 및 고속 로딩을 위한 필수 정적 에셋 프리캐시 목록
const PRECACHE_ASSETS = [
    '/offline.html',
    '/css/pretendard.css',
    '/css/unified-nav.css',
    '/js/unified-nav.js',
    '/js/news-ticker.js',
    '/fonts/Pretendard-Regular.subset.woff2',
    '/fonts/Pretendard-Medium.subset.woff2',
    '/fonts/Pretendard-SemiBold.subset.woff2',
    '/fonts/Pretendard-Bold.subset.woff2',
    '/favicon.svg',
    '/favicon.png',
    '/icon-192.png',
    '/icon-512.png',
    '/icon-monochrome.png',
    '/badge-monochrome.png',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS).catch((err) => {
                console.warn('[Portal SW] Precache partial error:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[Portal SW] Removing old cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 1. GET 이외의 요청이나 API, SSO 리다이렉트, 소켓 요청은 캐싱 완전 제외
    if (req.method !== 'GET' || 
        url.pathname.startsWith('/api') || 
        url.pathname.startsWith('/go') || 
        url.pathname.startsWith('/socket.io')) {
        return;
    }

    // 1-1. 중앙 UI 런처(jg-ui.js): 항상 실시간 네트워크 직통 (Network-Only, 무캐싱)
    if (url.pathname.endsWith('/js/jg-ui.js')) {
        event.respondWith(fetch(req).catch(() => caches.match(req)));
        return;
    }

    // 2. HTML 문서 탐색 및 CSS/JS 코드 요청: Network-First (항상 최신 버전 우선, 오프라인 시에만 캐시 폴백)
    if (req.mode === 'navigate' || url.pathname.match(/\.(css|js)$/i) || url.pathname.includes('unified-nav')) {
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

    // 3. 정적 미디어 에셋 (이미지, 폰트, 아이콘): Stale-While-Revalidate (0ms 응답 + 백그라운드 갱신)
    const isStaticAsset = (
        url.pathname.match(/\.(png|svg|jpg|jpeg|webp|woff2?|ico)$/i) ||
        PRECACHE_ASSETS.includes(url.pathname)
    );

    if (isStaticAsset) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cachedRes = await cache.match(req);
                const fetchPromise = fetch(req)
                    .then((networkRes) => {
                        if (networkRes && networkRes.status === 200) {
                            cache.put(req, networkRes.clone());
                        }
                        return networkRes;
                    })
                    .catch(() => cachedRes);

                // 캐시가 있으면 즉시 반환, 없으면 네트워크 응답 대기
                return cachedRes || fetchPromise;
            })
        );
        return;
    }

    // 4. 기타 리소스 기본 처리
    event.respondWith(
        fetch(req).catch(() => caches.match(req))
    );
});

// 🔔 [Web Push] 실시간 속보 및 시스템 알림 수신 처리
self.addEventListener('push', (event) => {
    let data = {
        title: '🚨 알림',
        body: '새로운 알림이 도착했습니다.',
        icon: 'https://j-jg.cc/icon-192.png',
        badge: 'https://j-jg.cc/icon-192.png',
        data: { url: 'https://news.j-jg.cc/breaking' }
    };

    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    if (data.title) {
        data.title = data.title
            .replace(/&nbsp;/gi, ' ')
            .replace(/\u00a0/g, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/^\[?JG\s*통합\s*포털\]?\s*/i, '')
            .replace(/^\[?JG\s*포털\]?\s*/i, '')
            .trim();
    }

    if (data.body) {
        data.body = String(data.body)
            .replace(/&nbsp;/gi, ' ')
            .replace(/\u00a0/g, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/<[^>]+>/g, '')
            .replace(/[^\S\r\n]+/g, ' ')
            .replace(/\n\s+/g, '\n')
            .replace(/\s+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    // 알림 성격에 맞춘 동적 액션 버튼 라벨 지정
    let actionTitle = '자세히 보기';
    const notifTitle = data.title || '';
    if (notifTitle.includes('속보')) {
        actionTitle = '속보 확인하기';
    } else if (notifTitle.includes('날씨')) {
        actionTitle = '날씨 확인하기';
    } else if (notifTitle.includes('증시') || notifTitle.includes('환율')) {
        actionTitle = '증시 확인하기';
    } else if (notifTitle.includes('혈압') || notifTitle.includes('복약') || notifTitle.includes('약')) {
        actionTitle = '혈압앱 열기';
    } else if (notifTitle.includes('서버') || notifTitle.includes('경보')) {
        actionTitle = '관리센터 열기';
    }

    const defaultUrl = data.title?.includes('속보') ? 'https://news.j-jg.cc/breaking' : 'https://j-jg.cc/';

    // 🌟 안드로이드(갤럭시) 텔레그램 스타일 단색 알림 적용
    // badge: 상단 상태표시줄 및 알림 헤더용 투명 배경 순수 흰색 실루엣 (안드로이드 공식 Monochrome 사양)
    // icon: 알림 본문 우측용 다크 슬레이트 단색 원형 심볼
    let notifBadge = 'https://j-jg.cc/badge-monochrome.png';
    let notifIcon = 'https://j-jg.cc/icon-monochrome.png';
    if (data.badge && !data.badge.includes('icon-192') && !data.badge.includes('icon-512')) {
        notifBadge = data.badge;
    }
    if (data.icon && !data.icon.includes('icon-192') && !data.icon.includes('icon-512')) {
        notifIcon = data.icon;
    }

    // 🌟 안드로이드 Heads-up (상단 배너 팝업)을 유도하고 알림이 덮어써지지 않도록 옵션 구성
    const options = {
        body: data.body,
        icon: notifIcon,
        badge: notifBadge,
        tag: data.tag || undefined,
        renotify: true,
        requireInteraction: true,
        vibrate: [300, 150, 300, 150, 300],
        timestamp: Date.now(),
        data: data.data || { url: defaultUrl },
        actions: [
            { action: 'open', title: actionTitle }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// 🔔 알림 클릭 시 읽음 처리 전송 및 해당 페이지로 이동
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const notifData = (event.notification.data) || {};
    let rawUrl = notifData.url || 'https://news.j-jg.cc/breaking';
    const notifId = notifData.notifId;

    // 상대 경로가 전달된 경우 적절한 도메인으로 보정
    let targetUrl = rawUrl;
    if (rawUrl.startsWith('/')) {
        if (rawUrl.includes('dashboard') || rawUrl.includes('hospital')) {
            targetUrl = `https://blood.j-jg.cc${rawUrl}`;
        } else {
            targetUrl = `https://j-jg.cc${rawUrl}`;
        }
    }

    // 🌟 알림 클릭 시 백그라운드에서 즉시 읽음 처리 API 호출
    const markReadPromise = notifId ? fetch(`https://j-jg.cc/api/notification/history/${notifId}/read`, {
        method: 'POST',
        credentials: 'include',
        keepalive: true
    }).catch(() => {}) : Promise.resolve();

    const openWindowPromise = clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        const cleanTarget = targetUrl.split('?')[0];
        
        // 1순위: 대상 URL과 동일한 창이 이미 열려있는 경우 해당 창 포커스 및 최신화
        for (const client of clientList) {
            if (client.url && client.url.includes(cleanTarget) && 'focus' in client) {
                if ('navigate' in client) {
                    client.navigate(targetUrl);
                }
                return client.focus();
            }
        }

        // 2순위: 대상 도메인과 일치하는 창이 열려있는 경우 (예: blood.j-jg.cc 타겟이면 blood 창)
        try {
            const targetOrigin = new URL(targetUrl).origin;
            for (const client of clientList) {
                if (client.url && client.url.startsWith(targetOrigin) && 'focus' in client) {
                    if ('navigate' in client) {
                        client.navigate(targetUrl);
                    }
                    return client.focus();
                }
            }
        } catch (e) {}

        // 3순위: 열려있는 적합한 창이 없는 경우 새 창 열기
        if (clients.openWindow) {
            return clients.openWindow(targetUrl);
        }
    });

    event.waitUntil(Promise.all([markReadPromise, openWindowPromise]));
});
