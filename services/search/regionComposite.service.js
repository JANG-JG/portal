/**
 * 🗺️ JG 통합 검색 - 지역·여행지 종합 브리핑 서비스 (regionComposite.service.js)
 * - 지역·동네·여행지 의도 감지 시 상단 올인원 복합 카드 데이터 생성:
 *   [위키백과 개요 + 대표 풍경 사진 + 카카오 미니맵] + [현재 날씨·미세먼지 + 7일 주간예보] + [인기 명소·맛집 TOP 4]
 * - 단독 날씨 검색용 7일 주간예보 보강 헬퍼 및 장소 썸네일 매칭 캐시 공유
 */

const axios = require('axios');
const { CITY_KO_MAP, CITY_COORDS, getLiveWeatherData } = require('../weather.service');
const { incrementUsage, isEngineEnabled } = require('./externalSearch.service');
const { fetchDaumEndpoint } = require('./daumSearch.service');

const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const KAKAO_CATEGORY_URL = 'https://dapi.kakao.com/v2/local/search/category.json';
const KAKAO_ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json';

const REGION_CACHE_TTL_MS = 10 * 60 * 1000;
const THUMB_CACHE_TTL_MS = 30 * 60 * 1000;
const regionCache = new Map();
const coordWeatherCache = new Map();
const placeThumbCache = new Map();

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
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

const WEATHER_EXCLUDE_RE = /(날씨|기온|온도|미세먼지|초미세먼지|강수|비와|비오|눈와|예보|일기예보)/;
const SPECIFIC_PLACE_EXCLUDE_RE = /(맛집|식당|음식점|횟집|고깃집|삼겹살|갈비|국밥|짬뽕|짜장면|파스타|초밥|스시|돈까스|냉면|칼국수|치킨|피자|술집|브런치|카페|커피|디저트|빵집|베이커리|병원|의원|치과|한의원|소아과|내과|약국|주차장|주유소|충전소|편의점|마트|백화점|은행|숙소|호텔|펜션|모텔|리조트|캠핑장|역|터미널|공항|학교|구청|시청|군청|도청|주민센터|행정복지센터|보건소|우체국|경찰서|도서관|영화관|미용실|길찾기|가는길|오시는길|어디야|어디에|주소|지도|근처|주변|가까운|내주변)/;
const TRAVEL_SUFFIX_RE = /\s*(여행코스|여행지|여행|가볼만한\s*곳|가볼만한곳|관광지|관광명소|관광|놀거리|볼거리|나들이|지역\s*정보|지역정보)$/;

