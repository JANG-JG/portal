/**
 * ⏱️ JG 통합 검색 - 웹봇 백그라운드 큐 & 관심 시드 정기 스케줄러 (webBotScheduler.service.js)
 * - 동시성 2 제한 백그라운드 수집 큐 (포털 이벤트 루프 보호)
 * - 검색 상위 문서 빠른 og:image 매칭 + 미수집 문서 비동기 보강
 * - 관리자 등록 RSS·웹사이트 시드 정기 순회 및 즉시 실행 지원
 */

const cron = require('node-cron');
const { isEngineEnabled, incrementUsage } = require('./externalSearchState.service');
const {
    validateSafePublicUrl,
    fetchPageDocument,
    fetchSeedFeedItems,
    getRobotsCacheSize,
    clearRobotsCache
} = require('./webBotFetcher.service');
const {
    dbRun,
    dbGet,
    dbAll,
    ensureWebBotSchema,
    savePageMeta,
    getCachedMetaMap,
    saveBotDocument,
    saveUserClip,
    getWebBotStorageStats,
    clearMetaCacheTable,
    purgeBotDocuments,
    deleteBotDocumentById
} = require('./webBotStore.service');

const MAX_QUEUE_SIZE = 120;
const MAX_CONCURRENCY = 2;

const metaQueue = [];
const inFlightUrls = new Set();
const recentCrawlLogs = [];
let activeWorkers = 0;
let schedulerStarted = false;
let isSeedCrawlRunning = false;

function pushCrawlLog(seedLabel, status, message, savedCount = 0) {
    recentCrawlLogs.unshift({
        time: Date.now(),
        seedLabel: String(seedLabel || '웹봇'),
        status,
        savedCount,
        message: String(message || '')
    });
    if (recentCrawlLogs.length > 30) recentCrawlLogs.length = 30;
}

function enqueueMetaUrl(url) {
    if (!url || typeof url !== 'string') return;
    if (inFlightUrls.has(url) || metaQueue.length >= MAX_QUEUE_SIZE) return;
    inFlightUrls.add(url);
    metaQueue.push(url);
    pumpMetaQueue();
}

function pumpMetaQueue() {
    while (activeWorkers < MAX_CONCURRENCY && metaQueue.length > 0) {
        const nextUrl = metaQueue.shift();
        activeWorkers += 1;
        processMetaJob(nextUrl)
            .catch(() => {})
            .finally(() => {
                activeWorkers -= 1;
                inFlightUrls.delete(nextUrl);
                if (metaQueue.length > 0) pumpMetaQueue();
            });
    }
}

async function processMetaJob(url) {
    const enabled = await isEngineEnabled('webBot');
    if (!enabled) return;
    const res = await fetchPageDocument(url, { fullBody: false, timeoutMs: 2200, skipWaitIfBusy: false });
    await incrementUsage('webBot', !res.ok);
    if (res.ok) {
        await savePageMeta({
            url,
            title: res.title,
            description: res.description,
            ogImage: res.ogImage,
            siteName: res.siteName
        });
    } else if (res.reason !== 'domain_busy') {
        // 반복 실패 방지를 위해 빈 메타 캐시 기록
        await savePageMeta({ url, title: '', description: '', ogImage: null, siteName: '' });
    }
}

/**
 * 검색 결과 배열에 SQLite 캐시된 og:image를 즉시 주입하고,
 * 미캐시 상위 문서는 짧은 예산(850ms) 내 조회 + 나머지는 백그라운드 큐로 위임
 */
async function enrichSearchItemsWithMeta(items = [], { quickFetchMax = 3, quickBudgetMs = 850 } = {}) {
    if (!Array.isArray(items) || items.length === 0) return items;
    const needUrls = items
        .filter((it) => it && it.link && !it.thumbnail)
        .map((it) => it.link);
    if (needUrls.length === 0) return items;

    const cachedMap = await getCachedMetaMap(needUrls);
    const stillMissing = [];

    for (const it of items) {
        if (!it || !it.link || it.thumbnail) continue;
        const hit = cachedMap.get(it.link);
        if (hit) {
            if (hit.ogImage) it.thumbnail = hit.ogImage;
            if (!it.siteName && hit.siteName) it.siteName = hit.siteName;
        } else {
            stillMissing.push(it);
        }
    }

    const botEnabled = await isEngineEnabled('webBot');
    if (!botEnabled || stillMissing.length === 0) return items;

    const quickTargets = stillMissing.slice(0, quickFetchMax);
    const bgTargets = stillMissing.slice(quickFetchMax, quickFetchMax + 10);

    if (quickTargets.length > 0 && quickBudgetMs > 0) {
        const quickTask = Promise.all(
            quickTargets.map(async (it) => {
                const doc = await fetchPageDocument(it.link, {
                    fullBody: false,
                    timeoutMs: quickBudgetMs,
                    skipWaitIfBusy: true
                });
                if (doc.ok) {
                    await incrementUsage('webBot', false);
                    if (doc.ogImage) it.thumbnail = doc.ogImage;
                    if (!it.siteName && doc.siteName) it.siteName = doc.siteName;
                    await savePageMeta({
                        url: it.link,
                        title: doc.title,
                        description: doc.description,
                        ogImage: doc.ogImage,
                        siteName: doc.siteName
                    });
                } else {
                    enqueueMetaUrl(it.link);
                }
            })
        );
        await Promise.race([
            quickTask,
            new Promise((r) => setTimeout(r, quickBudgetMs + 60))
        ]).catch(() => {});
    }

    for (const it of bgTargets) {
        enqueueMetaUrl(it.link);
    }
    return items;
}

