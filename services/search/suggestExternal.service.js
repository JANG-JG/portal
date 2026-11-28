/**
 * 🌐 JG 통합 검색 - 외부 실시간 검색어 추천 서비스 (suggestExternal.service.js)
 * - 구글 자동완성(Suggest API) + 위키백과 OpenSearch 병렬 조회
 * - 스마트 프라이버시 가드: 2글자 이상, 초성·숫자/수식·민감 키워드 제외 시에만 외부 전송
 * - 5분 인메모리 캐시 & 관리자 On/Off 토글 연동
 */

const axios = require('axios');
const { isChosungOnly } = require('./chosung.util');
const { isExternalSuggestEnabled, incrementUsage } = require('./externalSearch.service');

const EXT_SUGGEST_TTL_MS = 5 * 60 * 1000;
const EXT_SUGGEST_MAX_CACHE = 300;
const EXT_SUGGEST_TIMEOUT_MS = 900;

const extSuggestCache = new Map();

const SENSITIVE_KEYWORDS = [
    '비밀번호', '패스워드', '주민', '계좌', '카드번호', '토큰', '시크릿',
    '혈압', '처방', '병원', '진료', '복약', '자산', '매입', '잔고', 'pin'
];

function shouldCallExternalSuggest(rawPrefix) {
    const q = String(rawPrefix || '').trim();
    if (q.length < 2) return false;
    if (isChosungOnly(q)) return false;
    if (/^[0-9+\-*/%().\s=]+$/.test(q)) return false;
    if (/@/.test(q) || /\d{6,}/.test(q)) return false;

    const lower = q.toLowerCase();
    for (const kw of SENSITIVE_KEYWORDS) {
        if (lower.includes(kw)) return false;
    }
    return true;
}

function getExtCache(key) {
    const hit = extSuggestCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > EXT_SUGGEST_TTL_MS) {
        extSuggestCache.delete(key);
        return null;
    }
    return hit.items;
}

function setExtCache(key, items) {
    if (extSuggestCache.size >= EXT_SUGGEST_MAX_CACHE) {
        const oldest = extSuggestCache.keys().next().value;
        if (oldest) extSuggestCache.delete(oldest);
    }
    extSuggestCache.set(key, { ts: Date.now(), items });
}

async function fetchNaverSuggest(query) {
    try {
        const res = await axios.get('https://ac.search.naver.com/nx/ac', {
            params: {
                q: query,
                st: 100,
                r_format: 'json',
                r_enc: 'UTF-8',
                r_unicode: 0,
                t_koreng: 1
            },
            timeout: EXT_SUGGEST_TIMEOUT_MS,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; JGPortalSearch/1.0)',
                Accept: 'application/json'
            }
        });
        const rawList = Array.isArray(res.data?.items?.[0]) ? res.data.items[0] : [];
        return rawList
            .map((entry) => (Array.isArray(entry) ? entry[0] : entry))
            .filter((t) => typeof t === 'string' && t.trim())
            .slice(0, 6)
            .map((text) => ({
                text: text.trim(),
                type: 'naver',
                icon: '🔎',
                badge: '네이버'
            }));
    } catch (_) {
        return [];
    }
}

async function fetchGoogleSuggest(query) {
    try {
        const res = await axios.get('https://suggestqueries.google.com/complete/search', {
            params: { client: 'firefox', hl: 'ko', q: query },
            timeout: EXT_SUGGEST_TIMEOUT_MS,
            headers: { 'User-Agent': 'JGPortalSearch/1.0' }
        });
        const list = Array.isArray(res.data) && Array.isArray(res.data[1]) ? res.data[1] : [];
        return list
            .filter((t) => typeof t === 'string' && t.trim())
            .slice(0, 6)
            .map((text) => ({
                text: text.trim(),
                type: 'google',
                icon: '🔎',
                badge: '구글'
            }));
    } catch (_) {
        return [];
    }
}

async function fetchWikipediaSuggest(query) {
    const hasKorean = /[가-힣]/.test(query);
    const lang = hasKorean ? 'ko' : 'en';
    try {
        const res = await axios.get(`https://${lang}.wikipedia.org/w/api.php`, {
            params: {
                action: 'opensearch',
                search: query,
                limit: 2,
                namespace: 0,
                format: 'json'
            },
            timeout: EXT_SUGGEST_TIMEOUT_MS,
            headers: { 'User-Agent': 'JGPortalSearch/1.0 (https://j-jg.cc)' }
        });
        const titles = Array.isArray(res.data) && Array.isArray(res.data[1]) ? res.data[1] : [];
        const urls = Array.isArray(res.data) && Array.isArray(res.data[3]) ? res.data[3] : [];
        return titles
            .filter((t) => typeof t === 'string' && t.trim())
            .map((title, idx) => ({
                text: title.trim(),
                type: 'wikipedia',
                icon: '📚',
                badge: '위키백과',
                url: typeof urls[idx] === 'string' ? urls[idx] : null
            }));
    } catch (_) {
        return [];
    }
}

async function fetchExternalSuggestions(rawPrefix) {
    const q = String(rawPrefix || '').trim();
    if (!shouldCallExternalSuggest(q)) return [];

    const enabled = await isExternalSuggestEnabled().catch(() => true);
    if (!enabled) return [];

    const cacheKey = q.toLowerCase();
    const cached = getExtCache(cacheKey);
    if (cached) return cached;

    incrementUsage('externalSuggest', false).catch(() => {});

    const [naverRes, googleRes, wikiRes] = await Promise.allSettled([
        fetchNaverSuggest(q),
        fetchGoogleSuggest(q),
        fetchWikipediaSuggest(q)
    ]);

    const naverItems = naverRes.status === 'fulfilled' ? naverRes.value : [];
    const googleItems = googleRes.status === 'fulfilled' ? googleRes.value : [];
    const wikiItems = wikiRes.status === 'fulfilled' ? wikiRes.value : [];
    const combined = [...naverItems, ...googleItems, ...wikiItems];

    setExtCache(cacheKey, combined);
    return combined;
}

function clearExternalSuggestCache() {
    const size = extSuggestCache.size;
    extSuggestCache.clear();
    return size;
}

module.exports = {
    shouldCallExternalSuggest,
    fetchExternalSuggestions,
    clearExternalSuggestCache
};
