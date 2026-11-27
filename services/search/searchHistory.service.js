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
const { fetchExternalSuggestions } = require('./suggestExternal.service');
const {
    STATIC_DICTIONARY_HINTS,
    fetchUserExtendedPool,
    resolveQuickPreview,
    scoreCandidate
} = require('./suggestCorpus.service');

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

async function getCachedUserSources(userId, isAdmin = false, hasBlood = false) {
    const now = Date.now();
    const cached = userSuggestCache.get(userId);
    if (cached && cached.expiresAt > now) {
        return cached;
    }
    const [history, memos, extPool] = await Promise.all([
        getHistory(userId, 15),
        new Promise((resolve) => {
            if (!portalDb) return resolve([]);
            portalDb.all('SELECT id, title FROM user_memos WHERE user_id = ? ORDER BY updated_at DESC LIMIT 40', [userId], (err, rows) => {
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
        }),
        fetchUserExtendedPool(userId, isAdmin, hasBlood)
    ]);
    const entry = {
        expiresAt: now + SUGGEST_CACHE_TTL_MS,
        history,
        memos,
        calendar: extPool.calendar,
        hospitals: extPool.hospitals,
        medications: extPool.medications
    };
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
            wikiDb.all('SELECT title, slug FROM wiki_pages ORDER BY updated_at DESC LIMIT 50', [], (err, rows) => {
                if (err || !rows) return resolve([]);
                resolve(rows.map(r => ({ text: r.title, url: `https://wiki.j-jg.cc/page/${encodeURIComponent(r.slug || '')}` })));
            });
        }),
        new Promise((resolve) => {
            if (!newsDb) return resolve([]);
            newsDb.all('SELECT title FROM news_articles ORDER BY id DESC LIMIT 40', [], (err, rows) => {
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
    const hasBlood = isAdmin || isServiceAllowed(user, 'blood');

    const q = (rawPrefix || '').trim();
    const isChosung = isChosungOnly(q);
    const cleanChosung = q.replace(/\s+/g, '').toLowerCase();

    const userSources = await getCachedUserSources(userId, isAdmin, hasBlood);

    // 빈 입력(포커스 시): 최근 검색어(삭제 가능) + 추천 키워드 반환
    if (!q) {
        getCachedSharedSources().catch(() => {});
        const out = [];
        const seen = new Set();
        for (const h of userSources.history.slice(0, 6)) {
            const k = h.query.toLowerCase();
            if (!seen.has(k)) {
                seen.add(k);
                out.push({
                    text: h.query,
                    type: 'history',
                    icon: '🕒',
                    badge: '최근 검색',
                    historyId: h.id
                });
            }
        }
        for (const hint of STATIC_DICTIONARY_HINTS.slice(0, 5)) {
            const k = hint.text.toLowerCase();
            if (!seen.has(k)) {
                seen.add(k);
                out.push({
                    text: hint.text,
                    type: hint.type,
                    icon: hint.icon,
                    badge: hint.badge,
                    subtitle: hint.subtitle
                });
            }
            if (out.length >= 10) break;
        }
        return out;
    }

    const [sharedSources, extSuggestions, quickPreview] = await Promise.all([
        (hasWiki || hasNews) ? getCachedSharedSources() : Promise.resolve({ wiki: [], news: [] }),
        fetchExternalSuggestions(q),
        resolveQuickPreview(q, user)
    ]);

    const candidates = [];
    const addCandidate = (item, score) => {
        if (score >= 0 && item && item.text) {
            candidates.push({ ...item, _score: score });
        }
    };

    if (quickPreview) {
        addCandidate(quickPreview, 10000);
    }

    userSources.history.forEach((h, idx) => {
        const s = scoreCandidate(h.query, q, isChosung, cleanChosung, 90 - idx);
        if (s >= 0) {
            addCandidate({
                text: h.query,
                type: 'history',
                icon: '🕒',
                badge: '최근 검색',
                historyId: h.id
            }, s);
        }
    });

    for (const sc of getAllowedShortcuts(user)) {
        const sTitle = scoreCandidate(sc.title, q, isChosung, cleanChosung, 78);
        const sKw = matchesQuery(sc.keywords, q, isChosung, cleanChosung) ? 72 : -1;
        const best = Math.max(sTitle, sKw);
        if (best >= 0) {
            addCandidate({
                text: sc.title,
                type: 'shortcut',
                icon: sc.icon || '⚡',
                badge: '바로가기',
                subtitle: sc.desc,
                url: sc.url
            }, best);
        }
    }

    for (const m of userSources.memos) {
        const s = scoreCandidate(m.text, q, isChosung, cleanChosung, 70);
        if (s >= 0) addCandidate({ text: m.text, type: 'memo', icon: '📝', badge: '내 메모', url: m.url }, s);
    }
    for (const c of userSources.calendar || []) {
        const s = scoreCandidate(c.text, q, isChosung, cleanChosung, 68);
        if (s >= 0) addCandidate(c, s);
    }
    for (const h of userSources.hospitals || []) {
        const s = scoreCandidate(h.text, q, isChosung, cleanChosung, 66);
        if (s >= 0) addCandidate(h, s);
    }
    for (const med of userSources.medications || []) {
        const s = scoreCandidate(med.text, q, isChosung, cleanChosung, 65);
        if (s >= 0) addCandidate(med, s);
    }

    if (hasWiki) {
        for (const w of sharedSources.wiki) {
            const s = scoreCandidate(w.text, q, isChosung, cleanChosung, 62);
            if (s >= 0) addCandidate({ text: w.text, type: 'wiki', icon: '📖', badge: '가족 위키', url: w.url }, s);
        }
    }
    if (hasNews) {
        for (const n of sharedSources.news) {
            const s = scoreCandidate(n.text, q, isChosung, cleanChosung, 56);
            if (s >= 0) addCandidate({ text: n.text, type: 'news', icon: '📰', badge: '뉴스' }, s);
        }
    }

    for (const hint of STATIC_DICTIONARY_HINTS) {
        const s = scoreCandidate(hint.text, q, isChosung, cleanChosung, 54);
        if (s >= 0) addCandidate(hint, s);
    }

    extSuggestions.forEach((ext, idx) => {
        const base = ext.type === 'wikipedia' ? 50 : 40;
        const rawScore = scoreCandidate(ext.text, q, isChosung, cleanChosung, base);
        const finalScore = rawScore >= 0 ? rawScore - idx : (base - idx);
        addCandidate(ext, finalScore);
    });

    candidates.sort((a, b) => b._score - a._score);

    const results = [];
    const seen = new Set();
    for (const item of candidates) {
        const key = item.isInstant ? `__instant__:${item.text.toLowerCase()}` : item.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const { _score, ...clean } = item;
        results.push(clean);
        if (results.length >= 10) break;
    }
    return results;
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
