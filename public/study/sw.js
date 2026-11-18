/**
 * 빨간패드공부 (/study) 전용 경량 Service Worker
 * - 기존 포털 웹 푸시 알림과 완전히 분리됨 (push/notification 리스너 0%)
 * - 학습실 정적 리소스 고속 캐시 & 오프라인 복구 전담
 */
const CACHE_NAME = 'jg-study-v__STUDY_ASSET_VERSION__';

const PRECACHE_ASSETS = [
    '/study/offline.html',
    '/study/manifest.json',
    '/study/icons/favicon-64.png',
    '/study/icons/icon-192.png',
    '/study/icons/icon-512.png',
    '/css/pretendard.css',
    '/css/study.css',
    '/css/study-play.css',
    '/css/study-visuals.css',
    '/css/study-login.css',
    '/css/study-tablet.css',
    '/css/pokemon-meadow.css',
    '/css/pokemon-meadow-play.css',
    '/css/study-review.css',
    '/css/study-sheet-step.css',
    '/css/study-draw-studio.css',
    '/css/study-pokemon-social.css',
    '/fonts/Pretendard-Regular.subset.woff2',
    '/fonts/Pretendard-SemiBold.subset.woff2',
    '/fonts/Pretendard-Bold.subset.woff2',
    '/vendor/study/canvas-confetti.min.js',
    '/vendor/study/hangul-writer.min.js',
    '/vendor/study/perfect-freehand.min.js',
    '/js/study-fx.js',
    '/js/study-tts.js',
    '/js/study-hangul-trace.js',
    '/js/study-artwork.js',
    '/js/pokemon-meadow.js',
    '/js/pokemon-meadow-toys.js',
    '/js/pokemon-meadow-play.js',
    '/js/study-pokemon-social.js',
    '/js/study-pokemon-coloring.js',
    '/js/study-color-flood.js',
    '/js/study-draw-brushes.js',
    '/js/study-draw-stickers.js',
    '/js/study-draw-chrome.js',
    '/js/study-draw-modes.js',
    '/js/study-color-block.js',
    '/js/study-play-blocks.js',
    '/js/study-sheet-result.js',
    '/js/study-sheet-stepper.js',
    '/js/study-review.js',
    '/js/study-sheet.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => Promise.all(
                PRECACHE_ASSETS.map((assetUrl) =>
                    fetch(new Request(assetUrl, { cache: 'reload' }))
                        .then((res) => (res && res.status === 200) ? cache.put(assetUrl, res) : null)
                        .catch(() => null)
                )
            ))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.map((key) => (key !== CACHE_NAME && key.startsWith('jg-study-') ? caches.delete(key) : null))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 1. GET 이외, API/인증 경로는 네트워크 직통
    if (
        req.method !== 'GET' ||
        url.origin !== self.location.origin ||
        url.pathname.startsWith('/api') ||
        url.pathname.startsWith('/study/logout') ||
        url.pathname === '/logout'
    ) {
        return;
    }

    // 2. HTML 화면 탐색: 항상 최신 네트워크 우선 (리다이렉트된 응답은 캐시 제외)
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res && res.status === 200 && !res.redirected) {
                        const clone = res.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
                    }
                    return res;
                })
                .catch(async () => {
                    const cached = await caches.match(req);
                    if (cached) return cached;
                    return caches.match('/study/offline.html');
                })
        );
        return;
    }

    // 3. 버전(?v=) 정적 리소스 & 웹폰트: Cache-First
    const isVersionedOrFont =
        (url.searchParams.has('v') && /\.(css|js|png|svg|jpg|jpeg|webp|woff2?|ico)$/i.test(url.pathname)) ||
        /\/fonts\/.*\.(woff2?|ttf|otf)$/i.test(url.pathname);
    if (isVersionedOrFont) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) =>
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
        return;
    }

    // 4. 버전 없는 CSS/JS: Network-First
    if (/\.(css|js)$/i.test(url.pathname)) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res && res.status === 200) {
                        const clone = res.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
                    }
                    return res;
                })
                .catch(async () => {
                    const cached = await caches.match(req);
                    return cached || new Response('', { status: 408 });
                })
        );
        return;
    }

    // 5. 아이콘/이미지: Stale-While-Revalidate
    if (/\.(png|svg|jpg|jpeg|webp|ico)$/i.test(url.pathname)) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(req);
                const fetched = fetch(req)
                    .then((networkRes) => {
                        if (networkRes && networkRes.status === 200) {
                            cache.put(req, networkRes.clone()).catch(() => {});
                        }
                        return networkRes;
                    })
                    .catch(() => cached);
                return cached || fetched;
            })
        );
    }
});
