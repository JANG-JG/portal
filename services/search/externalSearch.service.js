/**
 * 🌐 JG 통합 검색 - 외부 검색 API 어댑터 & 쿼터 가드 (externalSearch.service.js)
 * - 위키백과 REST API (무키 즉시 활성)
 * - 네이버 오픈 API (웹·블로그·백과·뉴스·지역맛집, 일 25,000건 무료)
 * - 구글 Custom Search JSON API (영문/구글웹 탭 전용 · 일 90건 안전 차단)
 * - 15분 결과 캐시 + portal.db 일일 호출량 집계 + 관리자 ON/OFF 제어
 */

const axios = require('axios');
const { portalDb } = require('../db');

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_SIZE = 200;
const GOOGLE_DAILY_SAFE_LIMIT = 90;
const NAVER_DAILY_LIMIT = 25000;

const externalCache = new Map();
let schemaInitialized = false;
let engineToggles = { wikipedia: true, naver: true, google: true };
const DEFAULT_NAVER_SUBAPIS = [
    { code: 'webkr', label: '웹문서', tab: 'webBlog', enabled: true },
    { code: 'blog', label: '블로그', tab: 'webBlog', enabled: false },
    { code: 'encyc', label: '지식백과', tab: 'encyc', enabled: false },
    { code: 'news', label: '뉴스', tab: 'news', enabled: false },
    { code: 'local', label: '지역·맛집', tab: 'local', enabled: false },
    { code: 'kin', label: '지식iN', tab: 'webBlog', enabled: false }
];
let naverSubApis = DEFAULT_NAVER_SUBAPIS.map((it) => ({ ...it }));

function getTodayKst() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

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

function ensureExternalSchema() {
    if (schemaInitialized || !portalDb) return Promise.resolve();
    return new Promise((resolve) => {
        portalDb.serialize(() => {
            portalDb.run(`CREATE TABLE IF NOT EXISTS search_api_usage (
                usage_date TEXT NOT NULL,
                engine TEXT NOT NULL,
                calls INTEGER NOT NULL DEFAULT 0,
                errors INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (usage_date, engine)
            )`);
            portalDb.get("SELECT value FROM system_configs WHERE key = 'search_engine_toggles'", (err, row) => {
                if (!err && row && row.value) {
                    try {
                        engineToggles = { ...engineToggles, ...JSON.parse(row.value) };
                    } catch (_) {}
                }
            });
            portalDb.get("SELECT value FROM system_configs WHERE key = 'search_naver_subapis'", (err, row) => {
                if (!err && row && row.value) {
                    try {
                        const parsed = JSON.parse(row.value);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            naverSubApis = parsed.filter((x) => x && typeof x.code === 'string');
                        }
                    } catch (_) {}
                }
                schemaInitialized = true;
                resolve();
            });
        });
    });
}

async function incrementUsage(engine, isError = false) {
    await ensureExternalSchema();
    if (!portalDb) return;
    const today = getTodayKst();
    const errInc = isError ? 1 : 0;
    portalDb.run(
        `INSERT INTO search_api_usage (usage_date, engine, calls, errors)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(usage_date, engine) DO UPDATE SET calls = calls + 1, errors = errors + ?`,
        [today, engine, errInc, errInc],
        () => {}
    );
}

async function getTodayUsageMap() {
    await ensureExternalSchema();
    if (!portalDb) return {};
    const today = getTodayKst();
    return new Promise((resolve) => {
        portalDb.all('SELECT engine, calls, errors FROM search_api_usage WHERE usage_date = ?', [today], (err, rows) => {
            const map = {};
            if (!err && Array.isArray(rows)) {
                rows.forEach((r) => {
                    map[r.engine] = { calls: r.calls || 0, errors: r.errors || 0 };
                });
            }
            resolve(map);
        });
    });
}

function getCache(key) {
    const entry = externalCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        externalCache.delete(key);
        return null;
    }
    return entry.data;
}

function setCache(key, data) {
    if (externalCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = externalCache.keys().next().value;
        if (oldestKey) externalCache.delete(oldestKey);
    }
    externalCache.set(key, { ts: Date.now(), data });
}

function isNaverConfigured() {
    return Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}

function isGoogleConfigured() {
    return Boolean(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX);
}

