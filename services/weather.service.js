const { newsDb } = require('./db');

// 전국 주요 시·군·구 한글명 맵
const CITY_KO_MAP = {
    // 특별시 / 광역시 / 특별자치시·도
    'Seoul': '서울',
    'Gyeryong': '계룡',
    'Daejeon': '대전',
    'Sejong': '세종',
    'Busan': '부산',
    'Incheon': '인천',
    'Daegu': '대구',
    'Gwangju': '광주',
    'Ulsan': '울산',
    'Jeju': '제주',
    'Seogwipo': '서귀포',

    // 경기 주요 도시
    'Suwon': '수원',
    'Seongnam': '성남',
    'Goyang': '고양',
    'Yongin': '용인',
    'Bucheon': '부천',
    'Ansan': '안산',
    'Anyang': '안양',
    'Namyangju': '남양주',
    'Hwaseong': '화성',
    'Pyeongtaek': '평택',
    'Uijeongbu': '의정부',
    'Paju': '파주',
    'Siheung': '시흥',
    'Gimpo': '김포',
    'Gwangmyeong': '광명',
    'Hanam': '하남',
    'Gunpo': '군포',
    'Icheon': '이천',
    'Osan': '오산',
    'Guri': '구리',
    'Anseong': '안성',
    'Uiwang': '의왕',
    'Yangju': '양주',

    // 충청
    'Cheonan': '천안',
    'Cheongju': '청주',
    'Chungju': '충주',
    'Asan': '아산',
    'Seosan': '서산',
    'Dangjin': '당진',
    'Nonsan': '논산',
    'Gongju': '공주',
    'Boryeong': '보령',

    // 강원
    'Chuncheon': '춘천',
    'Wonju': '원주',
    'Gangneung': '강릉',
    'Sokcho': '속초',
    'Donghae': '동해',

    // 호남
    'Jeonju': '전주',
    'Iksan': '익산',
    'Gunsan': '군산',
    'Mokpo': '목포',
    'Yeosu': '여수',
    'Suncheon': '순천',
    'Naju': '나주',
    'Gwangyang': '광양',

    // 영남
    'Changwon': '창원',
    'Pohang': '포항',
    'Gimhae': '김해',
    'Gumi': '구미',
    'Jinju': '진주',
    'Yangsan': '양산',
    'Geoje': '거제',
    'Gyeongju': '경주',
    'Andong': '안동',
    'Gimcheon': '김천'
};

