/**
 * 📰 JG 포털 전용 하단 실시간 뉴스/속보 티커 바 (portal-bottom-news.js)
 * - 좌측: 24시간 실시간 시계 (KST)
 * - 중앙: 전체 뉴스 기사 좌측 연속 롤링 (Marquee 무한 스크롤, 호버 시 일시정지)
 * - 우측: 날씨 · 코스피 · 코스닥 · 환율 실시간 수직 롤링 (위로 스크롤)
 * - 상단 띠: 실시간 긴급 속보 발생 시 즉시 활성화
 * - 규칙 준수: 500줄 이하 모듈화 & 100% 한국어 친화적 인터페이스
 */
(function() {
    'use strict';
    if (document.getElementById('jg-global-ticker-bar')) return;

    let currentHasBreaking = false;
    let vRollingTimer = null;

    // 1. 하단 바 여백 동적 계산
    function updateBottomPadding(hasBreaking) {
        currentHasBreaking = !!hasBreaking;
        const isMobile = window.innerWidth <= 768;
        const tickerHeight = isMobile ? 56 : 42;
        const breakingHeight = currentHasBreaking ? (isMobile ? 34 : 36) : 0;
        const totalHeight = tickerHeight + breakingHeight;

        const tickerBar = document.getElementById('jg-global-ticker-bar');
        if (tickerBar) tickerBar.style.setProperty('bottom', '0px', 'important');

        const breakingBar = document.getElementById('jg-global-breaking-bar');
        if (breakingBar) breakingBar.style.setProperty('bottom', tickerHeight + 'px', 'important');

        if (document.body) {
            document.body.style.paddingBottom = (totalHeight + 8) + 'px';
        }
    }
    window.addEventListener('resize', () => updateBottomPadding(currentHasBreaking));

    // 2. 다크 테마 전용 스타일시트 주입
    if (!document.getElementById('jg-bottom-news-style')) {
        const link = document.createElement('link');
        link.id = 'jg-bottom-news-style';
        link.rel = 'stylesheet';
        link.href = '/css/portal-bottom-news.css';
        document.head.appendChild(link);
    }

    // 3. 긴급 속보 바 생성
    const breakingBar = document.createElement('div');
    breakingBar.id = 'jg-global-breaking-bar';
    breakingBar.innerHTML = `
        <div class="jg-brk-badge">
            <span class="jg-t-pulse" style="background:#b91c1c !important;"></span>
            <span>🚨 속보</span>
        </div>
        <div class="jg-brk-scroll-area">
            <div id="jgBrkTrack" class="jg-brk-track"></div>
        </div>
        <button type="button" class="jg-brk-close" id="jgBrkCloseBtn" title="속보 닫기">✕ 닫기</button>
    `;

    // 4. 기본 하단 티커 바 생성
    const tickerBar = document.createElement('div');
    tickerBar.id = 'jg-global-ticker-bar';
    tickerBar.innerHTML = `
        <div class="jg-t-meta-row">
            <div class="jg-t-left" title="현재 한국 표준시">
                <span>🕒</span>
                <span id="jgClockDate">-</span>
                <span id="jgClockTime" class="jg-t-time">-</span>
            </div>
            <div class="jg-t-right">
                <div class="jg-v-box" id="jgVBox">
                    <div class="jg-v-item" style="transform:translateY(0%); opacity:1;">
                        <span>🌤️ 계룡</span> <span style="color:#38bdf8;">조회 중...</span>
                    </div>
                </div>
            </div>
        </div>
        <div class="jg-t-center">
            <div class="jg-t-badge">
                <span class="jg-t-pulse"></span>
                <span class="jg-badge-full">뉴스룸</span>
                <span class="jg-badge-mobile">뉴스</span>
            </div>
            <div class="jg-t-scroll-area">
                <div id="jgNewsTrack" class="jg-t-track">
                    <span class="jg-t-link">실시간 최신 뉴스를 준비 중입니다...</span>
                </div>
            </div>
        </div>
    `;

    // 5. 실시간 시계 업데이트 (초 단위)
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

    // 6. 데이터 렌더링 코어
    function renderTickerData(data) {
        if (!data || !data.success) return;

        // 6-1. 긴급 속보 처리 (좌측 연속 스크롤)
        const breakingList = data.breakingArticles || [];
        const brkTrack = document.getElementById('jgBrkTrack');
        if (breakingList.length > 0 && brkTrack) {
            breakingBar.classList.add('jg-breaking-active');
            updateBottomPadding(true);

            const makeBrkItems = () => breakingList.map(a => `
                <a href="${a.link || 'https://news.j-jg.cc/breaking'}" target="_blank" rel="noopener" class="jg-brk-link">
                    <span style="background:#fee2e2; color:#991b1b; padding:1px 5px; border-radius:3px; font-weight:800; font-size:10px;">속보</span>
                    <span>${escapeHtml(a.title)}</span>
                    ${a.media_name ? `<span style="opacity:0.8; font-size:10px;">(${escapeHtml(a.media_name)})</span>` : ''}
                    <span style="opacity:0.5; margin:0 4px;">•</span>
                </a>
            `).join('');

            const repeatCount = Math.max(1, Math.ceil(6 / breakingList.length));
            const singleSetHtml = Array(repeatCount).fill(makeBrkItems()).join('');
            brkTrack.innerHTML = singleSetHtml + singleSetHtml;
        } else {
            breakingBar.classList.remove('jg-breaking-active');
            updateBottomPadding(false);
        }

        // 6-2. 전체 뉴스 기사 좌측 연속 롤링 (Marquee 무한 스크롤)
        const newsTrack = document.getElementById('jgNewsTrack');
        const articles = data.articles || [];
        if (newsTrack && articles.length > 0) {
            const makeNewsItems = () => articles.map(a => `
                <a href="${a.link || '/go/news'}" target="_blank" rel="noopener" class="jg-t-link">
                    <span class="jg-t-cat">${escapeHtml(a.category_name || '뉴스')}</span>
                    <span>${escapeHtml(a.title)}</span>
                    ${a.media_name ? `<span class="jg-t-media">(${escapeHtml(a.media_name)})</span>` : ''}
                    <span class="jg-t-sep">•</span>
                </a>
            `).join('');

            // 끊김 없는 무한 스크롤(-50% transform)을 위해 2벌 연결
            newsTrack.innerHTML = makeNewsItems() + makeNewsItems();
        }

        requestAnimationFrame(() => {
            if (newsTrack && articles.length > 0) {
                const newsDistance = newsTrack.scrollWidth / 2;
                const speedPxPerSec = newsDistance > 0 ? (newsDistance / 85) : 75;
                newsTrack.style.setProperty('animation-duration', '85s', 'important');

                if (brkTrack && breakingList.length > 0) {
                    const brkDistance = brkTrack.scrollWidth / 2;
                    if (brkDistance > 0 && speedPxPerSec > 0) {
                        const brkDuration = Math.max(8, Math.round((brkDistance / speedPxPerSec) * 10) / 10);
                        brkTrack.style.setProperty('animation-duration', `${brkDuration}s`, 'important');
                    }
                }
            }
        });

        // 6-3. 우측 날씨 / 증시 / 환율 수직 롤링 슬라이드 구성
        const vBox = document.getElementById('jgVBox');
        if (vBox) {
            const weather = data.weather || { city: '계룡', temp: '-', condition: '맑음', icon: '🌤️' };
            const market = data.market || {};
            const kospi = market.kospi || { price: '2,600.0', direction: 'down' };
            const kosdaq = market.kosdaq || { price: '850.0', direction: 'down' };
            const usd = market.usd_krw || { price: '1,350.0', direction: 'up' };

            const cityName = (weather.city === 'Gyeryong' || !weather.city) ? '계룡' : weather.city;
            const usdPrice = usd.price ? (String(usd.price).includes('원') ? String(usd.price) : `${usd.price}원`) : '-';

            const slides = [];

            // 1) 날씨 슬라이드 및 상단 내비게이션 날씨 배지 실시간 동기화
            if (weather && weather.temp && weather.temp !== '-') {
                const weatherIconUrl = weather.icon_url || (weather.icon_slug ? `https://cdn.jsdelivr.net/gh/basmilius/weather-icons@dev/production/fill/svg/${weather.icon_slug}.svg` : null);
                const weatherIconHtml = weatherIconUrl
                    ? `<img src="${weatherIconUrl}" alt="${weather.condition || '날씨'}" style="width:14px; height:14px; vertical-align:middle; display:inline-block; flex-shrink:0;" onerror="this.onerror=null; this.outerHTML='${weather.icon || '🌤️'}';">`
                    : (weather.icon || '🌤️');

                // 상단 내비게이션 바 날씨 배지(#welcomeWeatherBadge)도 항상 동일하게 동기화
                const topCityEl = document.getElementById('welcomeWeatherCity');
                const topTempEl = document.getElementById('welcomeWeatherTemp');
                const topIconEl = document.getElementById('welcomeWeatherIcon');
                if (topCityEl) topCityEl.textContent = cityName;
                if (topTempEl) topTempEl.textContent = weather.temp;
                if (topIconEl && weatherIconUrl) {
                    topIconEl.innerHTML = `<img src="${weatherIconUrl}" alt="${weather.condition || '날씨'}" style="width:18px; height:18px; vertical-align:middle; display:inline-block; flex-shrink:0;" onerror="this.onerror=null; this.outerHTML='${weather.icon || '🌤️'}';">`;
                }

                slides.push(`
                    <a href="https://news.j-jg.cc/weather" target="_blank" rel="noopener" class="jg-v-item" title="실시간 날씨 브리핑">
                        <span style="display:inline-flex; align-items:center; gap:3px;">${weatherIconHtml} ${cityName}</span>
                        <span style="color:#38bdf8; font-weight:700;">${weather.temp}</span>
                        ${weather.condition ? `<span style="color:#a1a1aa; font-size:10.5px;">${weather.condition}</span>` : ''}
                    </a>
                `);
            }

            // 2) 코스피 슬라이드
            if (kospi && kospi.price && kospi.price !== '-') {
                const dirUp = kospi.direction === 'up' || (kospi.ratio && kospi.ratio.startsWith('+'));
                slides.push(`
                    <a href="/go/economy" class="jg-v-item" title="실시간 코스피 증시">
                        <span style="color:#a1a1aa; font-size:10.5px;">코스피</span>
                        <span style="color:#ffffff; font-weight:700;">${kospi.price}</span>
                        <span class="${dirUp ? 'jg-val-up' : 'jg-val-down'}" style="font-size:10.5px;">${dirUp ? '▲' : '▼'}${kospi.ratio || ''}</span>
                    </a>
                `);
            }

            // 3) 코스닥 슬라이드
            if (kosdaq && kosdaq.price && kosdaq.price !== '-') {
                const dirUp = kosdaq.direction === 'up' || (kosdaq.ratio && kosdaq.ratio.startsWith('+'));
                slides.push(`
                    <a href="/go/economy" class="jg-v-item" title="실시간 코스닥 증시">
                        <span style="color:#a1a1aa; font-size:10.5px;">코스닥</span>
                        <span style="color:#ffffff; font-weight:700;">${kosdaq.price}</span>
                        <span class="${dirUp ? 'jg-val-up' : 'jg-val-down'}" style="font-size:10.5px;">${dirUp ? '▲' : '▼'}${kosdaq.ratio || ''}</span>
                    </a>
                `);
            }

            // 4) 달러 환율 슬라이드
            if (usd && usd.price && usd.price !== '-' && !usdPrice.includes('-')) {
                const dirUp = usd.direction === 'up' || (usd.ratio && usd.ratio.startsWith('+'));
                slides.push(`
                    <a href="/go/economy" class="jg-v-item" title="실시간 달러 환율 (USD/KRW)">
                        <span style="color:#a1a1aa; font-size:10.5px;">달러</span>
                        <span style="color:#ffffff; font-weight:700;">${usdPrice}</span>
                        <span class="${dirUp ? 'jg-val-up' : 'jg-val-down'}" style="font-size:10.5px;">${dirUp ? '▲' : '▼'}${usd.ratio || ''}</span>
                    </a>
                `);
            }

            // 5) 100엔 환율 슬라이드 (있을 경우)
            if (market.jpy_krw && market.jpy_krw.price && market.jpy_krw.price !== '-') {
                const jpy = market.jpy_krw;
                const dirUp = jpy.direction === 'up' || (jpy.ratio && jpy.ratio.startsWith('+'));
                slides.push(`
                    <a href="/go/economy" class="jg-v-item" title="실시간 엔화 환율 (JPY/KRW)">
                        <span style="color:#a1a1aa; font-size:10.5px;">100엔</span>
                        <span style="color:#ffffff; font-weight:700;">${jpy.price}</span>
                        <span class="${dirUp ? 'jg-val-up' : 'jg-val-down'}" style="font-size:10.5px;">${dirUp ? '▲' : '▼'}${jpy.ratio || ''}</span>
                    </a>
                `);
            }

            if (slides.length > 0) {
                vBox.innerHTML = slides.join('');
                startVerticalRolling(vBox);
            }
        }
    }

    // 7. 우측 날씨/증시/환율 수직 위로 슬라이드 롤링 (3.5초 간격)
    function startVerticalRolling(container) {
        if (vRollingTimer) clearInterval(vRollingTimer);
        const items = container.querySelectorAll('.jg-v-item');
        if (items.length <= 1) return;

        let curIdx = 0;
        items.forEach((item, i) => {
            item.style.transform = (i === 0) ? 'translateY(0%)' : 'translateY(100%)';
            item.style.opacity = (i === 0) ? '1' : '0';
            item.style.pointerEvents = (i === 0) ? 'auto' : 'none';
        });

        vRollingTimer = setInterval(() => {
            const prev = items[curIdx];
            curIdx = (curIdx + 1) % items.length;
            const next = items[curIdx];

            // 이전 항목: 위로 나가기
            prev.style.transition = 'transform 0.45s ease-in-out, opacity 0.45s ease-in-out';
            prev.style.transform = 'translateY(-100%)';
            prev.style.opacity = '0';
            prev.style.pointerEvents = 'none';

            // 다음 항목: 아래 대기 후 위로 올라오기
            next.style.transition = 'none';
            next.style.transform = 'translateY(100%)';
            next.style.opacity = '0';
            void next.offsetHeight; // Reflow 트리거

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

    // 8. 데이터 페칭 (캐시 연동)
    async function fetchTicker() {
        try {
            const res = await fetch('/api/ticker?_t=' + Math.floor(Date.now() / 20000));
            if (!res.ok) return;
            const data = await res.json();
            if (!data.success) return;

            try { localStorage.setItem('jg_cached_bottom_ticker', JSON.stringify(data)); } catch (e) {}
            renderTickerData(data);
        } catch (e) {
            console.warn('[BottomNews] 페칭 에러:', e);
        }
    }

    // 9. HTML 이스케이프 유틸
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 10. 속보 닫기 이벤트
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'jgBrkCloseBtn') {
            breakingBar.classList.remove('jg-breaking-active');
            updateBottomPadding(false);
        }
    });

    // 11. 초기 마운트
    const mount = () => {
        if (document.body) {
            document.body.appendChild(breakingBar);
            document.body.appendChild(tickerBar);
            updateBottomPadding(false);
            updateClock();
            setInterval(updateClock, 1000);

            // 로컬 캐시 즉시 렌더링 (0ms 첫 표시)
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
