/**
 * 🌐 JG 통합 검색 - 외부 검색 API 어댑터 & 쿼터 가드 (externalSearch.service.js)
 * - 위키백과 REST API (무키 즉시 활성)
 * - 네이버 오픈 API (웹·블로그·백과·뉴스·지역맛집, 일 25,000건 무료)
 * - 구글 Custom Search JSON API (영문/구글웹 탭 전용 · 일 90건 안전 차단)
 * - 15분 결과 캐시 + portal.db 일일 호출량 집계 + 관리자 ON/OFF 제어
 */

const axios = require('axios');
const {
    GOOGLE_DAILY_SAFE_LIMIT,
    ensureExternalSchema,
    incrementUsage,
    getTodayUsageMap,
    getCache,
    setCache,
    isNaverConfigured,
    isGoogleConfigured,
    isSubApiAuthBlocked,
    markSubApiAuthBlocked,
    getEngineToggles,
    getNaverSubApis,
    isSubApiEnabled,
    getSearchEngineStatus,
    isExternalSuggestEnabled,
    isEngineEnabled,
    setEngineToggle,
    setNaverSubApi,
    removeNaverSubApi,
    clearExternalCache
} = require('./externalSearchState.service');

const TAB_PAGE_SIZE = 15;
const MAX_NAVER_PAGE = 67;