async function fetchWikipediaSummary(rawQuery) {
    if (!engineToggles.wikipedia) return null;
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

async function fetchNaverEndpoint(type, rawQuery, display = 5) {
    const cacheKey = `naver:${type}:${rawQuery.toLowerCase()}:${display}`;
    const cached = getCache(cacheKey);
    if (cached !== null) return cached;

    const clientId = (process.env.NAVER_CLIENT_ID || '').trim();
    const clientSecret = (process.env.NAVER_CLIENT_SECRET || '').trim();
    const isLegacyDev = clientId.length === 20 && clientSecret.length === 10 && process.env.NAVER_API_MODE !== 'ncp';

    const url = isLegacyDev
        ? `https://openapi.naver.com/v1/search/${type}.json`
        : `https://naverapihub.apigw.ntruss.com/search/v1/${type}`;
    const headers = isLegacyDev
        ? { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret }
        : { 'X-NCP-APIGW-API-KEY-ID': clientId, 'X-NCP-APIGW-API-KEY': clientSecret };
    const params = isLegacyDev
        ? { query: rawQuery, display, sort: type === 'local' ? 'comment' : 'sim' }
        : { query: rawQuery, display, start: 1, format: 'json', sort: type === 'local' ? 'comment' : 'sim' };

    try {
        await incrementUsage('naver', false);
        const res = await axios.get(url, { params, headers, timeout: 3500 });
        const items = (res.data?.items || []).map((item) => ({
            title: stripHtmlTags(item.title),
            description: stripHtmlTags(item.description || item.roadAddress || item.address || ''),
            link: item.link || item.originallink || '',
            source: stripHtmlTags(item.bloggername || item.category || ''),
            date: item.postdate || item.pubDate || '',
            address: stripHtmlTags(item.roadAddress || item.address || ''),
            telephone: item.telephone || ''
        }));
        setCache(cacheKey, items);
        return items;
    } catch (_) {
        await incrementUsage('naver', true);
        return [];
    }
}

async function fetchGoogleSearch(rawQuery, num = 6) {
    if (!engineToggles.google || !isGoogleConfigured()) {
        return { items: [], blockedReason: !isGoogleConfigured() ? 'not_configured' : 'disabled' };
    }

    const cacheKey = `google:${rawQuery.toLowerCase()}:${num}`;
    const cached = getCache(cacheKey);
    if (cached !== null) return { items: cached, blockedReason: null, cached: true };

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
                num
            },
            timeout: 4500
        });
        const items = (res.data?.items || []).map((it) => ({
            title: it.title || '',
            description: it.snippet || '',
            link: it.link || '',
            displayLink: it.displayLink || ''
        }));
        setCache(cacheKey, items);
        return { items, blockedReason: null };
    } catch (_) {
        await incrementUsage('google', true);
        return { items: [], blockedReason: 'api_error' };
    }
}

function isSubApiEnabled(code) {
    const found = naverSubApis.find((s) => s.code === code);
    return Boolean(found && found.enabled);
}

