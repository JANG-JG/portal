/**
 * 📍 JG 통합 검색 - 카카오 로컬·지도 즉답 위젯 서비스 (kakaoMapWidget.service.js)
 * - 하이브리드 지역·장소 의도 감지 (명시적 키워드 + 행정구역/정확한 명소·역·상호 매칭, 일반 명사 오탐 차단)
 * - 카카오 로컬 REST API (keyword.json / address.json) 연동 + 10분 LRU 캐시
 * - '근처/주변' 검색 시 사용자 포털 날씨 기준 도시 좌표 우선 적용 + GPS 반경 재검색 지원
 */

const axios = require('axios');
const { db } = require('../db');
const { CITY_KO_MAP, CITY_COORDS, getDefaultWeatherCity } = require('../weather.service');
const { incrementUsage, isEngineEnabled } = require('./externalSearch.service');

const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const KAKAO_ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json';

const MAP_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_MAP_CACHE = 200;
const mapCache = new Map();

const EXPLICIT_MAP_RE = /(지도|위치|주소|길찾기|가는길|오시는길|어디야|어디에|맛집|식당|카페|커피|빵집|베이커리|병원|의원|치과|한의원|약국|주차장|주유소|충전소|편의점|마트|백화점|은행|숙소|호텔|펜션|모텔|관광|명소|공원|해수욕장|산|역|터미널|공항|학교|구청|시청|군청|도청|주민센터|행정복지센터|보건소|우체국|경찰서|도서관|영화관)/;
const NEARBY_RE = /(근처|주변|가까운|내주변|내\s*주변)/;
const WEATHER_EXCLUDE_RE = /(날씨|기온|온도|미세먼지|초미세먼지|강수|비와|비오|눈와|예보|일기예보)/;

// 단독 검색 시 신뢰할 수 있는 카카오 카테고리 그룹 코드
const TRUSTED_CATEGORY_GROUPS = new Set([
    'SW8', // 지하철역
    'AT4', // 관광명소
    'PO3', // 공공기관
    'HP8', // 병원
    'PM9', // 약국
    'SC4', // 학교
    'FD6', // 음식점
    'CE7', // 카페
    'AD5', // 숙박
    'PK6', // 주차장
    'CT1', // 문화시설
    'MT1', // 대형마트
    'BK9', // 은행
    'OL7'  // 주유소/충전소
]);

function getKakaoRestKey() {
    return (process.env.KAKAO_REST_API_KEY || '').trim();
}

function getKakaoJsKey() {
    return (process.env.KAKAO_JS_KEY || '').trim();
}

function getMapCache(key) {
    const entry = mapCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > MAP_CACHE_TTL_MS) {
        mapCache.delete(key);
        return null;
    }
    return entry.data;
}

function setMapCache(key, data) {
    if (mapCache.size >= MAX_MAP_CACHE) {
        const oldestKey = mapCache.keys().next().value;
        if (oldestKey) mapCache.delete(oldestKey);
    }
    mapCache.set(key, { ts: Date.now(), data });
}

function clearMapWidgetCache() {
    const prev = mapCache.size;
    mapCache.clear();
    return prev;
}

function normalizeText(str) {
    return String(str || '').toLowerCase().replace(/\s+/g, '');
}

function findDomesticCityMatch(rawText) {
    if (!rawText) return null;
    const trimmed = rawText.trim();
    if (CITY_COORDS[trimmed]) {
        return { code: trimmed, label: CITY_KO_MAP[trimmed] || trimmed, coord: CITY_COORDS[trimmed] };
    }
    const lower = trimmed.toLowerCase();
    const cleaned = lower.replace(/(특별자치시|특별자치도|광역시|시|군|구|도)$/, '').trim();
    for (const [code, koName] of Object.entries(CITY_KO_MAP)) {
        const koLower = koName.toLowerCase();
        const subName = koLower.replace(/^(서울|경기|강원|경남|경북|전남|전북|충남|충북)\s*/, '').trim();
        if (lower === koLower || lower === subName || (cleaned && (cleaned === koLower || cleaned === subName))) {
            const coord = CITY_COORDS[code];
            if (coord) return { code, label: koName, coord };
        }
    }
    return null;
}

async function getUserAnchorCity(user) {
    const username = user?.username;
    let cityCode = null;
    if (username && db) {
        cityCode = await new Promise((resolve) => {
            db.get('SELECT weather_city FROM users WHERE username = ?', [username], (err, row) => {
                if (!err && row && row.weather_city && row.weather_city.trim()) {
                    return resolve(row.weather_city.trim());
                }
                resolve(null);
            });
        });
    }
    if (!cityCode) {
        try {
            cityCode = await getDefaultWeatherCity();
        } catch (_) {
            cityCode = 'Seoul';
        }
    }
    const coord = CITY_COORDS[cityCode] || CITY_COORDS.Seoul;
    const label = CITY_KO_MAP[cityCode] || '서울';
    return { code: cityCode, label, coord };
}

