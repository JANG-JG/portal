// 주요 미국 및 글로벌 주식/ETF 친절한 한글 종목명 사전
const KOREAN_STOCK_MAP = {
    'O': '리얼티인컴',
    'MSFT': '마이크로소프트',
    'AAPL': '애플',
    'NVDA': '엔비디아',
    'TSLA': '테슬라',
    'SPY': 'S&P 500',
    'QQQ': '나스닥 100 (QQQ)',
    'QQQM': '나스닥 100 (QQQM)',
    'SOXL': '반도체 3배 (SOXL)',
    'MAR': '메리어트',
    'SBUX': '스타벅스',
    'AMZN': '아마존',
    'GOOGL': '구글 (알파벳)',
    'GOOG': '구글 (알파벳)',
    'META': '메타',
    'SCHD': '슈드 (SCHD)',
    'AMD': 'AMD',
    'INTC': '인텔',
    'PLTR': '팔란티어',
    'COIN': '코인베이스',
    'TLT': '미국 20년 국채 (TLT)',
    'VOO': 'S&P 500 (VOO)',
    'IVV': 'S&P 500 (IVV)'
};

const axios = require('axios');

const QUOTE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

// 종목명/한글명 -> 야후/네이버 티커 사전 정의 (자산관리 앱과 100% 동일)
const KNOWN_TICKER_MAP = {
    'TIGER 미국배당다우존스': '379800.KS',
    'TIGER 미국S&P500': '360750.KS',
    'TIGER 미국나스닥100': '133690.KS',
    'ACE 미국배당다우존스': '402970.KS',
    'ACE 미국S&P500': '360200.KS',
    'ACE 미국나스닥100': '367380.KS',
    'SOL 미국배당다우존스': '446720.KS',
    'SOL 미국S&P500': '429740.KS',
    'KODEX 200': '069500.KS',
    'KODEX 미국나스닥100TR': '379810.KS',
    'KODEX 미국S&P500TR': '379800.KS',
    'TIGER 차이나전기차SOLACTIVE': '371460.KS',
    '삼성전자': '005930.KS',
    'SK하이닉스': '000660.KS',
    'NAVER': '035420.KS',
    '카카오': '035720.KS',
    '현대차': '005380.KS'
};

// 메모리 시세 캐시 (유효시간: 90초)
const quotesCache = new Map();
const QUOTE_CACHE_TTL_MS = 90 * 1000;

// 환율 캐시 (유효시간: 180초)
let cachedExchangeRate = {
    rate: 1350.0,
    timestamp: 0
};

/**
 * 실시간 USD/KRW 환율 조회 (자산관리 앱 quote-service.js와 동일한 180초 캐시 및 소스)
 */
async function getExchangeRate() {
    const now = Date.now();
    if (now - cachedExchangeRate.timestamp < 180 * 1000 && cachedExchangeRate.rate > 0) {
        return cachedExchangeRate.rate;
    }

    try {
        const resp = await axios.get('https://api.stock.naver.com/marketindex/exchange/FX_USDKRW', {
            headers: QUOTE_HEADERS,
            timeout: 3000
        });
        if (resp.data && resp.data.exchangeInfo && resp.data.exchangeInfo.closePrice) {
            const num = parseFloat(String(resp.data.exchangeInfo.closePrice).replace(/,/g, ''));
            if (!isNaN(num) && num > 500) {
                cachedExchangeRate = { rate: num, timestamp: now };
                return num;
            }
        }
    } catch (e) {
        try {
            const resp2 = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 3000 });
            if (resp2.data && resp2.data.rates && resp2.data.rates.KRW) {
                const num = parseFloat(resp2.data.rates.KRW);
                cachedExchangeRate = { rate: num, timestamp: now };
                return num;
            }
        } catch (e2) {}
    }

    return cachedExchangeRate.rate || 1350.0;
}

