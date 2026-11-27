/**
 * 🕒 JG 통합 검색 - 개인화 최근 검색어(암호화) & 자동완성 서비스 (searchHistory.service.js)
 * - 계정별 AES-256-GCM 암호화 저장 (타인·관리자 열람 불가, 개인 프라이버시 엄격 보호)
 * - 자동저장 ON/OFF, 개별 삭제, 전체 삭제 지원
 * - 타이핑 시 최근 검색어 + 내 사이트 제목(초성 포함) + 스마트 추천어 자동완성
 */

const crypto = require('crypto');
const { portalDb, wikiDb, newsDb } = require('../db');
const { ADMIN_USERS } = require('../../config/constants');
const { isServiceAllowed } = require('../moduleRegistry.service');
const { encryptMemoText, decryptMemoText } = require('../crypto.service');
const { isChosungOnly, matchesQuery } = require('./chosung.util');
const { getAllowedShortcuts } = require('./internalSearch.service');

let schemaReady = false;
function ensureSearchTables() {
    if (schemaReady || !portalDb) return Promise.resolve();
    return new Promise((resolve) => {
        portalDb.serialize(() => {
            portalDb.run(`CREATE TABLE IF NOT EXISTS search_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                query_enc TEXT NOT NULL,
                query_hash TEXT NOT NULL,
                updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
                UNIQUE(user_id, query_hash)
            )`);
            portalDb.run(`CREATE INDEX IF NOT EXISTS idx_search_history_user_time ON search_history(user_id, updated_at DESC)`);
            portalDb.run(`CREATE TABLE IF NOT EXISTS search_user_settings (
                user_id TEXT PRIMARY KEY,
                auto_save INTEGER NOT NULL DEFAULT 1,
                updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`, () => {
                schemaReady = true;
                resolve();
            });
        });
    });
}

function hashUserQuery(userId, query) {
    const secret = process.env.JWT_SECRET || 'jg_search_fallback_salt';
    return crypto.createHmac('sha256', secret).update(`${userId}::${query.toLowerCase()}`).digest('hex');
}

async function getAutoSaveSetting(userId) {
    await ensureSearchTables();
    if (!portalDb || !userId) return true;
    return new Promise((resolve) => {
        portalDb.get('SELECT auto_save FROM search_user_settings WHERE user_id = ?', [userId], (err, row) => {
            if (err || !row) return resolve(true);
            resolve(row.auto_save !== 0);
        });
    });
}

async function setAutoSaveSetting(userId, enabled) {
    await ensureSearchTables();
    if (!portalDb || !userId) return true;
    const val = enabled ? 1 : 0;
    return new Promise((resolve) => {
        portalDb.run(
            `INSERT INTO search_user_settings (user_id, auto_save, updated_at)
             VALUES (?, ?, datetime('now', 'localtime'))
             ON CONFLICT(user_id) DO UPDATE SET auto_save = excluded.auto_save, updated_at = datetime('now', 'localtime')`,
            [userId, val],
            () => resolve(Boolean(val))
        );
    });
}

async function getHistory(userId, limit = 15) {
    await ensureSearchTables();
    if (!portalDb || !userId) return [];
    const safeLimit = Math.min(30, Math.max(1, parseInt(limit, 10) || 15));
    return new Promise((resolve) => {
        portalDb.all(
            'SELECT id, query_enc, updated_at FROM search_history WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?',
            [userId, safeLimit],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                const list = [];
                for (const r of rows) {
                    try {
                        const q = decryptMemoText(r.query_enc, userId);
                        if (q && q.trim()) {
                            list.push({ id: r.id, query: q.trim(), updated_at: r.updated_at });
                        }
                    } catch (_) {}
                }
                resolve(list);
            }
        );
    });
}

const SUGGEST_CACHE_TTL_MS = 60 * 1000;
const userSuggestCache = new Map();
let sharedSuggestCache = { expiresAt: 0, wiki: [], news: [] };

function invalidateUserSuggestCache(userId) {
    if (userId) userSuggestCache.delete(userId);
}

