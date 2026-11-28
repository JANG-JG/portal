/**
 * 🗄️ JG 통합 검색 - 웹봇 SQLite 저장소 & FTS5 전문 역색인 (webBotStore.service.js)
 * - webbot_page_meta: 검색 결과 og:image·요약 캐시 (최대 5,000건 LRU, 30일 TTL)
 * - webbot_documents: 관심 시드 자동 수집 문서 (최대 3,000건 자동 회전)
 * - user_saved_clips: 사용자별 '📌 내 서버 보관함' 영구 스크랩 (user_id 완벽 격리)
 * - webbot_fts: SQLite FTS5 BM25 초고속 전문 검색 (초성·구형 환경 자동 폴백)
 */

const crypto = require('crypto');
const { portalDb } = require('../db');
const { normalizeCanonicalUrl } = require('./daumSearch.service');
const { extractChosung } = require('./chosung.util');

const MAX_META_ROWS = 5000;
const MAX_BOT_DOCS = 3000;
const META_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let storeReadyPromise = null;
let ftsAvailable = false;

function hashUrl(rawUrl) {
    const canon = normalizeCanonicalUrl(rawUrl) || String(rawUrl || '').trim();
    return crypto.createHash('sha1').update(canon).digest('hex');
}

function dbRun(sql, params = []) {
    if (!portalDb) return Promise.resolve({ changes: 0, lastID: 0 });
    return new Promise((resolve, reject) => {
        portalDb.run(sql, params, function onRun(err) {
            if (err) return reject(err);
            resolve({ changes: this.changes || 0, lastID: this.lastID || 0 });
        });
    });
}

function dbGet(sql, params = []) {
    if (!portalDb) return Promise.resolve(null);
    return new Promise((resolve) => {
        portalDb.get(sql, params, (err, row) => resolve(err ? null : row || null));
    });
}

function dbAll(sql, params = []) {
    if (!portalDb) return Promise.resolve([]);
    return new Promise((resolve) => {
        portalDb.all(sql, params, (err, rows) => resolve(err || !rows ? [] : rows));
    });
}