// 행정구역 코드 외 자주 검색되는 국내 대표 권역·명소 좌표 사전
const FAMOUS_DESTINATIONS = {
    '해운대': { label: '부산 해운대', shortName: '해운대', lat: 35.1587, lng: 129.1604, cityCode: 'Busan', sub: true },
    '광안리': { label: '부산 광안리', shortName: '광안리', lat: 35.1532, lng: 129.1186, cityCode: 'Busan', sub: true },
    '성수동': { label: '서울 성수동', shortName: '성수동', lat: 37.5446, lng: 127.0560, cityCode: 'Seoul-Seongdong', sub: true },
    '성수': { label: '서울 성수동', shortName: '성수동', lat: 37.5446, lng: 127.0560, cityCode: 'Seoul-Seongdong', sub: true },
    '연남동': { label: '서울 연남동', shortName: '연남동', lat: 37.5662, lng: 126.9256, cityCode: 'Seoul-Mapo', sub: true },
    '홍대': { label: '서울 홍대입구·서교동', shortName: '홍대', lat: 37.5563, lng: 126.9236, cityCode: 'Seoul-Mapo', sub: true },
    '명동': { label: '서울 명동', shortName: '명동', lat: 37.5636, lng: 126.9869, cityCode: 'Seoul-Junggu', sub: true },
    '인사동': { label: '서울 인사동', shortName: '인사동', lat: 37.5741, lng: 126.9849, cityCode: 'Seoul-Jongno', sub: true },
    '익선동': { label: '서울 익선동', shortName: '익선동', lat: 37.5744, lng: 126.9898, cityCode: 'Seoul-Jongno', sub: true },
    '여의도': { label: '서울 여의도', shortName: '여의도', lat: 37.5216, lng: 126.9242, cityCode: 'Seoul-Yeongdeungpo', sub: true },
    '잠실': { label: '서울 잠실', shortName: '잠실', lat: 37.5133, lng: 127.1001, cityCode: 'Seoul-Songpa', sub: true },
    '판교': { label: '성남 판교', shortName: '판교', lat: 37.3948, lng: 127.1112, cityCode: 'Seongnam', sub: true },
    '송도': { label: '인천 송도국제도시', shortName: '송도', lat: 37.3925, lng: 126.6396, cityCode: 'Incheon', sub: true },
    '을왕리': { label: '인천 을왕리', shortName: '을왕리', lat: 37.4475, lng: 126.3725, cityCode: 'Incheon', sub: true },
    '대부도': { label: '안산 대부도', shortName: '대부도', lat: 37.2423, lng: 126.5839, cityCode: 'Ansan', sub: true },
    '남이섬': { label: '춘천·가평 남이섬', shortName: '남이섬', lat: 37.7914, lng: 127.5256, cityCode: 'Gapyeong', sub: true },
    '정동진': { label: '강릉 정동진', shortName: '정동진', lat: 37.6908, lng: 129.0343, cityCode: 'Gangneung', sub: true },
    '경포대': { label: '강릉 경포대', shortName: '경포대', lat: 37.7955, lng: 128.8966, cityCode: 'Gangneung', sub: true },
    '대관령': { label: '평창 대관령', shortName: '대관령', lat: 37.6766, lng: 128.7186, cityCode: null, sub: true },
    '우도': { label: '제주 우도', shortName: '우도', lat: 33.5043, lng: 126.9540, cityCode: 'Jeju', sub: true },
    '애월': { label: '제주 애월읍', shortName: '애월', lat: 33.4622, lng: 126.3289, cityCode: 'Jeju', sub: true },
    '협재': { label: '제주 협재해변', shortName: '협재', lat: 33.3943, lng: 126.2399, cityCode: 'Jeju', sub: true },
    '성산일출봉': { label: '서귀포 성산일출봉', shortName: '성산일출봉', lat: 33.4581, lng: 126.9425, cityCode: 'Seogwipo', sub: true },
    '중문': { label: '서귀포 중문관광단지', shortName: '중문', lat: 33.2494, lng: 126.4123, cityCode: 'Seogwipo', sub: true },
    '울릉도': { label: '경북 울릉도', shortName: '울릉도', lat: 37.4844, lng: 130.9057, cityCode: null, sub: false },
    '독도': { label: '경북 울릉군 독도', shortName: '독도', lat: 37.2420, lng: 131.8645, cityCode: null, sub: true },
    '거제도': { label: '경남 거제도', shortName: '거제', lat: 34.8806, lng: 128.6211, cityCode: 'Geoje', sub: false },
    '황리단길': { label: '경주 황리단길', shortName: '황리단길', lat: 35.8376, lng: 129.2097, cityCode: 'Gyeongju', sub: true },
    '전주한옥마을': { label: '전주 한옥마을', shortName: '전주한옥마을', lat: 35.8147, lng: 127.1526, cityCode: 'Jeonju', sub: true },
    '안면도': { label: '충남 태안 안면도', shortName: '안면도', lat: 36.5122, lng: 126.3458, cityCode: null, sub: true }
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

function getKakaoRestKey() {
    return (process.env.KAKAO_REST_API_KEY || '').trim();
}

function getKakaoJsKey() {
    return (process.env.KAKAO_JS_KEY || '').trim();
}

function getMapBounded(map, key, ttl) {
    const entry = map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > ttl) {
        map.delete(key);
        return null;
    }
    return entry.data;
}

