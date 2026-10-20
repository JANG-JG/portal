/**
 * 📰 JG 포털 전용 하단 실시간 뉴스/속보 티커 바 (portal-bottom-news.js)
 * - 외부 의존성(jg-ui, unified-nav) 없이 완전히 독립 동작하는 전용 하단 바
 * - 24시간 실시간 시계 + 뉴스 헤드라인 롤링 + 날씨/증시 지표 + 긴급 속보 띠
 * - 모듈화 표준 (500줄 이하) 준수
 */
(function() {
    'use strict';
    if (document.getElementById('jg-global-ticker-bar')) return;

    let currentHasBreaking = false;
    let articlesList = [];
    let currentArticleIndex = 0;
    let tickerRollTimer = null;
    let breakingRollTimer = null;
    let breakingList = [];
    let currentBreakingIndex = 0;

    // 1. 하단 여백 자동 확보
    function updateBottomPadding(hasBreaking) {
        currentHasBreaking = !!hasBreaking;
        const isMobile = window.innerWidth <= 768;
        const tickerHeight = isMobile ? 54 : 42;
        const breakingHeight = currentHasBreaking ? (isMobile ? 32 : 34) : 0;
        const totalHeight = tickerHeight + breakingHeight;

        const tickerBar = document.getElementById('jg-global-ticker-bar');
        if (tickerBar) {
            tickerBar.style.setProperty('bottom', '0px', 'important');
        }

        const breakingBar = document.getElementById('jg-global-breaking-bar');
        if (breakingBar) {
            breakingBar.style.setProperty('bottom', tickerHeight + 'px', 'important');
        }

        if (document.body) {
            document.body.style.paddingBottom = (totalHeight + 8) + 'px';
        }
    }
    window.addEventListener('resize', () => updateBottomPadding(currentHasBreaking));

    // 2. 다크 테마 인라인 스타일 주입
    const style = document.createElement('style');
    style.textContent = `
        /* 🚨 긴급 속보 바 (하단 티커 바로 위에 밀착) */
        #jg-global-breaking-bar {
            position: fixed !important; bottom: 42px !important; left: 0 !important; right: 0 !important;
            height: 34px !important; background: #450a0a !important; border-top: 1px solid #7f1d1d !important;
            color: #fecaca !important; z-index: 99998 !important; display: none; align-items: center !important;
            padding: 0 12px !important; box-sizing: border-box !important; font-size: 12px !important;
        }
        #jg-global-breaking-bar.active { display: flex !important; }
        .jg-breaking-badge {
            display: inline-flex !important; align-items: center !important; gap: 5px !important;
            background: #991b1b !important; color: #ffffff !important; padding: 2px 7px !important;
            border-radius: 4px !important; font-weight: 700 !important; font-size: 11px !important;
            flex-shrink: 0 !important; margin-right: 10px !important;
        }
        .jg-breaking-pulse {
            width: 6px !important; height: 6px !important; background: #f87171 !important;
            border-radius: 50% !important; animation: jgBreakingPulse 1.2s infinite ease-in-out !important;
        }
        @keyframes jgBreakingPulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.3; transform: scale(1.4); }
        }
        .jg-breaking-content {
            flex: 1 !important; overflow: hidden !important; white-space: nowrap !important;
            text-overflow: ellipsis !important; text-decoration: none !important;
            color: #ffffff !important; font-weight: 600 !important; text-align: left !important;
        }
        .jg-breaking-close {
            background: transparent !important; border: none !important; color: #fca5a5 !important;
            cursor: pointer !important; padding: 2px 6px !important; font-size: 13px !important; margin-left: 8px !important;
        }

        /* 📰 기본 하단 티커 바 */
        #jg-global-ticker-bar {
            position: fixed !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            height: 42px !important;
            background: #09090b !important;
            border-top: 1px solid #27272a !important;
            color: #f4f4f5 !important;
            z-index: 99997 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 0 14px !important;
            box-sizing: border-box !important;
            font-family: inherit !important;
            font-size: 12px !important;
            user-select: none !important;
        }
        .jg-ticker-left {
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            color: #a1a1aa !important;
            font-size: 11.5px !important;
            font-weight: 600 !important;
            white-space: nowrap !important;
            flex-shrink: 0 !important;
            font-variant-numeric: tabular-nums !important;
        }
        .jg-ticker-center {
            flex: 1 !important;
            height: 24px !important;
            line-height: 24px !important;
            overflow: hidden !important;
            margin: 0 14px !important;
            position: relative !important;
        }
        .jg-ticker-track {
            display: flex !important;
            align-items: center !important;
            height: 24px !important;
            overflow: hidden !important;
        }
        .jg-ticker-item {
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            color: #f4f4f5 !important;
            text-decoration: none !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            font-size: 12.5px !important;
            transition: color 0.15s ease !important;
        }
        .jg-ticker-item:hover {
            color: #60a5fa !important;
        }
        .jg-ticker-cat {
            background: #18181b !important;
            border: 1px solid #27272a !important;
            color: #a1a1aa !important;
            font-size: 10px !important;
            font-weight: 700 !important;
            padding: 1px 5px !important;
            border-radius: 3px !important;
            flex-shrink: 0 !important;
        }
        .jg-ticker-right {
            display: flex !important;
            align-items: center !important;
            gap: 10px !important;
            flex-shrink: 0 !important;
            font-size: 11.5px !important;
            color: #a1a1aa !important;
        }
        .jg-ticker-meta-item {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
            color: #a1a1aa !important;
            text-decoration: none !important;
            font-variant-numeric: tabular-nums !important;
        }
        .jg-ticker-meta-item:hover {
            color: #f4f4f5 !important;
        }
        .jg-ticker-val-up { color: #f43f5e !important; }
        .jg-ticker-val-down { color: #3b82f6 !important; }

        @media (min-width: 769px) {
            #jg-global-ticker-bar {
                flex-direction: row !important;
                justify-content: space-between !important;
                height: 42px !important;
            }
            .jg-ticker-meta-row {
                display: contents !important;
            }
            .jg-ticker-left {
                order: 1 !important;
                flex-shrink: 0 !important;
                margin-right: 14px !important;
                padding-right: 14px !important;
                border-right: 1px solid #27272a !important;
                height: 26px !important;
            }
            .jg-ticker-center {
                order: 2 !important;
                flex: 1 !important;
                min-width: 0 !important;
                margin: 0 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: flex-start !important;
                text-align: left !important;
            }
            .jg-ticker-track {
                width: 100% !important;
                display: flex !important;
                align-items: center !important;
                justify-content: flex-start !important;
                text-align: left !important;
            }
            .jg-ticker-item {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: flex-start !important;
                text-align: left !important;
                max-width: 100% !important;
            }
            .jg-ticker-title {
                text-align: left !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
            }
            .jg-ticker-right {
                order: 3 !important;
                flex-shrink: 0 !important;
                margin-left: 14px !important;
                padding-left: 14px !important;
                border-left: 1px solid #27272a !important;
                display: flex !important;
                height: 26px !important;
            }
        }

        @media (max-width: 768px) {
            #jg-global-ticker-bar {
                height: 54px !important;
                flex-direction: column !important;
                justify-content: center !important;
                padding: 4px 10px !important;
                gap: 2px !important;
            }
            .jg-ticker-meta-row {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                width: 100% !important;
            }
            .jg-ticker-left {
                font-size: 10.5px !important;
            }
            .jg-ticker-right {
                display: flex !important;
                font-size: 10.5px !important;
                gap: 8px !important;
            }
            .jg-ticker-center {
                width: 100% !important;
                margin: 0 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: flex-start !important;
                text-align: left !important;
            }
            .jg-ticker-track {
                width: 100% !important;
                display: flex !important;
                align-items: center !important;
                justify-content: flex-start !important;
                text-align: left !important;
            }
            .jg-ticker-item {
                width: 100% !important;
                display: flex !important;
                align-items: center !important;
                justify-content: flex-start !important;
                text-align: left !important;
            }
            .jg-ticker-title {
                text-align: left !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
            }
        }
    `;
    document.head.appendChild(style);

    // 3. 긴급 속보 바 생성
    const breakingBar = document.createElement('div');
    breakingBar.id = 'jg-global-breaking-bar';
    breakingBar.innerHTML = `
        <div class="jg-breaking-badge">
            <span class="jg-breaking-pulse"></span>
            <span>🚨 속보</span>
        </div>
        <a href="https://news.j-jg.cc/breaking" target="_blank" rel="noopener" class="jg-breaking-content" id="jgBreakingText">
            실시간 속보를 확인하는 중...
        </a>
        <button type="button" class="jg-breaking-close" id="jgBreakingCloseBtn" title="속보 닫기">✕</button>
    `;

    // 4. 기본 하단 티커 바 생성
    const tickerBar = document.createElement('div');
    tickerBar.id = 'jg-global-ticker-bar';
    tickerBar.innerHTML = `
        <div class="jg-ticker-meta-row">
            <div class="jg-ticker-left">
                <span>🕒</span>
                <span id="jgClockDate">-</span>
                <span id="jgClockTime" style="color:#ffffff; font-weight:700;">-</span>
            </div>
            <div class="jg-ticker-right" id="jgTickerRight">
                <a href="https://news.j-jg.cc/weather" target="_blank" rel="noopener" class="jg-ticker-meta-item" id="jgTickerWeather">
                    <span id="jgWeatherIcon">🌤️</span>
                    <span id="jgWeatherTemp">-</span>
                </a>
                <span style="color:#3f3f46;">|</span>
                <a href="/go/economy" class="jg-ticker-meta-item" id="jgTickerMarket">
                    <span id="jgMarketLabel">증시</span>
                    <span id="jgMarketVal">-</span>
                </a>
            </div>
        </div>
        <div class="jg-ticker-center">
            <div class="jg-ticker-track" id="jgTickerTrack">
                <a href="/go/news" class="jg-ticker-item">
                    <span class="jg-ticker-cat">뉴스</span>
                    <span class="jg-ticker-title">최신 뉴스 브리핑을 준비 중입니다...</span>
                </a>
            </div>
        </div>
    `;

    // 5. 실시간 시계 (1초 단위 갱신)
    function updateClock() {
        const now = new Date();
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const dayStr = days[now.getDay()];
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');

        const dateEl = document.getElementById('jgClockDate');
        const timeEl = document.getElementById('jgClockTime');
        if (dateEl) dateEl.textContent = `${m}.${d}(${dayStr})`;
        if (timeEl) timeEl.textContent = `${hh}:${mm}:${ss}`;
    }

    // 6. 데이터 페칭 및 렌더링
    async function fetchTicker() {
        try {
            const res = await fetch('/api/ticker?_t=' + Math.floor(Date.now() / 30000));
            if (!res.ok) return;
            const data = await res.json();
            if (!data.success) return;

            // 로컬 캐시 저장
            try { localStorage.setItem('jg_cached_bottom_ticker', JSON.stringify(data)); } catch (e) {}

            renderTickerData(data);
        } catch (e) {
            console.error('[BottomNews] 페칭 에러:', e);
        }
    }

    function renderTickerData(data) {
        // 날씨
        if (data.weather) {
            const iconEl = document.getElementById('jgWeatherIcon');
            const tempEl = document.getElementById('jgWeatherTemp');
            if (iconEl && data.weather.icon) iconEl.textContent = data.weather.icon;
            if (tempEl && data.weather.temp) tempEl.textContent = data.weather.temp;
        }

        // 시장 지표 (코스피 / 코스닥 / 환율 순환)
        if (data.market) {
            const mLabel = document.getElementById('jgMarketLabel');
            const mVal = document.getElementById('jgMarketVal');
            const mItem = data.market.kospi || data.market.usd_krw;
            if (mLabel && mItem) mLabel.textContent = mItem.name || '코스피';
            if (mVal && mItem) {
                mVal.textContent = `${mItem.price} (${mItem.ratio})`;
                mVal.className = (mItem.direction === 'up' || (mItem.ratio && mItem.ratio.startsWith('+')))
                    ? 'jg-ticker-val-up' : 'jg-ticker-val-down';
            }
        }

        // 기사 목록
        if (data.articles && data.articles.length > 0) {
            articlesList = data.articles;
            startArticleRolling();
        }

        // 긴급 속보
        if (data.breakingArticles && data.breakingArticles.length > 0) {
            breakingList = data.breakingArticles;
            startBreakingRolling();
        } else {
            breakingBar.classList.remove('active');
            updateBottomPadding(false);
        }
    }

    // 뉴스 롤링 (4초 간격)
    function startArticleRolling() {
        if (tickerRollTimer) clearInterval(tickerRollTimer);
        const track = document.getElementById('jgTickerTrack');
        if (!track || articlesList.length === 0) return;

        const showArticle = () => {
            const art = articlesList[currentArticleIndex];
            if (!art) return;
            const cat = art.category_name || '종합';
            track.innerHTML = `
                <a href="${art.link || '/go/news'}" target="_blank" rel="noopener" class="jg-ticker-item">
                    <span class="jg-ticker-cat">${cat}</span>
                    <span class="jg-ticker-title">${art.title || ''}</span>
                </a>
            `;
            currentArticleIndex = (currentArticleIndex + 1) % articlesList.length;
        };

        showArticle();
        tickerRollTimer = setInterval(showArticle, 4500);
    }

    // 속보 롤링 (5초 간격)
    function startBreakingRolling() {
        if (breakingRollTimer) clearInterval(breakingRollTimer);
        const textEl = document.getElementById('jgBreakingText');
        if (!textEl || breakingList.length === 0) return;

        breakingBar.classList.add('active');
        updateBottomPadding(true);

        const showBreaking = () => {
            const b = breakingList[currentBreakingIndex];
            if (!b) return;
            textEl.textContent = b.title || '';
            textEl.href = b.link || 'https://news.j-jg.cc/breaking';
            currentBreakingIndex = (currentBreakingIndex + 1) % breakingList.length;
        };

        showBreaking();
        breakingRollTimer = setInterval(showBreaking, 5000);
    }

    // 속보 닫기 버튼
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'jgBreakingCloseBtn') {
            breakingBar.classList.remove('active');
            updateBottomPadding(false);
            if (breakingRollTimer) clearInterval(breakingRollTimer);
        }
    });

    // 7. 마운트
    const mount = () => {
        if (document.body) {
            document.body.appendChild(breakingBar);
            document.body.appendChild(tickerBar);
            updateBottomPadding(false);
            updateClock();
            setInterval(updateClock, 1000);

            // 캐시 즉시 렌더링
            try {
                const cached = localStorage.getItem('jg_cached_bottom_ticker');
                if (cached) renderTickerData(JSON.parse(cached));
            } catch (e) {}

            fetchTicker();
            setInterval(fetchTicker, 45000);
        } else {
            window.addEventListener('DOMContentLoaded', mount);
        }
    };
    mount();
})();