async function addHistory(userId, rawQuery) {
    const q = (rawQuery || '').trim();
    if (!q || q.length > 100 || !portalDb || !userId) return false;
    const autoSave = await getAutoSaveSetting(userId);
    if (!autoSave) return false;

    await ensureSearchTables();
    const enc = encryptMemoText(q, userId);
    const qHash = hashUserQuery(userId, q);

    return new Promise((resolve) => {
        portalDb.run(
            `INSERT INTO search_history (user_id, query_enc, query_hash, updated_at)
             VALUES (?, ?, ?, datetime('now', 'localtime'))
             ON CONFLICT(user_id, query_hash) DO UPDATE SET query_enc = excluded.query_enc, updated_at = datetime('now', 'localtime')`,
            [userId, enc, qHash],
            (err) => {
                if (err) return resolve(false);
                invalidateUserSuggestCache(userId);
                // 사용자당 최대 30건만 유지
                portalDb.run(
                    `DELETE FROM search_history WHERE user_id = ? AND id NOT IN (
                        SELECT id FROM search_history WHERE user_id = ? ORDER BY updated_at DESC LIMIT 30
                    )`,
                    [userId, userId],
                    () => resolve(true)
                );
            }
        );
    });
}

async function deleteHistoryItem(userId, itemId) {
    await ensureSearchTables();
    if (!portalDb || !userId) return false;
    const idNum = parseInt(itemId, 10);
    if (!Number.isInteger(idNum) || idNum <= 0) return false;
    return new Promise((resolve) => {
        portalDb.run('DELETE FROM search_history WHERE id = ? AND user_id = ?', [idNum, userId], function (err) {
            if (!err && this.changes > 0) invalidateUserSuggestCache(userId);
            resolve(!err && this.changes > 0);
        });
    });
}

async function clearHistory(userId) {
    await ensureSearchTables();
    if (!portalDb || !userId) return false;
    return new Promise((resolve) => {
        portalDb.run('DELETE FROM search_history WHERE user_id = ?', [userId], (err) => {
            if (!err) invalidateUserSuggestCache(userId);
            resolve(!err);
        });
    });
}

const SMART_SUGGEST_HINTS = [
    { text: '오늘 날씨', badge: '날씨' },
    { text: '서울 날씨', badge: '날씨' },
    { text: '계룡 날씨', badge: '날씨' },
    { text: '도쿄 날씨', badge: '해외날씨' },
    { text: '원달러 환율', badge: '환율' },
    { text: '코스피 증시', badge: '증시' },
    { text: '34평 몇제곱미터', badge: '단위변환' }
];

async function getCachedUserSources(userId) {
    const now = Date.now();
    const cached = userSuggestCache.get(userId);
    if (cached && cached.expiresAt > now) {
        return cached;
    }
    const [history, memos] = await Promise.all([
        getHistory(userId, 15),
        new Promise((resolve) => {
            if (!portalDb) return resolve([]);
            portalDb.all('SELECT id, title FROM user_memos WHERE user_id = ? ORDER BY updated_at DESC LIMIT 30', [userId], (err, rows) => {
                if (err || !rows) return resolve([]);
                const list = [];
                for (const r of rows) {
                    try {
                        const dec = decryptMemoText(r.title, userId);
                        if (dec) list.push({ text: dec, url: `/memo?id=${r.id}` });
                    } catch (_) {}
                }
                resolve(list);
            });
        })
    ]);
    const entry = { expiresAt: now + SUGGEST_CACHE_TTL_MS, history, memos };
    userSuggestCache.set(userId, entry);
    return entry;
}