function stripHtmlTags(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
        .replace(/<[^>]*>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function formatSearchDate(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (/^\d{8}$/.test(trimmed)) {
        return `${trimmed.slice(0, 4)}.${trimmed.slice(4, 6)}.${trimmed.slice(6, 8)}`;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
        const d = new Date(parsed);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}.${m}.${day}`;
    }
    return trimmed.slice(0, 16);
}

function extractCleanDomain(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        const u = new URL(url);
        return u.hostname.replace(/^www\./i, '');
    } catch (_) {
        return '';
    }
}

async function fetchWikipediaSummary(rawQuery) {
    if (!getEngineToggles().wikipedia) return null;
    const cacheKey = `wiki:${rawQuery.toLowerCase()}`;
    const cached = getCache(cacheKey);
    if (cached !== null) return cached;

    const hasKorean = /[가-힣]/.test(rawQuery);
    const lang = hasKorean ? 'ko' : 'en';
    const base = `https://${lang}.wikipedia.org`;

    try {
        await incrementUsage('wikipedia', false);
        const searchRes = await axios.get(`${base}/w/api.php`, {
            params: { action: 'opensearch', search: rawQuery, limit: 1, namespace: 0, format: 'json' },
            headers: { 'User-Agent': 'JG-Portal-Search/1.0' },
            timeout: 3000
        });
        const topTitle = searchRes.data?.[1]?.[0];
        if (!topTitle) {
            setCache(cacheKey, null);
            return null;
        }

        const sumRes = await axios.get(`${base}/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`, {
            headers: { 'User-Agent': 'JG-Portal-Search/1.0' },
            timeout: 3000
        });
        const d = sumRes.data;
        if (!d || !d.extract) {
            setCache(cacheKey, null);
            return null;
        }

        const result = {
            title: d.title || topTitle,
            description: d.description || '',
            extract: d.extract.slice(0, 320) + (d.extract.length > 320 ? '...' : ''),
            thumbnail: d.thumbnail?.source || null,
            url: d.content_urls?.desktop?.page || `${base}/wiki/${encodeURIComponent(topTitle)}`,
            lang
        };
        setCache(cacheKey, result);
        return result;
    } catch (_) {
        await incrementUsage('wikipedia', true);
        return null;
    }
}

function emptyNaverBucket(display = 5, page = 1) {
    return {
        items: [],
        meta: { total: 0, page, display, totalPages: 0, hasMore: false }
    };
}

async function fetchNaverEndpoint(type, rawQuery, display = 5, page = 1) {
    const safePage = Math.max(1, Math.min(MAX_NAVER_PAGE, parseInt(page, 10) || 1));
    const safeDisplay = Math.max(1, Math.min(30, parseInt(display, 10) || 5));
    if (isSubApiAuthBlocked(type)) {
        return emptyNaverBucket(safeDisplay, safePage);
    }

    const cacheKey = `naver:${type}:${rawQuery.toLowerCase()}:${safeDisplay}:p${safePage}`;
    const cached = getCache(cacheKey);
    if (cached !== null) return cached;

    const clientId = (process.env.NAVER_CLIENT_ID || '').trim();
    const clientSecret = (process.env.NAVER_CLIENT_SECRET || '').trim();
    const isLegacyDev = clientId.length === 20 && clientSecret.length === 10 && process.env.NAVER_API_MODE !== 'ncp';
    const start = Math.min(1000, (safePage - 1) * safeDisplay + 1);

    const url = isLegacyDev
        ? `https://openapi.naver.com/v1/search/${type}.json`
        : `https://naverapihub.apigw.ntruss.com/search/v1/${type}`;
    const headers = isLegacyDev
        ? { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret }
        : { 'X-NCP-APIGW-API-KEY-ID': clientId, 'X-NCP-APIGW-API-KEY': clientSecret };
    const params = isLegacyDev
        ? { query: rawQuery, display: safeDisplay, start, sort: type === 'local' ? 'comment' : 'sim' }
        : { query: rawQuery, display: safeDisplay, start, format: 'json', sort: type === 'local' ? 'comment' : 'sim' };

    try {
        const res = await axios.get(url, { params, headers, timeout: 3500 });
        await incrementUsage('naver', false);
        const items = (res.data?.items || []).map((item) => {
            const link = item.originallink || item.link || '';
            return {
                title: stripHtmlTags(item.title),
                description: stripHtmlTags(item.description || item.roadAddress || item.address || ''),
                link: item.link || item.originallink || '',
                domain: extractCleanDomain(link || item.link || ''),
                source: stripHtmlTags(item.bloggername || item.category || ''),
                date: formatSearchDate(item.postdate || item.pubDate || ''),
                address: stripHtmlTags(item.roadAddress || item.address || ''),
                telephone: item.telephone || ''
            };
        });
        const total = Math.max(items.length, Number(res.data?.total) || 0);
        const totalPages = Math.min(MAX_NAVER_PAGE, Math.ceil(total / safeDisplay));
        const bucket = {
            items,
            meta: {
                total,
                page: safePage,
                display: safeDisplay,
                totalPages,
                hasMore: safePage < totalPages && items.length > 0
            }
        };
        setCache(cacheKey, bucket);
        return bucket;
    } catch (err) {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
            markSubApiAuthBlocked(type);
            return emptyNaverBucket(safeDisplay, safePage);
        }
        await incrementUsage('naver', true);
        return emptyNaverBucket(safeDisplay, safePage);
    }
}

async function fetchGoogleSearch(rawQuery, num = 6, page = 1) {
    const engineToggles = getEngineToggles();
    if (!engineToggles.google || !isGoogleConfigured()) {
        return { items: [], blockedReason: !isGoogleConfigured() ? 'not_configured' : 'disabled' };
    }

    const safePage = Math.max(1, Math.min(10, parseInt(page, 10) || 1));
    const safeNum = Math.max(1, Math.min(10, parseInt(num, 10) || 6));
    const start = (safePage - 1) * safeNum + 1;
    const cacheKey = `google:${rawQuery.toLowerCase()}:${safeNum}:p${safePage}`;
    const cached = getCache(cacheKey);
    if (cached !== null) return { ...cached, cached: true };

    const usageMap = await getTodayUsageMap();
    const todayCalls = usageMap.google?.calls || 0;
    if (todayCalls >= GOOGLE_DAILY_SAFE_LIMIT) {
        return { items: [], blockedReason: 'daily_quota_guard' };
    }

    try {
        await incrementUsage('google', false);
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: {
                key: process.env.GOOGLE_CSE_API_KEY,
                cx: process.env.GOOGLE_CSE_CX,
                q: rawQuery,
                num: safeNum,
                start
            },
            timeout: 4500
        });
        const items = (res.data?.items || []).map((it) => ({
            title: it.title || '',
            description: it.snippet || '',
            link: it.link || '',
            displayLink: (it.displayLink || '').replace(/^www\./i, '')
        }));
        const total = Math.max(items.length, Number(res.data?.searchInformation?.totalResults) || 0);
        const totalPages = Math.min(10, Math.ceil(total / safeNum));
        const payload = {
            items,
            blockedReason: null,
            meta: { total, page: safePage, display: safeNum, totalPages, hasMore: safePage < totalPages && items.length > 0 }
        };
        setCache(cacheKey, payload);
        return payload;
    } catch (_) {
        await incrementUsage('google', true);
        return { items: [], blockedReason: 'api_error' };
    }
}