function buildSearchLinks(name, lat, lng) {
    const encodedName = encodeURIComponent(name || '');
    const kakaoUrl = lat && lng
        ? `https://map.kakao.com/link/map/${encodedName},${lat},${lng}`
        : `https://map.kakao.com/link/search/${encodedName}`;
    const naverUrl = `https://map.naver.com/p/search/${encodedName}`;
    const directionsUrl = lat && lng
        ? `https://map.kakao.com/link/to/${encodedName},${lat},${lng}`
        : `https://map.kakao.com/link/search/${encodedName}`;
    return { kakaoUrl, naverUrl, directionsUrl };
}

function mapKakaoDocumentToPlace(doc) {
    const lat = parseFloat(doc.y);
    const lng = parseFloat(doc.x);
    const name = String(doc.place_name || doc.address_name || '').trim();
    const links = buildSearchLinks(name, lat, lng);
    return {
        id: doc.id || `${lat},${lng}`,
        name,
        category: String(doc.category_name || '').split('>').pop().trim(),
        categoryGroup: doc.category_group_code || '',
        roadAddress: doc.road_address_name || '',
        address: doc.address_name || '',
        phone: doc.phone || '',
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        distance: doc.distance ? Number(doc.distance) : null,
        kakaoUrl: links.kakaoUrl,
        naverUrl: links.naverUrl,
        directionsUrl: links.directionsUrl
    };
}

function mapAddressDocToPlace(doc, fallbackTitle) {
    const lat = parseFloat(doc.y);
    const lng = parseFloat(doc.x);
    const addr = doc.road_address?.address_name || doc.address?.address_name || doc.address_name || fallbackTitle;
    const name = doc.road_address?.building_name || addr;
    const links = buildSearchLinks(name, lat, lng);
    return {
        id: `addr:${lat},${lng}`,
        name,
        category: doc.address_type === 'REGION' ? '행정구역' : '주소',
        categoryGroup: 'REGION',
        roadAddress: doc.road_address?.address_name || '',
        address: doc.address?.address_name || doc.address_name || '',
        phone: '',
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        distance: null,
        kakaoUrl: links.kakaoUrl,
        naverUrl: links.naverUrl,
        directionsUrl: links.directionsUrl
    };
}

async function fetchKakaoKeyword(query, opts = {}) {
    const key = getKakaoRestKey();
    if (!key || !query) return [];
    const params = { query, size: opts.size || 5 };
    if (opts.lat && opts.lng) {
        params.y = opts.lat;
        params.x = opts.lng;
        params.radius = opts.radius || 5000;
        if (opts.sort) params.sort = opts.sort;
    }
    await incrementUsage('kakaoMap', false);
    const res = await axios.get(KAKAO_KEYWORD_URL, {
        params,
        headers: { Authorization: `KakaoAK ${key}` },
        timeout: 3000
    });
    return Array.isArray(res.data?.documents) ? res.data.documents : [];
}

async function fetchKakaoAddress(query) {
    const key = getKakaoRestKey();
    if (!key || !query) return [];
    await incrementUsage('kakaoMap', false);
    const res = await axios.get(KAKAO_ADDRESS_URL, {
        params: { query, size: 3 },
        headers: { Authorization: `KakaoAK ${key}` },
        timeout: 3000
    });
    return Array.isArray(res.data?.documents) ? res.data.documents : [];
}

