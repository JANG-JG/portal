/**
 * ==============================================================================
 * 빨간패드공부 (/study) 태블릿 전용 PWA 부트스트랩 (study-pwa.js)
 * ------------------------------------------------------------------------------
 * - 알림 없는 전용 Service Worker(/study/sw.js, scope: '/study/') 등록
 * - 독립 실행(standalone) 모드 감지 및 포털 이탈 버튼 보호
 * - 갤럭시 탭(Chrome/삼성 인터넷) 원클릭 앱 설치 배너 지원
 * ==============================================================================
 */
(function () {
    'use strict';

    const DISMISS_KEY = 'jg_study_install_dismissed_v1';
    let deferredInstallPrompt = null;

    function isStandaloneApp() {
        return Boolean(
            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
            window.navigator.standalone === true
        );
    }

    function applyStandaloneUi() {
        const standalone = isStandaloneApp();
        if (standalone) {
            document.documentElement.classList.add('study-standalone');
            const portalBack = document.getElementById('portalBackLink');
            if (portalBack) portalBack.hidden = true;
        }
    }

    function registerStudyServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/study/sw.js', { scope: '/study/' }).catch((err) => {
                console.warn('빨간패드공부 SW 등록 대기:', err && err.message ? err.message : err);
            });
        });
    }

    function setupInstallBanner() {
        const banner = document.getElementById('studyInstallBanner');
        const installBtn = document.getElementById('btnStudyInstallApp');
        const dismissBtn = document.getElementById('btnStudyInstallDismiss');
        if (!banner || !installBtn || !dismissBtn) return;

        if (isStandaloneApp()) {
            banner.hidden = true;
            return;
        }

        let dismissed = false;
        try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) {}

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredInstallPrompt = e;
            if (!dismissed && !isStandaloneApp()) {
                banner.hidden = false;
            }
        });

        installBtn.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            installBtn.disabled = true;
            try {
                deferredInstallPrompt.prompt();
                const choice = await deferredInstallPrompt.userChoice;
                if (choice && choice.outcome === 'accepted') {
                    banner.hidden = true;
                }
            } catch (e) {}
            deferredInstallPrompt = null;
            installBtn.disabled = false;
        });

        dismissBtn.addEventListener('click', () => {
            banner.hidden = true;
            try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
        });

        window.addEventListener('appinstalled', () => {
            banner.hidden = true;
            deferredInstallPrompt = null;
        });
    }

    applyStandaloneUi();
    registerStudyServiceWorker();
    document.addEventListener('DOMContentLoaded', () => {
        applyStandaloneUi();
        setupInstallBanner();
    });
})();