async function persistNaverSubApis() {
    if (!portalDb) return;
    await new Promise((resolve) => {
        portalDb.run(
            `INSERT INTO system_configs (key, value) VALUES ('search_naver_subapis', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [JSON.stringify(naverSubApis)],
            () => resolve()
        );
    });
}

async function searchExternal(rawQuery, mode = 'all') {
    await ensureExternalSchema();
    const q = (rawQuery || '').trim();
    if (!q) return { wikipedia: null, naver: {}, google: { items: [] } };

    const naverActive = engineToggles.naver && isNaverConfigured();
    const isEnglishOnly = /^[a-zA-Z0-9\s.,?!'"-]+$/.test(q) && /[a-zA-Z]{2,}/.test(q);
    const shouldCallGoogle = mode === 'google' || (mode === 'all' && isEnglishOnly);

    const coreCodes = new Set(['webkr', 'blog', 'encyc', 'news', 'local']);
    const extraSubApis = naverActive
        ? naverSubApis.filter((s) => s.enabled && !coreCodes.has(s.code) && (mode === 'all' || mode === s.tab || mode === 'webBlog'))
        : [];

    const tasks = {
        wikipedia: (mode === 'all' || mode === 'encyc') ? fetchWikipediaSummary(q) : Promise.resolve(null),
        naverWeb: naverActive && isSubApiEnabled('webkr') && (mode === 'all' || mode === 'webBlog') ? fetchNaverEndpoint('webkr', q, mode === 'webBlog' ? 8 : 4) : Promise.resolve([]),
        naverBlog: naverActive && isSubApiEnabled('blog') && (mode === 'all' || mode === 'webBlog') ? fetchNaverEndpoint('blog', q, mode === 'webBlog' ? 8 : 4) : Promise.resolve([]),
        naverEncyc: naverActive && isSubApiEnabled('encyc') && (mode === 'all' || mode === 'encyc') ? fetchNaverEndpoint('encyc', q, mode === 'encyc' ? 8 : 3) : Promise.resolve([]),
        naverNews: naverActive && isSubApiEnabled('news') && (mode === 'all' || mode === 'news') ? fetchNaverEndpoint('news', q, 5) : Promise.resolve([]),
        naverLocal: naverActive && isSubApiEnabled('local') && (mode === 'all' || mode === 'local') ? fetchNaverEndpoint('local', q, mode === 'local' ? 8 : 4) : Promise.resolve([]),
        google: shouldCallGoogle ? fetchGoogleSearch(q, mode === 'google' ? 8 : 5) : Promise.resolve({ items: [], skipped: true }),
        extras: Promise.all(extraSubApis.map(async (sub) => ({
            code: sub.code,
            label: sub.label,
            tab: sub.tab || 'webBlog',
            items: await fetchNaverEndpoint(sub.code, q, 5)
        })))
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
        wikipedia,
        naver: {
            web: naverWeb,
            blog: naverBlog,
            encyc: naverEncyc,
            news: naverNews,
            local: naverLocal,
            extras: naverExtras
        },
        google
    };
}

async function getSearchEngineStatus() {
    await ensureExternalSchema();
    const usage = await getTodayUsageMap();
    const enabledLabels = naverSubApis.filter((s) => s.enabled).map((s) => s.label).join('·') || '없음';
    return {
        date: getTodayKst(),
        cacheSize: externalCache.size,
        naverSubApis: naverSubApis.map((s) => ({ ...s })),
        engines: [
            {
                id: 'wikipedia',
                name: '위키백과 지식 카드',
                configured: true,
                enabled: Boolean(engineToggles.wikipedia),
                todayCalls: usage.wikipedia?.calls || 0,
                todayErrors: usage.wikipedia?.errors || 0,
                dailyLimit: null
            },
            {
                id: 'naver',
                name: `네이버 오픈 API (${enabledLabels})`,
                configured: isNaverConfigured(),
                enabled: Boolean(engineToggles.naver),
                todayCalls: usage.naver?.calls || 0,
                todayErrors: usage.naver?.errors || 0,
                dailyLimit: NAVER_DAILY_LIMIT
            },
            {
                id: 'google',
                name: '구글 Custom Search API',
                configured: isGoogleConfigured(),
                enabled: Boolean(engineToggles.google),
                todayCalls: usage.google?.calls || 0,
                todayErrors: usage.google?.errors || 0,
                dailyLimit: GOOGLE_DAILY_SAFE_LIMIT
            }
        ]
    };
}

async function setEngineToggle(engineId, enabled) {
    await ensureExternalSchema();
    if (!['wikipedia', 'naver', 'google'].includes(engineId)) {
        return { success: false, message: '지원하지 않는 검색 엔진입니다.' };
    }
    engineToggles[engineId] = Boolean(enabled);
    if (portalDb) {
        await new Promise((resolve) => {
            portalDb.run(
                `INSERT INTO system_configs (key, value) VALUES ('search_engine_toggles', ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                [JSON.stringify(engineToggles)],
                () => resolve()
            );
        });
    }
    return { success: true, toggles: { ...engineToggles } };
}

async function setNaverSubApi({ code, label, tab = 'webBlog', enabled = true }) {
    await ensureExternalSchema();
    const cleanCode = String(code || '').trim().toLowerCase();
    if (!/^[a-z]{2,16}$/.test(cleanCode)) {
        return { success: false, message: 'API 코드는 영문 소문자 2~16자여야 합니다. (예: webkr, blog, kin, book)' };
    }
    const existing = naverSubApis.find((s) => s.code === cleanCode);
    if (existing) {
        existing.enabled = Boolean(enabled);
        if (label && String(label).trim()) existing.label = String(label).trim().slice(0, 24);
    } else {
        const cleanLabel = String(label || cleanCode).trim().slice(0, 24);
        const safeTab = ['webBlog', 'encyc', 'news', 'local'].includes(tab) ? tab : 'webBlog';
        naverSubApis.push({ code: cleanCode, label: cleanLabel, tab: safeTab, enabled: Boolean(enabled), custom: true });
    }
    await persistNaverSubApis();
    externalCache.clear();
    return { success: true, naverSubApis: naverSubApis.map((s) => ({ ...s })) };
}

async function removeNaverSubApi(code) {
    await ensureExternalSchema();
    const cleanCode = String(code || '').trim().toLowerCase();
    const target = naverSubApis.find((s) => s.code === cleanCode);
    if (!target) return { success: false, message: '등록된 API가 아닙니다.' };
    if (!target.custom) return { success: false, message: '기본 제공 API는 삭제할 수 없으며 비활성화만 가능합니다.' };
    naverSubApis = naverSubApis.filter((s) => s.code !== cleanCode);
    await persistNaverSubApis();
    externalCache.clear();
    return { success: true, naverSubApis: naverSubApis.map((s) => ({ ...s })) };
}

function clearExternalCache() {
    const prevSize = externalCache.size;
    externalCache.clear();
    return prevSize;
}

module.exports = {
    searchExternal,
    getSearchEngineStatus,
    setEngineToggle,
    setNaverSubApi,
    removeNaverSubApi,
    clearExternalCache
};
