const { newsDb, db } = require('./db');

// 전국 주요 시·군·구 한글명 및 위경도 좌표 데이터베이스 모듈 임포트
const { CITY_KO_MAP, CITY_COORDS } = require('./weather.coords');

// WMO 기상 코드 한국어 매핑 테이블
const WMO_CODE_KO = {
    0: '맑음',
    1: '대체로 맑음',
    2: '구름 조금',
    3: '흐림',
    45: '안개',
    48: '짙은 안개',
    51: '약한 이슬비',
    53: '이슬비',
    55: '강한 이슬비',
    56: '어는 이슬비',
    57: '강한 어는 이슬비',
    51: '약한 비',
    63: '비',
    65: '강한 비',
    66: '어는 비',
    67: '강한 어는 비',
    71: '약한 눈',
    73: '눈',
    75: '강한 눈',
    77: '싸락눈',
    80: '약한 소나기',
    81: '소나기',
    82: '폭우',
    85: '눈 소나기',
    86: '강한 눈 소나기',
    95: '뇌우',
    96: '우박 동반 뇌우',
    99: '강한 우박 동반 뇌우'
};

function getWeatherIcon(condition, is_day = 1) {
    if (!condition) return is_day === 0 ? '🌙' : '☀️';
    const cond = String(condition).trim();

    if (is_day === 0) {
        if (cond === '맑음' || cond === '대체로 맑음') return '🌙';
        if (cond === '구름 조금' || cond === '대체로 흐림') return '☁️🌙';
    }

    if (cond.includes('뇌우') || cond.includes('우박')) return '⛈️';
    if (cond.includes('눈')) return '❄️';
    if (cond.includes('소나기')) return '🌦️';
    if (cond.includes('비') || cond.includes('이슬비')) return '🌧️';
    if (cond.includes('안개')) return '🌫️';
    if (cond === '흐림') return '☁️';
    if (cond === '구름 조금') return is_day === 0 ? '☁️🌙' : '⛅';
    if (cond === '대체로 맑음') return is_day === 0 ? '🌙' : '🌤️';
    if (cond === '맑음') return is_day === 0 ? '🌙' : '☀️';

    return is_day === 0 ? '🌙' : '🌤️';
}

function getWeatherIconSlug(condition, is_day = 1) {
    if (!condition) return is_day === 1 ? 'clear-day' : 'clear-night';
    const cond = String(condition).trim();
    if (/뇌우|우박|천둥/.test(cond)) return 'thunderstorms-rain';
    if (/진눈깨비/.test(cond)) return 'sleet';
    if (/눈|싸락눈/.test(cond)) return 'snow';
    if (/소나기/.test(cond)) return is_day === 1 ? 'partly-cloudy-day-rain' : 'partly-cloudy-night-rain';
    if (/폭우|강한\s*비|비/.test(cond)) return 'rain';
    if (/이슬비|약한\s*비/.test(cond)) return 'drizzle';
    if (/안개/.test(cond)) return 'fog';
    if (cond === '흐림') return 'overcast';
    if (/구름\s*많음|구름\s*조금|대체로\s*흐림/.test(cond)) return is_day === 1 ? 'partly-cloudy-day' : 'partly-cloudy-night';
    if (/맑음|대체로\s*맑음/.test(cond)) return is_day === 1 ? 'clear-day' : 'clear-night';
    return is_day === 1 ? 'clear-day' : 'clear-night';
}

const CITY_LIST = Object.entries(CITY_KO_MAP)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

const KO_CITY_MAP = Object.entries(CITY_KO_MAP).reduce((acc, [code, name]) => {
    acc[name.toLowerCase()] = code;
    // '서울 강남' -> '강남'도 매핑
    const subName = name.replace(/^(서울|경기|강원|경남|경북|전남|전북|충남|충북)\s*/, '').trim().toLowerCase();
    if (subName && !acc[subName]) {
        acc[subName] = code;
    }
    return acc;
}, {});

// 도시별 메모리 날씨 캐시 (TTL: 10분)
const weatherCacheMap = new Map();
const inFlightWeatherFetches = new Map();
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;

// 서울 초기 기본 날씨 데이터 (0ms 즉시 응답용 안전 폴백)
const DEFAULT_SEOUL_FALLBACK = {
    city: '서울',
    city_code: 'Seoul',
    temp: '15.0°C',
    condition: '맑음',
    icon: '☀️',
    icon_slug: 'clear-day',
    icon_url: 'https://cdn.jsdelivr.net/gh/basmilius/weather-icons@dev/production/fill/svg/clear-day.svg',
    is_day: 1,
    feels_like: '15.0°C',
    humidity: '50%',
    wind_speed: '5.0km/h'
};
weatherCacheMap.set('Seoul', { timestamp: 0, data: DEFAULT_SEOUL_FALLBACK });

