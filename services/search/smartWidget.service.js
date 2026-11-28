/**
 * ✨ JG 통합 검색 - 스마트 즉답 위젯 서비스 (smartWidget.service.js)
 * - 국내 220여 개 시군구 + 해외 도시 날씨/미세먼지/주간 예보 (Open-Meteo 연동)
 * - 실시간 환율 계산기 & 국내외 주요 증시/종목 시세 (market.service.js 연동)
 * - 안전 수식 계산기 (eval 미사용 재귀 파서) & 생활 단위 변환 (평↔㎡, 온도, 무게, 길이)
 */

const axios = require('axios');
const { db } = require('../db');
const {
    CITY_KO_MAP,
    CITY_COORDS,
    getDefaultWeatherCity,
    getLiveWeatherData
} = require('../weather.service');
const {
    getExchangeRate,
    getLiveMarketData,
    KOREAN_STOCK_MAP,
    KNOWN_TICKER_MAP
} = require('../market.service');

const WMO_KO = {
    0: '맑음', 1: '대체로 맑음', 2: '구름 조금', 3: '흐림',
    45: '안개', 48: '짙은 안개',
    51: '약한 이슬비', 53: '이슬비', 55: '강한 이슬비',
    61: '약한 비', 63: '비', 65: '강한 비',
    71: '약한 눈', 73: '눈', 75: '강한 눈', 77: '싸락눈',
    80: '약한 소나기', 81: '소나기', 82: '폭우',
    85: '눈 소나기', 86: '강한 눈 소나기',
    95: '뇌우', 96: '우박 동반 뇌우', 99: '강한 우박 동반 뇌우'
};

function wmoToIcon(code, isDay = 1) {
    if (code === 0 || code === 1) return isDay ? '☀️' : '🌙';
    if (code === 2) return isDay ? '⛅' : '☁️';
    if (code === 3) return '☁️';
    if (code === 45 || code === 48) return '🌫️';
    if (code >= 51 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '❄️';
    if (code >= 80 && code <= 82) return '🌦️';
    if (code >= 85 && code <= 86) return '🌨️';
    if (code >= 95) return '⛈️';
    return '🌤️';
}

// 해외 도시 날씨 캐시 (10분)
const globalWeatherCache = new Map();
const GLOBAL_WEATHER_TTL = 10 * 60 * 1000;

// 추가 환율 캐시 (JPY, EUR, CNY)
const fxCache = new Map();
const FX_TTL = 3 * 60 * 1000;

async function getUserWeatherCity(user) {
    const username = user?.username;
    if (username && db) {
        const userCity = await new Promise((resolve) => {
            db.get('SELECT weather_city FROM users WHERE username = ?', [username], (err, row) => {
                if (!err && row && row.weather_city && row.weather_city.trim()) {
                    return resolve(row.weather_city.trim());
                }
                resolve(null);
            });
        });
        if (userCity) return userCity;
    }
    try {
        return await getDefaultWeatherCity();
    } catch (_) {
        return 'Seoul';
    }
}

/**
 * 국내 도시 코드 정확 매칭 (Seoul 폴백 없이 매칭 여부 판별)
 */
function findDomesticCityCode(rawPlace) {
    if (!rawPlace) return null;
    const trimmed = rawPlace.trim();
    if (CITY_COORDS[trimmed]) return trimmed;

    const lower = trimmed.toLowerCase();
    const cleaned = lower.replace(/(특별자치시|특별자치도|광역시|시|군|구|도)$/, '').trim();

    for (const [code, koName] of Object.entries(CITY_KO_MAP)) {
        const koLower = koName.toLowerCase();
        const subName = koLower.replace(/^(서울|경기|강원|경남|경북|전남|전북|충남|충북)\s*/, '').trim();
        if (
            lower === koLower ||
            lower === subName ||
            (cleaned && (cleaned === koLower || cleaned === subName))
        ) {
            return code;
        }
    }
    return null;
}

/**
 * 해외 도시 Open-Meteo 지오코딩 + 날씨 조회
 */
async function fetchGlobalCityWeather(cityQuery) {
    const cacheKey = cityQuery.toLowerCase();
    const cached = globalWeatherCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < GLOBAL_WEATHER_TTL) {
        return cached.data;
    }

    try {
        const geoRes = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
            params: { name: cityQuery, count: 1, language: 'ko', format: 'json' },
            timeout: 3500
        });
        const place = geoRes.data?.results?.[0];
        if (!place) return null;

        const { fetchCoord7DayWeather } = require('./regionComposite.service');
        const label = place.country ? `${place.name} (${place.country})` : place.name;
        const data = await fetchCoord7DayWeather(place.latitude, place.longitude, { isGlobal: true }, label);
        if (!data) return null;

        globalWeatherCache.set(cacheKey, { ts: Date.now(), data });
        return data;
    } catch (_) {
        return null;
    }
}

