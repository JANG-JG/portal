/**
 * news-ticker.js - JG 통합 포털 및 모든 서브 서비스 공통 TV 뉴스 티커 하단바 위젯
 * 모든 사이트에서 <script src="https://j-jg.cc/js/news-ticker.js"></script> 한 줄로 구동됩니다.
 */
(function() {
    // 중복 실행 방지
    if (document.getElementById('jg-global-ticker-bar')) return;

    // 1. 하단 여백 확보 (기존 콘텐츠 가림 방지)
    const applyBottomPadding = () => {
        if (document.body) {
            document.body.style.paddingBottom = '52px';
        } else {
            window.addEventListener('DOMContentLoaded', applyBottomPadding);
        }
    };
    applyBottomPadding();

    // 2. 전용 독립 스타일 주입
    const style = document.createElement('style');
    style.textContent = `
        #jg-global-ticker-bar {
            position: fixed !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            height: 48px !important;
            background: #020617 !important;
            border-top: 1px solid #1e293b !important;
            color: #f8fafc !important;
            z-index: 99999 !important;
            display: flex !important;
            align-items: center !important;
            padding: 0 14px !important;
            font-family: -apple-system, BlinkMacSystemFont, "Pretendard", system-ui, sans-serif !important;
            font-size: 12px !important;
            box-shadow: 0 -4px 16px rgba(0,0,0,0.3) !important;
            user-select: none !important;
            box-sizing: border-box !important;
        }
        #jg-global-ticker-bar * {
            box-sizing: border-box !important;
        }
        .jg-ticker-badge {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            background: #e11d48 !important;
            color: #ffffff !important;
            font-weight: 800 !important;
            font-size: 11px !important;
            padding: 4px 8px !important;
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
            color: #fde047 !important;
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
            margin-left: 12px !important;
            padding-left: 12px !important;
            border-left: 1px solid #1e293b !important;
            height: 32px !important;
            display: flex !important;
            align-items: center !important;
        }
        .jg-v-box {
            position: relative !important;
            height: 32px !important;
            width: 140px !important;
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
            .jg-v-box { width: 110px !important; }
            .jg-ticker-link { font-size: 11px !important; }
        }
    `;
    document.head.appendChild(style);

    // 3. 하단바 DOM 요소 생성
    const bar = document.createElement('div');
    bar.id = 'jg-global-ticker-bar';
    bar.innerHTML = `
        <div class="jg-ticker-badge">
            <span class="jg-ticker-dot"></span>
            <span>뉴스 브리핑</span>
        </div>
        <div class="jg-ticker-scroll-area">
            <div id="jg-track" class="jg-ticker-track">
                <span class="jg-ticker-link">최신 뉴스 브리핑 헤드라인 로드 중...</span>
            </div>
        </div>
        <div class="jg-ticker-right">
            <div class="jg-v-box" id="jg-v-box">
                <div class="jg-v-item" style="transform: translateY(0); opacity: 1;">
                    <span>☀️ Gyeryong</span> <span style="color:#38bdf8;">22°C</span>
                </div>
            </div>
        </div>
    `;

    const injectBar = () => {
        if (document.body) {
            document.body.appendChild(bar);
            fetchTickerData();
        } else {
            window.addEventListener('DOMContentLoaded', injectBar);
        }
    };
    injectBar();

    // 4. 포털 API 호출 및 데이터 바인딩
    async function fetchTickerData() {
        try {
            const res = await fetch('https://j-jg.cc/api/ticker');
            const data = await res.json();
            if (!data.success) return;

            // 4-1. 기사 트랙 구성
            const track = document.getElementById('jg-track');
            if (track && data.articles && data.articles.length > 0) {
                const makeItems = () => data.articles.map(a => `
                    <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="jg-ticker-link">
                        <span class="jg-ticker-cat">${a.category_name || '뉴스'}</span>
                        <span>${escapeHtml(a.title)}</span>
                        ${a.media_name ? `<span style="color:#64748b; font-size:10px;">(${a.media_name})</span>` : ''}
                        <span style="color:#475569; margin: 0 4px;">•</span>
                    </a>
                `).join('');

                // 무한 순환을 위해 2벌 연속 배치
                track.innerHTML = makeItems() + makeItems();
            }

            // 4-2. 우측 롤링 위젯 구성 (날씨, 코스피, 달러)
            const vBox = document.getElementById('jg-v-box');
            if (vBox) {
                const weather = data.weather || { city: 'Gyeryong', temp: '22°C', icon: '☀️' };
                const market = data.market || {};
                const kospi = market.kospi || { price: '2,580.4', direction: 'up' };
                const usd = market.usd_krw || { price: '1,352.0', direction: 'down' };

                const slides = [
                    `<a href="https://news.j-jg.cc" class="jg-v-item">
                        <span>${weather.icon || '☀️'} ${weather.city || 'Gyeryong'}</span>
                        <span style="color:#38bdf8; font-weight:700;">${weather.temp || '22°C'}</span>
                    </a>`,
                    `<div class="jg-v-item">
                        <span style="color:#94a3b8; font-size:10px;">코스피</span>
                        <span style="color:#ffffff;">${kospi.price}</span>
                        <span style="color:${kospi.direction === 'up' ? '#f43f5e' : '#3b82f6'}; font-size:10px;">${kospi.direction === 'up' ? '▲' : '▼'}</span>
                    </div>`,
                    `<div class="jg-v-item">
                        <span style="color:#94a3b8; font-size:10px;">달러</span>
                        <span style="color:#ffffff;">${usd.price}원</span>
                        <span style="color:${usd.direction === 'up' ? '#f43f5e' : '#3b82f6'}; font-size:10px;">${usd.direction === 'up' ? '▲' : '▼'}</span>
                    </div>`
                ];

                vBox.innerHTML = slides.join('');
                startVerticalRolling(vBox);
            }
        } catch (e) {
            console.warn('[Ticker] 데이터 로드 실패:', e);
        }
    }

    // 4-3. 우측 위젯 3.5초 수직 롤링 타이머
    function startVerticalRolling(container) {
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

        setInterval(() => {
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