/**
 * 사용자가 '📌 보관' 클릭 시 본문 텍스트·썸네일을 안전 추출해 영구 색인
 */
async function scrapeAndSaveUserClip(userId, rawPayload = {}) {
    const rawUrl = String(rawPayload.url || '').trim();
    const safeParsed = await validateSafePublicUrl(rawUrl);
    if (!safeParsed) {
        return { success: false, message: '보관할 수 없는 주소(사설망 또는 잘못된 URL)입니다.' };
    }

    let title = String(rawPayload.title || '').trim();
    let snippet = String(rawPayload.snippet || '').trim();
    let thumbnailUrl = rawPayload.thumbnail && /^https?:\/\//i.test(String(rawPayload.thumbnail))
        ? String(rawPayload.thumbnail).trim()
        : null;
    let siteName = String(rawPayload.siteName || '').trim();
    let bodyText = '';

    const botEnabled = await isEngineEnabled('webBot');
    if (botEnabled) {
        const scraped = await fetchPageDocument(safeParsed.toString(), { fullBody: true, timeoutMs: 3200 });
        await incrementUsage('webBot', !scraped.ok);
        if (scraped.ok) {
            if (!title && scraped.title) title = scraped.title;
            if (!snippet && scraped.description) snippet = scraped.description;
            if (!thumbnailUrl && scraped.ogImage) thumbnailUrl = scraped.ogImage;
            if (!siteName && scraped.siteName) siteName = scraped.siteName;
            bodyText = scraped.bodyText || '';
        }
    }

    if (!title) title = safeParsed.hostname;
    const saved = await saveUserClip(userId, {
        url: safeParsed.toString(),
        title,
        snippet,
        bodyText,
        thumbnailUrl,
        siteName: siteName || safeParsed.hostname.replace(/^www\./, ''),
        category: String(rawPayload.category || 'web')
    });

    return { success: Boolean(saved), clip: saved };
}

async function listSeeds() {
    await ensureWebBotSchema();
    return dbAll(`SELECT * FROM webbot_seeds ORDER BY id ASC`);
}

async function upsertSeed({ id = null, label, url, seedType = 'rss', category = '정보', enabled = true, intervalMin = 240 }) {
    await ensureWebBotSchema();
    const cleanLabel = String(label || '').trim().slice(0, 60);
    const cleanUrl = String(url || '').trim();
    if (!cleanLabel || !cleanUrl) {
        return { success: false, message: '시드 이름과 URL을 모두 입력해 주세요.' };
    }
    const safeUrl = await validateSafePublicUrl(cleanUrl);
    if (!safeUrl) {
        return { success: false, message: '유효한 공개 http/https 주소만 시드로 등록할 수 있습니다.' };
    }
    const safeType = seedType === 'html' ? 'html' : 'rss';
    const safeCat = String(category || '정보').trim().slice(0, 24) || '정보';
    const safeInterval = Math.max(30, Math.min(1440, parseInt(intervalMin, 10) || 240));
    const safeEnabled = enabled ? 1 : 0;

    if (id) {
        await dbRun(
            `UPDATE webbot_seeds SET label = ?, url = ?, seed_type = ?, category = ?, enabled = ?, interval_min = ? WHERE id = ?`,
            [cleanLabel, safeUrl.toString(), safeType, safeCat, safeEnabled, safeInterval, Number(id)]
        );
    } else {
        await dbRun(
            `INSERT INTO webbot_seeds (label, url, seed_type, category, enabled, interval_min, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(url) DO UPDATE SET label = excluded.label, category = excluded.category, enabled = excluded.enabled, interval_min = excluded.interval_min`,
            [cleanLabel, safeUrl.toString(), safeType, safeCat, safeEnabled, safeInterval, Date.now()]
        );
    }
    return { success: true, seeds: await listSeeds() };
}

async function deleteSeed(id) {
    await ensureWebBotSchema();
    const r = await dbRun(`DELETE FROM webbot_seeds WHERE id = ?`, [Number(id)]);
    return { success: r.changes > 0, seeds: await listSeeds() };
}

async function toggleSeedEnabled(id, enabled) {
    await ensureWebBotSchema();
    const r = await dbRun(`UPDATE webbot_seeds SET enabled = ? WHERE id = ?`, [enabled ? 1 : 0, Number(id)]);
    return { success: r.changes > 0, seeds: await listSeeds() };
}

