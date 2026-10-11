const CACHE_NAME = 'jg-portal-v4';

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

// 🔔 [Web Push] 실시간 속보 및 시스템 알림 수신 처리
self.addEventListener('push', (event) => {
    let data = {
        title: '🚨 [JG 통합 포털] 알림',
        body: '새로운 알림이 도착했습니다.',
        icon: 'https://j-jg.cc/favicon.svg',
        badge: 'https://j-jg.cc/favicon.svg',
        data: { url: 'https://news.j-jg.cc/breaking' }
    };

    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
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

    const options = {
        body: data.body,
        icon: data.icon || 'https://j-jg.cc/favicon.svg',
        badge: data.badge || 'https://j-jg.cc/favicon.svg',
        tag: data.tag || undefined,
        renotify: false,
        vibrate: [200, 100, 200],
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
