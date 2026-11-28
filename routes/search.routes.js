const express = require('express');
const router = express.Router();
const { db, assetDb, newsDb, portalDb } = require('../services/db');
const { authenticateToken } = require('../middleware/auth');
const { ADMIN_USERS } = require('../config/constants');
const { decryptMemoText } = require('../services/crypto.service');

// ==============================================================================
// 🔍 [한글 초성 검색 및 통합 퀵 검색 (Ctrl+K)]
// ==============================================================================
const CHOSUNG_LIST = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function extractChosung(str) {
    if (!str) return '';
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code >= 0xAC00 && code <= 0xD7A3) {
            const chosungIndex = Math.floor((code - 0xAC00) / (21 * 28));
            result += CHOSUNG_LIST[chosungIndex];
        } else {
            result += str.charAt(i);
        }
    }
    return result.toLowerCase();
}

function isChosungOnly(str) {
    return /^[\u3131-\u314E\s]+$/.test(str);
}

router.get('/unified', authenticateToken, async (req, res) => {
    const rawQuery = (req.query.q || '').trim();
    if (!rawQuery) {
        return res.json({
            success: true,
            query: '',
            total: 0,
            results: { memos: [], news: [], hospitals: [], assets: [] }
        });
    }

    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const hasBlood = Boolean(isAdmin); // 🛡️ 혈압 및 진료 일정은 관리자 전용 기능 (비관리자 원천 배제)

    const isChosung = isChosungOnly(rawQuery);
    const cleanChosungQuery = rawQuery.replace(/\s+/g, '').toLowerCase();
    const term = `%${rawQuery}%`;

    // 1) 메모 검색 (AES-256-GCM 복호화 후 일반/초성 검색 지원)
    const memoPromise = new Promise((resolve) => {
        portalDb.all("SELECT id, user_id, title, content, category, color, is_pinned, updated_at FROM user_memos WHERE user_id = ? ORDER BY is_pinned DESC, updated_at DESC LIMIT 100", [userId], (err, rows) => {
            if (err || !rows) return resolve([]);
            const cleanQuery = rawQuery.toLowerCase();
            const results = [];

            for (const r of rows) {
                const decTitle = decryptMemoText(r.title, r.user_id);
                const decContent = decryptMemoText(r.content, r.user_id);

                let match = false;
                if (isChosung) {
                    match = extractChosung(decTitle).includes(cleanChosungQuery) || extractChosung(decContent).includes(cleanChosungQuery);
                } else {
                    match = (decTitle && decTitle.toLowerCase().includes(cleanQuery)) || (decContent && decContent.toLowerCase().includes(cleanQuery));
                }

                if (match) {
                    results.push({
                        id: r.id,
                        title: decTitle,
                        content: decContent,
                        category: r.category,
                        color: r.color,
                        is_pinned: r.is_pinned,
                        updated_at: r.updated_at
                    });
                    if (results.length >= 8) break;
                }
            }
            resolve(results);
        });
    });

    // 2) 뉴스 브리핑 검색
    const newsPromise = new Promise((resolve) => {
        if (isChosung) {
            newsDb.all("SELECT id, date, category_name, title, link, media_name, summary, published_at FROM news_articles ORDER BY id DESC LIMIT 50", (err, rows) => {
                if (err || !rows) return resolve([]);
                const filtered = rows.filter(r => extractChosung(r.title).includes(cleanChosungQuery) || extractChosung(r.category_name).includes(cleanChosungQuery)).slice(0, 8);
                resolve(filtered);
            });
        } else {
            const sql = `
                SELECT id, date, category_name, title, link, media_name, summary, published_at
                FROM news_articles
                WHERE (title LIKE ? OR summary LIKE ?)
                ORDER BY date DESC, id DESC
                LIMIT 8
            `;
            newsDb.all(sql, [term, term], (err, rows) => resolve(rows || []));
        }
    });

    // 3) 병원 진료 일정 검색 (blood 권한 보유자 전용)
    const hospitalPromise = new Promise((resolve) => {
        if (!hasBlood) return resolve([]);
        if (isChosung) {
            db.all("SELECT id, visit_date, hospital_name, department, memo, next_visit_date, reservation_open_date FROM hospital_visits WHERE (user_id = ? OR ? = 1) ORDER BY visit_date DESC LIMIT 50", [userId, isAdmin], (err, rows) => {
                if (err || !rows) return resolve([]);
                const filtered = rows.filter(r => extractChosung(r.hospital_name).includes(cleanChosungQuery) || extractChosung(r.department).includes(cleanChosungQuery)).slice(0, 8);
                resolve(filtered);
            });
        } else {
            const sql = `
                SELECT id, visit_date, hospital_name, department, memo, next_visit_date, reservation_open_date
                FROM hospital_visits
                WHERE (user_id = ? OR ? = 1)
                  AND (hospital_name LIKE ? OR department LIKE ? OR memo LIKE ?)
                ORDER BY visit_date DESC
                LIMIT 8
            `;
            db.all(sql, [userId, isAdmin, term, term, term], (err, rows) => resolve(rows || []));
        }
    });

    // 4) 자산/보유 종목 검색 (관리자 전용)
    const assetPromise = new Promise((resolve) => {
        if (!isAdmin) return resolve([]);
        if (isChosung) {
            assetDb.all("SELECT id, symbol, full_name, asset_type, quantity, avg_price, currency FROM assets LIMIT 50", (err, rows) => {
                if (err || !rows) return resolve([]);
                const filtered = rows.filter(r => extractChosung(r.symbol).includes(cleanChosungQuery) || extractChosung(r.full_name).includes(cleanChosungQuery)).slice(0, 8);
                resolve(filtered);
            });
        } else {
            const sql = `
                SELECT id, symbol, full_name, asset_type, quantity, avg_price, currency
                FROM assets
                WHERE (symbol LIKE ? OR full_name LIKE ?)
                LIMIT 8
            `;
            assetDb.all(sql, [term, term], (err, rows) => resolve(rows || []));
        }
    });

    try {
        const [memoRes, newsRes, hospRes, assetRes] = await Promise.allSettled([
            memoPromise,
            newsPromise,
            hospitalPromise,
            assetPromise
        ]);

        const memos = memoRes.status === 'fulfilled' ? memoRes.value : [];
        const news = newsRes.status === 'fulfilled' ? newsRes.value : [];
        const hospitals = hospRes.status === 'fulfilled' ? hospRes.value : [];
        const assets = assetRes.status === 'fulfilled' ? assetRes.value : [];

        const total = memos.length + news.length + hospitals.length + assets.length;

        res.json({
            success: true,
            query: rawQuery,
            isChosung,
            total,
            results: { memos, news, hospitals, assets }
        });
    } catch (e) {
        console.error('[Unified search err]:', e);
        res.status(500).json({ success: false, message: '통합 검색 중 오류가 발생했습니다.' });
    }
});

