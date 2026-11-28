/**
 * 📌 JG 통합 검색 - 내 서버 보관함(스크랩 아카이브) 전용 라우터 (searchClips.routes.js)
 * - 사용자별 user_id 완벽 격리 (타인 보관함 조회·삭제 차단)
 * - 웹봇 코어를 통해 본문 핵심 텍스트 + og:image 추출 후 SQLite FTS5 영구 색인
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { listUserClips, removeUserClip } = require('../services/search/webBotStore.service');
const { scrapeAndSaveUserClip } = require('../services/search/webBotScheduler.service');

router.get('/', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 20));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * limit;
    try {
        const clips = await listUserClips(userId, limit, offset);
        res.json({ success: true, clips, page });
    } catch (_) {
        res.status(500).json({ success: false, message: '보관함 목록을 불러오지 못했습니다.' });
    }
});

router.post('/', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    const body = req.body || {};
    const url = String(body.url || '').trim().slice(0, 1000);
    if (!url || !/^https?:\/\//i.test(url)) {
        return res.status(400).json({ success: false, message: '올바른 웹문서 주소(http/https)가 필요합니다.' });
    }

    try {
        const result = await scrapeAndSaveUserClip(userId, {
            url,
            title: String(body.title || '').slice(0, 200),
            snippet: String(body.snippet || '').slice(0, 400),
            thumbnail: body.thumbnail ? String(body.thumbnail).slice(0, 1000) : null,
            siteName: String(body.siteName || '').slice(0, 60),
            category: String(body.category || 'web').slice(0, 24)
        });
        if (!result.success) {
            return res.status(400).json({ success: false, message: result.message || '보관 처리에 실패했습니다.' });
        }
        res.json({ success: true, clip: result.clip });
    } catch (_) {
        res.status(500).json({ success: false, message: '보관함 저장 중 오류가 발생했습니다.' });
    }
});

router.delete('/', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    const id = req.query.id || req.body?.id || null;
    const url = String(req.query.url || req.body?.url || '').trim().slice(0, 1000);
    if (!id && !url) {
        return res.status(400).json({ success: false, message: '삭제할 보관 항목 정보가 없습니다.' });
    }
    try {
        const ok = await removeUserClip(userId, { id, url });
        if (!ok) {
            return res.status(404).json({ success: false, message: '삭제할 보관 항목을 찾지 못했습니다.' });
        }
        res.json({ success: true });
    } catch (_) {
        res.status(500).json({ success: false, message: '보관함 삭제 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
