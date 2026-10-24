/**
 * news-ticker.js - JG 통합 포털 및 모든 서브 서비스(뉴스, 자산, 혈압) 공통 하단바 & 긴급 속보 위젯
 * 모든 사이트에서 <script src="https://j-jg.cc/js/news-ticker.js?v=20261019_v14"></script> 한 줄로 구동됩니다.
 * - 기본 하단바: 최신 뉴스 브리핑 헤드라인 및 우측 날씨/증시 실시간 롤링 (모든 사이트 상시 노출)
 * - 긴급 속보 바: 실시간 속보 발생 시 기본 하단바 바로 '위에' 빨간색 긴급 속보 띠가 새로 나타남
 * - 속보 닫기: 사용자가 속보를 확인한 후 [✕ 닫기]를 누르면 속보 바가 닫히고 기존 뉴스만 깔끔하게 표시됨
 */
(function() {
    // 중복 실행 방지
    if (document.getElementById('jg-global-ticker-bar')) return;

    // 1. 하단 여백 및 .bottom-nav 동적 적용 (하단 메뉴를 화면 최하단에 배치하고 뉴스 티커를 그 위에 위치)
    let currentHasBreaking = false;
    function updateBottomPadding(hasBreaking) {
        currentHasBreaking = !!hasBreaking;
        const isMobile = window.innerWidth <= 768;
        const tickerHeight = isMobile ? 58 : 44;
        const breakingHeight = currentHasBreaking ? (isMobile ? 34 : 36) : 0;
        const totalBarHeight = tickerHeight + breakingHeight;

        // 자산관리(.bottom-nav) 및 관리자 페이지(.admin-bottom-nav) 하단 내비게이션 바 탐색
        const bottomNav = document.querySelector('.bottom-nav, .admin-bottom-nav');
        let navHeight = 0;
        if (bottomNav) {
            // 하단 메뉴는 화면 최하단(바닥)에 완전히 밀착 고정
            bottomNav.style.setProperty('bottom', '0px', 'important');
            bottomNav.style.setProperty('z-index', '1000000', 'important');
            navHeight = bottomNav.offsetHeight || (isMobile ? 56 : 52);
        }

        // 뉴스 티커 바는 하단 내비게이션 바로 위에 배치
        const tickerBar = document.getElementById('jg-global-ticker-bar');
        if (tickerBar) {
            tickerBar.style.setProperty('bottom', navHeight + 'px', 'important');
            tickerBar.style.setProperty('transition', 'bottom 0.25s ease', 'important');
        }

        // 긴급 속보 바는 뉴스 티커 바 바로 위에 배치
        const breakingBar = document.getElementById('jg-global-breaking-bar');
        if (breakingBar) {
            breakingBar.style.setProperty('bottom', (navHeight + tickerHeight) + 'px', 'important');
            breakingBar.style.setProperty('transition', 'bottom 0.25s ease', 'important');
        }

        const pad = (totalBarHeight + navHeight + 8) + 'px';
        if (document.body) {
            document.body.style.paddingBottom = pad;
        } else {
            window.addEventListener('DOMContentLoaded', () => updateBottomPadding(hasBreaking));
        }
    }
    window.addEventListener('resize', () => updateBottomPadding(currentHasBreaking));
    updateBottomPadding(false);

    // 2. 전용 독립 스타일 주입
    const style = document.createElement('style');
    style.textContent = `
        /* 🚨 긴급 속보 상단 띠 (속보 발생 시 기본 하단바 바로 위에 노출) */
        #jg-global-breaking-bar {
            position: fixed !important;
            bottom: 44px !important;
            left: 0 !important;
            right: 0 !important;
            height: 36px !important;
            background: linear-gradient(90deg, #991b1b 0%, #b91c1c 50%, #7f1d1d 100%) !important;
            border-top: 1px solid #ef4444 !important;
            border-bottom: 1px solid #450a0a !important;
            color: #ffffff !important;
            z-index: 1000002 !important;
            display: none;
            align-items: center !important;
            padding: 0 12px !important;
            font-family: -apple-system, BlinkMacSystemFont, "Pretendard", system-ui, sans-serif !important;
            font-size: 11.5px !important;
            box-shadow: 0 -2px 10px rgba(185, 28, 28, 0.4) !important;
            user-select: none !important;
            box-sizing: border-box !important;
            transition: transform 0.3s ease, opacity 0.3s ease !important;
        }
        #jg-global-breaking-bar.jg-breaking-active {
            display: flex !important;
        }
        .jg-breaking-badge {
            display: inline-flex !important;
            align-items: center !important;
            gap: 5px !important;
            background: #ffffff !important;
            color: #b91c1c !important;
            font-weight: 900 !important;
            font-size: 10.5px !important;
            padding: 2.5px 7px !important;
            border-radius: 5px !important;
            margin-right: 10px !important;
            white-space: nowrap !important;
            flex-shrink: 0 !important;
            letter-spacing: -0.3px !important;
            animation: jg-pulse-shadow 1.5s infinite !important;
        }
        @keyframes jg-pulse-shadow {
            0%, 100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7); }
            50% { box-shadow: 0 0 0 4px rgba(255, 255, 255, 0); }
        }
        .jg-breaking-track {
            display: inline-flex !important;
            white-space: nowrap !important;
            animation: jg-breaking-scroll 60s linear infinite !important;
        }
        .jg-breaking-track:hover {
            animation-play-state: paused !important;
        }
        @keyframes jg-breaking-scroll {
            0% { transform: translateX(0%); }
            100% { transform: translateX(-50%); }
        }
        .jg-breaking-link {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            color: #ffffff !important;
            text-decoration: none !important;
            margin-right: 24px !important;
            font-weight: 600 !important;
            font-size: 11.5px !important;
            transition: opacity 0.2s !important;
        }
        .jg-breaking-link:hover {
            text-decoration: underline !important;
            color: #fef08a !important;
        }
        .jg-breaking-actions {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            margin-left: 8px !important;
            flex-shrink: 0 !important;
        }
        .jg-breaking-more {
            padding: 2px 7px !important;
            background: rgba(0, 0, 0, 0.3) !important;
            border: 1px solid rgba(255, 255, 255, 0.3) !important;
            border-radius: 4px !important;
            color: #fef08a !important;
            text-decoration: none !important;
            font-size: 10.5px !important;
            font-weight: 700 !important;
            white-space: nowrap !important;
            transition: background 0.2s !important;
        }
        .jg-breaking-more:hover {
            background: rgba(0, 0, 0, 0.5) !important;
        }
        .jg-breaking-close-btn {
            background: rgba(0, 0, 0, 0.4) !important;
            border: 1px solid rgba(255, 255, 255, 0.4) !important;
            color: #ffffff !important;
            border-radius: 4px !important;
            padding: 2px 7px !important;
            font-size: 10.5px !important;
            font-weight: 700 !important;
            cursor: pointer !important;
            display: inline-flex !important;
            align-items: center !important;
            gap: 3px !important;
            transition: all 0.2s !important;
        }
        .jg-breaking-close-btn:hover {
            background: rgba(0, 0, 0, 0.7) !important;
            color: #f87171 !important;
            border-color: #f87171 !important;
        }

        /* 📰 기본 하단 티커 바 컨테이너 */
        #jg-global-ticker-bar {
            position: fixed !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            height: 44px !important;
            background: #020617 !important;
            border-top: 1px solid #1e293b !important;
            color: #f8fafc !important;
            z-index: 999999 !important;
            display: flex !important;
            align-items: center !important;
            padding: 0 12px !important;
            font-family: -apple-system, BlinkMacSystemFont, "Pretendard", system-ui, sans-serif !important;
            font-size: 12px !important;
            box-shadow: 0 -4px 16px rgba(0,0,0,0.3) !important;
            user-select: none !important;
            box-sizing: border-box !important;
        }
        #jg-global-ticker-bar *, #jg-global-breaking-bar * {
            box-sizing: border-box !important;
        }

        /* 좌측 실시간 시계 위젯 */
        .jg-ticker-left {
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            font-size: 11.5px !important;
            color: #94a3b8 !important;
            font-weight: 600 !important;
            white-space: nowrap !important;
            letter-spacing: -0.2px !important;
        }
        .jg-clock-icon {
            font-size: 12px !important;
            opacity: 0.9 !important;
        }
        .jg-clock-date {
            color: #cbd5e1 !important;
        }
        .jg-clock-time {
            color: #38bdf8 !important;
            font-weight: 700 !important;
            font-variant-numeric: tabular-nums !important;
            letter-spacing: 0.5px !important;
        }

        /* 뉴스 뱃지 및 스크롤 영역 */
        .jg-ticker-badge {
            display: inline-flex !important;
            align-items: center !important;
            gap: 5px !important;
            background: #2563eb !important;
            color: #ffffff !important;
            font-weight: 800 !important;
            font-size: 11px !important;
            padding: 3.5px 8px !important;
            border-radius: 6px !important;
            margin-right: 12px !important;
            white-space: nowrap !important;
            flex-shrink: 0 !important;
            letter-spacing: -0.3px !important;
        }
        .jg-ticker-dot {
            width: 6px !important;
            height: 6px !important;
            background: #ffffff !important;
            border-radius: 50% !important;
            animation: jg-pulse 1.5s infinite !important;
        }
        @keyframes jg-pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.3; transform: scale(0.8); }
        }
        .jg-ticker-scroll-area {
            flex: 1 !important;
            min-width: 0 !important;
            overflow: hidden !important;
            position: relative !important;
            height: 100% !important;
            display: flex !important;
            align-items: center !important;
        }
        .jg-ticker-track {
            display: inline-flex !important;
            white-space: nowrap !important;
            animation: jg-ticker-scroll 85s linear infinite !important;
        }
        .jg-ticker-track:hover {
            animation-play-state: paused !important;
        }
        @keyframes jg-ticker-scroll {
            0% { transform: translateX(0%); }
            100% { transform: translateX(-50%); }
        }
        .jg-ticker-link {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            color: #e2e8f0 !important;
            text-decoration: none !important;
            margin-right: 24px !important;
            font-weight: 500 !important;
            font-size: 12px !important;
            transition: color 0.2s !important;
        }
        .jg-ticker-link:hover {
            color: #38bdf8 !important;
            text-decoration: underline !important;
        }
        .jg-ticker-cat {
            background: #1e293b !important;
            color: #38bdf8 !important;
            border: 1px solid #334155 !important;
            padding: 1px 5px !important;
            border-radius: 4px !important;
            font-size: 10px !important;
            font-weight: 700 !important;
        }

        /* 우측 날씨/증시/환율 롤링 위젯 */
        .jg-ticker-right {
            flex-shrink: 0 !important;
            height: 30px !important;
            display: flex !important;
            align-items: center !important;
        }
        .jg-v-box {
            position: relative !important;
            height: 30px !important;
            width: 175px !important;
            overflow: hidden !important;
        }
        .jg-v-item {
            position: absolute !important;
            inset: 0 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 6px !important;
            padding: 0 8px !important;
            background: #0f172a !important;
            border: 1px solid #1e293b !important;
            border-radius: 6px !important;
            color: #cbd5e1 !important;
            font-size: 11.5px !important;
            font-weight: 600 !important;
            white-space: nowrap !important;
            transition: transform 0.4s ease-in-out, opacity 0.4s ease-in-out, background 0.15s, border-color 0.15s !important;
            text-decoration: none !important;
        }
        .jg-v-item:hover {
            background: #1e293b !important;
            border-color: #38bdf8 !important;
            cursor: pointer !important;
        }

        /* 🖥️ [데스크톱 / 넓은 화면] 좌측(시계) - 가운데(뉴스) - 우측(날씨/증시/환율) 1줄 배치 */
        @media (min-width: 769px) {
            #jg-global-ticker-bar {
                flex-direction: row !important;
                justify-content: space-between !important;
                height: 44px !important;
            }
            .jg-ticker-meta-row {
                display: contents !important;
            }
            .jg-ticker-left {
                order: 1 !important;
                flex-shrink: 0 !important;
                margin-right: 14px !important;
                padding-right: 14px !important;
                border-right: 1px solid #1e293b !important;
                height: 28px !important;
            }
            .jg-ticker-news-row {
                order: 2 !important;
                flex: 1 !important;
                min-width: 0 !important;
                display: flex !important;
                align-items: center !important;
                height: 100% !important;
            }
            .jg-ticker-right {
                order: 3 !important;
                flex-shrink: 0 !important;
                margin-left: 14px !important;
                padding-left: 14px !important;
                border-left: 1px solid #1e293b !important;
                height: 28px !important;
            }
            .jg-badge-text-mobile { display: none !important; }
            .jg-badge-text-full { display: inline !important; }
        }

        /* 📱 [모바일 화면] 위(날짜/시간, 날씨/증시/환율) + 아래(뉴스) 2줄 레이아웃 (줄바꿈 원천 차단) */
        @media (max-width: 768px) {
            #jg-global-ticker-bar {
                height: 58px !important;
                flex-direction: column !important;
                padding: 4px 8px !important;
                justify-content: center !important;
                gap: 2px !important;
                overflow: hidden !important;
            }
            #jg-global-breaking-bar {
                bottom: 58px !important;
                height: 34px !important;
                padding: 0 8px !important;
                font-size: 11px !important;
                flex-wrap: nowrap !important;
                overflow: hidden !important;
            }
            /* 1행(위): 날짜/시간 (좌측) + 날씨/증시/환율 (우측) */
            .jg-ticker-meta-row {
                width: 100% !important;
                height: 25px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
                padding-bottom: 2px !important;
                flex-wrap: nowrap !important;
                overflow: hidden !important;
            }
            .jg-ticker-left {
                font-size: 10.5px !important;
                gap: 4px !important;
                flex: 1 !important;
                min-width: 0 !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }
            .jg-year-full {
                display: none !important; /* 모바일에서는 연도 생략하여 '10. 16. (금)'으로 컴팩트하게 노출 */
            }
            .jg-ticker-right {
                height: 22px !important;
                flex-shrink: 0 !important;
            }
            .jg-v-box {
                width: 142px !important;
                height: 22px !important;
            }
            .jg-v-item {
                font-size: 10px !important;
                gap: 4px !important;
                padding: 0 5px !important;
                border-radius: 4px !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }

            /* 2행(아래): 뉴스 뱃지 + 흐르는 뉴스 헤드라인 */
            .jg-ticker-news-row {
                width: 100% !important;
                height: 25px !important;
                display: flex !important;
                align-items: center !important;
                flex-wrap: nowrap !important;
                overflow: hidden !important;
            }
            .jg-ticker-badge {
                padding: 2px 5px !important;
                margin-right: 6px !important;
                font-size: 9.5px !important;
                border-radius: 4px !important;
                flex-shrink: 0 !important;
                white-space: nowrap !important;
            }
            .jg-badge-text-full { display: none !important; }
            .jg-badge-text-mobile { display: inline !important; }
            .jg-ticker-scroll-area {
                flex: 1 !important;
                min-width: 0 !important;
                overflow: hidden !important;
                white-space: nowrap !important;
            }
            .jg-ticker-track {
                white-space: nowrap !important;
            }
            .jg-ticker-link {
                font-size: 11px !important;
                margin-right: 14px !important;
                white-space: nowrap !important;
            }
            .jg-breaking-badge {
                font-size: 9.5px !important;
                padding: 2px 5px !important;
                margin-right: 6px !important;
            }
            .jg-breaking-actions {
                gap: 4px !important;
            }
            .jg-breaking-more {
                padding: 2px 5px !important;
                font-size: 9.5px !important;
            }
            .jg-breaking-close-btn {
                padding: 2px 5px !important;
                font-size: 9.5px !important;
            }
        }
    `;
    document.head.appendChild(style);

    // 3. 긴급 속보 상단 띠 DOM 생성
    let currentBreakingSignature = '';
    const breakingBar = document.createElement('div');
    breakingBar.id = 'jg-global-breaking-bar';
    breakingBar.innerHTML = `
        <div class="jg-breaking-badge">
            <span class="jg-ticker-dot" style="background:#b91c1c !important;"></span>
            <span>🚨 긴급 속보</span>
        </div>
        <div class="jg-ticker-scroll-area">
            <div id="jg-breaking-track" class="jg-breaking-track"></div>
        </div>
        <div class="jg-breaking-actions">
            <a href="https://j-jg.cc/go/news?path=/breaking" class="jg-breaking-more" title="실시간 속보 브리핑 바로가기">
                속보 브리핑 ❯
            </a>
            <button type="button" class="jg-breaking-close-btn" onclick="window.jgDismissBreaking()" title="속보 닫고 기존 뉴스만 보기">
                <span>✕</span> <span>닫기</span>
            </button>
        </div>
    `;

    // 4. 속보 닫기 전역 핸들러 (20분간 임시 닫기 유지)
    window.jgDismissBreaking = function() {
        breakingBar.classList.remove('jg-breaking-active');
        breakingBar.style.setProperty('display', 'none', 'important');
        updateBottomPadding(false);
        if (currentBreakingSignature) {
            try {
                sessionStorage.setItem('jg_dismissed_breaking_sig', currentBreakingSignature);
                sessionStorage.setItem('jg_dismissed_breaking_time', String(Date.now()));
            } catch (e) {}
        }
    };

    // 5. 기본 하단 티커 바 DOM 생성 (데스크톱: 좌측 시계 - 가운데 뉴스 - 우측 날씨/증시 / 모바일: 2줄)
    const tickerBar = document.createElement('div');
    tickerBar.id = 'jg-global-ticker-bar';
    tickerBar.innerHTML = `
        <div class="jg-ticker-meta-row">
            <div class="jg-ticker-left" id="jg-ticker-clock" title="현재 한국 표준시 (KST, 24시간제)">
                <span class="jg-clock-icon">🕒</span>
                <span class="jg-clock-date" id="jg-clock-date"><span class="jg-year-full">2026. </span>10. 16. (금)</span>
                <span class="jg-clock-time" id="jg-clock-time">12:00:00</span>
            </div>
            <div class="jg-ticker-right">
                <div class="jg-v-box" id="jg-v-box">
                    <div class="jg-v-item" style="transform: translateY(0); opacity: 1;">
                        <span>🌤️ 계룡</span> <span style="color:#38bdf8;">조회 중...</span>
                    </div>
                </div>
            </div>
        </div>
        <div class="jg-ticker-news-row">
            <div class="jg-ticker-badge">
                <span class="jg-ticker-dot"></span>
                <span class="jg-badge-text-full">뉴스룸</span>
                <span class="jg-badge-text-mobile" style="display:none;">뉴스</span>
            </div>
            <div class="jg-ticker-scroll-area">
                <div id="jg-track" class="jg-ticker-track">
                    <span class="jg-ticker-link">실시간 최신 뉴스를 준비 중입니다...</span>
                </div>
            </div>
        </div>
    `;

    // 5-1. 실시간 24시간 시계 갱신 함수 (초 단위 실시간 업데이트)
    function updateLiveClock() {
        const now = new Date();
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const date = String(now.getDate()).padStart(2, '0');
        const dayStr = days[now.getDay()];
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        const dateEl = document.getElementById('jg-clock-date');
        const timeEl = document.getElementById('jg-clock-time');
        if (dateEl) {
            dateEl.innerHTML = `<span class="jg-year-full">${year}. </span>${month}. ${date}. (${dayStr})`;
        }
        if (timeEl) {
            timeEl.textContent = `${hours}:${minutes}:${seconds}`;
        }
    }

    // 6. DOM 주입 및 데이터 조회 시작
    const injectBars = () => {
        if (document.body) {
            document.body.appendChild(breakingBar);
            document.body.appendChild(tickerBar);
            updateBottomPadding(currentHasBreaking);
            updateLiveClock();
            setInterval(updateLiveClock, 1000);

            // ⚡ [Instant SWR Render] 로컬 캐시가 있으면 0ms 즉각 렌더링 (체감 로딩 지연 원천 박멸)
            try {
                const cachedStr = localStorage.getItem('jg_cached_ticker');
                if (cachedStr) {
                    const cachedData = JSON.parse(cachedStr);
                    if (cachedData && cachedData.success) {
                        applyTickerData(cachedData);
                    }
                }
            } catch (e) {}

            // 백그라운드 최신 데이터 갱신
            fetchTickerData();
            // 45초 주기 자동 갱신
            setInterval(fetchTickerData, 45000);
        } else {
            window.addEventListener('DOMContentLoaded', injectBars);
        }
    };
    injectBars();

    // 7. 데이터 렌더링 코어 함수 (캐시 즉시 렌더링 & 백그라운드 갱신 공용)
    function applyTickerData(data) {
        if (!data || !data.success) return;

        // 7-1. 긴급 속보 처리 (자산관리, 캘린더 등 전 사이트 완전 지원)
        const breakingList = data.breakingArticles || [];
        const hasBreaking = breakingList.length > 0;
        const breakingTrack = document.getElementById('jg-breaking-track');

        if (hasBreaking && breakingTrack) {
            const newSig = breakingList.map(a => a.id).join(',');
            currentBreakingSignature = newSig;

            // 사용자가 닫은 속보인지 확인 (20분간만 임시 유지)
            let isDismissed = false;
            try {
                const dismissedSig = sessionStorage.getItem('jg_dismissed_breaking_sig') || '';
                const dismissedTime = parseInt(sessionStorage.getItem('jg_dismissed_breaking_time') || '0', 10);
                if (dismissedSig === newSig && (Date.now() - dismissedTime < 20 * 60 * 1000)) {
                    isDismissed = true;
                }
            } catch (e) {}

            if (isDismissed) {
                breakingBar.classList.remove('jg-breaking-active');
                breakingBar.style.setProperty('display', 'none', 'important');
                updateBottomPadding(false);
            } else {
                breakingBar.classList.add('jg-breaking-active');
                breakingBar.style.setProperty('display', 'flex', 'important');
                updateBottomPadding(true);

                const makeBreakingItems = () => breakingList.map(a => `
                    <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="jg-breaking-link">
                        <span style="background:#fee2e2; color:#991b1b; padding:1px 5px; border-radius:3px; font-weight:800; font-size:10px;">속보</span>
                        <span>${escapeHtml(a.title)}</span>
                        ${a.media_name ? `<span style="opacity:0.8; font-size:10px;">(${a.media_name})</span>` : ''}
                        <span style="opacity:0.5; margin: 0 4px;">•</span>
                    </a>
                `).join('');

                // 속보 건수가 적을 때(1~2건)도 화면이 비지 않도록 최소 6개 아이템 분량으로 1벌을 구성한 뒤 2벌 연결(-50% 무한 루프)
                const repeatCount = Math.max(1, Math.ceil(6 / breakingList.length));
                const singleSetHtml = Array(repeatCount).fill(makeBreakingItems()).join('');
                breakingTrack.innerHTML = singleSetHtml + singleSetHtml;
            }
        } else {
            breakingBar.classList.remove('jg-breaking-active');
            breakingBar.style.setProperty('display', 'none', 'important');
            updateBottomPadding(false);
        }

        // 7-2. 기본 뉴스 브리핑 헤드라인 처리
        const track = document.getElementById('jg-track');
        const articles = data.articles || [];

        if (track && articles.length > 0) {
            const makeItems = () => articles.map(a => `
                <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="jg-ticker-link">
                    <span class="jg-ticker-cat">${escapeHtml(a.category_name || '뉴스')}</span>
                    <span>${escapeHtml(a.title)}</span>
                    ${a.media_name ? `<span style="color:#64748b; font-size:10px;">(${a.media_name})</span>` : ''}
                    <span style="color:#475569; margin: 0 4px;">•</span>
                </a>
            `).join('');

            track.innerHTML = makeItems() + makeItems();
        }

        // 7-2b. 뉴스 기사 제목 이동 속도와 긴급 속보 이동 속도(px/sec) 100% 동기화
        requestAnimationFrame(() => {
            if (track && articles.length > 0) {
                const newsDistance = track.scrollWidth / 2;
                // 기본 뉴스 브리핑 이동 속도 기준 (85초 동안 newsDistance 이동, 기본 약 75px/sec)
                const speedPxPerSec = newsDistance > 0 ? (newsDistance / 85) : 75;
                track.style.setProperty('animation-duration', '85s', 'important');

                if (breakingTrack && hasBreaking) {
                    const breakingDistance = breakingTrack.scrollWidth / 2;
                    if (breakingDistance > 0 && speedPxPerSec > 0) {
                        const breakingDuration = Math.max(8, Math.round((breakingDistance / speedPxPerSec) * 10) / 10);
                        breakingTrack.style.setProperty('animation-duration', `${breakingDuration}s`, 'important');
                    }
                }
            }
        });

        // 7-3. 우측 날씨/증시 롤링 위젯 구성
        const vBox = document.getElementById('jg-v-box');
        if (vBox) {
            const weather = data.weather || { city: '계룡', temp: '-', condition: '맑음', icon: '🌤️' };
            const market = data.market || {};
            const kospi = market.kospi || { price: '2,600.0', direction: 'down' };
            const kosdaq = market.kosdaq || { price: '850.0', direction: 'down' };
            const usd = market.usd_krw || { price: '1,350.0', direction: 'up' };

            const cityName = (weather.city === 'Gyeryong' || !weather.city) ? '계룡' : weather.city;
            const usdPriceText = usd.price ? (String(usd.price).includes('원') ? String(usd.price) : `${usd.price}원`) : '-';

            const getBasmiliusSlug = (condition, isDay = 1) => {
                if (!condition) return isDay === 1 ? 'clear-day' : 'clear-night';
                const c = String(condition).trim();
                if (/뇌우|우박|천둥/.test(c)) return 'thunderstorms-rain';
                if (/진눈깨비/.test(c)) return 'sleet';
                if (/눈|싸락눈/.test(c)) return 'snow';
                if (/소나기/.test(c)) return isDay === 1 ? 'partly-cloudy-day-rain' : 'partly-cloudy-night-rain';
                if (/폭우|강한\s*비|비/.test(c)) return 'rain';
                if (/이슬비|약한\s*비/.test(c)) return 'drizzle';
                if (/안개/.test(c)) return 'fog';
                if (c === '흐림') return 'overcast';
                if (/구름\s*많음|구름\s*조금|대체로\s*흐림/.test(c)) return isDay === 1 ? 'partly-cloudy-day' : 'partly-cloudy-night';
                if (/맑음|대체로\s*맑음/.test(c)) return isDay === 1 ? 'clear-day' : 'clear-night';
                return isDay === 1 ? 'clear-day' : 'clear-night';
            };

            const weatherIsDay = weather.is_day !== undefined ? weather.is_day : 1;
            const weatherSlug = weather.icon_slug || getBasmiliusSlug(weather.condition, weatherIsDay);
            const weatherIconSvg = `<img src="https://cdn.jsdelivr.net/gh/basmilius/weather-icons@dev/production/fill/svg/${weatherSlug}.svg" alt="${weather.condition || '날씨'}" style="width:16px; height:16px; vertical-align:middle; display:inline-block; flex-shrink:0;" onerror="this.onerror=null; this.outerHTML='${weather.icon || '🌤️'}';">`;

            const weatherTitle = `실시간 날씨: ${cityName} ${weather.temp || ''} (${weather.condition || ''}) - 클릭 시 날씨 브리핑 이동`;
            const conditionBadge = weather.condition ? `<span style="color:#cbd5e1; font-size:10.5px; margin-left:3px; font-weight:500;">${weather.condition}</span>` : '';

            const kospiRatio = kospi.ratio && kospi.ratio !== '-' ? `<span style="font-size:10.5px; margin-left:3px;">${kospi.ratio}</span>` : '';
            const kosdaqRatio = kosdaq.ratio && kosdaq.ratio !== '-' ? `<span style="font-size:10.5px; margin-left:3px;">${kosdaq.ratio}</span>` : '';
            const usdRatio = usd.ratio && usd.ratio !== '-' ? `<span style="font-size:10.5px; margin-left:3px;">${usd.ratio}</span>` : '';

            const slides = [];

            // 1. 날씨 슬라이드 및 상단 내비게이션 날씨 배지 실시간 동기화
            if (weather && weather.temp && weather.temp !== '-') {
                const topCityEl = document.getElementById('welcomeWeatherCity');
                const topTempEl = document.getElementById('welcomeWeatherTemp');
                const topIconEl = document.getElementById('welcomeWeatherIcon');
                if (topCityEl) topCityEl.textContent = cityName;
                if (topTempEl) topTempEl.textContent = weather.temp;
                if (topIconEl && weatherSlug) {
                    topIconEl.innerHTML = `<img src="https://cdn.jsdelivr.net/gh/basmilius/weather-icons@dev/production/fill/svg/${weatherSlug}.svg" alt="${weather.condition || '날씨'}" style="width:18px; height:18px; vertical-align:middle; display:inline-block; flex-shrink:0;" onerror="this.onerror=null; this.outerHTML='${weather.icon || '🌤️'}';">`;
                }

                slides.push(
                    `<a href="https://j-jg.cc/go/news?path=/weather" class="jg-v-item" title="${weatherTitle}">
                        <span style="display:inline-flex; align-items:center; gap:4px;">${weatherIconSvg}<span>${cityName}</span></span>
                        <span style="color:#38bdf8; font-weight:700;">${weather.temp}</span>
                        ${conditionBadge}
                    </a>`
                );
            }

            // 2. 코스피 슬라이드
            if (kospi && kospi.price && kospi.price !== '-') {
                slides.push(
                    `<a href="https://j-jg.cc/go/news?path=/economy" class="jg-v-item" title="실시간 코스피 증시 브리핑 바로가기">
                        <span style="color:#94a3b8; font-size:10.5px; font-weight:700;">코스피</span>
                        <span style="color:#ffffff; font-weight:700; letter-spacing:-0.2px;">${kospi.price}</span>
                        <span style="color:${kospi.direction === 'up' ? '#f43f5e' : '#3b82f6'}; font-size:10.5px; font-weight:700; display:inline-flex; align-items:center;">${kospi.direction === 'up' ? '▲' : '▼'}${kospiRatio}</span>
                    </a>`
                );
            }

            // 3. 코스닥 슬라이드
            if (kosdaq && kosdaq.price && kosdaq.price !== '-') {
                slides.push(
                    `<a href="https://j-jg.cc/go/news?path=/economy" class="jg-v-item" title="실시간 코스닥 증시 브리핑 바로가기">
                        <span style="color:#94a3b8; font-size:10.5px; font-weight:700;">코스닥</span>
                        <span style="color:#ffffff; font-weight:700; letter-spacing:-0.2px;">${kosdaq.price}</span>
                        <span style="color:${kosdaq.direction === 'up' ? '#f43f5e' : '#3b82f6'}; font-size:10.5px; font-weight:700; display:inline-flex; align-items:center;">${kosdaq.direction === 'up' ? '▲' : '▼'}${kosdaqRatio}</span>
                    </a>`
                );
            }

            // 4. 달러 슬라이드
            if (usd && usd.price && usd.price !== '-' && !usdPriceText.includes('-')) {
                slides.push(
                    `<a href="https://j-jg.cc/go/news?path=/economy" class="jg-v-item" title="실시간 달러 환율 브리핑 바로가기 (USD/KRW)">
                        <span style="color:#94a3b8; font-size:10.5px; font-weight:700;">달러</span>
                        <span style="color:#ffffff; font-weight:700; letter-spacing:-0.2px;">${usdPriceText}</span>
                        <span style="color:${usd.direction === 'up' ? '#f43f5e' : '#3b82f6'}; font-size:10.5px; font-weight:700; display:inline-flex; align-items:center;">${usd.direction === 'up' ? '▲' : '▼'}${usdRatio}</span>
                    </a>`
                );
            }

            // 5. 엔화 슬라이드
            if (market.jpy_krw && market.jpy_krw.price && market.jpy_krw.price !== '-') {
                const jpy = market.jpy_krw;
                const jpyRatio = jpy.ratio && jpy.ratio !== '-' ? `<span style="font-size:10.5px; margin-left:3px;">${jpy.ratio}</span>` : '';
                slides.push(
                    `<a href="https://j-jg.cc/go/news?path=/economy" class="jg-v-item" title="실시간 엔화 환율 브리핑 바로가기 (JPY/KRW)">
                        <span style="color:#94a3b8; font-size:10.5px; font-weight:700;">100엔</span>
                        <span style="color:#ffffff; font-weight:700; letter-spacing:-0.2px;">${jpy.price}</span>
                        <span style="color:${jpy.direction === 'up' ? '#f43f5e' : '#3b82f6'}; font-size:10.5px; font-weight:700; display:inline-flex; align-items:center;">${jpy.direction === 'up' ? '▲' : '▼'}${jpyRatio}</span>
                    </a>`
                );
            }

            if (slides.length > 0) {
                vBox.innerHTML = slides.join('');
                startVerticalRolling(vBox);
            }
        }
    }

    // 8. 데이터 백그라운드 비동기 페칭 함수
    async function fetchTickerData() {
        try {
            const isLocal = window.location.hostname === 'localhost';
            const cacheBucket = Math.floor(Date.now() / 15000);
            const apiUrl = (isLocal ? '/api/ticker' : 'https://j-jg.cc/api/ticker') + '?_t=' + cacheBucket;
            const res = await fetch(apiUrl);
            if (!res.ok) throw new Error('API 응답 에러');
            const data = await res.json();
            if (!data.success) return;

            // 로컬 스토리지에 캐시 보관 (다음 방문/새로고침 시 0ms 즉시 표시)
            try {
                localStorage.setItem('jg_cached_ticker', JSON.stringify(data));
            } catch (e) {}

            applyTickerData(data);
        } catch (e) {
            console.warn('[Ticker] 데이터 페치 경고:', e);
            // 만약 캐시도 없고 첫 로드 실패인 경우에만 안내 표시
            const track = document.getElementById('jg-track');
            if (track && track.textContent.includes('준비 중')) {
                track.innerHTML = '<span class="jg-ticker-link" style="color:#94a3b8;">실시간 최신 뉴스를 불러오는 중입니다...</span>';
            }
        }
    }

    // 8. 우측 위젯 3.5초 수직 롤링 타이머
    let rollingTimer = null;
    function startVerticalRolling(container) {
        if (rollingTimer) clearInterval(rollingTimer);
        const items = container.querySelectorAll('.jg-v-item');
        if (items.length <= 1) return;

        let curIdx = 0;
        items.forEach((item, i) => {
            if (i === 0) {
                item.style.transform = 'translateY(0%)';
                item.style.opacity = '1';
                item.style.pointerEvents = 'auto';
            } else {
                item.style.transform = 'translateY(100%)';
                item.style.opacity = '0';
                item.style.pointerEvents = 'none';
            }
        });

        rollingTimer = setInterval(() => {
            const prev = items[curIdx];
            curIdx = (curIdx + 1) % items.length;
            const next = items[curIdx];

            prev.style.transition = 'transform 0.45s ease-in-out, opacity 0.45s ease-in-out';
            prev.style.transform = 'translateY(-100%)';
            prev.style.opacity = '0';
            prev.style.pointerEvents = 'none';

            next.style.transition = 'none';
            next.style.transform = 'translateY(100%)';
            next.style.opacity = '0';
            void next.offsetHeight; // Reflow

            next.style.transition = 'transform 0.45s ease-in-out, opacity 0.45s ease-in-out';
            next.style.transform = 'translateY(0%)';
            next.style.opacity = '1';
            next.style.pointerEvents = 'auto';

            setTimeout(() => {
                prev.style.transition = 'none';
                prev.style.transform = 'translateY(100%)';
            }, 460);
        }, 3500);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
})();
