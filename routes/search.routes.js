const express = require('express');
const router = express.Router();
const { db, assetDb, newsDb } = require('../services/db');
const { authenticateToken } = require('../middleware/auth');

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
    const isChosung = isChosungOnly(rawQuery);
    const cleanChosungQuery = rawQuery.replace(/\s+/g, '').toLowerCase();
    const term = `%${rawQuery}%`;

    // 1) 메모 검색 (일반 or 초성)
    const memoPromise = new Promise((resolve) => {
        if (isChosung) {
            db.all("SELECT id, title, content, category, color, is_pinned, updated_at FROM user_memos WHERE (user_id = ? OR user_id = 'admin' OR user_id = 'upt0731') ORDER BY is_pinned DESC, updated_at DESC LIMIT 50", [userId], (err, rows) => {
                if (err || !rows) return resolve([]);
                const filtered = rows.filter(r => extractChosung(r.title).includes(cleanChosungQuery) || extractChosung(r.content).includes(cleanChosungQuery)).slice(0, 8);
                resolve(filtered);
            });
        } else {
            const sql = `
                SELECT id, title, content, category, color, is_pinned, updated_at
                FROM user_memos
                WHERE (user_id = ? OR user_id = 'admin' OR user_id = 'upt0731')
                  AND (title LIKE ? OR content LIKE ?)
                ORDER BY is_pinned DESC, updated_at DESC
                LIMIT 8
            `;
            db.all(sql, [userId, term, term], (err, rows) => resolve(rows || []));
        }
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

    // 3) 병원 진료 일정 검색
    const hospitalPromise = new Promise((resolve) => {
        if (isChosung) {
            db.all("SELECT id, visit_date, hospital_name, department, memo, next_visit_date, reservation_open_date FROM hospital_visits WHERE (user_id = ? OR user_id = 'admin' OR user_id = 'upt0731') ORDER BY visit_date DESC LIMIT 50", [userId], (err, rows) => {
                if (err || !rows) return resolve([]);
                const filtered = rows.filter(r => extractChosung(r.hospital_name).includes(cleanChosungQuery) || extractChosung(r.department).includes(cleanChosungQuery)).slice(0, 8);
                resolve(filtered);
            });
        } else {
            const sql = `
                SELECT id, visit_date, hospital_name, department, memo, next_visit_date, reservation_open_date
                FROM hospital_visits
                WHERE (user_id = ? OR user_id = 'admin' OR user_id = 'upt0731')
                  AND (hospital_name LIKE ? OR department LIKE ? OR memo LIKE ?)
                ORDER BY visit_date DESC
                LIMIT 8
            `;
            db.all(sql, [userId, term, term, term], (err, rows) => resolve(rows || []));
        }
    });

    // 4) 자산/보유 종목 검색
    const assetPromise = new Promise((resolve) => {
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

module.exports = router;