function cleanMapQuery(rawQuery) {
    return String(rawQuery || '')
        .replace(/(지도|위치|주소|길찾기|가는길|오시는길|어디야|어디에|어디|알려줘|검색|찾아줘)/g, ' ')
        .replace(/(근처|주변|가까운|내주변|내\s*주변|우리집|동네)/g, ' ')
        .replace(/[?!.,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function hasRegionWordInQuery(cleanedQuery) {
    const tokens = cleanedQuery.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
        if (findDomesticCityMatch(tokens[0])) return true;
        if (/(시|군|구|동|읍|면|역|로|길)$/.test(tokens[0])) return true;
    }
    return false;
}

async function resolveKakaoMapWidget(rawQuery, user) {
    const q = String(rawQuery || '').trim();
    if (!q || q.length < 2 || q.length > 80) return null;
    if (WEATHER_EXCLUDE_RE.test(q)) return null;
    if (!getKakaoRestKey()) return null;

    const enabled = await isEngineEnabled('kakaoMap');
    if (!enabled) return null;

    const isExplicit = EXPLICIT_MAP_RE.test(q);
    const isNearby = NEARBY_RE.test(q);
    const cityMatch = findDomesticCityMatch(q);

    // 1글자 영문/숫자/순수 수식 등은 조기 차단
    if (!isExplicit && !isNearby && !cityMatch && /^[0-9a-zA-Z\s+\-*/=.%]+$/.test(q)) {
        return null;
    }

    const cleaned = cleanMapQuery(q) || q;
    const anchor = (isNearby && !hasRegionWordInQuery(cleaned)) ? await getUserAnchorCity(user) : null;

    const cacheKey = `map:${q.toLowerCase()}:${anchor ? anchor.code : 'none'}`;
    const cached = getMapCache(cacheKey);
    if (cached !== null) return cached;

    try {
        let places = [];

        if (cityMatch) {
            const addrDocs = await fetchKakaoAddress(cityMatch.label);
            const kwDocs = await fetchKakaoKeyword(cityMatch.label, {
                lat: cityMatch.coord.lat,
                lng: cityMatch.coord.lon,
                radius: 10000,
                size: 5
            });
            const addrPlaces = addrDocs.slice(0, 1).map((d) => mapAddressDocToPlace(d, cityMatch.label));
            const kwPlaces = kwDocs.map(mapKakaoDocumentToPlace).filter((p) => p.lat && p.lng);
            places = [...addrPlaces, ...kwPlaces].slice(0, 5);
        } else if (isExplicit || isNearby) {
            const kwDocs = await fetchKakaoKeyword(cleaned, anchor ? {
                lat: anchor.coord.lat,
                lng: anchor.coord.lon,
                radius: 5000,
                size: 5
            } : { size: 5 });
            places = kwDocs.map(mapKakaoDocumentToPlace).filter((p) => p.lat && p.lng);
            if (places.length === 0) {
                const addrDocs = await fetchKakaoAddress(cleaned);
                places = addrDocs.map((d) => mapAddressDocToPlace(d, cleaned)).filter((p) => p.lat && p.lng);
            }
        } else {
            // 단독 검색어: 행정구역/주소 일치 또는 장소명·카테고리 정확 일치 시에만 발동 (일반 명사 오탐 방지)
            const [addrDocs, kwDocs] = await Promise.all([
                fetchKakaoAddress(cleaned),
                fetchKakaoKeyword(cleaned, { size: 5 })
            ]);

            if (addrDocs.length > 0) {
                places = addrDocs.map((d) => mapAddressDocToPlace(d, cleaned)).filter((p) => p.lat && p.lng);
            }
            if (kwDocs.length > 0) {
                const normQ = normalizeText(cleaned);
                const top = kwDocs[0];
                const normTop = normalizeText(top.place_name);
                const rawTopLower = String(top.place_name || '').trim().toLowerCase();
                const rawQLower = cleaned.toLowerCase();
                const exactOrStrong = normTop === normQ || normTop.startsWith(`${normQ}(`) || normTop.endsWith(normQ) || rawTopLower.startsWith(`${rawQLower} `);
                const trustedCat = TRUSTED_CATEGORY_GROUPS.has(top.category_group_code);
                if (exactOrStrong && trustedCat) {
                    places = kwDocs.map(mapKakaoDocumentToPlace).filter((p) => p.lat && p.lng);
                }
            }
        }

        if (!places.length) {
            setMapCache(cacheKey, null);
            return null;
        }

        const widget = {
            type: 'map',
            data: {
                query: cleaned,
                rawQuery: q,
                kakaoJsKey: getKakaoJsKey(),
                isNearbyQuery: Boolean(anchor),
                anchorLabel: anchor ? `${anchor.label} (설정 지역) 기준` : '',
                center: { lat: places[0].lat, lng: places[0].lng },
                places
            }
        };
        setMapCache(cacheKey, widget);
        return widget;
    } catch (_) {
        await incrementUsage('kakaoMap', true);
        return null;
    }
}

async function searchNearbyByCoords(rawQuery, lat, lng) {
    if (!getKakaoRestKey()) return null;
    const enabled = await isEngineEnabled('kakaoMap');
    if (!enabled) return null;

    const cleaned = cleanMapQuery(rawQuery) || String(rawQuery || '').trim();
    if (!cleaned) return null;

    try {
        const kwDocs = await fetchKakaoKeyword(cleaned, {
            lat,
            lng,
            radius: 5000,
            sort: 'distance',
            size: 5
        });
        const places = kwDocs.map(mapKakaoDocumentToPlace).filter((p) => p.lat && p.lng);
        if (!places.length) return null;
        return {
            type: 'map',
            data: {
                query: cleaned,
                rawQuery: String(rawQuery || '').trim(),
                kakaoJsKey: getKakaoJsKey(),
                isNearbyQuery: true,
                anchorLabel: '내 현재 위치 기준 (반경 5km)',
                center: { lat: places[0].lat, lng: places[0].lng },
                places
            }
        };
    } catch (_) {
        await incrementUsage('kakaoMap', true);
        return null;
    }
}

module.exports = {
    resolveKakaoMapWidget,
    searchNearbyByCoords,
    clearMapWidgetCache
};
