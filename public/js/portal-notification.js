/**
 * 🔔 호환성 래퍼 (portal-notification.js -> 단일 통합 알림 모듈로 일원화 완료)
 * 구버전 캐시 HTML에서 호출되더라도 중복 정의 없이 단일 모듈만 로드합니다.
 */
(function() {
    'use strict';
    ['unified-nav-push.js', 'unified-nav-modal.js', 'unified-nav-history.js'].forEach((file) => {
        if (!document.querySelector(`script[src*="${file}"]`)) {
            const s = document.createElement('script');
            s.src = `/js/${file}`;
            s.defer = true;
            (document.head || document.documentElement).appendChild(s);
        }
    });
})();