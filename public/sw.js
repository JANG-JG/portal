const CACHE_NAME = 'jg-portal-v2';

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
        title: '🚨 JG 통합 포털 알림',
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

    const options = {
        body: data.body,
        icon: data.icon || 'https://j-jg.cc/favicon.svg',
        badge: data.badge || 'https://j-jg.cc/favicon.svg',
        vibrate: [200, 100, 200],
        data: data.data || { url: 'https://news.j-jg.cc/breaking' },
        actions: [
            { action: 'open', title: '속보 확인하기' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// 🔔 알림 클릭 시 브리핑 사이트의 속보 페이지(또는 전달된 url)로 이동
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = (event.notification.data && event.notification.data.url) 
        ? event.notification.data.url 
        : 'https://news.j-jg.cc/breaking';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes(targetUrl) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});