function setMapBounded(map, key, data, max = 250) {
    if (map.size >= max) {
        const first = map.keys().next().value;
        if (first) map.delete(first);
    }
    map.set(key, { ts: Date.now(), data });
}

function clearRegionCompositeCache() {
    const count = regionCache.size + coordWeatherCache.size + placeThumbCache.size;
    regionCache.clear();
    coordWeatherCache.clear();
    placeThumbCache.clear();
    return count;
}

function formatDayLabel(isoDate, idx) {
    if (idx === 0) return '오늘';
    if (idx === 1) return '내일';
    const parts = String(isoDate || '').split('-').map(Number);
    if (parts.length === 3 && !isNaN(parts[0])) {
        const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        return `${WEEKDAYS_KO[dt.getUTCDay()]}요일`;
    }
    return isoDate ? isoDate.slice(5) : '';
}

function formatShortDate(isoDate) {
    const parts = String(isoDate || '').split('-');
    if (parts.length === 3) return `${Number(parts[1])}/${Number(parts[2])}`;
    return '';
}

/**
 * 위경도 기준 현재 날씨 + 7일 주간예보 조회 (Open-Meteo + 국내 미세먼지 병합)
 */
async function fetchCoord7DayWeather(lat, lng, baseWeather = null, cityLabel = '') {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return baseWeather;
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    let rawWx = getMapBounded(coordWeatherCache, key, REGION_CACHE_TTL_MS);

    if (!rawWx) {
        try {
            const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
                params: {
                    latitude: lat,
                    longitude: lng,
                    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m',
                    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
                    timezone: 'auto',
                    forecast_days: 7
                },
                timeout: 3500
            });
            if (res.data?.current) {
                rawWx = res.data;
                setMapBounded(coordWeatherCache, key, rawWx, 200);
            }
        } catch (_) {
            rawWx = null;
        }
    }

    if (!rawWx?.current) return baseWeather;
    const cur = rawWx.current;
    const daily = rawWx.daily || {};
    const forecast7d = (daily.time || []).slice(0, 7).map((date, idx) => {
        const code = daily.weather_code?.[idx];
        const minNum = daily.temperature_2m_min?.[idx];
        const maxNum = daily.temperature_2m_max?.[idx];
        const rainNum = daily.precipitation_probability_max?.[idx];
        return {
            date,
            dateShort: formatShortDate(date),
            label: formatDayLabel(date, idx),
            condition: WMO_KO[code] || '맑음',
            icon: wmoToIcon(code, 1),
            min: typeof minNum === 'number' ? `${Math.round(minNum)}°` : '-',
            max: typeof maxNum === 'number' ? `${Math.round(maxNum)}°` : '-',
            rain: typeof rainNum === 'number' ? `${rainNum}%` : '0%',
            rainProb: typeof rainNum === 'number' ? rainNum : 0
        };
    });

    return {
        city: cityLabel || baseWeather?.city || '현재 지역',
        isGlobal: Boolean(baseWeather?.isGlobal),
        temp: baseWeather?.temp || `${cur.temperature_2m.toFixed(1)}°C`,
        feels_like: baseWeather?.feels_like || `${cur.apparent_temperature.toFixed(1)}°C`,
        condition: baseWeather?.condition || WMO_KO[cur.weather_code] || '맑음',
        icon: baseWeather?.icon || wmoToIcon(cur.weather_code, cur.is_day),
        humidity: baseWeather?.humidity || `${cur.relative_humidity_2m}%`,
        wind_speed: baseWeather?.wind_speed || `${cur.wind_speed_10m}km/h`,
        pm10_grade: baseWeather?.pm10_grade || null,
        pm25_grade: baseWeather?.pm25_grade || null,
        forecast: forecast7d
    };
}

/**
 * 장소 배열에 대표 이미지(카카오 이미지 검색 기반 30분 캐시) 고속 매칭
 */
