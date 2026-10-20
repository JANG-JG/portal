/**
 * 🚀 JG Smart Central UI Loader (jg-ui.js)
 * - 상단 통합 내비게이션 바(unified-nav)와 하단 실시간 뉴스/속보 바(news-ticker)를 단 한 줄로 모든 서비스에 통합 주입합니다.
 * - 사용법: <script src="https://j-jg.cc/js/jg-ui.js" defer></script>
 * - 옵션: data-nav="false" (상단바 비활성화), data-ticker="false" (하단바 비활성화)
 * - 버전 갱신 시 아래 JG_UI_VERSION만 수정하면 전 사이트에 실시간 동시 반영됩니다.
 */
(function() {
    'use strict';

    if (window.__JG_UI_LOADER_INITIALIZED__) return;
    window.__JG_UI_LOADER_INITIALIZED__ = true;

    // 🎯 중앙 집중 단일 버전 상수 (여기서 버전만 올리면 전 사이트 자동 갱신!)
    const JG_UI_VERSION = '20261020_v8';

    // 0. 🛡️ [FOUC & 거대 로고 방지 동기 크리티컬 인라인 CSS 즉시 주입 (0ms 무지연 가드)]
    // CSS 번들이 로드되기 전 HTML이 먼저 파싱/주입되더라도 거대 로고 팝업, 레이아웃 덜컥거림을 100% 원천 차단합니다.
    (function injectCriticalCss() {
        if (document.getElementById('jg-ui-critical-css')) return;
        const style = document.createElement('style');
        style.id = 'jg-ui-critical-css';
        style.textContent = `
            /* 1) 상단 내비바 예약 높이 및 레이아웃 사전 확보 (CLS 0px 방지) */
            #unified-nav-root, .unav-header {
                display: block !important;
                min-height: 54px !important;
                background-color: #ffffff !important;
                position: sticky !important;
                top: 0 !important;
                left: 0 !important;
                right: 0 !important;
                width: 100% !important;
                z-index: 99999 !important;
                box-sizing: border-box !important;
            }
            .unav-container {
                max-width: 1280px !important;
                margin: 0 auto !important;
                padding: 0.65rem 1.25rem !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                box-sizing: border-box !important;
                height: 54px !important;
                flex-wrap: nowrap !important;
            }
            .unav-brand {
                display: inline-flex !important;
                align-items: center !important;
                gap: 0.5rem !important;
                text-decoration: none !important;
                font-size: 1.2rem !important;
                font-weight: 800 !important;
                color: #0f172a !important;
                line-height: 1 !important;
                white-space: nowrap !important;
                flex-shrink: 0 !important;
            }
            /* 2) 로고 거대화 팝 현상 원천 박멸 (24px 강제 고정) */
            .unav-brand-icon-img {
                width: 24px !important;
                height: 24px !important;
                max-width: 24px !important;
                max-height: 24px !important;
                border-radius: 6px !important;
                display: inline-block !important;
                vertical-align: middle !important;
                object-fit: contain !important;
                flex-shrink: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            .unav-brand-text {
                font-weight: 800 !important;
                line-height: 1 !important;
                display: inline-block !important;
                color: #0f172a !important;
            }
            .unav-menu {
                display: flex !important;
                align-items: center !important;
                gap: 0.15rem !important;
                flex-wrap: nowrap !important;
                list-style: none !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            .unav-item {
                position: relative !important;
                display: inline-flex !important;
            }
            .unav-link {
                display: inline-flex !important;
                align-items: center !important;
                gap: 0.25rem !important;
                padding: 0.4rem 0.55rem !important;
                border-radius: 0.5rem !important;
                text-decoration: none !important;
                font-size: 0.85rem !important;
                font-weight: 600 !important;
                color: #334155 !important;
                white-space: nowrap !important;
            }
            /* 드롭다운 서브메뉴 사전 숨김 (스타일 로딩 전 페이지 세로 팽창 방지) */
            .unav-dropdown {
                position: absolute !important;
                top: 100% !important;
                left: 0 !important;
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
            }
            .unav-item:hover .unav-dropdown {
                opacity: 1 !important;
                visibility: visible !important;
                pointer-events: auto !important;
            }
            /* 모바일 드로어 사전 숨김 */
            .unav-drawer:not(.open) {
                display: none !important;
            }
            .unav-actions {
                display: inline-flex !important;
                align-items: center !important;
                gap: 0.4rem !important;
            }
            .unav-hamburger, .unav-mobile-notif-btn {
                display: none !important;
            }
            @media (max-width: 860px) {
                #unified-nav-root, .unav-header {
                    min-height: 52px !important;
                }
                .unav-container {
                    padding: 0.5rem 0.85rem !important;
                    height: 52px !important;
                }
                .unav-menu {
                    display: none !important;
                }
                .unav-hamburger {
                    display: flex !important;
                    width: 36px !important;
                    height: 36px !important;
                }
                .unav-mobile-notif-btn {
                    display: inline-flex !important;
                    width: 36px !important;
                    height: 36px !important;
                }
            }
            /* 3) 하단 티커 바 레이아웃 사전 확보 및 덜컥거림 방지 */
            #jg-global-ticker-bar {
                position: fixed !important;
                bottom: 0 !important;
                left: 0 !important;
                right: 0 !important;
                height: 44px !important;
                background: #020617 !important;
                border-top: 1px solid #1e293b !important;
                color: #f8fafc !important;
                z-index: 999990 !important;
                display: flex !important;
                align-items: center !important;
                padding: 0 12px !important;
                box-sizing: border-box !important;
            }
            body:has(.bottom-nav) #jg-global-ticker-bar,
            body:has(.admin-bottom-nav) #jg-global-ticker-bar {
                bottom: 56px !important;
            }
            @media (max-width: 768px) {
                #jg-global-ticker-bar {
                    height: 58px !important;
                    flex-direction: column !important;
                    padding: 4px 8px !important;
                    justify-content: center !important;
                    gap: 2px !important;
                }
            }
            #jg-global-breaking-bar {
                position: fixed !important;
                bottom: 44px !important;
                left: 0 !important;
                right: 0 !important;
                height: 36px !important;
                z-index: 1000002 !important;
                display: none;
            }
            #jg-global-breaking-bar.jg-breaking-active {
                display: flex !important;
            }
            body:has(.bottom-nav) #jg-global-breaking-bar,
            body:has(.admin-bottom-nav) #jg-global-breaking-bar {
                bottom: 100px !important;
            }
            @media (max-width: 768px) {
                #jg-global-breaking-bar {
                    bottom: 58px !important;
                    height: 34px !important;
                }
                body:has(.bottom-nav) #jg-global-breaking-bar,
                body:has(.admin-bottom-nav) #jg-global-breaking-bar {
                    bottom: 114px !important;
                }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    })();

    // 1. 현재 스크립트 엘리먼트 및 호스트 오리진 감지
    const currentScript = document.currentScript || (function() {
        const scripts = document.getElementsByTagName('script');
        for (let i = scripts.length - 1; i >= 0; i--) {
            if (scripts[i].src && scripts[i].src.includes('jg-ui.js')) return scripts[i];
        }
        return null;
    })();

    let origin = 'https://j-jg.cc';
    let enableNav = true;
    let enableTicker = true;

    if (currentScript) {
        try {
            if (currentScript.src) {
                const url = new URL(currentScript.src);
                // 로컬 호스트 테스트 환경 지원 (localhost, 127.0.0.1)
                if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
                    origin = url.origin;
                }
            }
        } catch (e) {}

        if (currentScript.dataset) {
            if (currentScript.dataset.nav === 'false') enableNav = false;
            if (currentScript.dataset.ticker === 'false') enableTicker = false;
        }
    }

    // 2. 리소스 주입 헬퍼 함수
    function injectStylesheet(href) {
        const cleanHref = href.split('?')[0];
        if (document.querySelector(`link[href*="${cleanHref}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        (document.head || document.documentElement).appendChild(link);
    }

    function injectScript(src) {
        const cleanSrc = src.split('?')[0];
        if (document.querySelector(`script[src*="${cleanSrc}"]`)) return;
        const script = document.createElement('script');
        script.src = src;
        script.defer = true;
        (document.head || document.documentElement).appendChild(script);
    }

    // 3. 상단 내비게이션 바 주입
    if (enableNav) {
        // 스타일시트 동적 주입
        injectStylesheet(`${origin}/css/unified-nav.css?v=${JG_UI_VERSION}`);
        // 상단바 스크립트 동적 주입
        injectScript(`${origin}/js/unified-nav.js?v=${JG_UI_VERSION}`);
    }

    // 4. 하단 뉴스/속보 티커 위젯 주입 및 하단 여백 사전 확보
    if (enableTicker) {
        const reserveBottomPadding = () => {
            if (document.body && !document.body.style.paddingBottom) {
                const isMobile = window.innerWidth <= 768;
                document.body.style.paddingBottom = isMobile ? '62px' : '48px';
            }
        };
        if (document.body) reserveBottomPadding();
        else window.addEventListener('DOMContentLoaded', reserveBottomPadding);

        injectScript(`${origin}/js/news-ticker.js?v=${JG_UI_VERSION}`);
    }

    // 5. 🛡️ 사이트 접속 시 최상단(Top: 0) 시작 가드
    // 브라우저 앵커/포커스로 인해 페이지 첫 진입 시 임의로 아래로 튕기는 현상 원천 차단
    if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#tab-home') {
        if ('scrollRestoration' in history) {
            try { history.scrollRestoration = 'manual'; } catch (e) {}
        }
        window.addEventListener('load', function() {
            setTimeout(function() {
                if (window.scrollY > 0 && (!window.location.hash || window.location.hash === '#tab-home')) {
                    window.scrollTo(0, 0);
                }
            }, 60);
        });
    }
})();
