// ==============================================================================
// 📈 JG 포털 시장 지표 & 자산 종목 티커 엔진 (portal-market.js)
// - 코스피, 코스닥, S&P 500, 나스닥 100, 환율(USD/JPY) 3.2초 순환 롤링
// - 보유 자산 종목 페이드 전환 & 실시간 속보 한줄 티커
// ==============================================================================

// 🔄 1. 국내외 종합 시장 지표 자동 롤링 엔진
let comprehensiveMarketTimer = null;
function startComprehensiveMarketRolling(market) {
    if (comprehensiveMarketTimer) {
        clearInterval(comprehensiveMarketTimer);
        comprehensiveMarketTimer = null;
    }

    const items = [];
    if (market) {
        if (market.kospi && market.kospi.price && market.kospi.price !== '-') {
            items.push({ name: '코스피', price: market.kospi.price, ratio: market.kospi.ratio, dir: market.kospi.direction || 'down' });
        }
        if (market.kosdaq && market.kosdaq.price && market.kosdaq.price !== '-') {
            items.push({ name: '코스닥', price: market.kosdaq.price, ratio: market.kosdaq.ratio, dir: market.kosdaq.direction || 'down' });
        }
        const snp = market.sp500 || { price: '5,864.67', ratio: '+0.40%', dir: 'up' };
        items.push({ name: 'S&P 500', price: snp.price, ratio: snp.ratio, dir: snp.dir });

        const nasdaq = market.nasdaq || { price: '18,518.61', ratio: '+0.63%', dir: 'up' };
        items.push({ name: '나스닥 100', price: nasdaq.price, ratio: nasdaq.ratio, dir: nasdaq.dir });

        const usd = market.usd_krw || market.fx;
        if (usd && usd.price && usd.price !== '-') {
            items.push({ name: 'USD/KRW', price: usd.price, ratio: usd.ratio, dir: usd.direction || 'down' });
        }
        if (market.jpy_krw && market.jpy_krw.price && market.jpy_krw.price !== '-') {
            items.push({ name: 'JPY/KRW', price: market.jpy_krw.price, ratio: market.jpy_krw.ratio, dir: market.jpy_krw.direction || 'down' });
        }
    }

    if (items.length === 0) return;

    let curIndex = 0;
    const tickerBox = document.getElementById('marketTickerContent');
    const tickerVal = document.getElementById('marketTickerVal');

    function updateTicker(idx) {
        if (!tickerBox || !tickerVal) return;
        const item = items[idx];
        const arrow = item.dir === 'up' ? '▲' : '▼';
        const color = item.dir === 'up' ? 'var(--status-rose)' : 'var(--status-emerald)';

        tickerBox.classList.add('fade-out');
        setTimeout(() => {
            const labelEl = tickerBox.querySelector('.ticker-label');
            if (labelEl) labelEl.textContent = item.name;
            tickerVal.innerHTML = `${item.price} <span style="color:${color}; font-size:0.72rem; margin-left:4px;">${arrow} ${item.ratio || ''}</span>`;
            tickerBox.classList.remove('fade-out');
        }, 200);
    }

    updateTicker(0);
    comprehensiveMarketTimer = setInterval(() => {
        curIndex = (curIndex + 1) % items.length;
        updateTicker(curIndex);
    }, 3200);
}

// 🔄 2. 보유 자산 종목 페이드 티커 엔진
let assetFadeTimer = null;
function startAssetFading(tickerBox, items) {
    if (!tickerBox || !items || items.length <= 1) return;
    if (assetFadeTimer) clearInterval(assetFadeTimer);

    let currentIndex = 0;
    assetFadeTimer = setInterval(() => {
        currentIndex = (currentIndex + 1) % items.length;
        const stock = items[currentIndex];
        const dirSymbol = stock.direction === 'up' ? '▲' : '▼';

        tickerBox.style.opacity = '0';
        setTimeout(() => {
            tickerBox.innerHTML = `
                <span class="stock-kor-name" title="${stock.name}" style="color:var(--text-primary); font-weight:700;">${stock.name}</span>
                <span class="stock-price" style="color:var(--text-secondary); margin:0 4px;">${stock.formattedTotal}</span>
                <span class="stock-diff ${stock.direction}">${dirSymbol} ${stock.diffPercent}</span>
            `;
            tickerBox.style.opacity = '1';
        }, 250);
    }, 3500);
}

// 🚨 3. 실시간 속보 한줄 티커 바인딩
let breakingTickerTimer = null;
function bindBreakingTicker(articles) {
    const bannerEl = document.getElementById('breakingBannerBar');
    const trackEl = document.getElementById('breakingTickerTrack');
    const dropdownList = document.getElementById('breakingDropdownItems');
    if (!bannerEl || !trackEl) return;

    if (!articles || articles.length === 0) {
        bannerEl.style.display = 'none';
        return;
    }

    bannerEl.style.display = 'flex';
    if (dropdownList) {
        dropdownList.innerHTML = articles.map(item => `
            <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="breaking-dropdown-item">
                <span class="breaking-dropdown-item-title">${item.title}</span>
                <span class="breaking-dropdown-item-meta">${item.media_name || '속보'}</span>
            </a>
        `).join('');
    }

    let bIdx = 0;
    trackEl.innerHTML = `<div class="breaking-ticker-item"><span class="breaking-item-title">${articles[0].title}</span></div>`;

    if (breakingTickerTimer) clearInterval(breakingTickerTimer);
    if (articles.length > 1) {
        breakingTickerTimer = setInterval(() => {
            bIdx = (bIdx + 1) % articles.length;
            trackEl.style.opacity = '0';
            setTimeout(() => {
                trackEl.innerHTML = `<div class="breaking-ticker-item"><span class="breaking-item-title">${articles[bIdx].title}</span></div>`;
                trackEl.style.opacity = '1';
            }, 250);
        }, 4000);
    }
}