async function enrichPlacesWithThumbnails(places = [], regionHint = '', maxCount = 5) {
    if (!Array.isArray(places) || places.length === 0) return places;
    const targets = places.slice(0, maxCount);

    const tasks = targets.map(async (pl) => {
        if (!pl || !pl.name || pl.thumbnail) return;
        const cacheKey = `${regionHint}:${pl.name}`.toLowerCase();
        const cached = getMapBounded(placeThumbCache, cacheKey, THUMB_CACHE_TTL_MS);
        if (cached !== null) {
            if (cached) pl.thumbnail = cached;
            return;
        }
        const searchQ = regionHint && !pl.name.includes(regionHint) ? `${regionHint} ${pl.name}` : pl.name;
        const bucket = await fetchDaumEndpoint('image', searchQ, 2, 1).catch(() => null);
        const found = bucket?.items?.find((it) => it.thumbnail && /^https?:\/\//i.test(it.thumbnail));
        const thumbUrl = found ? found.thumbnail : '';
        setMapBounded(placeThumbCache, cacheKey, thumbUrl, 400);
        if (thumbUrl) pl.thumbnail = thumbUrl;
    });

    await Promise.race([
        Promise.allSettled(tasks),
        new Promise((resolve) => setTimeout(resolve, 1400))
    ]);
    return places;
}

function findCityMatch(rawText) {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) return null;
    if (CITY_COORDS[trimmed]) {
        return { code: trimmed, label: CITY_KO_MAP[trimmed] || trimmed, shortName: CITY_KO_MAP[trimmed] || trimmed, coord: CITY_COORDS[trimmed] };
    }
    const lower = trimmed.toLowerCase();
    const cleaned = lower.replace(/(특별자치시|특별자치도|특별시|광역시|시|군|구|도)$/, '').trim();
    for (const [code, koName] of Object.entries(CITY_KO_MAP)) {
        const koLower = koName.toLowerCase();
        const subName = koLower.replace(/^(서울|경기|강원|경남|경북|전남|전북|충남|충북)\s*/, '').trim();
        if (lower === koLower || lower === subName || (cleaned && cleaned.length >= 2 && (cleaned === koLower || cleaned === subName))) {
            const coord = CITY_COORDS[code];
            if (coord) return { code, label: koName, shortName: subName || koName, coord };
        }
    }
    return null;
}

async function fetchRegionWiki(candidates = []) {
    for (const term of candidates) {
        if (!term) continue;
        try {
            const searchRes = await axios.get('https://ko.wikipedia.org/w/api.php', {
                params: { action: 'opensearch', search: term, limit: 1, namespace: 0, format: 'json' },
                headers: { 'User-Agent': 'JG-Portal-Search/1.0' },
                timeout: 2400
            });
            const topTitle = searchRes.data?.[1]?.[0];
            if (!topTitle) continue;
            const sumRes = await axios.get(`https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`, {
                headers: { 'User-Agent': 'JG-Portal-Search/1.0' },
                timeout: 2400
            });
            const d = sumRes.data;
            if (d?.extract) {
                return {
                    title: d.title || topTitle,
                    description: d.description || '',
                    extract: d.extract.length > 230 ? `${d.extract.slice(0, 230)}...` : d.extract,
                    thumbnail: d.thumbnail?.source || '',
                    url: d.content_urls?.desktop?.page || `https://ko.wikipedia.org/wiki/${encodeURIComponent(topTitle)}`
                };
            }
        } catch (_) {}
    }
    return null;
}

