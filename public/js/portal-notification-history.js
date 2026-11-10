/**
 * 📜 호환성 래퍼 (portal-notification-history.js -> unified-nav-history.js 단일 모듈로 일원화 완료)
 */
(function() {
    'use strict';
    if (!window.__JG_NOTIF_HISTORY_READY__ && !document.querySelector('script[src*="unified-nav-history.js"]')) {
        const s = document.createElement('script');
        s.src = '/js/unified-nav-history.js';
        s.defer = true;
        (document.head || document.documentElement).appendChild(s);
    }
})();
