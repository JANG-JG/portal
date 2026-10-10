/**
 * news-ticker.js - JG 통합 포털 및 모든 서브 서비스(뉴스, 자산, 혈압) 공통 하단바 & 긴급 속보 위젯
 * 모든 사이트에서 <script src="https://j-jg.cc/js/news-ticker.js?v=20261011_v3"></script> 한 줄로 구동됩니다.
 * - 기본 하단바: 최신 뉴스 브리핑 헤드라인 및 우측 날씨/증시 실시간 롤링 (모든 사이트 상시 노출)
 * - 긴급 속보 바: 실시간 속보 발생 시 기본 하단바 바로 '위에' 빨간색 긴급 속보 띠가 새로 나타남
 * - 속보 닫기: 사용자가 속보를 확인한 후 [✕ 닫기]를 누르면 속보 바가 닫히고 기존 뉴스만 깔끔하게 표시됨
 */
(function() {
    // 중복 실행 방지
    if (document.getElementById('jg-global-ticker-bar')) return;

    // 1. 하단 여백 동적 적용 (속보 여부에 따라 48px 또는 82px)
    function updateBottomPadding(hasBreaking) {
        const pad = hasBreaking ? '82px' : '48px';
        if (document.body) {
            document.body.style.paddingBottom = pad;
        } else {
            window.addEventListener('DOMContentLoaded', () => updateBottomPadding(hasBreaking));
        }
    }
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
            z-index: 999998 !important;
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

        /* 📰 기본 하단 뉴스 브리핑 바 (모든 사이트 상시 노출) */
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
        .jg-ticker-right {
            flex-shrink: 0 !important;
            margin-left: 10px !important;
            padding-left: 10px !important;
            border-left: 1px solid #1e293b !important;
            height: 30px !important;
            display: flex !important;
            align-items: center !important;
        }
        .jg-v-box {
            position: relative !important;
            height: 30px !important;
            width: 135px !important;
            overflow: hidden !important;
        }
        .jg-v-item {
            position: absolute !important;
            inset: 0 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 5px !important;
            background: #0f172a !important;
            border: 1px solid #1e293b !important;
            border-radius: 6px !important;
            color: #cbd5e1 !important;
            font-size: 11px !important;
            font-weight: 600 !important;
            transition: transform 0.4s ease-in-out, opacity 0.4s ease-in-out !important;
            text-decoration: none !important;
        }
        @media (max-width: 640px) {
            #jg-global-ticker-bar {
                padding: 0 6px !important;
                height: 42px !important;
            }
            #jg-global-breaking-bar {
                bottom: 42px !important;
                height: 34px !important;
                padding: 0 6px !important;
                font-size: 11px !important;
            }
            .jg-ticker-badge {
                padding: 2.5px 6px !important;
                margin-right: 6px !important;
                font-size: 10px !important;
            }
            .jg-badge-text-full { display: none !important; }
            .jg-badge-text-mobile { display: inline !important; }
            .jg-ticker-right {
                margin-left: 6px !important;
                padding-left: 6px !important;
                height: 26px !important;
            }
            .jg-v-box {
                width: 100px !important;
                height: 26px !important;
            }
            .jg-v-item {
                font-size: 10px !important;
                gap: 2px !important;
                padding: 0 3px !important;
            }
            .jg-ticker-link {
                font-size: 11px !important;
                margin-right: 14px !important;
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
            <a href="https://news.j-jg.cc/breaking" class="jg-breaking-more" title="실시간 속보 브리핑 바로가기">
                속보 브리핑 ❯
            </a>
            <button type="button" class="jg-breaking-close-btn" onclick="window.jgDismissBreaking()" title="속보 닫고 기존 뉴스만 보기">
                <span>✕</span> <span>닫기</span>
            </button>
        </div>
    `;

    // 4. 속보 닫기 전역 핸들러
    window.jgDismissBreaking = function() {
        breakingBar.style.display = 'none';
        updateBottomPadding(false);
        if (currentBreakingSignature) {
            try {
                sessionStorage.setItem('jg_dismissed_breaking_sig', currentBreakingSignature);
            } catch (e) {}
        }
    };

    // 5. 기본 하단 티커 바 DOM 생성
    const tickerBar = document.createElement('div');
    tickerBar.id = 'jg-global-ticker-bar';
    tickerBar.innerHTML = `
        <div class="jg-ticker-badge">
            <span class="jg-ticker-dot"></span>
            <span class="jg-badge-text-full">뉴스 브리핑</span>
            <span class="jg-badge-text-mobile" style="display:none;">뉴스</span>
        </div>
        <div class="jg-ticker-scroll-area">
            <div id="jg-track" class="jg-ticker-track">
                <span class="jg-ticker-link">최신 뉴스 브리핑 헤드라인 로드 중...</span>
            </div>
        </div>
        <div class="jg-ticker-right">
            <div class="jg-v-box" id="jg-v-box">
                <div class="jg-v-item" style="transform: translateY(0); opacity: 1;">
                    <span>☀️ 계룡</span> <span style="color:#38bdf8;">22°C</span>
                </div>
            </div>
        </div>
    `;

    // 6. DOM 주입 및 데이터 조회 시작
    const injectBars = () => {
        if (document.body) {
            document.body.appendChild(breakingBar);
            document.body.appendChild(tickerBar);
            fetchTickerData();
            // 45초 주기 갱신
            setInterval(fetchTickerData, 45000);
        } else {
            window.addEventListener('DOMContentLoaded', injectBars);
        }
    };
    injectBars();

    // 7. 데이터 바인딩
    async function fetchTickerData() {
        try {
            const isLocal = window.location.hostname === 'localhost';
            const apiUrl = (isLocal ? '/api/ticker' : 'https://j-jg.cc/api/ticker') + '?_t=' + Date.now();
            const res = await fetch(apiUrl);
            if (!res.ok) throw new Error('API 응답 에러');
            const data = await res.json();
            if (!data.success) return;

            // 7-1. 긴급 속보 처리
            const breakingList = data.breakingArticles || [];
            const hasBreaking = breakingList.length > 0;
            const breakingTrack = document.getElementById('jg-breaking-track');

            if (hasBreaking && breakingTrack) {
                // 속보 고유 식별값 (기사 id 목록)
                const newSig = breakingList.map(a => a.id).join(',');
                currentBreakingSignature = newSig;

                // 사용자가 닫은 속보인지 확인
                let dismissedSig = '';
                try {
                    dismissedSig = sessionStorage.getItem('jg_dismissed_breaking_sig') || '';
                } catch (e) {}

                if (dismissedSig === newSig) {
                    // 사용자가 이미 닫은 속보이므로 숨김 유지
                    breakingBar.style.display = 'none';
                    updateBottomPadding(false);
                } else {
                    // 새 속보이거나 닫지 않은 상태이면 노출
                    breakingBar.style.display = 'flex';
                    updateBottomPadding(true);

                    const makeBreakingItems = () => breakingList.map(a => `
                        <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="jg-breaking-link">
                            <span style="background:#fee2e2; color:#991b1b; padding:1px 5px; border-radius:3px; font-weight:800; font-size:10px;">속보</span>
                            <span>${escapeHtml(a.title)}</span>
                            ${a.media_name ? `<span style="opacity:0.8; font-size:10px;">(${a.media_name})</span>` : ''}
                            <span style="opacity:0.5; margin: 0 4px;">•</span>
                        </a>
                    `).join('');

                    breakingTrack.innerHTML = makeBreakingItems() + makeBreakingItems();
                }
            } else {
                breakingBar.style.display = 'none';
                updateBottomPadding(false);
            }

            // 7-2. 기본 뉴스 브리핑 헤드라인 처리 (모든 사이트 공통 상시 노출)
            const track = document.getElementById('jg-track');
            const articles = data.articles || [];

            if (track) {
                if (articles.length > 0) {
                    const makeItems = () => articles.map(a => `
                        <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="jg-ticker-link">
                            <span class="jg-ticker-cat">${escapeHtml(a.category_name || '뉴스')}</span>
                            <span>${escapeHtml(a.title)}</span>
                            ${a.media_name ? `<span style="color:#64748b; font-size:10px;">(${a.media_name})</span>` : ''}
                            <span style="color:#475569; margin: 0 4px;">•</span>
                        </a>
                    `).join('');

                    track.innerHTML = makeItems() + makeItems();
                } else {
                    track.innerHTML = '<span class="jg-ticker-link" style="color:#94a3b8;">최신 뉴스 브리핑을 준비 중입니다.</span>';
                }
            }

            // 7-3. 우측 날씨/증시 롤링 위젯 구성
            const vBox = document.getElementById('jg-v-box');
            if (vBox) {
                const weather = data.weather || { city: '계룡', temp: '22°C', icon: '☀️' };
                const market = data.market || {};
                const kospi = market.kospi || { price: '2,600.0', direction: 'down' };
                const kosdaq = market.kosdaq || { price: '850.0', direction: 'down' };
                const usd = market.usd_krw || { price: '1,350.0', direction: 'up' };

                const cityName = (weather.city === 'Gyeryong' || !weather.city) ? '계룡' : weather.city;
                const usdPriceText = usd.price ? (String(usd.price).includes('원') ? String(usd.price) : `${usd.price}원`) : '-';

                const slides = [
                    `<a href="https://news.j-jg.cc/weather" class="jg-v-item" title="실시간 날씨 상세 보기">
                        <span>${weather.icon || '☀️'} ${cityName}</span>
                        <span style="color:#38bdf8; font-weight:700;">${weather.temp || '-'}</span>
                    </a>`,
                    `<div class="jg-v-item">
                        <span style="color:#94a3b8; font-size:10px;">코스피</span>
                        <span style="color:#ffffff;">${kospi.price}</span>
                        <span style="color:${kospi.direction === 'up' ? '#f43f5e' : '#3b82f6'}; font-size:10px;">${kospi.direction === 'up' ? '▲' : '▼'}</span>
                    </div>`,
                    `<div class="jg-v-item">
                        <span style="color:#94a3b8; font-size:10px;">코스닥</span>
                        <span style="color:#ffffff;">${kosdaq.price}</span>
                        <span style="color:${kosdaq.direction === 'up' ? '#f43f5e' : '#3b82f6'}; font-size:10px;">${kosdaq.direction === 'up' ? '▲' : '▼'}</span>
                    </div>`,
                    `<div class="jg-v-item">
                        <span style="color:#94a3b8; font-size:10px;">달러</span>
                        <span style="color:#ffffff;">${usdPriceText}</span>
                        <span style="color:${usd.direction === 'up' ? '#f43f5e' : '#3b82f6'}; font-size:10px;">${usd.direction === 'up' ? '▲' : '▼'}</span>
                    </div>`
                ];

                vBox.innerHTML = slides.join('');
                startVerticalRolling(vBox);
            }
        } catch (e) {
            console.warn('[Ticker] 데이터 로드 실패:', e);
            const track = document.getElementById('jg-track');
            if (track && track.textContent.includes('로드 중')) {
                track.innerHTML = '<span class="jg-ticker-link" style="color:#94a3b8;">실시간 뉴스 브리핑을 불러오는 중입니다...</span>';
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