function normalizeCityCode(cityInput) {
    if (!cityInput || typeof cityInput !== 'string') return 'Seoul';
    const trimmed = cityInput.trim();
    if (CITY_COORDS[trimmed]) return trimmed;
    const lower = trimmed.toLowerCase();
    if (KO_CITY_MAP[lower]) return KO_CITY_MAP[lower];

    // 한글 접미사(시, 군, 구, 도, 특별자치시 등) 정리 후 검색
    const cleaned = lower.replace(/(특별자치시|특별자치도|광역시|시|군|구|도)$/, '').trim();
    if (KO_CITY_MAP[cleaned]) return KO_CITY_MAP[cleaned];

    // 부분 문자열 매칭 (예: "홍성" in "충남 홍성군")
    for (const [kName, eCode] of Object.entries(KO_CITY_MAP)) {
        if (lower.includes(kName) || kName.includes(lower) || cleaned.includes(kName) || kName.includes(cleaned)) {
            return eCode;
        }
    }

    return 'Seoul';
}

/**
 * 🌐 시스템 기본 날씨 도시 조회 (단일 진실 공급원: briefing.db system_settings)
 */
function getDefaultWeatherCity() {
    return new Promise((resolve) => {
        if (!newsDb) return resolve('Seoul');
        newsDb.get("SELECT value FROM system_settings WHERE key = 'weather_city'", [], (err, row) => {
            if (!err && row && row.value && row.value.trim()) {
                return resolve(normalizeCityCode(row.value.trim()));
            }
            resolve('Seoul');
        });
    });
}

async function refreshWeatherInBackground(rawCity, korCityName) {
    const cityKey = normalizeCityCode(rawCity);
    if (inFlightWeatherFetches.has(cityKey)) {
        return inFlightWeatherFetches.get(cityKey);
    }

    const fetchPromise = (async () => {
        try {
            const coords = CITY_COORDS[cityKey] || CITY_COORDS['Seoul'];
            const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,cloud_cover,wind_speed_10m&timezone=Asia%2FTokyo`;

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const resp = await fetch(openMeteoUrl, {
                headers: { 'User-Agent': 'JG-Portal/1.0' },
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (resp.ok) {
                const data = await resp.json();
                const curr = data && data.current ? data.current : null;
                if (curr) {
                    const tempVal = typeof curr.temperature_2m === 'number' ? curr.temperature_2m : parseFloat(curr.temperature_2m || 0);
                    const feelsVal = typeof curr.apparent_temperature === 'number' ? curr.apparent_temperature : parseFloat(curr.apparent_temperature || 0);
                    const isDay = typeof curr.is_day === 'number' ? curr.is_day : 1;
                    const weatherCode = typeof curr.weather_code === 'number' ? curr.weather_code : 0;

                    const conditionKo = WMO_CODE_KO[weatherCode] || '맑음';
                    const icon = getWeatherIcon(conditionKo, isDay);
                    const iconSlug = getWeatherIconSlug(conditionKo, isDay);
                    const displayName = korCityName || CITY_KO_MAP[cityKey] || cityKey;

                    const weatherData = {
                        city: displayName,
                        city_code: cityKey,
                        temp: `${tempVal.toFixed(1)}°C`,
                        condition: conditionKo,
                        icon: icon,
                        icon_slug: iconSlug,
                        icon_url: `https://cdn.jsdelivr.net/gh/basmilius/weather-icons@dev/production/fill/svg/${iconSlug}.svg`,
                        is_day: isDay,
                        feels_like: `${feelsVal.toFixed(1)}°C`,
                        humidity: `${curr.relative_humidity_2m || 0}%`,
                        wind_speed: `${curr.wind_speed_10m || 0}km/h`
                    };

                    weatherCacheMap.set(cityKey, {
                        timestamp: Date.now(),
                        data: weatherData
                    });

                    return weatherData;
                }
            }
        } catch (e) {
            // 실패 시 기존 캐시 또는 기본 폴백 유지
        } finally {
            inFlightWeatherFetches.delete(cityKey);
        }
        const existing = weatherCacheMap.get(cityKey);
        return existing ? existing.data : DEFAULT_SEOUL_FALLBACK;
    })();

    inFlightWeatherFetches.set(cityKey, fetchPromise);
    return fetchPromise;
}

