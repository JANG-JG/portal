/**
 * ==============================================================================
 * 어린이 학습실 5분 수준 테스트 & 서버 폴백 음성(TTS) 라우터 (studyMedia.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] study.routes.js 500줄 이하 모듈 분리
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { normalizeChildId } = require('../services/study/studyDb.service');
const { startLevelTest, submitLevelTestAnswer } = require('../services/study/adaptiveLevel.service');
const { synthesizeStudySpeech } = require('../services/study/studyTts.service');

router.post('/api/study/test/start', authenticateToken, async (req, res) => {
    try {
        const childId = normalizeChildId(req.body?.childId || 'first');
        const session = await startLevelTest(childId);
        res.json({ success: true, ...session });
    } catch (err) {
        console.error('수준 테스트 시작 오류:', err);
        res.status(500).json({ success: false, message: '수준 테스트를 시작하지 못했습니다.' });
    }
});

router.post('/api/study/test/:testId/answer', authenticateToken, async (req, res) => {
    try {
        const { choice } = req.body || {};
        const outcome = await submitLevelTestAnswer(req.params.testId, choice);
        res.json({ success: true, ...outcome });
    } catch (err) {
        console.error('수준 테스트 채점 오류:', err);
        res.status(500).json({ success: false, message: err.message || '채점 처리 중 오류가 발생했습니다.' });
    }
});

router.get('/api/study/tts', authenticateToken, async (req, res) => {
    try {
        const text = String(req.query.text || '').trim();
        const lang = String(req.query.lang || 'ko-KR').trim();
        const out = await synthesizeStudySpeech(text, lang);
        if (!out.ok) {
            return res.status(out.status || 503).json({
                success: false,
                message: '음성 합성에 일시적인 문제가 있습니다.'
            });
        }

        const buf = out.buffer;
        const total = buf.length;
        res.setHeader('Content-Type', out.mimeType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, max-age=86400');

        const rangeHeader = req.headers.range;
        if (rangeHeader && rangeHeader.startsWith('bytes=')) {
            const [sStr, eStr] = rangeHeader.replace('bytes=', '').split('-');
            const start = Math.max(0, parseInt(sStr, 10) || 0);
            const end = eStr ? Math.min(total - 1, parseInt(eStr, 10)) : total - 1;
            if (start >= total || start > end) {
                return res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
            }
            const chunk = buf.subarray(start, end + 1);
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
            res.setHeader('Content-Length', chunk.length);
            return res.send(chunk);
        }

        res.setHeader('Content-Length', total);
        return res.send(buf);
    } catch (err) {
        console.error('학습실 TTS 스트리밍 오류:', err);
        return res.status(500).json({ success: false, message: '음성 생성 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
