/**
 * ==============================================================================
 * 어린이 학습실 5분 수준 테스트 & 서버 폴백 음성(TTS) 라우터 (studyMedia.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] study.routes.js 500줄 이하 모듈 분리
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { normalizeChildId } = require('../services/study/studyDb.service');
const { startLevelTest, submitLevelTestAnswer } = require('../services/study/adaptiveLevel.service');
const {
    TTS_VOICE_PRESETS,
    getTtsVoiceSettings,
    setTtsVoiceSettings,
    synthesizeStudySpeech,
    purgeTtsCache,
    getTtsCacheStats
} = require('../services/study/studyTts.service');

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
        const voice = String(req.query.voice || '').trim();
        const out = await synthesizeStudySpeech(text, lang, voice ? { voice } : {});
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
        res.setHeader('Cache-Control', voice ? 'no-store' : 'private, max-age=3600');
        if (out.engine) res.setHeader('X-TTS-Engine', out.engine);
        if (out.voice) res.setHeader('X-TTS-Voice', out.voice);

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

router.get('/api/admin/study/tts', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const settings = await getTtsVoiceSettings();
        res.json({
            success: true,
            settings,
            presets: TTS_VOICE_PRESETS,
            ttsCache: getTtsCacheStats()
        });
    } catch (err) {
        res.status(500).json({ success: false, message: '음성 설정 조회에 실패했습니다.' });
    }
});

router.post('/api/admin/study/tts', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { koVoice, enVoice } = req.body || {};
        const settings = await setTtsVoiceSettings({ koVoice, enVoice });
        res.json({
            success: true,
            message: '학습실 자연 음성 목소리 설정을 저장했습니다.',
            settings,
            ttsCache: getTtsCacheStats()
        });
    } catch (err) {
        res.status(500).json({ success: false, message: '음성 설정 저장에 실패했습니다.' });
    }
});

router.post('/api/admin/study/tts/purge', authenticateToken, requireAdmin, (req, res) => {
    const removed = purgeTtsCache();
    res.json({
        success: true,
        removed,
        message: `음성 캐시 파일 ${removed}개를 정리했습니다.`,
        ttsCache: getTtsCacheStats()
    });
});

module.exports = router;
