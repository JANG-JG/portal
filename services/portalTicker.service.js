const { newsDb } = require('./db');
const { getLiveWeatherData, getDefaultWeatherCity } = require('./weather.service');
const { getLiveMarketData } = require('./market.service');
const { getKstDateTimeString } = require('./portalSummary.service');

// 하단 실시간 뉴스/속보 티커 캐시 (SWR 무기다림 캐시 패턴)
let tickerMemoryCache = {
    timestamp: 0,
    payload: null
};
let isUpdatingTicker = false;

function invalidateTickerCache() {
    tickerMemoryCache = {
        timestamp: 0,
        payload: null
    };
}

function fetchTickerFromDb() {
    return new Promise((resolve) => {
        newsDb.all(
            "SELECT id, title, link, category_name, media_name, published_at FROM news_articles WHERE category_name != '속보' AND title NOT LIKE '%[속보]%' ORDER BY id DESC LIMIT 12",
            [],
            (err, articles) => {
                const breakingThreshold = getKstDateTimeString(-60).slice(0, 16);
                newsDb.all(
                    `SELECT id, title, link, media_name, published_at 
                     FROM news_articles 
                     WHERE (category_name = '속보' OR title LIKE '%[속보]%' OR title LIKE '%(속보)%') 
                       AND (
                         CASE 
                           WHEN published_at IS NOT NULL AND published_at != '' AND length(published_at) >= 16 
                           THEN substr(published_at, 1, 16) 
                           ELSE substr(created_at, 1, 16) 
                         END
                       ) >= ? 
                     ORDER BY id DESC LIMIT 5`,
                    [breakingThreshold],
                    async (bErr, breakingRows) => {
                        try {
                            const defaultCity = await getDefaultWeatherCity();
                            const [weather, market] = await Promise.all([
                                getLiveWeatherData(defaultCity),
                                getLiveMarketData()
                            ]);

                            resolve({
                                success: true,
                                articles: articles || [],
                                breakingArticles: breakingRows || [],
                                breakingCount: breakingRows ? breakingRows.length : 0,
                                weather,
                                market
                            });
                        } catch (e) {
                            resolve({
                                success: true,
                                articles: articles || [],
                                breakingArticles: breakingRows || [],
                                breakingCount: 0,
                                weather: null,
                                market: null
                            });
                        }
                    }
                );
            }
        );
    });
}

async function refreshTickerInBackground() {
    if (isUpdatingTicker) return;
    isUpdatingTicker = true;
    try {
        const freshData = await fetchTickerFromDb();
        if (freshData && freshData.success) {
            tickerMemoryCache = {
                timestamp: Date.now(),
                payload: freshData
            };
        }
    } catch (e) {
        console.warn('[Ticker] 백그라운드 갱신 에러:', e.message);
    } finally {
        isUpdatingTicker = false;
    }
}

// 최초 서버 가동 2초 후 1회 사전 웜업 (첫 접속자도 0ms 보장)
setTimeout(() => {
    refreshTickerInBackground();
}, 2000);

async function getTickerData() {
    const now = Date.now();

    // 1) 15초 이내 신선한 캐시가 있으면 즉시 반환 (0ms)
    if (tickerMemoryCache.payload && (now - tickerMemoryCache.timestamp < 15000)) {
        return tickerMemoryCache.payload;
    }

    // 2) 만료되었더라도 직전 캐시가 있으면 즉시 반환(0ms)하고 백그라운드 비동기 갱신 (SWR 무기다림)
    if (tickerMemoryCache.payload) {
        refreshTickerInBackground();
        return tickerMemoryCache.payload;
    }

    // 3) 최초 1회 부팅 직후 캐시가 아예 없을 때만 동기 대기
    const freshData = await fetchTickerFromDb();
    tickerMemoryCache = {
        timestamp: Date.now(),
        payload: freshData
    };
    return freshData;
}

module.exports = {
    fetchTickerFromDb,
    refreshTickerInBackground,
    getTickerData,
    invalidateTickerCache
};