function ensureWebBotSchema() {
    if (storeReadyPromise) return storeReadyPromise;
    if (!portalDb) return Promise.resolve();

    storeReadyPromise = (async () => {
        await dbRun(`CREATE TABLE IF NOT EXISTS webbot_page_meta (
            url_hash TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            title TEXT DEFAULT '',
            description TEXT DEFAULT '',
            og_image TEXT,
            site_name TEXT DEFAULT '',
            fetched_at INTEGER NOT NULL
        )`);
        await dbRun(`CREATE INDEX IF NOT EXISTS idx_webbot_meta_fetched ON webbot_page_meta(fetched_at)`);

        await dbRun(`CREATE TABLE IF NOT EXISTS webbot_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url_hash TEXT NOT NULL UNIQUE,
            url TEXT NOT NULL,
            title TEXT NOT NULL,
            snippet TEXT DEFAULT '',
            body_text TEXT DEFAULT '',
            og_image TEXT,
            site_name TEXT DEFAULT '',
            seed_id INTEGER DEFAULT 0,
            published_at TEXT DEFAULT '',
            crawled_at INTEGER NOT NULL
        )`);
        await dbRun(`CREATE INDEX IF NOT EXISTS idx_webbot_docs_crawled ON webbot_documents(crawled_at DESC)`);

        await dbRun(`CREATE TABLE IF NOT EXISTS user_saved_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            url_hash TEXT NOT NULL,
            url TEXT NOT NULL,
            title TEXT NOT NULL,
            snippet TEXT DEFAULT '',
            body_text TEXT DEFAULT '',
            thumbnail_url TEXT,
            site_name TEXT DEFAULT '',
            category TEXT DEFAULT 'web',
            created_at INTEGER NOT NULL,
            UNIQUE(user_id, url_hash)
        )`);
        await dbRun(`CREATE INDEX IF NOT EXISTS idx_saved_clips_user ON user_saved_clips(user_id, created_at DESC)`);

        await dbRun(`CREATE TABLE IF NOT EXISTS webbot_seeds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            seed_type TEXT DEFAULT 'rss',
            category TEXT DEFAULT '정보',
            enabled INTEGER NOT NULL DEFAULT 1,
            interval_min INTEGER NOT NULL DEFAULT 240,
            last_crawled_at INTEGER NOT NULL DEFAULT 0,
            last_status TEXT DEFAULT '대기 중',
            items_collected INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )`);

        try {
            await dbRun(`CREATE VIRTUAL TABLE IF NOT EXISTS webbot_fts USING fts5(
                doc_key UNINDEXED,
                owner_scope UNINDEXED,
                title,
                snippet,
                body_text,
                site_name,
                tokenize='unicode61'
            )`);
            ftsAvailable = true;
        } catch (_) {
            ftsAvailable = false;
        }

        const seededRow = await dbGet("SELECT value FROM system_configs WHERE key = 'webbot_default_seeds_v1'");
        if (!seededRow) {
            const now = Date.now();
            const defaults = [
                ['대한민국 정책브리핑 (생활·정책 RSS)', 'https://www.korea.kr/rss/policy.xml', 'rss', '생활·정책', 1, 240, now],
                ['전자신문 IT·과학 속보 (RSS)', 'https://rss.etnews.com/Section901.xml', 'rss', 'IT·과학', 1, 240, now]
            ];
            for (const d of defaults) {
                await dbRun(
                    `INSERT OR IGNORE INTO webbot_seeds (label, url, seed_type, category, enabled, interval_min, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    d
                ).catch(() => {});
            }
            await dbRun(
                `INSERT INTO system_configs (key, value) VALUES ('webbot_default_seeds_v1', '1')
                 ON CONFLICT(key) DO UPDATE SET value = '1'`
            ).catch(() => {});
        }
        const v2SeedRow = await dbGet("SELECT value FROM system_configs WHERE key = 'webbot_default_seeds_v2'");
        if (!v2SeedRow) {
            await dbRun(
                `INSERT OR IGNORE INTO webbot_seeds (label, url, seed_type, category, enabled, interval_min, created_at)
                 VALUES (?, ?, 'rss', '종합뉴스', 1, 180, ?)`,
                ['SBS 뉴스 주요속보 (RSS)', 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01&plink=RSSREADER', Date.now()]
            ).catch(() => {});
            await dbRun(`INSERT INTO system_configs (key, value) VALUES ('webbot_default_seeds_v2', '1') ON CONFLICT(key) DO UPDATE SET value = '1'`).catch(() => {});
        }
    })();

    return storeReadyPromise;
}

async function upsertFtsEntry(docKey, ownerScope, { title = '', snippet = '', bodyText = '', siteName = '' }) {
    if (!ftsAvailable) return;
    try {
        await dbRun(`DELETE FROM webbot_fts WHERE doc_key = ?`, [docKey]);
        await dbRun(
            `INSERT INTO webbot_fts (doc_key, owner_scope, title, snippet, body_text, site_name) VALUES (?, ?, ?, ?, ?, ?)`,
            [docKey, ownerScope, title, snippet, bodyText, siteName]
        );
    } catch (_) {}
}

async function deleteFtsEntry(docKey) {
    if (!ftsAvailable) return;
    await dbRun(`DELETE FROM webbot_fts WHERE doc_key = ?`, [docKey]).catch(() => {});
}

async function savePageMeta({ url, title = '', description = '', ogImage = null, siteName = '' }) {
    await ensureWebBotSchema();
    if (!url) return;
    const urlHash = hashUrl(url);
    const now = Date.now();
    await dbRun(
        `INSERT INTO webbot_page_meta (url_hash, url, title, description, og_image, site_name, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url_hash) DO UPDATE SET
            title = CASE WHEN excluded.title != '' THEN excluded.title ELSE webbot_page_meta.title END,
            description = CASE WHEN excluded.description != '' THEN excluded.description ELSE webbot_page_meta.description END,
            og_image = COALESCE(excluded.og_image, webbot_page_meta.og_image),
            site_name = CASE WHEN excluded.site_name != '' THEN excluded.site_name ELSE webbot_page_meta.site_name END,
            fetched_at = excluded.fetched_at`,
        [urlHash, url, title.slice(0, 200), description.slice(0, 400), ogImage, siteName.slice(0, 60), now]
    ).catch(() => {});

    const cntRow = await dbGet(`SELECT COUNT(*) AS cnt FROM webbot_page_meta`);
    if (cntRow && cntRow.cnt > MAX_META_ROWS) {
        const overflow = cntRow.cnt - MAX_META_ROWS + 250;
        await dbRun(
            `DELETE FROM webbot_page_meta WHERE url_hash IN (
                SELECT url_hash FROM webbot_page_meta ORDER BY fetched_at ASC LIMIT ?
            )`,
            [overflow]
        ).catch(() => {});
    }
}

async function getCachedMetaMap(urls = []) {
    await ensureWebBotSchema();
    const result = new Map();
    if (!Array.isArray(urls) || urls.length === 0) return result;

    const hashToUrls = new Map();
    for (const u of urls) {
        if (!u) continue;
        const h = hashUrl(u);
        if (!hashToUrls.has(h)) hashToUrls.set(h, []);
        hashToUrls.get(h).push(u);
    }
    const hashes = Array.from(hashToUrls.keys()).slice(0, 50);
    if (!hashes.length) return result;

    const placeholders = hashes.map(() => '?').join(',');
    const minTs = Date.now() - META_TTL_MS;
    const rows = await dbAll(
        `SELECT url_hash, title, description, og_image, site_name FROM webbot_page_meta
         WHERE url_hash IN (${placeholders}) AND fetched_at >= ?`,
        [...hashes, minTs]
    );

    for (const row of rows) {
        const origList = hashToUrls.get(row.url_hash) || [];
        for (const orig of origList) {
            result.set(orig, {
                ogImage: row.og_image || null,
                siteName: row.site_name || '',
                description: row.description || ''
            });
        }
    }
    return result;
}

async function saveBotDocument({ url, title, snippet = '', bodyText = '', ogImage = null, siteName = '', seedId = 0, publishedAt = '' }) {
    await ensureWebBotSchema();
    if (!url || !title) return false;
    const urlHash = hashUrl(url);
    const now = Date.now();

    await dbRun(
        `INSERT INTO webbot_documents (url_hash, url, title, snippet, body_text, og_image, site_name, seed_id, published_at, crawled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url_hash) DO UPDATE SET
            title = excluded.title,
            snippet = CASE WHEN excluded.snippet != '' THEN excluded.snippet ELSE webbot_documents.snippet END,
            body_text = CASE WHEN excluded.body_text != '' THEN excluded.body_text ELSE webbot_documents.body_text END,
            og_image = COALESCE(excluded.og_image, webbot_documents.og_image),
            crawled_at = excluded.crawled_at`,
        [urlHash, url, title.slice(0, 200), snippet.slice(0, 360), bodyText.slice(0, 4000), ogImage, siteName.slice(0, 60), seedId, publishedAt.slice(0, 25), now]
    );

    await upsertFtsEntry(`bot:${urlHash}`, 'public', { title, snippet, bodyText, siteName });

    const cntRow = await dbGet(`SELECT COUNT(*) AS cnt FROM webbot_documents`);
    if (cntRow && cntRow.cnt > MAX_BOT_DOCS) {
        const oldRows = await dbAll(`SELECT url_hash FROM webbot_documents ORDER BY crawled_at ASC LIMIT 200`);
        for (const r of oldRows) {
            await dbRun(`DELETE FROM webbot_documents WHERE url_hash = ?`, [r.url_hash]).catch(() => {});
            await deleteFtsEntry(`bot:${r.url_hash}`);
        }
    }
    return true;
}

async function saveUserClip(userId, { url, title, snippet = '', bodyText = '', thumbnailUrl = null, siteName = '', category = 'web' }) {
    await ensureWebBotSchema();
    if (!userId || !url || !title) return null;
    const urlHash = hashUrl(url);
    const now = Date.now();

    await dbRun(
        `INSERT INTO user_saved_clips (user_id, url_hash, url, title, snippet, body_text, thumbnail_url, site_name, category, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, url_hash) DO UPDATE SET
            title = excluded.title,
            snippet = CASE WHEN excluded.snippet != '' THEN excluded.snippet ELSE user_saved_clips.snippet END,
            body_text = CASE WHEN excluded.body_text != '' THEN excluded.body_text ELSE user_saved_clips.body_text END,
            thumbnail_url = COALESCE(excluded.thumbnail_url, user_saved_clips.thumbnail_url),
            site_name = CASE WHEN excluded.site_name != '' THEN excluded.site_name ELSE user_saved_clips.site_name END`,
        [userId, urlHash, url, title.slice(0, 200), snippet.slice(0, 360), bodyText.slice(0, 4000), thumbnailUrl, siteName.slice(0, 60), category.slice(0, 24), now]
    );

    await upsertFtsEntry(`clip:${userId}:${urlHash}`, `clip:${userId}`, { title, snippet, bodyText, siteName });
    return dbGet(`SELECT id, url_hash, url, title, snippet, thumbnail_url, site_name, category, created_at FROM user_saved_clips WHERE user_id = ? AND url_hash = ?`, [userId, urlHash]);
}

async function removeUserClip(userId, { id = null, url = '' } = {}) {
    await ensureWebBotSchema();
    if (!userId) return false;
    let target = null;
    if (id) {
        target = await dbGet(`SELECT id, url_hash FROM user_saved_clips WHERE id = ? AND user_id = ?`, [Number(id), userId]);
    } else if (url) {
        target = await dbGet(`SELECT id, url_hash FROM user_saved_clips WHERE user_id = ? AND url_hash = ?`, [userId, hashUrl(url)]);
    }
    if (!target) return false;

    const r = await dbRun(`DELETE FROM user_saved_clips WHERE id = ? AND user_id = ?`, [target.id, userId]);
    await deleteFtsEntry(`clip:${userId}:${target.url_hash}`);
    return r.changes > 0;
}

async function getUserClippedUrlSet(userId, urls = []) {
    await ensureWebBotSchema();
    const out = new Set();
    if (!userId || !Array.isArray(urls) || !urls.length) return out;
    const hashMap = new Map();
    for (const u of urls) {
        if (u) hashMap.set(hashUrl(u), u);
    }
    const hashes = Array.from(hashMap.keys()).slice(0, 60);
    if (!hashes.length) return out;

    const ph = hashes.map(() => '?').join(',');
    const rows = await dbAll(
        `SELECT url_hash FROM user_saved_clips WHERE user_id = ? AND url_hash IN (${ph})`,
        [userId, ...hashes]
    );
    for (const row of rows) {
        out.add(row.url_hash);
    }
    return out;
}

async function listUserClips(userId, limit = 20, offset = 0) {
    await ensureWebBotSchema();
    if (!userId) return [];
    return dbAll(
        `SELECT id, url_hash, url, title, snippet, thumbnail_url, site_name, category, created_at
         FROM user_saved_clips WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [userId, Math.min(50, limit), Math.max(0, offset)]
    );
}

function buildFtsMatchQuery(rawQuery) {
    const tokens = String(rawQuery || '')
        .replace(/["'*():^+\-{}\[\]\\/|~<>!?.,;]/g, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 1)
        .slice(0, 6);
    if (!tokens.length) return '';
    return tokens.map((t) => `"${t}"*`).join(' AND ');
}

async function searchClipsAndBotDocs(rawQuery, userId, isChosung = false, cleanChosung = '', limit = 8) {
    await ensureWebBotSchema();
    const q = String(rawQuery || '').trim();
    if (!q) return { savedClips: [], botDocs: [] };

    if (isChosung) {
        const rawClips = userId ? await dbAll(`SELECT id, url, title, snippet, thumbnail_url, site_name, created_at FROM user_saved_clips WHERE user_id = ? ORDER BY created_at DESC LIMIT 80`, [userId]) : [];
        const savedClips = rawClips.filter((r) => extractChosung(r.title).toLowerCase().includes(cleanChosung)).slice(0, limit);

        const rawBots = await dbAll(`SELECT id, url, title, snippet, og_image, site_name, published_at, crawled_at FROM webbot_documents ORDER BY crawled_at DESC LIMIT 120`);
        const botDocs = rawBots.filter((r) => extractChosung(r.title).toLowerCase().includes(cleanChosung)).slice(0, limit);
        return { savedClips, botDocs };
    }

    const matchExpr = ftsAvailable ? buildFtsMatchQuery(q) : '';
    if (ftsAvailable && matchExpr) {
        try {
            const clipScope = `clip:${userId || '__none__'}`;
            const ftsRows = await dbAll(
                `SELECT doc_key, owner_scope, bm25(webbot_fts, 0.0, 0.0, 8.0, 3.0, 1.0, 2.0) AS rank
                 FROM webbot_fts
                 WHERE webbot_fts MATCH ? AND owner_scope IN ('public', ?)
                 ORDER BY rank ASC LIMIT ?`,
                [matchExpr, clipScope, limit * 3]
            );

            if (ftsRows.length > 0) {
                const clipHashes = [];
                const botHashes = [];
                for (const r of ftsRows) {
                    if (r.doc_key.startsWith(`clip:${userId}:`)) {
                        clipHashes.push(r.doc_key.slice(`clip:${userId}:`.length));
                    } else if (r.doc_key.startsWith('bot:')) {
                        botHashes.push(r.doc_key.slice(4));
                    }
                }

                const savedClips = clipHashes.length && userId
                    ? await dbAll(
                        `SELECT id, url, title, snippet, thumbnail_url, site_name, created_at FROM user_saved_clips
                         WHERE user_id = ? AND url_hash IN (${clipHashes.map(() => '?').join(',')}) LIMIT ?`,
                        [userId, ...clipHashes, limit]
                    )
                    : [];

                const botDocs = botHashes.length
                    ? await dbAll(
                        `SELECT id, url, title, snippet, og_image, site_name, published_at, crawled_at FROM webbot_documents
                         WHERE url_hash IN (${botHashes.map(() => '?').join(',')}) LIMIT ?`,
                        [...botHashes, limit]
                    )
                    : [];

                return { savedClips, botDocs };
            }
        } catch (_) {}
    }

    const term = `%${q}%`;
    const savedClips = userId
        ? await dbAll(
            `SELECT id, url, title, snippet, thumbnail_url, site_name, created_at FROM user_saved_clips
             WHERE user_id = ? AND (title LIKE ? OR snippet LIKE ? OR body_text LIKE ?)
             ORDER BY created_at DESC LIMIT ?`,
            [userId, term, term, term, limit]
        )
        : [];

    const botDocs = await dbAll(
        `SELECT id, url, title, snippet, og_image, site_name, published_at, crawled_at FROM webbot_documents
         WHERE (title LIKE ? OR snippet LIKE ? OR body_text LIKE ?)
         ORDER BY crawled_at DESC LIMIT ?`,
        [term, term, term, limit]
    );
    return { savedClips, botDocs };
}

async function getWebBotStorageStats() {
    await ensureWebBotSchema();
    const [metaRow, docRow, clipRow, seedRow] = await Promise.all([
        dbGet(`SELECT COUNT(*) AS cnt, COALESCE(SUM(LENGTH(title)+LENGTH(description)),0) AS bytes FROM webbot_page_meta`),
        dbGet(`SELECT COUNT(*) AS cnt, COALESCE(SUM(LENGTH(title)+LENGTH(snippet)+LENGTH(body_text)),0) AS bytes FROM webbot_documents`),
        dbGet(`SELECT COUNT(*) AS cnt, COALESCE(SUM(LENGTH(title)+LENGTH(snippet)+LENGTH(body_text)),0) AS bytes FROM user_saved_clips`),
        dbGet(`SELECT COUNT(*) AS total, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS active FROM webbot_seeds`)
    ]);
    const rawBytes = (metaRow?.bytes || 0) + (docRow?.bytes || 0) + (clipRow?.bytes || 0);
    return {
        ftsEnabled: ftsAvailable,
        metaCachedCount: metaRow?.cnt || 0,
        maxMetaLimit: MAX_META_ROWS,
        indexedDocsCount: docRow?.cnt || 0,
        maxDocsLimit: MAX_BOT_DOCS,
        savedClipsCount: clipRow?.cnt || 0,
        totalSeeds: seedRow?.total || 0,
        activeSeeds: seedRow?.active || 0,
        estimatedSizeKb: Math.max(1, Math.round((rawBytes * 1.8) / 1024))
    };
}

async function clearMetaCacheTable() {
    await ensureWebBotSchema();
    const r = await dbRun(`DELETE FROM webbot_page_meta`);
    return r.changes || 0;
}

async function purgeBotDocuments(mode = 'expired') {
    await ensureWebBotSchema();
    if (mode === 'all') {
        const r = await dbRun(`DELETE FROM webbot_documents`);
        if (ftsAvailable) await dbRun(`DELETE FROM webbot_fts WHERE owner_scope = 'public'`).catch(() => {});
        return r.changes || 0;
    }
    const cutoff = Date.now() - META_TTL_MS;
    const oldRows = await dbAll(`SELECT url_hash FROM webbot_documents WHERE crawled_at < ?`, [cutoff]);
    for (const row of oldRows) {
        await dbRun(`DELETE FROM webbot_documents WHERE url_hash = ?`, [row.url_hash]).catch(() => {});
        await deleteFtsEntry(`bot:${row.url_hash}`);
    }
    return oldRows.length;
}

async function deleteBotDocumentById(docId) {
    await ensureWebBotSchema();
    const row = await dbGet(`SELECT id, url_hash FROM webbot_documents WHERE id = ?`, [Number(docId)]);
    if (!row) return false;
    await dbRun(`DELETE FROM webbot_documents WHERE id = ?`, [row.id]);
    await deleteFtsEntry(`bot:${row.url_hash}`);
    return true;
}

module.exports = {
    hashUrl, dbRun, dbGet, dbAll, ensureWebBotSchema,
    savePageMeta, getCachedMetaMap, saveBotDocument,
    saveUserClip, removeUserClip, getUserClippedUrlSet, listUserClips,
    searchClipsAndBotDocs, getWebBotStorageStats, clearMetaCacheTable,
    purgeBotDocuments, deleteBotDocumentById
};