// ==============================================================================
// 🚀 [전용 스마트 통합 검색 (/search) 1단계 API]
// ==============================================================================
const { resolveSmartWidget, getHomeMiniWeather } = require('../services/search/smartWidget.service');
const { searchAllInternal, getAllowedShortcuts } = require('../services/search/internalSearch.service');
const { searchExternal } = require('../services/search/externalSearch.service');
const { streamSearchAiSummary, cacheSearchContext } = require('../services/search/searchAiBriefing.service');
const {
    getHistory,
    addHistory,
    deleteHistoryItem,
    clearHistory,
    getAutoSaveSetting,
    setAutoSaveSetting,
    getSuggestions
} = require('../services/search/searchHistory.service');

router.get('/home', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    try {
        const [miniWeather, history, autoSave] = await Promise.all([
            getHomeMiniWeather(req.user),
            getHistory(userId, 12),
            getAutoSaveSetting(userId)
        ]);
        const shortcuts = getAllowedShortcuts(req.user);
        res.json({
            success: true,
            miniWeather,
            history,
            autoSave,
            shortcuts
        });
    } catch (e) {
        console.error('[Search home err]:', e);
        res.status(500).json({ success: false, message: '검색 홈 정보를 불러오지 못했습니다.' });
    }
});

router.get('/portal', authenticateToken, async (req, res) => {
    const rawQuery = (req.query.q || '').trim().slice(0, 120);
    const rawMode = (req.query.tab || 'all').trim();
    const mode = rawMode === 'webBlog' ? 'web' : rawMode;
    const page = Math.max(1, Math.min(67, parseInt(req.query.page, 10) || 1));
    const userId = req.user.username || 'admin';

    if (!rawQuery) {
        return res.json({
            success: true,
            query: '',
            page: 1,
            smartWidget: null,
            internal: { isChosung: false, total: 0, results: {} },
            external: { wikipedia: null, naver: {}, google: { items: [] } },
            counts: {},
            totals: {}
        });
    }

    try {
        if (req.query.save !== '0' && page === 1) {
            addHistory(userId, rawQuery).catch(() => {});
        }

        const extMode = ['web', 'blog', 'encyc', 'wikiNews', 'local', 'google'].includes(mode) ? mode : 'all';
        const needSmartWidget = page === 1 && (mode === 'all' || mode === 'local');
        const needInternal = page === 1 || ['all', 'internal', 'memoCalendar', 'wikiNews', 'album', 'healthAsset'].includes(mode);

        const [smartWidget, internal, external] = await Promise.all([
            needSmartWidget ? resolveSmartWidget(rawQuery, req.user) : Promise.resolve(null),
            needInternal ? searchAllInternal(rawQuery, req.user) : Promise.resolve({ isChosung: false, total: 0, results: {} }),
            searchExternal(rawQuery, extMode, page)
        ]);

        const r = internal.results || {};
        const ext = external || {};
        const nv = ext.naver || {};
        const nvMeta = nv.meta || {};
        const webCnt = nv.web?.length || 0;
        const blogCnt = nv.blog?.length || 0;
        const encycCnt = (ext.wikipedia ? 1 : 0) + (nv.encyc?.length || 0);
        const localCnt = (nv.local?.length || 0) + (smartWidget?.type === 'map' ? 1 : 0);
        const googleCnt = ext.google?.items?.length || 0;
        const externalTotal = webCnt + blogCnt + encycCnt + localCnt + (nv.news?.length || 0) + googleCnt;

        const counts = {
            all: internal.total + externalTotal + (smartWidget ? 1 : 0),
            internal: internal.total,
            memoCalendar: (r.memos?.length || 0) + (r.calendar?.length || 0),
            wikiNews: (r.wiki?.length || 0) + (r.news?.length || 0) + (nv.news?.length || 0),
            album: r.album?.length || 0,
            healthAsset: (r.hospitals?.length || 0) + (r.medications?.length || 0) + (r.assets?.length || 0) + (r.kindergarten?.length || 0),
            web: webCnt,
            blog: blogCnt,
            webBlog: webCnt + blogCnt,
            encyc: encycCnt,
            local: localCnt,
            google: googleCnt
        };

        const totals = {
            web: nvMeta.web?.total || webCnt,
            blog: nvMeta.blog?.total || blogCnt,
            encyc: (nvMeta.encyc?.total || 0) + (ext.wikipedia ? 1 : 0),
            wikiNews: (r.wiki?.length || 0) + (r.news?.length || 0) + (nvMeta.news?.total || 0),
            local: (nvMeta.local?.total || 0) + (smartWidget?.type === 'map' ? 1 : 0),
            google: ext.google?.meta?.total || googleCnt
        };

        if (page === 1 && mode === 'all') {
            cacheSearchContext(userId, rawQuery, { smartWidget, internal, external });
        }

        res.json({
            success: true,
            query: rawQuery,
            page,
            smartWidget,
            internal,
            external,
            counts,
            totals
        });
    } catch (e) {
        console.error('[Portal search err]:', e);
        res.status(500).json({ success: false, message: '통합 검색 처리 중 오류가 발생했습니다.' });
    }
});