async function enrichDomesticWeather7d(cityCode) {
    const { fetchCoord7DayWeather } = require('./regionComposite.service');
    const wx = await getLiveWeatherData(cityCode);
    const coord = CITY_COORDS[cityCode];
    if (coord && wx) {
        return fetchCoord7DayWeather(coord.lat, coord.lon, wx, wx.city);
    }
    return wx;
}

async function resolveWeatherWidget(rawQuery, user) {
    const weatherIntentRe = /(날씨|기온|온도|미세먼지|초미세먼지|강수|비와|비오|눈와|예보|일기예보)/;
    if (!weatherIntentRe.test(rawQuery)) return null;

    const cleanedPlace = rawQuery
        .replace(/(오늘|내일|모레|이번주|주간|실시간|현재|지금|우리집|동네)/g, ' ')
        .replace(/(날씨|기온|온도|미세먼지|초미세먼지|강수확률|강수|예보|일기예보|어때|어때요|알려줘|검색)/g, ' ')
        .replace(/[?!.,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleanedPlace) {
        const myCity = await getUserWeatherCity(user);
        const wx = await enrichDomesticWeather7d(myCity);
        return { type: 'weather', data: wx };
    }

    const domesticCode = findDomesticCityCode(cleanedPlace);
    if (domesticCode) {
        const wx = await enrichDomesticWeather7d(domesticCode);
        return { type: 'weather', data: wx };
    }

    const globalWx = await fetchGlobalCityWeather(cleanedPlace);
    if (globalWx) {
        return { type: 'weather', data: globalWx };
    }

    const fallbackCity = await getUserWeatherCity(user);
    const wx = await enrichDomesticWeather7d(fallbackCity);
    return { type: 'weather', data: wx };
}

async function fetchNaverFxRate(code) {
    const cached = fxCache.get(code);
    if (cached && Date.now() - cached.ts < FX_TTL) return cached.rate;
    try {
        const resp = await axios.get(`https://api.stock.naver.com/marketindex/exchange/${code}`, { timeout: 2500 });
        const raw = resp.data?.exchangeInfo?.closePrice || resp.data?.closePrice;
        if (raw) {
            const parsed = parseFloat(String(raw).replace(/,/g, ''));
            if (!isNaN(parsed) && parsed > 0) {
                fxCache.set(code, { ts: Date.now(), rate: parsed });
                return parsed;
            }
        }
    } catch (_) {}
    return null;
}

async function resolveFinanceWidget(rawQuery) {
    const q = rawQuery.trim();
    const lower = q.toLowerCase();

    // 1) 환율 질의
    const fxMatch = q.match(/(\d+(?:\.\d+)?)\s*(달러|usd|엔|엔화|jpy|유로|eur|위안|cny)/i);
    if (/환율|달러|원달러|엔화|유로|위안/i.test(q) || fxMatch) {
        const amount = fxMatch ? parseFloat(fxMatch[1]) : 1;
        const unitRaw = (fxMatch ? fxMatch[2] : q).toLowerCase();
        let currency = 'USD';
        let label = '미국 달러 (USD)';
        let naverCode = 'FX_USDKRW';
        let unitDivisor = 1;

        if (/엔|jpy/.test(unitRaw)) {
            currency = 'JPY'; label = '일본 엔 (JPY 100)'; naverCode = 'FX_JPYKRW'; unitDivisor = 100;
        } else if (/유로|eur/.test(unitRaw)) {
            currency = 'EUR'; label = '유럽 유로 (EUR)'; naverCode = 'FX_EURKRW';
        } else if (/위안|cny/.test(unitRaw)) {
            currency = 'CNY'; label = '중국 위안 (CNY)'; naverCode = 'FX_CNYKRW';
        }

        const rate = currency === 'USD'
            ? await getExchangeRate()
            : (await fetchNaverFxRate(naverCode)) || (currency === 'JPY' ? 900 : currency === 'EUR' ? 1480 : 190);

        const convertedKrw = Math.round((amount / unitDivisor) * rate);
        return {
            type: 'exchange',
            data: {
                currency,
                label,
                amount,
                ratePerUnit: rate,
                unitDivisor,
                convertedKrw
            }
        };
    }

    // 2) 주식/증시 질의
    const stockNames = [
        ...Object.keys(KNOWN_TICKER_MAP),
        ...Object.keys(KOREAN_STOCK_MAP),
        ...Object.values(KOREAN_STOCK_MAP)
    ];
    const matchedStock = stockNames.find((n) => lower.includes(n.toLowerCase()));
    if (/(코스피|코스닥|나스닥|에스앤피|s&p|증시|주식|주가|시세)/i.test(q) || matchedStock) {
        const market = await getLiveMarketData();
        return {
            type: 'market',
            data: {
                matchedQuery: matchedStock || null,
                indices: (market.indices || []).slice(0, 6),
                usdKrw: market.usdKrw || null
            }
        };
    }

    return null;
}

/**
 * 안전 재귀 하강 수식 파서 (eval 절대 미사용)
 */
function safeEvaluateMath(expr) {
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
        const ch = expr[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (/[0-9.]/.test(ch)) {
            let num = '';
            while (i < expr.length && /[0-9.]/.test(expr[i])) num += expr[i++];
            const val = Number(num);
            if (!Number.isFinite(val)) return null;
            tokens.push({ type: 'num', val });
            continue;
        }
        if ('+-*/%()'.includes(ch)) {
            tokens.push({ type: ch });
            i++;
            continue;
        }
        return null;
    }
    if (tokens.length < 3) return null;

    let pos = 0;
    function parseExpr() {
        let left = parseTerm();
        while (pos < tokens.length && (tokens[pos].type === '+' || tokens[pos].type === '-')) {
            const op = tokens[pos++].type;
            const right = parseTerm();
            left = op === '+' ? left + right : left - right;
        }
        return left;
    }
    function parseTerm() {
        let left = parseFactor();
        while (pos < tokens.length && (tokens[pos].type === '*' || tokens[pos].type === '/' || tokens[pos].type === '%')) {
            const op = tokens[pos++].type;
            const right = parseFactor();
            if ((op === '/' || op === '%') && right === 0) throw new Error('DIV0');
            left = op === '*' ? left * right : op === '/' ? left / right : left % right;
        }
        return left;
    }
    function parseFactor() {
        const t = tokens[pos];
        if (!t) throw new Error('EOF');
        if (t.type === '+' || t.type === '-') {
            pos++;
            const v = parseFactor();
            return t.type === '-' ? -v : v;
        }
        if (t.type === '(') {
            pos++;
            const v = parseExpr();
            if (!tokens[pos] || tokens[pos].type !== ')') throw new Error('PAREN');
            pos++;
            return v;
        }
        if (t.type === 'num') {
            pos++;
            return t.val;
        }
        throw new Error('TOKEN');
    }

    try {
        const result = parseExpr();
        if (pos !== tokens.length || !Number.isFinite(result)) return null;
        return Number(result.toFixed(6));
    } catch (_) {
        return null;
    }
}

function resolveCalcOrUnitWidget(rawQuery) {
    const q = rawQuery.trim();

    // 1) 수식 계산기
    if (/^[0-9+\-*/%().\s=]+$/.test(q) && /[+\-*/%]/.test(q)) {
        const cleaned = q.replace(/=/g, '').trim();
        const result = safeEvaluateMath(cleaned);
        if (result !== null) {
            return {
                type: 'calculator',
                data: { expression: cleaned, result }
            };
        }
    }

    // 2) 단위 변환 (한글 뒤에서는 JS \b가 동작하지 않으므로 공백/끝/한글 경계 사용)
    const unitMatch = q.match(/^(-?\d+(?:\.\d+)?)\s*(평|㎡|m2|제곱미터|섭씨|도|℃|c|화씨|℉|f|kg|킬로|lb|파운드|cm|인치|inch|km|마일|mile)(?=\s|$|[가-힣?])/i);
    if (unitMatch) {
        const val = parseFloat(unitMatch[1]);
        const u = unitMatch[2].toLowerCase();
        if (u === '평') {
            return { type: 'unit', data: { from: `${val} 평`, to: `${(val * 3.305785).toFixed(2)} ㎡`, category: '넓이 변환' } };
        }
        if (u === '㎡' || u === 'm2' || u === '제곱미터') {
            return { type: 'unit', data: { from: `${val} ㎡`, to: `${(val / 3.305785).toFixed(2)} 평`, category: '넓이 변환' } };
        }
        if (u === '섭씨' || u === '℃' || u === 'c' || (u === '도' && /화씨/.test(q))) {
            return { type: 'unit', data: { from: `${val} ℃`, to: `${((val * 9) / 5 + 32).toFixed(1)} ℉`, category: '온도 변환' } };
        }
        if (u === '화씨' || u === '℉' || u === 'f') {
            return { type: 'unit', data: { from: `${val} ℉`, to: `${(((val - 32) * 5) / 9).toFixed(1)} ℃`, category: '온도 변환' } };
        }
        if (u === 'kg' || u === '킬로') {
            return { type: 'unit', data: { from: `${val} kg`, to: `${(val * 2.20462).toFixed(2)} lb (파운드)`, category: '무게 변환' } };
        }
        if (u === 'lb' || u === '파운드') {
            return { type: 'unit', data: { from: `${val} lb`, to: `${(val / 2.20462).toFixed(2)} kg`, category: '무게 변환' } };
        }
        if (u === 'cm') {
            return { type: 'unit', data: { from: `${val} cm`, to: `${(val / 2.54).toFixed(2)} inch (인치)`, category: '길이 변환' } };
        }
        if (u === '인치' || u === 'inch') {
            return { type: 'unit', data: { from: `${val} inch`, to: `${(val * 2.54).toFixed(2)} cm`, category: '길이 변환' } };
        }
        if (u === 'km') {
            return { type: 'unit', data: { from: `${val} km`, to: `${(val * 0.621371).toFixed(2)} mile`, category: '거리 변환' } };
        }
        if (u === '마일' || u === 'mile') {
            return { type: 'unit', data: { from: `${val} mile`, to: `${(val / 0.621371).toFixed(2)} km`, category: '거리 변환' } };
        }
    }

    return null;
}

async function resolveSmartWidget(rawQuery, user) {
    if (!rawQuery || typeof rawQuery !== 'string') return null;
    const calcOrUnit = resolveCalcOrUnitWidget(rawQuery);
    if (calcOrUnit) return calcOrUnit;

    const weather = await resolveWeatherWidget(rawQuery, user).catch(() => null);
    if (weather) return weather;

    const finance = await resolveFinanceWidget(rawQuery).catch(() => null);
    if (finance) return finance;

    const { resolveRegionCompositeWidget } = require('./regionComposite.service');
    const regionComposite = await resolveRegionCompositeWidget(rawQuery).catch(() => null);
    if (regionComposite) return regionComposite;

    const { resolveKakaoMapWidget } = require('./kakaoMapWidget.service');
    const mapWidget = await resolveKakaoMapWidget(rawQuery, user).catch(() => null);
    if (mapWidget) return mapWidget;

    return null;
}

async function getHomeMiniWeather(user) {
    try {
        const city = await getUserWeatherCity(user);
        return await getLiveWeatherData(city);
    } catch (_) {
        return null;
    }
}

module.exports = {
    resolveSmartWidget,
    resolveCalcOrUnitWidget,
    getHomeMiniWeather
};