async function crawlSingleSeed(seed) {
    const feedRes = await fetchSeedFeedItems(seed.url, 6);
    await incrementUsage('webBot', !feedRes.ok);
    if (!feedRes.ok) {
        const failMsg = `수집 실패 (${feedRes.reason})`;
        await dbRun(
            `UPDATE webbot_seeds SET last_crawled_at = ?, last_status = ? WHERE id = ?`,
            [Date.now(), failMsg, seed.id]
        );
        pushCrawlLog(seed.label, 'error', failMsg, 0);
        return 0;
    }

    let savedCount = 0;
    for (const item of feedRes.items.slice(0, 5)) {
        let ogImage = item.ogImage || null;
        let bodyText = '';
        let snippet = item.snippet || '';

        const pageDoc = await fetchPageDocument(item.url, { fullBody: true, timeoutMs: 2500 });
        if (pageDoc.ok) {
            if (!ogImage && pageDoc.ogImage) ogImage = pageDoc.ogImage;
            if (!snippet && pageDoc.description) snippet = pageDoc.description;
            bodyText = pageDoc.bodyText || '';
        }

        const ok = await saveBotDocument({
            url: item.url,
            title: item.title,
            snippet,
            bodyText,
            ogImage,
            siteName: seed.label,
            seedId: seed.id,
            publishedAt: item.publishedAt
        });
        if (ok) savedCount += 1;
    }

    const okMsg = `정상 (${savedCount}건 갱신 · 원본 ${feedRes.items.length}건 확인)`;
    await dbRun(
        `UPDATE webbot_seeds SET last_crawled_at = ?, last_status = ?, items_collected = items_collected + ? WHERE id = ?`,
        [Date.now(), `정상 (${savedCount}건 갱신)`, savedCount, seed.id]
    );
    pushCrawlLog(seed.label, 'ok', okMsg, savedCount);
    return savedCount;
}

async function runScheduledOrManualSeedCrawl(targetSeedId = null, force = false) {
    if (isSeedCrawlRunning) {
        return { success: false, message: '이미 웹봇 시드 수집이 진행 중입니다.' };
    }
    const botEnabled = await isEngineEnabled('webBot');
    if (!botEnabled && !force) {
        return { success: false, message: '웹봇 엔진이 비활성화되어 있습니다.' };
    }

    isSeedCrawlRunning = true;
    try {
        await ensureWebBotSchema();
        const seeds = await listSeeds();
        const now = Date.now();
        const targets = seeds.filter((s) => {
            if (targetSeedId) return Number(s.id) === Number(targetSeedId);
            if (!s.enabled) return false;
            if (force) return true;
            return now - (s.last_crawled_at || 0) >= (s.interval_min || 240) * 60 * 1000;
        });

        let totalSaved = 0;
        for (const seed of targets) {
            totalSaved += await crawlSingleSeed(seed);
        }
        return { success: true, crawledSeeds: targets.length, totalSaved };
    } finally {
        isSeedCrawlRunning = false;
    }
}

async function getWebBotAdminSnapshot() {
    await ensureWebBotSchema();
    const [enabled, stats, seeds, recentDocs] = await Promise.all([
        isEngineEnabled('webBot'),
        getWebBotStorageStats(),
        listSeeds(),
        dbAll(`SELECT id, url, title, snippet, site_name, og_image, published_at, crawled_at FROM webbot_documents ORDER BY crawled_at DESC LIMIT 15`)
    ]);
    return {
        enabled,
        queueDepth: metaQueue.length,
        activeWorkers,
        isSeedCrawlRunning,
        robotsCachedHosts: getRobotsCacheSize(),
        stats,
        seeds,
        recentDocs,
        recentLogs: recentCrawlLogs
    };
}

async function clearAllWebBotCaches() {
    const metaCleared = await clearMetaCacheTable();
    const robotsCleared = clearRobotsCache();
    return metaCleared + robotsCleared;
}

function initWebBotScheduler() {
    if (schedulerStarted) return;
    const isDevInstance = process.env.PORT == 3005 || process.env.IS_DEV === 'true';
    const isPrimaryWorker = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
    if (isDevInstance || !isPrimaryWorker) return;

    schedulerStarted = true;
    ensureWebBotSchema().catch(() => {});

    // 30분마다 주기 도래한 관심 시드만 조용히 순회 (서버 기동 2분 후 첫 점검)
    setTimeout(() => {
        runScheduledOrManualSeedCrawl(null, false).catch(() => {});
    }, 120 * 1000);

    cron.schedule('*/30 * * * *', () => {
        runScheduledOrManualSeedCrawl(null, false).catch(() => {});
    });
}

module.exports = {
    enrichSearchItemsWithMeta,
    scrapeAndSaveUserClip,
    listSeeds,
    upsertSeed,
    deleteSeed,
    toggleSeedEnabled,
    runScheduledOrManualSeedCrawl,
    getWebBotAdminSnapshot,
    clearAllWebBotCaches,
    purgeBotDocuments,
    deleteBotDocumentById,
    pushCrawlLog,
    initWebBotScheduler
};