function resolveQuoteSymbol(symbol, fullName) {
    if (!symbol) return null;
    const cleanSym = String(symbol).trim();
    const cleanUpper = cleanSym.toUpperCase();

    if (KNOWN_TICKER_MAP[cleanSym]) return KNOWN_TICKER_MAP[cleanSym];
    if (KNOWN_TICKER_MAP[cleanUpper]) return KNOWN_TICKER_MAP[cleanUpper];

    const codeMatch = (String(fullName || '') + ' ' + cleanSym).match(/\b(\d{6})(\.KS|\.KQ)?\b/);
    if (codeMatch) {
        return codeMatch[2] ? `${codeMatch[1]}${codeMatch[2]}` : `${codeMatch[1]}.KS`;
    }

    if (/^\d{6}$/.test(cleanSym)) {
        return `${cleanSym}.KS`;
    }

    if (/^[A-Za-z0-9\.\=\-]+$/.test(cleanSym)) {
        return cleanUpper;
    }

    return cleanSym;
}

// 백그라운드 중복 조회 방지 Set
const inFlightFetches = new Set();

/**
 * 실제 네트워크를 통한 단일 종목 시세 조회 (타임아웃 2.5초)
 */
async function _fetchSingleQuoteNetwork(resolvedSymbol) {
    if (!resolvedSymbol) return null;
    let quote = null;

    // 1순위: 야후 파이낸스 v8 chart
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(resolvedSymbol)}?interval=1d&range=2d`;
        const res = await axios.get(url, { headers: QUOTE_HEADERS, timeout: 2500 });
        if (res.data && res.data.chart && res.data.chart.result && res.data.chart.result[0]) {
            const meta = res.data.chart.result[0].meta;
            const price = parseFloat(meta.regularMarketPrice);
            const prev = parseFloat(meta.chartPreviousClose || meta.previousClose);

            if (!isNaN(price) && price > 0) {
                const change = !isNaN(prev) && prev > 0 ? (price - prev) : 0;
                const changeRate = !isNaN(prev) && prev > 0 ? (change / prev) * 100 : 0;
                const currency = (meta.currency || (resolvedSymbol.endsWith('.KS') || resolvedSymbol.endsWith('.KQ') ? 'KRW' : 'USD')).toUpperCase();

                quote = {
                    price,
                    prevClose: prev || price,
                    change,
                    changeRate,
                    currency,
                    symbol: resolvedSymbol
                };
            }
        }
    } catch (err) {}

    // 2순위: 국내 주식의 경우 네이버 증권 폴링 API 백업
    if (!quote && (resolvedSymbol.endsWith('.KS') || resolvedSymbol.endsWith('.KQ') || /^\d{6}$/.test(resolvedSymbol))) {
        const code = resolvedSymbol.replace(/\.(KS|KQ)$/i, '');
        try {
            const nUrl = `https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`;
            const nRes = await axios.get(nUrl, { headers: QUOTE_HEADERS, timeout: 2000 });
            if (nRes.data && nRes.data.datas && nRes.data.datas.length > 0) {
                const d = nRes.data.datas[0];
                const price = parseFloat(String(d.closePrice || 0).replace(/,/g, ''));
                const chg = parseFloat(String(d.compareToPreviousClosePrice || 0).replace(/,/g, ''));
                const ratio = parseFloat(String(d.fluctuationsRatio || 0).replace(/,/g, ''));
                const statName = d.compareToPreviousPrice?.name || 'FLAT';
                const signedChg = (statName === 'FALLING' || statName === 'DOWN') ? -Math.abs(chg) : Math.abs(chg);

                if (!isNaN(price) && price > 0) {
                    quote = {
                        price,
                        prevClose: price - signedChg,
                        change: signedChg,
                        changeRate: ratio,
                        currency: 'KRW',
                        symbol: resolvedSymbol
                    };
                }
            }
        } catch (nErr) {}
    }

    if (quote) {
        quotesCache.set(resolvedSymbol, { data: quote, timestamp: Date.now() });
    }
    return quote;
}

/**
 * 단일 종목 시세 조회 (SWR: 캐시 만료 시에도 직전 데이터 0ms 즉시 반환 + 백그라운드 갱신)
 */
async function fetchSingleQuote(resolvedSymbol) {
    if (!resolvedSymbol) return null;

    const now = Date.now();
    const cached = quotesCache.get(resolvedSymbol);

    // 1. 유효한 신선한 캐시가 있으면 즉시 반환
    if (cached && (now - cached.timestamp < QUOTE_CACHE_TTL_MS)) {
        return cached.data;
    }

    // 2. 만료되었지만 기존 캐시가 있는 경우 -> 즉시 기존 데이터 반환하고 백그라운드 비동기 갱신
    if (cached && cached.data) {
        if (!inFlightFetches.has(resolvedSymbol)) {
            inFlightFetches.add(resolvedSymbol);
            _fetchSingleQuoteNetwork(resolvedSymbol).finally(() => inFlightFetches.delete(resolvedSymbol));
        }
        return cached.data;
    }

    // 3. 캐시가 전혀 없는 최초 1회 요청 종목
    if (!inFlightFetches.has(resolvedSymbol)) {
        inFlightFetches.add(resolvedSymbol);
        const promise = _fetchSingleQuoteNetwork(resolvedSymbol).finally(() => inFlightFetches.delete(resolvedSymbol));
        return await promise;
    }

    return null;
}

// 전체 자산 시세 스냅샷 캐시 (SWR 지원)
let lastPortalEnrichedSnapshot = null;
let lastPortalEnrichedTimestamp = 0;
let isPortalRefreshingAssets = false;

async function _recalculatePortalEnrichedAssets(assets, exchangeRate) {
    const quotePromises = assets.map(async (ast, idx) => {
        const resolvedSym = resolveQuoteSymbol(ast.symbol, ast.full_name);
        let q = null;
        if (resolvedSym) {
            q = await fetchSingleQuote(resolvedSym);
        }
        return { key: ast.id !== undefined ? ast.id : idx, quote: q };
    });

    const quoteResults = await Promise.all(quotePromises);
    const quoteMap = new Map();
    quoteResults.forEach(r => {
        if (r.quote) quoteMap.set(r.key, r.quote);
    });

    const enrichedAssets = assets.map((ast, idx) => {
        const key = ast.id !== undefined ? ast.id : idx;
        const q = quoteMap.get(key);
        const userCurrency = (ast.currency || 'KRW').toUpperCase();

        if (!q) {
            return {
                ...ast,
                currentPrice: ast.avg_price,
                rawPrice: ast.avg_price,
                priceCurrency: userCurrency,
                dailyChange: 0,
                dailyChangeRate: 0,
                prevClose: ast.avg_price,
                exchangeRate,
                hasRealtimeQuote: false
            };
        }

        const quoteCurrency = q.currency || 'KRW';
        let compareCurrentPrice = q.price;
        let compareDailyChange = q.change;

        if (userCurrency === 'KRW' && quoteCurrency === 'USD') {
            compareCurrentPrice = q.price * exchangeRate;
            compareDailyChange = q.change * exchangeRate;
        } else if (userCurrency === 'USD' && quoteCurrency === 'KRW') {
            compareCurrentPrice = q.price / exchangeRate;
            compareDailyChange = q.change / exchangeRate;
        }

        return {
            ...ast,
            currentPrice: compareCurrentPrice,
            rawPrice: q.price,
            priceCurrency: quoteCurrency,
            dailyChange: compareDailyChange,
            dailyChangeRate: q.changeRate,
            prevClose: q.prevClose,
            exchangeRate,
            hasRealtimeQuote: true
        };
    });

    return { enrichedAssets, exchangeRate };
}

/**
 * 자산 목록(assets)에 실시간 시세 및 등락률 바인딩 (SWR 기반 0ms 즉시 응답)
 */
async function enrichAssetsWithQuotes(assets) {
    if (!Array.isArray(assets) || assets.length === 0) {
        return { enrichedAssets: [], exchangeRate: 1350.0 };
    }

    const now = Date.now();
    const exchangeRate = await getExchangeRate();

    // 1. 직전 스냅샷이 있고 60초 이내라면 즉시 반환
    if (lastPortalEnrichedSnapshot && (now - lastPortalEnrichedTimestamp < 60 * 1000)) {
        return lastPortalEnrichedSnapshot;
    }

    // 2. 만료되었지만 기존 스냅샷이 있는 경우 -> 직전 스냅샷을 0ms 즉시 반환하고 백그라운드 갱신
    if (lastPortalEnrichedSnapshot) {
        if (!isPortalRefreshingAssets) {
            isPortalRefreshingAssets = true;
            _recalculatePortalEnrichedAssets(assets, exchangeRate)
                .then(result => {
                    lastPortalEnrichedSnapshot = result;
                    lastPortalEnrichedTimestamp = Date.now();
                })
                .catch(() => {})
                .finally(() => { isPortalRefreshingAssets = false; });
        }
        return lastPortalEnrichedSnapshot;
    }

    // 3. 서버 시작 후 최초 1회 요청 시 동기 계산 및 스냅샷 보관
    const result = await _recalculatePortalEnrichedAssets(assets, exchangeRate);
    lastPortalEnrichedSnapshot = result;
    lastPortalEnrichedTimestamp = now;
    return result;
}

function getKoreanStockName(symbol, fullName) {
    if (!symbol) return fullName || '';
    const cleanSym = symbol.trim().toUpperCase();
    if (KOREAN_STOCK_MAP[cleanSym]) {
        return KOREAN_STOCK_MAP[cleanSym];
    }
    let name = (fullName || symbol || '').trim();
    name = name.replace(/\s*\([0-9A-Za-z]{6}\.(?:KS|KQ)\)/gi, '');
    name = name.replace(/\s*\([0-9]{6}\)/g, '');
    if (/[가-힣]/.test(name)) {
        return name;
    }
    return name || symbol;
}

// 실시간 증시 및 환율 캐시 (3분 유효)
let marketCache = {
    timestamp: 0,
    data: {
        kospi: { name: '코스피', price: '-', ratio: '-', direction: 'up' },
        kosdaq: { name: '코스닥', price: '-', ratio: '-', direction: 'up' },
        usd_krw: { name: 'USD/KRW', price: '-', ratio: '-', direction: 'up' },
        jpy_krw: { name: 'JPY/KRW', price: '-', ratio: '-', direction: 'up' },
        eur_krw: { name: 'EUR/KRW', price: '-', ratio: '-', direction: 'up' }
    }
};
let isMarketFetching = false;

async function refreshMarketInBackground() {
    if (isMarketFetching) return;
    isMarketFetching = true;
    try {
        const [kRes, qRes, uRes, jRes, eRes] = await Promise.allSettled([
            fetch('https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI', { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(3000) 
            }).then(r => r.json()),
            fetch('https://polling.finance.naver.com/api/realtime/domestic/index/KOSDAQ', { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(3000) 
            }).then(r => r.json()),
            fetch('https://m.stock.naver.com/front-api/marketIndex/prices?category=exchange&reutersCode=FX_USDKRW', { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(3000) 
            }).then(r => r.json()),
            fetch('https://api.stock.naver.com/marketindex/exchange/FX_JPYKRW', { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(3000) 
            }).then(r => r.json()),
            fetch('https://api.stock.naver.com/marketindex/exchange/FX_EURKRW', { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(3000) 
            }).then(r => r.json())
        ]);

        const nextData = { ...marketCache.data };

        if (kRes.status === 'fulfilled' && kRes.value?.datas?.[0]) {
            const d = kRes.value.datas[0];
            const p = d.closePrice || '-';
            const fName = d.compareToPreviousPrice?.name || '';
            const dir = fName.includes('RISING') ? 'up' : (fName.includes('FALLING') ? 'down' : 'flat');
            const sign = dir === 'up' ? '+' : (dir === 'down' ? '-' : '');
            const ratioVal = parseFloat(d.fluctuationsRatio || 0);
            const ratio = d.fluctuationsRatio ? `${sign}${Math.abs(ratioVal).toFixed(2)}%` : '-';
            nextData.kospi = { name: '코스피', price: p, ratio, direction: dir };
        }

        if (qRes.status === 'fulfilled' && qRes.value?.datas?.[0]) {
            const d = qRes.value.datas[0];
            const p = d.closePrice || '-';
            const fName = d.compareToPreviousPrice?.name || '';
            const dir = fName.includes('RISING') ? 'up' : (fName.includes('FALLING') ? 'down' : 'flat');
            const sign = dir === 'up' ? '+' : (dir === 'down' ? '-' : '');
            const ratioVal = parseFloat(d.fluctuationsRatio || 0);
            const ratio = d.fluctuationsRatio ? `${sign}${Math.abs(ratioVal).toFixed(2)}%` : '-';
            nextData.kosdaq = { name: '코스닥', price: p, ratio, direction: dir };
        }

        if (uRes.status === 'fulfilled' && uRes.value?.result?.[0]) {
            const d = uRes.value.result[0];
            const p = d.closePrice ? (d.closePrice.includes('원') ? d.closePrice : d.closePrice + '원') : '-';
            const fName = d.fluctuationsType?.name || '';
            const dir = fName.includes('RISING') ? 'up' : (fName.includes('FALLING') ? 'down' : 'flat');
            const sign = dir === 'up' ? '+' : (dir === 'down' ? '-' : '');
            const ratioVal = parseFloat(d.fluctuationsRatio || 0);
            const ratio = d.fluctuationsRatio ? `${sign}${Math.abs(ratioVal).toFixed(2)}%` : '-';
            nextData.usd_krw = { name: 'USD/KRW', price: p, ratio, direction: dir };
        }

        if (jRes.status === 'fulfilled' && jRes.value?.exchangeInfo) {
            const ex = jRes.value.exchangeInfo;
            const p = ex.closePrice ? `${ex.closePrice}원` : '-';
            const statName = ex.fluctuationsType?.name || '';
            const dir = (statName === 'RISING' || statName === 'UP') ? 'up' : ((statName === 'FALLING' || statName === 'DOWN') ? 'down' : 'flat');
            const sign = dir === 'up' ? '+' : (dir === 'down' ? '-' : '');
            const ratioVal = parseFloat(ex.fluctuationsRatio || 0);
            const ratio = ex.fluctuationsRatio ? `${sign}${Math.abs(ratioVal).toFixed(2)}%` : '-';
            nextData.jpy_krw = { name: 'JPY/KRW', price: p, ratio, direction: dir };
        }

        if (eRes.status === 'fulfilled' && eRes.value?.exchangeInfo) {
            const ex = eRes.value.exchangeInfo;
            const p = ex.closePrice ? `${ex.closePrice}원` : '-';
            const statName = ex.fluctuationsType?.name || '';
            const dir = (statName === 'RISING' || statName === 'UP') ? 'up' : ((statName === 'FALLING' || statName === 'DOWN') ? 'down' : 'flat');
            const sign = dir === 'up' ? '+' : (dir === 'down' ? '-' : '');
            const ratioVal = parseFloat(ex.fluctuationsRatio || 0);
            const ratio = ex.fluctuationsRatio ? `${sign}${Math.abs(ratioVal).toFixed(2)}%` : '-';
            nextData.eur_krw = { name: 'EUR/KRW', price: p, ratio, direction: dir };
        }

        marketCache = { timestamp: Date.now(), data: nextData };
    } catch (e) {
    } finally {
        isMarketFetching = false;
    }
}

async function getLiveMarketData() {
    const now = Date.now();
    if (marketCache.data && (now - marketCache.timestamp < 300000)) {
        return marketCache.data;
    }
    if (marketCache.data && marketCache.timestamp > 0) {
        refreshMarketInBackground();
        return marketCache.data;
    }
    await refreshMarketInBackground();
    return marketCache.data;
}

module.exports = {
    KOREAN_STOCK_MAP,
    getKoreanStockName,
    getLiveMarketData,
    refreshMarketInBackground,
    getExchangeRate,
    enrichAssetsWithQuotes
};
