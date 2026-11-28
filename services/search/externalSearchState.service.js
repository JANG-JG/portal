/**
 * 🔧 JG 통합 검색 - 외부 검색 상태·캐시·쿼터·관리자 설정 모듈 (externalSearchState.service.js)
 * - 15분 결과 캐시 + NCP 미신청(401/403) 자동 쿨다운 감지
 * - portal.db 일일 호출량 집계 및 세부 API ON/OFF 상태 영속화
 */

const { portalDb } = require('../db');

const CACHE_TTL_MS = 15 * 60 * 1000;
const AUTH_BLOCK_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_SIZE = 300;
const GOOGLE_DAILY_SAFE_LIMIT = 90;
const NAVER_DAILY_LIMIT = 25000;

const externalCache = new Map();
const subApiAuthBlocked = new Map();

let schemaInitialized = false;
let engineToggles = {
    wikipedia: true,
    naver: true,
    daumSearch: true,
    webBot: true,
    google: true,
    externalSuggest: true,
    kakaoMap: true,
    geminiSummary: true
};

const DEFAULT_NAVER_SUBAPIS = [
    { code: 'webkr', label: '웹문서', tab: 'web', enabled: true },
    { code: 'blog', label: '블로그', tab: 'blog', enabled: true },
    { code: 'encyc', label: '지식백과', tab: 'encyc', enabled: true },
    { code: 'news', label: '뉴스', tab: 'wikiNews', enabled: true },
    { code: 'local', label: '지역·맛집', tab: 'local', enabled: true },
    { code: 'kin', label: '지식iN', tab: 'web', enabled: false }
];

let naverSubApis = DEFAULT_NAVER_SUBAPIS.map((it) => ({ ...it }));

function getTodayKst() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function isNaverConfigured() {
    return Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}

function isGoogleConfigured() {
    return Boolean(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX);
}

