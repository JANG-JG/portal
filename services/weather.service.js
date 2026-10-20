const { newsDb } = require('./db');

// 도시 한글명 맵
const CITY_KO_MAP = {
    'Seoul': '서울',
    'Gyeryong': '계룡',
    'Daejeon': '대전',
    'Busan': '부산',
    'Incheon': '인천',
    'Daegu': '대구',
    'Gwangju': '광주',
    'Ulsan': '울산',
    'Sejong': '세종',
    'Suwon': '수원',
    'Seongnam': '성남',
    'Goyang': '고양',
    'Yongin': '용인',
    'Cheonan': '천안',
    'Cheongju': '청주',
    'Jeonju': '전주',
    'Changwon': '창원',
    'Pohang': '포항',
    'Chuncheon': '춘천',
    'Gangneung': '강릉',
    'Jeju': '제주'
};

// 한국 주요 도시 위경도 좌표 매핑
const CITY_COORDS = {
    'Seoul': { lat: 37.5665, lon: 126.9780 },
    'Gyeryong': { lat: 36.3160, lon: 127.2480 },
    'Daejeon': { lat: 36.3504, lon: 127.3845 },
    'Busan': { lat: 35.1796, lon: 129.0756 },
    'Incheon': { lat: 37.4563, lon: 126.7052 },
    'Daegu': { lat: 35.8714, lon: 128.6014 },
    'Gwangju': { lat: 35.1595, lon: 126.8526 },
    'Ulsan': { lat: 35.5384, lon: 129.3114 },
    'Sejong': { lat: 36.4800, lon: 127.2890 },
    'Suwon': { lat: 37.2636, lon: 127.0286 },
    'Seongnam': { lat: 37.4200, lon: 127.1265 },
    'Goyang': { lat: 37.6584, lon: 126.8320 },
    'Yongin': { lat: 37.2410, lon: 127.1775 },
    'Cheonan': { lat: 36.8151, lon: 127.1139 },
    'Cheongju': { lat: 36.6424, lon: 127.4890 },
    'Jeonju': { lat: 35.8242, lon: 127.1480 },
    'Changwon': { lat: 35.2280, lon: 128.6811 },
    'Pohang': { lat: 36.0190, lon: 129.3435 },
    'Chuncheon': { lat: 37.8813, lon: 127.7298 },
    'Gangneung': { lat: 37.7519, lon: 128.8760 },
    'Jeju': { lat: 33.4996, lon: 126.5312 }
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

let weatherCache = {
    timestamp: 0,
    data: {
        city: '계룡',
        temp: '13.0°C',
        condition: '맑음',
        icon: '🌤️',
        icon_slug: 'clear-day',
        icon_url: 'https://cdn.jsdelivr.net/gh/basmilius/weather-icons@dev/production/fill/svg/clear-day.svg',
        is_day: 1
    }
};
let isWeatherFetching = false;

async function refreshWeatherInBackground(rawCity, korCityName) {
    if (isWeatherFetching) return;
    isWeatherFetching = true;
    try {
        const coords = CITY_COORDS[rawCity] || CITY_COORDS['Gyeryong'] || { lat: 36.3160, lon: 127.2480 };
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

                weatherCache = {
                    timestamp: Date.now(),
                    data: {
                        city: korCityName,
                        temp: `${tempVal.toFixed(1)}°C`,
                        condition: conditionKo,
                        icon: icon,
                        icon_slug: iconSlug,
                        icon_url: `https://cdn.jsdelivr.net/gh/basmilius/weather-icons@dev/production/fill/svg/${iconSlug}.svg`,
                        is_day: isDay,
                        feels_like: `${feelsVal.toFixed(1)}°C`,
                        humidity: `${curr.relative_humidity_2m || 0}%`,
                        wind_speed: `${curr.wind_speed_10m || 0}km/h`
                    }
                };
                return;
            }
        }
    } catch (e) {
    } finally {
        isWeatherFetching = false;
    }
}

async function getLiveWeatherData() {
    const now = Date.now();
    if (weatherCache.data && (now - weatherCache.timestamp < 10 * 60 * 1000)) {
        return weatherCache.data;
    }

    let rawCity = 'Gyeryong';
    try {
        const row = await new Promise((res) => {
            newsDb.get("SELECT value FROM system_settings WHERE key = 'weather_city'", (err, r) => res(r || null));
        });
        if (row && row.value && row.value.trim()) {
            rawCity = row.value.trim();
        }
    } catch (e) {}
    const korCityName = CITY_KO_MAP[rawCity] || rawCity;

    if (weatherCache.data && weatherCache.timestamp > 0) {
        refreshWeatherInBackground(rawCity, korCityName);
        return weatherCache.data;
    }

    refreshWeatherInBackground(rawCity, korCityName);
    return weatherCache.data;
}

module.exports = {
    CITY_KO_MAP,
    CITY_COORDS,
    getLiveWeatherData,
    refreshWeatherInBackground
};