async function getCachedSharedSources() {
    const now = Date.now();
    if (sharedSuggestCache.expiresAt > now) {
        return sharedSuggestCache;
    }
    const [wiki, news] = await Promise.all([
        new Promise((resolve) => {
            if (!wikiDb) return resolve([]);
            wikiDb.all('SELECT title, slug FROM wiki_pages ORDER BY updated_at DESC LIMIT 40', [], (err, rows) => {
                if (err || !rows) return resolve([]);
                resolve(rows.map(r => ({ text: r.title, url: `https://wiki.j-jg.cc/page/${encodeURIComponent(r.slug || '')}` })));
            });
        }),
        new Promise((resolve) => {
            if (!newsDb) return resolve([]);
            newsDb.all('SELECT title FROM news_articles ORDER BY id DESC LIMIT 30', [], (err, rows) => {
                if (err || !rows) return resolve([]);
                resolve(rows.map(r => ({ text: r.title })));
            });
        })
    ]);
    sharedSuggestCache = { expiresAt: now + SUGGEST_CACHE_TTL_MS, wiki, news };
    return sharedSuggestCache;
}

async function getSuggestions(user, rawPrefix) {
    const userId = user?.username || 'admin';
    const isAdmin = Boolean(user?.role === 'admin' || ADMIN_USERS.has(userId));
    const hasWiki = isAdmin || isServiceAllowed(user, 'wiki');
    const hasNews = isAdmin || isServiceAllowed(user, 'news');

    const q = (rawPrefix || '').trim();
    const isChosung = isChosungOnly(q);
    const cleanChosung = q.replace(/\s+/g, '').toLowerCase();

    const suggestions = [];
    const seen = new Set();
    const pushItem = (text, type, badge, url = null) => {
        const key = text.toLowerCase();
        if (!text || seen.has(key)) return;
        seen.add(key);
        suggestions.push({ text, type, badge, url });
    };

    const userSources = await getCachedUserSources(userId);

    // 1) 최근 검색어
    for (const h of userSources.history) {
        if (!q || matchesQuery(h.query, q, isChosung, cleanChosung)) {
            pushItem(h.query, 'history', '최근 검색');
            if (suggestions.length >= 4) break;
        }
    }

    if (!q) {
        // 빈 입력(포커스) 시 공용 캐시도 백그라운드 예열
        getCachedSharedSources().catch(() => {});
        for (const hint of SMART_SUGGEST_HINTS.slice(0, 4)) {
            pushItem(hint.text, 'smart', hint.badge);
        }
        return suggestions.slice(0, 8);
    }

    // 2) 스마트 추천어
    for (const hint of SMART_SUGGEST_HINTS) {
        if (matchesQuery(hint.text, q, isChosung, cleanChosung)) {
            pushItem(hint.text, 'smart', hint.badge);
        }
    }

    // 3) 사이트 바로가기
    for (const s of getAllowedShortcuts(user)) {
        if (matchesQuery(s.title, q, isChosung, cleanChosung) || matchesQuery(s.keywords, q, isChosung, cleanChosung)) {
            pushItem(s.title, 'shortcut', '바로가기', s.url);
        }
    }

    // 4) 내 메모 제목 & 가족 위키 제목 & 뉴스 제목 (초성 포함, 메모리 캐시)
    const sharedSources = (hasWiki || hasNews) ? await getCachedSharedSources() : { wiki: [], news: [] };

    let memoCount = 0;
    for (const m of userSources.memos) {
        if (matchesQuery(m.text, q, isChosung, cleanChosung)) {
            pushItem(m.text, 'memo', '내 메모', m.url);
            if (++memoCount >= 3) break;
        }
    }
    if (hasWiki) {
        let wikiCount = 0;
        for (const w of sharedSources.wiki) {
            if (matchesQuery(w.text, q, isChosung, cleanChosung)) {
                pushItem(w.text, 'wiki', '가족 위키', w.url);
                if (++wikiCount >= 3) break;
            }
        }
    }
    if (hasNews) {
        let newsCount = 0;
        for (const n of sharedSources.news) {
            if (matchesQuery(n.text, q, isChosung, cleanChosung)) {
                pushItem(n.text, 'news', '뉴스');
                if (++newsCount >= 2) break;
            }
        }
    }

    return suggestions.slice(0, 10);
}

module.exports = {
    getHistory,
    addHistory,
    deleteHistoryItem,
    clearHistory,
    getAutoSaveSetting,
    setAutoSaveSetting,
    getSuggestions
};
