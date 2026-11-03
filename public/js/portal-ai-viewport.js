/**
 * 🤖 JG 포털 AI 비서 - 모바일 뷰포트 및 가상 키보드 제어 엔진 (portal-ai-viewport.js)
 * - [핵심 기능] 안드로이드 visualViewport 동기화, 삼성 브라우저 하단 툴바 오프셋 보정, 키보드 밀착 제어
 * - [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 모바일 완벽 대응
 */
(function() {
    'use strict';

    let isStandaloneMode = false;
    let isSamsungBrowser = false;
    let baseInnerHeight = 0;
    let lastInnerWidth = 0;

    /**
     * 화면 상단 불필요 스크롤 즉시 리셋
     */
    function resetWindowScroll() {
        if (window.scrollY !== 0 || document.documentElement.scrollTop !== 0 || document.body.scrollTop !== 0) {
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
        }
    }

    /**
     * 모바일 환경 및 가상 키보드 실시간 뷰포트 변경 감지 핸들러
     */
    function handleViewportChange(promptInputEl, onScrollRequest) {
        const vv = window.visualViewport;
        const vh = vv ? vv.height : window.innerHeight;
        const vTop = (vv && vv.offsetTop) ? vv.offsetTop : 0;

        document.documentElement.style.setProperty('--ai-viewport-height', `${vh}px`);
        document.documentElement.style.setProperty('--ai-viewport-top', `${vTop}px`);

        if (window.innerWidth <= 768) {
            // 키보드 열림 판단: 입력창 포커스 중이거나 화면 높이가 100px 이상 줄어듦
            const isInputFocused = promptInputEl && (document.activeElement === promptInputEl);
            const heightDrop = baseInnerHeight - vh;
            const isKeyboard = isInputFocused || (heightDrop > 100);

            document.body.classList.toggle('keyboard-open', isKeyboard);

            // 웹앱이 아닌 일반 삼성 브라우징 모드에서만 하단 툴바 오프셋 계산 (웹앱은 툴바 없으므로 0px)
            if (isSamsungBrowser && !isStandaloneMode) {
                if (isKeyboard) {
                    // 키보드 열림 시 오프셋 완전 제거 (키보드 위에 바로 밀착)
                    document.documentElement.style.setProperty('--ai-samsung-offset', '0px');
                } else {
                    // 사용자가 스크롤하여 삼성 툴바를 숨겼는지 체크
                    const isToolbarHidden = (window.innerHeight - baseInnerHeight >= 45);
                    if (isToolbarHidden) {
                        document.documentElement.style.setProperty('--ai-samsung-offset', '0px');
                    } else {
                        // 툴바 표시 중 (하단 주소창 모드 대비 72px 오프셋 적용)
                        document.documentElement.style.setProperty('--ai-samsung-offset', '72px');
                    }
                }
            } else {
                document.documentElement.style.setProperty('--ai-samsung-offset', '0px');
            }

            // 키보드가 닫혀 있고 포커스가 없을 때만 baseInnerHeight 갱신 (키보드 개폐 도중 오염 방지)
            if (!isKeyboard && !isInputFocused) {
                if (vh > baseInnerHeight || Math.abs(window.innerWidth - lastInnerWidth) > 50) {
                    baseInnerHeight = vh;
                    lastInnerWidth = window.innerWidth;
                }
            }

            resetWindowScroll();
            if (typeof onScrollRequest === 'function') {
                onScrollRequest();
            }
        }
    }

    /**
     * 뷰포트 엔진 초기화
     */
    function initVisualViewport(promptInputEl, onScrollRequest) {
        // 웹앱(PWA/홈화면 추가/독립실행) 환경 판별
        isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches ||
                           window.matchMedia('(display-mode: fullscreen)').matches ||
                           window.matchMedia('(display-mode: minimal-ui)').matches ||
                           (window.navigator.standalone === true) ||
                           (document.referrer && document.referrer.includes('android-app://'));

        if (isStandaloneMode) {
            document.body.classList.add('is-standalone');
        }

        isSamsungBrowser = /SamsungBrowser/i.test(navigator.userAgent);
        if (isSamsungBrowser && !isStandaloneMode) {
            document.body.classList.add('is-samsung');
        }

        baseInnerHeight = Math.max(window.innerHeight, (window.visualViewport && window.visualViewport.height) || 0);
        lastInnerWidth = window.innerWidth;

        const updateHandler = () => handleViewportChange(promptInputEl, onScrollRequest);

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateHandler);
            window.visualViewport.addEventListener('scroll', () => {
                if (window.innerWidth <= 768) updateHandler();
            });
        }

        window.addEventListener('resize', updateHandler);
        window.addEventListener('scroll', () => {
            if (window.innerWidth <= 768) resetWindowScroll();
        });

        // 초기 가용 높이 세팅
        updateHandler();

        // 입력창 포커스/블러 시 가상 키보드 스크롤 밀림 방어 및 즉각 키보드 밀착 모드 전환
        if (promptInputEl) {
            promptInputEl.addEventListener('focus', () => {
                document.body.classList.add('keyboard-open');
                document.documentElement.style.setProperty('--ai-samsung-offset', '0px');
                resetWindowScroll();
                setTimeout(() => {
                    updateHandler();
                    resetWindowScroll();
                }, 30);
                setTimeout(() => {
                    updateHandler();
                    resetWindowScroll();
                    if (typeof onScrollRequest === 'function') onScrollRequest();
                }, 120);
                setTimeout(() => {
                    updateHandler();
                    resetWindowScroll();
                    if (typeof onScrollRequest === 'function') onScrollRequest();
                }, 300);
            });

            promptInputEl.addEventListener('blur', () => {
                setTimeout(() => {
                    resetWindowScroll();
                    document.body.classList.remove('keyboard-open');
                    updateHandler();
                }, 100);
            });
        }
    }

    // 전역 인터페이스 노출
    window.JgAiViewport = {
        init: initVisualViewport,
        resetScroll: resetWindowScroll
    };
})();
