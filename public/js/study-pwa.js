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

    function showPwaToast(msg) {
        const toast = document.getElementById('studyToast');
        if (!toast) return;
        toast.textContent = msg;
        toast.hidden = false;
        clearTimeout(toast._pwaTimer);
        toast._pwaTimer = setTimeout(() => { toast.hidden = true; }, 3200);
    }

    function setupDashMenuToggle() {
        const topbar = document.getElementById('studyDashTopbar');
        const btn = document.getElementById('btnToggleDashMenu');
        if (!topbar || !btn) return;
        btn.addEventListener('click', () => {
            const open = topbar.classList.toggle('is-menu-open');
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            btn.textContent = open ? '✕ 닫기' : '⚙️ 메뉴';
        });
    }

    async function syncMicButtonState(btn) {
        if (!btn) return;
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            btn.textContent = '🎤 마이크 미지원';
            btn.disabled = true;
            return;
        }
        if (navigator.permissions && typeof navigator.permissions.query === 'function') {
            try {
                const status = await navigator.permissions.query({ name: 'microphone' });
                const apply = () => {
                    if (status.state === 'granted') {
                        btn.textContent = '🎤 마이크 켜짐';
                        btn.classList.add('is-active');
                        btn.setAttribute('aria-pressed', 'true');
                    } else if (status.state === 'denied') {
                        btn.textContent = '🎤 마이크 차단됨';
                        btn.classList.remove('is-active');
                        btn.setAttribute('aria-pressed', 'false');
                    } else {
                        btn.textContent = '🎤 마이크 허용';
                        btn.classList.remove('is-active');
                        btn.setAttribute('aria-pressed', 'false');
                    }
                };
                apply();
                if (!status._studyBound) {
                    status._studyBound = true;
                    status.addEventListener('change', apply);
                }
            } catch (_) {}
        }
    }

    function setupMicPermissionControl() {
        const btn = document.getElementById('btnMicPermissionToggle');
        if (!btn) return;
        syncMicButtonState(btn);
        btn.addEventListener('click', async () => {
            if (!window.isSecureContext || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
                showPwaToast('HTTPS 보안 연결 환경에서만 마이크 권한을 요청할 수 있어요.');
                return;
            }
            btn.disabled = true;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach((t) => t.stop());
                btn.textContent = '🎤 마이크 켜짐';
                btn.classList.add('is-active');
                btn.setAttribute('aria-pressed', 'true');
                showPwaToast('✅ 마이크 권한이 허용되었어요! 이제 따라 말하기 녹음을 할 수 있어요.');
            } catch (err) {
                if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
                    btn.textContent = '🎤 마이크 차단됨';
                    btn.classList.remove('is-active');
                    btn.setAttribute('aria-pressed', 'false');
                    showPwaToast('기기 설정 → 앱 → 빨간패드공부(또는 브라우저) → 권한 → 마이크를 허용해 주세요.');
                } else if (err && err.name === 'NotFoundError') {
                    showPwaToast('연결된 마이크를 찾을 수 없어요.');
                } else {
                    showPwaToast('마이크 권한 확인 중 오류가 발생했어요.');
                }
            } finally {
                btn.disabled = false;
            }
        });
    }

    window.StudyPwaMic = {
        sync: () => syncMicButtonState(document.getElementById('btnMicPermissionToggle'))
    };

    applyStandaloneUi();
    registerStudyServiceWorker();
    document.addEventListener('DOMContentLoaded', () => {
        applyStandaloneUi();
        setupInstallBanner();
        setupDashMenuToggle();
        setupMicPermissionControl();
    });
})();
