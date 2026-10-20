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

function getKoreanStockName(symbol, fullName) {
    if (!symbol) return fullName || '';
    const cleanSym = symbol.trim().toUpperCase();
    if (KOREAN_STOCK_MAP[cleanSym]) {
        return KOREAN_STOCK_MAP[cleanSym];
    }
    if (/[가-힣]/.test(symbol)) {
        return symbol;
    }
    if (fullName && /[가-힣]/.test(fullName)) {
        return fullName;
    }
    return symbol;
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
    refreshMarketInBackground
};
