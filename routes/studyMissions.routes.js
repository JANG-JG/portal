/**
 * ==============================================================================
 * 오늘의 3종 미션 API 라우터 (studyMissions.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { resolveChildProfileId } = require('../services/study/studyDb.service');
const { getDailyMissionsState, startDailyMission } = require('../services/study/studyMissions.service');

router.get('/api/study/missions', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.query.childId, req.user);
        const state = await getDailyMissionsState(cid);
        res.json({ success: true, childId: cid, ...state });
    } catch (err) {
        console.error('오늘의 미션 조회 오류:', err);
        res.status(500).json({ success: false, message: '오늘의 미션을 불러오지 못했어요.' });
    }
});

router.post('/api/study/missions/start', authenticateToken, async (req, res) => {
    try {
        const { childId, slotIndex, subject } = req.body || {};
        const cid = await resolveChildProfileId(childId, req.user);
        const result = await startDailyMission(cid, slotIndex, subject, req.user?.username || 'kid');
        res.json({ success: true, childId: cid, ...result });
    } catch (err) {
        console.error('오늘의 미션 시작 오류:', err);
        res.status(500).json({ success: false, message: err.message || '미션 학습지를 준비하지 못했어요.' });
    }
});

module.exports = router;