async function getLiveWeatherData(requestedCity) {
    let targetCity = requestedCity;
    if (!targetCity) {
        targetCity = await getDefaultWeatherCity();
    }
    const cityKey = normalizeCityCode(targetCity);
    const korCityName = CITY_KO_MAP[cityKey] || '서울';
    const now = Date.now();
    const cached = weatherCacheMap.get(cityKey);

    // 1. 유효한 신선 캐시 (10분 이내) -> 0ms 즉시 반환
    if (cached && cached.data && (now - cached.timestamp < WEATHER_CACHE_TTL_MS) && cached.timestamp > 0) {
        return cached.data;
    }

    // 2. 만료되었지만 기존 캐시가 있음 -> 0ms 즉시 반환하고 백그라운드 비동기 갱신 (SWR)
    if (cached && cached.data) {
        refreshWeatherInBackground(cityKey, korCityName);
        return cached.data;
    }

    // 3. 최초 요청 시 -> 비동기 조회 후 반환
    const freshData = await refreshWeatherInBackground(cityKey, korCityName);
    return freshData || DEFAULT_SEOUL_FALLBACK;
}

/**
 * 📍 주기적 갱신 대상 도시 목록 추출
 * 1) 기본 시스템 도시 (system_settings의 weather_city)
 * 2) 사용자 DB(users)에 등록된 개별 날씨 설정 도시
 * 3) 서울(Seoul) 및 계룡(Gyeryong) 기본 포함
 */
async function getActiveWeatherCities() {
    const citySet = new Set(['Seoul', 'Gyeryong']);
    try {
        const defaultCity = await getDefaultWeatherCity();
        if (defaultCity) citySet.add(normalizeCityCode(defaultCity));
    } catch (e) {}

    try {
        if (db) {
            const userCities = await new Promise((resolve) => {
                db.all("SELECT DISTINCT weather_city FROM users WHERE weather_city IS NOT NULL AND weather_city != ''", [], (err, rows) => {
                    if (err || !Array.isArray(rows)) return resolve([]);
                    resolve(rows.map(r => r.weather_city && r.weather_city.trim()).filter(Boolean));
                });
            });
            for (const c of userCities) {
                citySet.add(normalizeCityCode(c));
            }
        }
    } catch (e) {}

    return Array.from(citySet);
}

/**
 * 🔄 활성 도시 날씨 일괄 백그라운드 갱신
 */
async function refreshAllActiveWeather() {
    try {
        const cities = await getActiveWeatherCities();
        const results = [];
        for (const city of cities) {
            try {
                const korName = CITY_KO_MAP[city] || city;
                const data = await refreshWeatherInBackground(city, korName);
                if (data && data.temp) {
                    results.push(`${data.city || korName}(${data.temp})`);
                }
            } catch (err) {
                // 개별 도시 실패 시에도 다음 도시 계속 진행
            }
        }
        if (results.length > 0) {
            console.log(`[WeatherService] 🌤️ 날씨 주기적 자동 갱신 완료 (${results.length}개 지역: ${results.join(', ')})`);
        }
    } catch (err) {
        console.error('[WeatherService] 날씨 주기적 자동 갱신 중 오류:', err.message);
    }
}

let autoRefreshTimer = null;

/**
 * ⏰ 날씨 주기적 자동 갱신 스케줄러 (기본 10분 주기)
 */
function initWeatherAutoRefresh(intervalMs = 10 * 60 * 1000) {
    if (autoRefreshTimer) return;
    // 서버 기동 1.5초 후 초기 1회 즉시 갱신
    setTimeout(() => {
        refreshAllActiveWeather().catch(() => {});
    }, 1500);

    // 10분 주기 자동 갱신 등록
    autoRefreshTimer = setInterval(() => {
        refreshAllActiveWeather().catch(() => {});
    }, intervalMs);

    if (autoRefreshTimer.unref) {
        autoRefreshTimer.unref();
    }
    console.log(`[WeatherService] ⏰ 주기적 날씨 자동 갱신 스케줄러 등록 완료 (주기: ${Math.round(intervalMs / 60000)}분)`);
}

module.exports = {
    CITY_KO_MAP,
    CITY_COORDS,
    CITY_LIST,
    normalizeCityCode,
    getDefaultWeatherCity,
    getLiveWeatherData,
    refreshWeatherInBackground,
    getActiveWeatherCities,
    refreshAllActiveWeather,
    initWeatherAutoRefresh
};
