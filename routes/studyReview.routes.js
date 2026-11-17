/**
 * ==============================================================================
 * 어린이 학습실 오답 노트 & 복습 API 라우터 (studyReview.routes.js)
 * ------------------------------------------------------------------------------
 * - 틀린 문제 목록 조회 (과목·상태 필터)
 * - 오답 복습 풀이 결과 기록 & 미지급 별(칭찬 도장) 즉시 보상
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { resolveChildProfileId } = require('../services/study/studyDb.service');
const { scheduleReplenish } = require('../services/study/studyPreGen.service');
const {
    listWrongNotes,
    recordWrongNoteAttempt
} = require('../services/study/studyWrongNote.service');

router.get('/api/study/wrong-notes', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.query.childId, req.user);
        const status = String(req.query.status || 'pending');
        const subject = String(req.query.subject || 'all');
        const limit = Number(req.query.limit || 60);
        const data = await listWrongNotes(cid, { status, subject, limit });
        res.json({ success: true, childId: cid, ...data });
    } catch (err) {
        console.error('오답 노트 목록 조회 오류:', err);
        res.status(500).json({ success: false, message: '틀린 문제 목록을 불러오지 못했습니다.' });
    }
});

router.post('/api/study/wrong-notes/:id/attempt', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.body?.childId, req.user);
        const { isCorrect, selectedAnswer } = req.body || {};
        const result = await recordWrongNoteAttempt(req.params.id, cid, {
            isCorrect: Boolean(isCorrect),
            selectedAnswer
        });
        if (result.stampAwarded && result.board) {
            scheduleReplenish(cid, 'korean');
        }
        res.json({ success: true, childId: cid, ...result });
    } catch (err) {
        const status = err.statusCode || 500;
        console.error('오답 복습 시도 기록 오류:', err);
        res.status(status).json({
            success: false,
            message: err.message || '복습 결과를 저장하지 못했습니다.'
        });
    }
});

module.exports = router;