function mapHighlightDoc(doc) {
    const lat = parseFloat(doc.y);
    const lng = parseFloat(doc.x);
    const name = String(doc.place_name || '').trim();
    const enc = encodeURIComponent(name);
    return {
        id: doc.id || `${lat},${lng}`,
        name,
        category: String(doc.category_name || '').split('>').pop().trim(),
        categoryGroup: doc.category_group_code || '',
        roadAddress: doc.road_address_name || doc.address_name || '',
        phone: doc.phone || '',
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        kakaoUrl: Number.isFinite(lat) ? `https://map.kakao.com/link/map/${enc},${lat},${lng}` : `https://map.kakao.com/link/search/${enc}`,
        naverUrl: `https://map.naver.com/p/search/${enc}`,
        directionsUrl: Number.isFinite(lat) ? `https://map.kakao.com/link/to/${enc},${lat},${lng}` : `https://map.kakao.com/link/search/${enc}`,
        thumbnail: ''
    };
}

async function fetchRegionHighlights(shortName, lat, lng, radius = 10000) {
    const key = getKakaoRestKey();
    if (!key || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const headers = { Authorization: `KakaoAK ${key}` };

    const [spotRes, foodRes] = await Promise.allSettled([
        axios.get(KAKAO_CATEGORY_URL, {
            params: { category_group_code: 'AT4', x: lng, y: lat, radius, size: 4 },
            headers,
            timeout: 2600
        }),
        axios.get(KAKAO_KEYWORD_URL, {
            params: { query: `${shortName} 맛집`, x: lng, y: lat, radius, size: 4 },
            headers,
            timeout: 2600
        })
    ]);
    await incrementUsage('kakaoMap', false).catch(() => {});

    const spots = (spotRes.status === 'fulfilled' ? spotRes.value.data?.documents || [] : []).map(mapHighlightDoc).filter((p) => p.lat && p.lng);
    const foods = (foodRes.status === 'fulfilled' ? foodRes.value.data?.documents || [] : []).map(mapHighlightDoc).filter((p) => p.lat && p.lng);

    const seen = new Set();
    const combined = [];
    const maxLen = Math.max(spots.length, foods.length);
    for (let i = 0; i < maxLen && combined.length < 4; i += 1) {
        if (spots[i] && !seen.has(spots[i].id)) {
            seen.add(spots[i].id);
            combined.push(spots[i]);
        }
        if (combined.length < 4 && foods[i] && !seen.has(foods[i].id)) {
            seen.add(foods[i].id);
            combined.push(foods[i]);
        }
    }
    return enrichPlacesWithThumbnails(combined, shortName, 4);
}

async function resolveTargetRegion(coreText, hasTravelSuffix) {
    const famous = FAMOUS_DESTINATIONS[coreText.replace(/\s+/g, '')];
    if (famous) return { ...famous, isGlobal: false };

    const city = findCityMatch(coreText);
    if (city) {
        return {
            label: city.label,
            shortName: city.shortName,
            lat: city.coord.lat,
            lng: city.coord.lon,
            cityCode: city.code,
            sub: /^(Seoul-|Busan-)/.test(city.code),
            isGlobal: false
        };
    }

    const key = getKakaoRestKey();
    if (key && (/(시|군|구|읍|면|동|가|리|섬|도)$/.test(coreText) || hasTravelSuffix)) {
        try {
            const addrRes = await axios.get(KAKAO_ADDRESS_URL, {
                params: { query: coreText, size: 2 },
                headers: { Authorization: `KakaoAK ${key}` },
                timeout: 2500
            });
            const doc = (addrRes.data?.documents || []).find((d) => d.address_type === 'REGION' || hasTravelSuffix);
            if (doc && doc.y && doc.x) {
                const fullAddr = doc.address?.address_name || doc.address_name || coreText;
                const tokens = fullAddr.split(/\s+/).filter(Boolean);
                const shortName = tokens[tokens.length - 1] || coreText;
                return {
                    label: fullAddr,
                    shortName,
                    lat: parseFloat(doc.y),
                    lng: parseFloat(doc.x),
                    cityCode: null,
                    sub: /(읍|면|동|가|리)$/.test(shortName),
                    isGlobal: false
                };
            }
        } catch (_) {}
    }

    if (hasTravelSuffix && coreText.length >= 2) {
        try {
            const geoRes = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
                params: { name: coreText, count: 1, language: 'ko', format: 'json' },
                timeout: 2600
            });
            const g = geoRes.data?.results?.[0];
            if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
                return {
                    label: g.country ? `${g.name} (${g.country})` : g.name,
                    shortName: g.name || coreText,
                    lat: g.latitude,
                    lng: g.longitude,
                    cityCode: null,
                    sub: false,
                    isGlobal: true
                };
            }
        } catch (_) {}
    }
    return null;
}

