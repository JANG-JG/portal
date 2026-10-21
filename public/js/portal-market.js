// ==============================================================================
// 📈 JG 포털 시장 지표 & 자산 종목 티커 엔진 (portal-market.js)
// - 실시간 주요 뉴스 벤토 카드의 지수(코스피/코스닥) 및 환율(USD/JPY/EUR) 칩 렌더링 & 페이드 전환
// - 국내외 종합 시장 지표 순환 롤링 & 보유 자산 종목 페이드 전환
// - 실시간 속보 한줄 티커
// - 모듈화 표준 (500줄 이하) 준수
// ==============================================================================

// 🔄 1. 국내외 종합 시장 지표 & 실시간 주요 뉴스 지수/환율 칩 엔진
let marketFadeTimer = null;
let comprehensiveMarketTimer = null;

function startComprehensiveMarketRolling(market) {
    if (!market) return;

    // 1-1. 실시간 주요 뉴스 벤토 카드 미니 칩 바 (#newsMarketBar) 바인딩
    startMarketFading(market);

    // 1-2. 레거시/단일 티커 컨테이너(#marketTickerContent, #marketTickerVal)가 있을 경우의 폴백 지원
    const tickerBox = document.getElementById('marketTickerContent');
    const tickerVal = document.getElementById('marketTickerVal');
    if (!tickerBox || !tickerVal) return;

    if (comprehensiveMarketTimer) clearInterval(comprehensiveMarketTimer);

    const items = [];
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

    if (items.length === 0) return;

    let curIndex = 0;
    function updateTicker(idx) {
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

// 📈 1-2. 메인 대시보드 실시간 주요 뉴스 카드 [지수 칩] + [환율 칩] 부드러운 순환 페이드 전환 함수
function startMarketFading(market) {
    if (!market) return;
    if (marketFadeTimer) {
        clearInterval(marketFadeTimer);
        marketFadeTimer = null;
    }

    // 1) 지수 목록 (코스피, 코스닥)
    const indexList = [];
    if (market.kospi && market.kospi.price && market.kospi.price !== '-') {
        indexList.push({ ...market.kospi, name: '코스피' });
    }
    if (market.kosdaq && market.kosdaq.price && market.kosdaq.price !== '-') {
        indexList.push({ ...market.kosdaq, name: '코스닥' });
    }

    // 2) 환율 목록 (USD, JPY, EUR)
    const fxList = [];
    const usd = market.usd_krw || market.fx;
    if (usd && usd.price && usd.price !== '-') {
        fxList.push({ ...usd, name: 'USD/KRW' });
    }
    if (market.jpy_krw && market.jpy_krw.price && market.jpy_krw.price !== '-') {
        fxList.push({ ...market.jpy_krw, name: 'JPY/KRW' });
    }
    if (market.eur_krw && market.eur_krw.price && market.eur_krw.price !== '-') {
        fxList.push({ ...market.eur_krw, name: 'EUR/KRW' });
    }

    const indexNameEl = document.getElementById('marketIndexName');
    const fxNameEl = document.getElementById('marketFxName');
    const indexBox = document.getElementById('marketIndexBox');
    const fxBox = document.getElementById('marketFxBox');

    let indexCur = 0;
    let fxCur = 0;

    function renderIndex(item) {
        if (!item) return;
        if (indexNameEl) indexNameEl.textContent = item.name;
        const arrow = item.direction === 'up' ? '▲ ' : (item.direction === 'down' ? '▼ ' : '');
        const diffCls = item.direction === 'up' ? 'up' : (item.direction === 'down' ? 'down' : '');
        if (indexBox) {
            indexBox.innerHTML = `
                <span class="market-price font-mono" id="kospiPrice">${item.price || '-'}</span>
                <span class="market-diff font-mono ${diffCls}" id="kospiDiff">${arrow}${item.ratio || '-'}</span>
            `;
        }
    }

    function renderFx(item) {
        if (!item) return;
        if (fxNameEl) fxNameEl.textContent = item.name;
        const arrow = item.direction === 'up' ? '▲ ' : (item.direction === 'down' ? '▼ ' : '');
        const diffCls = item.direction === 'up' ? 'up' : (item.direction === 'down' ? 'down' : '');
        if (fxBox) {
            fxBox.innerHTML = `
                <span class="market-price font-mono" id="fxPrice">${item.price || '-'}</span>
                <span class="market-diff font-mono ${diffCls}" id="fxDiff">${arrow}${item.ratio || '-'}</span>
            `;
        }
    }

    // 0ms 초기 렌더링
    if (indexList.length > 0) renderIndex(indexList[0]);
    if (fxList.length > 0) renderFx(fxList[0]);

    if (indexList.length <= 1 && fxList.length <= 1) return;

    // 3.5초 주기 순환 페이드 전환
    marketFadeTimer = setInterval(() => {
        if (indexList.length > 1 && indexBox) {
            indexBox.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
            indexBox.style.opacity = '0';
            indexBox.style.transform = 'translateY(-2px)';
            setTimeout(() => {
                indexCur = (indexCur + 1) % indexList.length;
                renderIndex(indexList[indexCur]);
                indexBox.style.opacity = '1';
                indexBox.style.transform = 'translateY(0)';
            }, 220);
        }

        if (fxList.length > 1 && fxBox) {
            fxBox.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
            fxBox.style.opacity = '0';
            fxBox.style.transform = 'translateY(-2px)';
            setTimeout(() => {
                fxCur = (fxCur + 1) % fxList.length;
                renderFx(fxList[fxCur]);
                fxBox.style.opacity = '1';
                fxBox.style.transform = 'translateY(0)';
            }, 220);
        }
    }, 3500);
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
                <span class="stock-kor-name" title="${stock.name}" style="color:var(--text-primary); font-weight:700; font-size:10.5px; overflow:hidden; text-overflow:ellipsis;">${stock.name}</span>
                <span class="stock-price" style="color:var(--text-secondary); font-size:10.5px; margin:0 2px; flex-shrink:0;">${stock.formattedTotal}</span>
                <span class="stock-diff ${stock.direction}" style="font-size:10px; flex-shrink:0;">${dirSymbol} ${stock.diffPercent}</span>
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
        bannerEl.classList.remove('has-breaking', 'active');
        bannerEl.style.setProperty('display', 'none', 'important');
        return;
    }

    bannerEl.classList.add('has-breaking');
    bannerEl.style.setProperty('display', 'flex', 'important');
    if (dropdownList) {
        dropdownList.innerHTML = articles.map(item => `
            <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="breaking-dropdown-item">
                <span class="breaking-dropdown-item-title">${item.title}</span>
                <span class="breaking-dropdown-item-meta">${item.media_name || '속보'}</span>
            </a>
        `).join('');
    }

    let bIdx = 0;
    const renderItem = (idx) => {
        const item = articles[idx];
        trackEl.style.opacity = '1';
        trackEl.innerHTML = `<a href="${item.link || 'https://news.j-jg.cc/breaking'}" target="_blank" rel="noopener noreferrer" class="breaking-ticker-item"><span class="breaking-item-title">${item.title}</span></a>`;
    };
    renderItem(0);

    if (!bannerEl.dataset.boundClick) {
        bannerEl.dataset.boundClick = 'true';
        bannerEl.addEventListener('click', (e) => {
            if (e.target.closest('.breaking-dropdown-panel') || e.target.closest('.breaking-ticker-item') || e.target.closest('.breaking-dropdown-link')) return;
            bannerEl.classList.toggle('active');
        });
        document.addEventListener('click', (e) => {
            if (!bannerEl.contains(e.target)) bannerEl.classList.remove('active');
        });
    }

    if (breakingTickerTimer) clearInterval(breakingTickerTimer);
    if (articles.length > 1) {
        breakingTickerTimer = setInterval(() => {
            bIdx = (bIdx + 1) % articles.length;
            renderItem(bIdx);
        }, 3000);
    }
}