function normalizeSubApiTab(code, rawTab) {
    if (code === 'webkr') return 'web';
    if (code === 'blog') return 'blog';
    if (code === 'encyc') return 'encyc';
    if (code === 'news') return 'wikiNews';
    if (code === 'local') return 'local';
    if (rawTab === 'webBlog') return 'web';
    if (rawTab === 'news') return 'wikiNews';
    return ['web', 'blog', 'encyc', 'wikiNews', 'local'].includes(rawTab) ? rawTab : 'web';
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
            portalDb.get("SELECT value FROM system_configs WHERE key = 'search_naver_subapis_v2'", (v2Err, v2Row) => {
                const alreadyMigrated = Boolean(!v2Err && v2Row && v2Row.value === '1');
                portalDb.get("SELECT value FROM system_configs WHERE key = 'search_naver_subapis'", (err, row) => {
                    if (!err && row && row.value) {
                        try {
                            const parsed = JSON.parse(row.value);
                            if (Array.isArray(parsed) && parsed.length > 0) {
                                const coreEnableSet = new Set(['webkr', 'blog', 'encyc', 'news', 'local']);
                                naverSubApis = parsed
                                    .filter((x) => x && typeof x.code === 'string')
                                    .map((x) => ({
                                        ...x,
                                        tab: normalizeSubApiTab(x.code, x.tab),
                                        enabled: !alreadyMigrated && coreEnableSet.has(x.code) ? true : Boolean(x.enabled)
                                    }));
                            }
                        } catch (_) {}
                    }
                    if (!alreadyMigrated) {
                        portalDb.run(
                            `INSERT INTO system_configs (key, value) VALUES ('search_naver_subapis', ?)
                             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                            [JSON.stringify(naverSubApis)],
                            () => {}
                        );
                        portalDb.run(
                            `INSERT INTO system_configs (key, value) VALUES ('search_naver_subapis_v2', '1')
                             ON CONFLICT(key) DO UPDATE SET value = '1'`,
                            () => {}
                        );
                    }
                    schemaInitialized = true;
                    resolve();
                });
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

function isSubApiAuthBlocked(code) {
    const ts = subApiAuthBlocked.get(code);
    if (!ts) return false;
    if (Date.now() - ts > AUTH_BLOCK_TTL_MS) {
        subApiAuthBlocked.delete(code);
        return false;
    }
    return true;
}

function markSubApiAuthBlocked(code) {
    subApiAuthBlocked.set(code, Date.now());
}

function getEngineToggles() {
    return engineToggles;
}

function getNaverSubApis() {
    return naverSubApis;
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

async function getSearchEngineStatus() {
    await ensureExternalSchema();
    const usage = await getTodayUsageMap();
    const activeLabels = naverSubApis
        .filter((s) => s.enabled && !isSubApiAuthBlocked(s.code))
        .map((s) => s.label)
        .join('·') || '없음';

    return {
        date: getTodayKst(),
        cacheSize: externalCache.size,
        naverSubApis: naverSubApis.map((s) => ({
            ...s,
            authBlocked: isSubApiAuthBlocked(s.code)
        })),
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
                name: `네이버 오픈 API (${activeLabels})`,
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
            },
            {
                id: 'externalSuggest',
                name: '실시간 검색어 추천 (네이버·구글·위키백과)',
                configured: true,
                enabled: engineToggles.externalSuggest !== false,
                todayCalls: usage.externalSuggest?.calls || 0,
                todayErrors: usage.externalSuggest?.errors || 0,
                dailyLimit: null
            },
            {
                id: 'kakaoMap',
                name: '카카오 로컬·지도 즉답 카드',
                configured: Boolean((process.env.KAKAO_REST_API_KEY || '').trim()),
                enabled: engineToggles.kakaoMap !== false,
                todayCalls: usage.kakaoMap?.calls || 0,
                todayErrors: usage.kakaoMap?.errors || 0,
                dailyLimit: 100000
            },
            {
                id: 'daumSearch',
                name: '카카오·다음 검색 API (웹·블로그·카페·이미지)',
                configured: Boolean((process.env.KAKAO_REST_API_KEY || '').trim()),
                enabled: engineToggles.daumSearch !== false,
                todayCalls: usage.daumSearch?.calls || 0,
                todayErrors: usage.daumSearch?.errors || 0,
                dailyLimit: 90000
            },
            {
                id: 'webBot',
                name: '한국형 표적 웹봇 (og:image · FTS5 · 정기 시드 수집)',
                configured: true,
                enabled: engineToggles.webBot !== false,
                todayCalls: usage.webBot?.calls || 0,
                todayErrors: usage.webBot?.errors || 0,
                dailyLimit: null
            },
            {
                id: 'geminiSummary',
                name: 'AI 한눈에 요약 (Google Gemini · 공개 자료 전용)',
                configured: Boolean(require('./searchAiBriefing.service').hasGeminiKey()),
                enabled: engineToggles.geminiSummary !== false,
                todayCalls: usage.geminiSummary?.calls || 0,
                todayErrors: usage.geminiSummary?.errors || 0,
                dailyLimit: null
            }
        ]
    };
}

async function isExternalSuggestEnabled() {
    await ensureExternalSchema();
    return engineToggles.externalSuggest !== false;
}

async function isEngineEnabled(engineId) {
    await ensureExternalSchema();
    return engineToggles[engineId] !== false;
}

async function setEngineToggle(engineId, enabled) {
    await ensureExternalSchema();
    if (!['wikipedia', 'naver', 'daumSearch', 'webBot', 'google', 'externalSuggest', 'kakaoMap', 'geminiSummary'].includes(engineId)) {
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

async function setNaverSubApi({ code, label, tab = 'web', enabled = true }) {
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
        const safeTab = normalizeSubApiTab(cleanCode, tab);
        naverSubApis.push({ code: cleanCode, label: cleanLabel, tab: safeTab, enabled: Boolean(enabled), custom: true });
    }
    subApiAuthBlocked.delete(cleanCode);
    await persistNaverSubApis();
    externalCache.clear();
    return { success: true, naverSubApis: naverSubApis.map((s) => ({ ...s, authBlocked: isSubApiAuthBlocked(s.code) })) };
}

async function removeNaverSubApi(code) {
    await ensureExternalSchema();
    const cleanCode = String(code || '').trim().toLowerCase();
    const target = naverSubApis.find((s) => s.code === cleanCode);
    if (!target) return { success: false, message: '등록된 API가 아닙니다.' };
    if (!target.custom) return { success: false, message: '기본 제공 API는 삭제할 수 없으며 비활성화만 가능합니다.' };
    naverSubApis = naverSubApis.filter((s) => s.code !== cleanCode);
    subApiAuthBlocked.delete(cleanCode);
    await persistNaverSubApis();
    externalCache.clear();
    return { success: true, naverSubApis: naverSubApis.map((s) => ({ ...s, authBlocked: isSubApiAuthBlocked(s.code) })) };
}

function clearExternalCache() {
    const prevSize = externalCache.size;
    externalCache.clear();
    subApiAuthBlocked.clear();
    return prevSize;
}

module.exports = {
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
};