router.get('/external', authenticateToken, async (req, res) => {
    const rawQuery = (req.query.q || '').trim().slice(0, 120);
    const mode = (req.query.mode || 'all').trim();
    const page = Math.max(1, Math.min(67, parseInt(req.query.page, 10) || 1));
    if (!rawQuery) return res.json({ success: true, external: { wikipedia: null, naver: {}, google: { items: [] } } });
    try {
        const external = await searchExternal(rawQuery, mode, page);
        res.json({ success: true, external });
    } catch (e) {
        res.status(500).json({ success: false, message: '외부 검색 조회 중 오류가 발생했습니다.' });
    }
});

router.get('/map-nearby', authenticateToken, async (req, res) => {
    const rawQuery = (req.query.q || '').trim().slice(0, 80);
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!rawQuery || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ success: false, message: '검색어 또는 위치 좌표가 올바르지 않습니다.' });
    }
    try {
        const { searchNearbyByCoords } = require('../services/search/kakaoMapWidget.service');
        const widget = await searchNearbyByCoords(rawQuery, lat, lng);
        if (!widget) {
            return res.json({ success: false, message: '주변 장소 검색 결과를 찾지 못했습니다.' });
        }
        res.json({ success: true, widget });
    } catch (_) {
        res.status(500).json({ success: false, message: '주변 위치 검색 중 오류가 발생했습니다.' });
    }
});

router.post('/ai-summary', authenticateToken, (req, res) => {
    const q = (req.body?.query || '').trim().slice(0, 120);
    const tab = (req.body?.tab || 'all').trim().slice(0, 30);
    return streamSearchAiSummary(req, res, q, tab);
});

router.get('/suggest', authenticateToken, async (req, res) => {
    const prefix = (req.query.q || '').trim().slice(0, 80);
    try {
        const suggestions = await getSuggestions(req.user, prefix);
        res.json({ success: true, suggestions });
    } catch (e) {
        res.json({ success: true, suggestions: [] });
    }
});

router.post('/history', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    const q = (req.body?.query || '').trim().slice(0, 100);
    if (!q) return res.status(400).json({ success: false, message: '검색어가 비어 있습니다.' });
    const saved = await addHistory(userId, q);
    res.json({ success: true, saved });
});

router.delete('/history/:id', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    const ok = await deleteHistoryItem(userId, req.params.id);
    if (!ok) return res.status(404).json({ success: false, message: '삭제할 검색어를 찾지 못했습니다.' });
    res.json({ success: true });
});

router.delete('/history', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    await clearHistory(userId);
    res.json({ success: true });
});

router.patch('/settings', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    if (typeof req.body?.autoSave !== 'boolean') {
        return res.status(400).json({ success: false, message: 'autoSave 값이 올바르지 않습니다.' });
    }
    const autoSave = await setAutoSaveSetting(userId, req.body.autoSave);
    res.json({ success: true, autoSave });
});

module.exports = router;