async function resolveRegionCompositeWidget(rawQuery) {
    const q = String(rawQuery || '').trim();
    if (!q || q.length < 2 || q.length > 40) return null;
    if (WEATHER_EXCLUDE_RE.test(q) || SPECIFIC_PLACE_EXCLUDE_RE.test(q)) return null;
    if (/^[0-9a-zA-Z\s+\-*/=.%]+$/.test(q)) return null;

    const enabled = await isEngineEnabled('kakaoMap');
    if (!enabled) return null;

    const cacheKey = `region:${q.toLowerCase()}`;
    const cached = getMapBounded(regionCache, cacheKey, REGION_CACHE_TTL_MS);
    if (cached !== null) return cached;

    const hasTravelSuffix = TRAVEL_SUFFIX_RE.test(q);
    const coreText = q.replace(TRAVEL_SUFFIX_RE, '').trim();
    if (!coreText || coreText.length < 2) return null;

    const region = await resolveTargetRegion(coreText, hasTravelSuffix);
    if (!region) {
        setMapBounded(regionCache, cacheKey, null);
        return null;
    }

    const [wikiRes, imgRes, liveWxRes] = await Promise.allSettled([
        fetchRegionWiki([region.shortName, coreText, region.label]),
        fetchDaumEndpoint('image', `${region.shortName} 여행 풍경`, 4, 1),
        region.cityCode ? getLiveWeatherData(region.cityCode) : Promise.resolve(null)
    ]);

    const wiki = wikiRes.status === 'fulfilled' ? wikiRes.value : null;
    const imgBucket = imgRes.status === 'fulfilled' ? imgRes.value : null;
    const baseWx = liveWxRes.status === 'fulfilled' ? liveWxRes.value : null;

    const [weather7d, highlights] = await Promise.all([
        fetchCoord7DayWeather(region.lat, region.lng, baseWx ? { ...baseWx, isGlobal: region.isGlobal } : { isGlobal: region.isGlobal }, region.label),
        region.isGlobal ? Promise.resolve([]) : fetchRegionHighlights(region.shortName, region.lat, region.lng, region.sub ? 3500 : 12000)
    ]);

    const heroDoc = imgBucket?.items?.find((it) => (it.imageUrl || it.thumbnail) && /^https?:\/\//i.test(it.imageUrl || it.thumbnail));
    const heroImage = wiki?.thumbnail || heroDoc?.thumbnail || heroDoc?.imageUrl || '';

    const widget = {
        type: 'regionComposite',
        data: {
            query: q,
            regionName: region.label,
            shortName: region.shortName,
            isGlobal: region.isGlobal,
            subtitle: region.isGlobal ? '해외 여행지 종합 브리핑' : (wiki?.description || '대한민국 지역 · 여행 종합 브리핑'),
            summary: wiki?.extract || `${region.label}의 실시간 기상·주간 예보와 대표 명소·맛집 정보를 한눈에 확인하세요.`,
            summaryUrl: wiki?.url || '',
            heroImage,
            center: { lat: region.lat, lng: region.lng },
            kakaoJsKey: region.isGlobal ? '' : getKakaoJsKey(),
            weather: weather7d,
            highlights
        }
    };

    setMapBounded(regionCache, cacheKey, widget);
    return widget;
}

module.exports = {
    fetchCoord7DayWeather,
    enrichPlacesWithThumbnails,
    resolveRegionCompositeWidget,
    clearRegionCompositeCache
};
