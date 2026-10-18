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
    const JG_UI_VERSION = '20261018_v15';

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

    // 4. 하단 뉴스/속보 티커 위젯 주입
    if (enableTicker) {
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