async function searchExternal(rawQuery, rawMode = 'all', rawPage = 1) {
    await ensureExternalSchema();
    const q = (rawQuery || '').trim();
    if (!q) return { wikipedia: null, naver: {}, google: { items: [] } };

    const mode = rawMode === 'webBlog' ? 'web' : (rawMode === 'news' ? 'wikiNews' : rawMode);
    const page = Math.max(1, Math.min(MAX_NAVER_PAGE, parseInt(rawPage, 10) || 1));
    const engineToggles = getEngineToggles();
    const naverSubApis = getNaverSubApis();
    const naverActive = engineToggles.naver && isNaverConfigured();
    const isEnglishOnly = /^[a-zA-Z0-9\s.,?!'"-]+$/.test(q) && /[a-zA-Z]{2,}/.test(q);
    const shouldCallGoogle = mode === 'google' || (mode === 'all' && isEnglishOnly);

    const coreCodes = new Set(['webkr', 'blog', 'encyc', 'news', 'local']);
    const extraSubApis = naverActive
        ? naverSubApis.filter((s) => s.enabled && !coreCodes.has(s.code) && (mode === 'all' || mode === s.tab))
        : [];

    const tasks = {
        wikipedia: ((mode === 'all' || mode === 'encyc') && page === 1) ? fetchWikipediaSummary(q) : Promise.resolve(null),
        naverWeb: naverActive && isSubApiEnabled('webkr') && (mode === 'all' || mode === 'web')
            ? fetchNaverEndpoint('webkr', q, mode === 'web' ? TAB_PAGE_SIZE : 5, mode === 'web' ? page : 1)
            : Promise.resolve(emptyNaverBucket(mode === 'web' ? TAB_PAGE_SIZE : 5, mode === 'web' ? page : 1)),
        naverBlog: naverActive && isSubApiEnabled('blog') && (mode === 'all' || mode === 'blog')
            ? fetchNaverEndpoint('blog', q, mode === 'blog' ? TAB_PAGE_SIZE : 5, mode === 'blog' ? page : 1)
            : Promise.resolve(emptyNaverBucket(mode === 'blog' ? TAB_PAGE_SIZE : 5, mode === 'blog' ? page : 1)),
        naverEncyc: naverActive && isSubApiEnabled('encyc') && (mode === 'all' || mode === 'encyc')
            ? fetchNaverEndpoint('encyc', q, mode === 'encyc' ? TAB_PAGE_SIZE : 3, mode === 'encyc' ? page : 1)
            : Promise.resolve(emptyNaverBucket(mode === 'encyc' ? TAB_PAGE_SIZE : 3, mode === 'encyc' ? page : 1)),
        naverNews: naverActive && isSubApiEnabled('news') && (mode === 'all' || mode === 'wikiNews')
            ? fetchNaverEndpoint('news', q, mode === 'wikiNews' ? TAB_PAGE_SIZE : 5, mode === 'wikiNews' ? page : 1)
            : Promise.resolve(emptyNaverBucket(mode === 'wikiNews' ? TAB_PAGE_SIZE : 5, mode === 'wikiNews' ? page : 1)),
        naverLocal: naverActive && isSubApiEnabled('local') && (mode === 'all' || mode === 'local')
            ? fetchNaverEndpoint('local', q, mode === 'local' ? TAB_PAGE_SIZE : 4, mode === 'local' ? page : 1)
            : Promise.resolve(emptyNaverBucket(mode === 'local' ? TAB_PAGE_SIZE : 4, mode === 'local' ? page : 1)),
        google: shouldCallGoogle
            ? fetchGoogleSearch(q, mode === 'google' ? 10 : 5, mode === 'google' ? page : 1)
            : Promise.resolve({ items: [], skipped: true }),
        extras: Promise.all(extraSubApis.map(async (sub) => {
            const subBucket = await fetchNaverEndpoint(sub.code, q, mode === 'all' ? 5 : TAB_PAGE_SIZE, mode === 'all' ? 1 : page);
            return {
                code: sub.code,
                label: sub.label,
                tab: sub.tab || 'web',
                items: subBucket.items,
                meta: subBucket.meta
            };
        }))
    };

    const [wikipedia, naverWeb, naverBlog, naverEncyc, naverNews, naverLocal, google, naverExtras] = await Promise.all([
        tasks.wikipedia,
        tasks.naverWeb,
        tasks.naverBlog,
        tasks.naverEncyc,
        tasks.naverNews,
        tasks.naverLocal,
        tasks.google,
        tasks.extras
    ]);

    return {
        configured: {
            wikipedia: true,
            naver: isNaverConfigured(),
            google: isGoogleConfigured()
        },
        toggles: { ...engineToggles },
        page,
        wikipedia,
        naver: {
            web: naverWeb.items,
            blog: naverBlog.items,
            encyc: naverEncyc.items,
            news: naverNews.items,
            local: naverLocal.items,
            extras: naverExtras,
            meta: {
                web: naverWeb.meta,
                blog: naverBlog.meta,
                encyc: naverEncyc.meta,
                news: naverNews.meta,
                local: naverLocal.meta
            }
        },
        google
    };
}

module.exports = {
    searchExternal,
    getSearchEngineStatus,
    setEngineToggle,
    setNaverSubApi,
    removeNaverSubApi,
    clearExternalCache,
    isExternalSuggestEnabled,
    isEngineEnabled,
    incrementUsage
};