// 전국 주요 시·군·구 위경도 좌표 매핑 (Open-Meteo 호출용)
const CITY_COORDS = {
    'Seoul': { lat: 37.5665, lon: 126.9780 },
    'Gyeryong': { lat: 36.3160, lon: 127.2480 },
    'Daejeon': { lat: 36.3504, lon: 127.3845 },
    'Sejong': { lat: 36.4800, lon: 127.2890 },
    'Busan': { lat: 35.1796, lon: 129.0756 },
    'Incheon': { lat: 37.4563, lon: 126.7052 },
    'Daegu': { lat: 35.8714, lon: 128.6014 },
    'Gwangju': { lat: 35.1595, lon: 126.8526 },
    'Ulsan': { lat: 35.5384, lon: 129.3114 },
    'Jeju': { lat: 33.4996, lon: 126.5312 },
    'Seogwipo': { lat: 33.2541, lon: 126.5601 },

    'Suwon': { lat: 37.2636, lon: 127.0286 },
    'Seongnam': { lat: 37.4200, lon: 127.1265 },
    'Goyang': { lat: 37.6584, lon: 126.8320 },
    'Yongin': { lat: 37.2410, lon: 127.1775 },
    'Bucheon': { lat: 37.5034, lon: 126.7660 },
    'Ansan': { lat: 37.3219, lon: 126.8309 },
    'Anyang': { lat: 37.3943, lon: 126.9568 },
    'Namyangju': { lat: 37.6360, lon: 127.2165 },
    'Hwaseong': { lat: 37.1995, lon: 126.8315 },
    'Pyeongtaek': { lat: 36.9921, lon: 127.1129 },
    'Uijeongbu': { lat: 37.7381, lon: 127.0337 },
    'Paju': { lat: 37.7600, lon: 126.7799 },
    'Siheung': { lat: 37.3802, lon: 126.8029 },
    'Gimpo': { lat: 37.6153, lon: 126.7156 },
    'Gwangmyeong': { lat: 37.4786, lon: 126.8647 },
    'Hanam': { lat: 37.5393, lon: 127.2148 },
    'Gunpo': { lat: 37.3617, lon: 126.9352 },
    'Icheon': { lat: 37.2723, lon: 127.4348 },
    'Osan': { lat: 37.1499, lon: 127.0772 },
    'Guri': { lat: 37.5943, lon: 127.1296 },
    'Anseong': { lat: 37.0080, lon: 127.2798 },
    'Uiwang': { lat: 37.3448, lon: 126.9683 },
    'Yangju': { lat: 37.7853, lon: 127.0458 },

    'Cheonan': { lat: 36.8151, lon: 127.1139 },
    'Cheongju': { lat: 36.6424, lon: 127.4890 },
    'Chungju': { lat: 36.9910, lon: 127.9259 },
    'Asan': { lat: 36.7898, lon: 127.0019 },
    'Seosan': { lat: 36.7845, lon: 126.4503 },
    'Dangjin': { lat: 36.8931, lon: 126.6283 },
    'Nonsan': { lat: 36.1872, lon: 127.0987 },
    'Gongju': { lat: 36.4465, lon: 127.1190 },
    'Boryeong': { lat: 36.3332, lon: 126.6129 },

    'Chuncheon': { lat: 37.8813, lon: 127.7298 },
    'Wonju': { lat: 37.3422, lon: 127.9202 },
    'Gangneung': { lat: 37.7519, lon: 128.8760 },
    'Sokcho': { lat: 38.2070, lon: 128.5918 },
    'Donghae': { lat: 37.5247, lon: 129.1143 },

    'Jeonju': { lat: 35.8242, lon: 127.1480 },
    'Iksan': { lat: 35.9483, lon: 126.9576 },
    'Gunsan': { lat: 35.9676, lon: 126.7366 },
    'Mokpo': { lat: 34.8118, lon: 126.3922 },
    'Yeosu': { lat: 34.7604, lon: 127.6622 },
    'Suncheon': { lat: 34.9506, lon: 127.4872 },
    'Naju': { lat: 35.0161, lon: 126.7108 },
    'Gwangyang': { lat: 34.9407, lon: 127.6959 },

    'Changwon': { lat: 35.2280, lon: 128.6811 },
    'Pohang': { lat: 36.0190, lon: 129.3435 },
    'Gimhae': { lat: 35.2285, lon: 128.8894 },
    'Gumi': { lat: 36.1195, lon: 128.3446 },
    'Jinju': { lat: 35.1802, lon: 128.1076 },
    'Yangsan': { lat: 35.3350, lon: 129.0373 },
    'Geoje': { lat: 34.8806, lon: 128.6211 },
    'Gyeongju': { lat: 35.8562, lon: 129.2247 },
    'Andong': { lat: 36.5684, lon: 128.7294 },
    'Gimcheon': { lat: 36.1398, lon: 128.1136 }
};

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

const CITY_LIST = Object.entries(CITY_KO_MAP).map(([code, name]) => ({ code, name }));
const KO_CITY_MAP = Object.entries(CITY_KO_MAP).reduce((acc, [code, name]) => {
    acc[name] = code;
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
    if (KO_CITY_MAP[trimmed]) return KO_CITY_MAP[trimmed];

    // 한글 접미사(시, 군, 구, 도, 특별자치시 등) 정리 후 검색
    const cleaned = trimmed.replace(/(특별자치시|특별자치도|광역시|시|군|구|도)$/, '').trim();
    if (KO_CITY_MAP[cleaned]) return KO_CITY_MAP[cleaned];

    // 부분 문자열 매칭 (예: "계룡" in "충남 계룡시")
    for (const [kName, eCode] of Object.entries(KO_CITY_MAP)) {
        if (trimmed.includes(kName) || kName.includes(trimmed)) {
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

module.exports = {
    CITY_KO_MAP,
    CITY_COORDS,
    CITY_LIST,
    normalizeCityCode,
    getDefaultWeatherCity,
    getLiveWeatherData,
    refreshWeatherInBackground
};
