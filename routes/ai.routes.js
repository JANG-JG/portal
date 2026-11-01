/**
 * 🤖 JG 포털 로컬 AI 비서 라우터 (ai.routes.js)
 * - LG EXAONE 3.5 기반 헬스체크, AI 브리핑, 실시간 가족 대화 API
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { checkAiHealth, generateAiDailyBriefing, askAiAssistant } = require('../services/aiAssistant.service');
const { getPortalSummary } = require('../services/portalSummary.service');

// 1. AI 노드 헬스체크
router.get('/api/ai/health', async (req, res) => {
    try {
        const health = await checkAiHealth();
        res.json({ success: true, health });
    } catch (err) {
        res.status(500).json({ success: false, message: 'AI 헬스체크 실패', error: err.message });
    }
});

// 2. 실시간 AI 데일리 브리핑 문장 요청
router.get('/api/ai/briefing', authenticateToken, async (req, res) => {
    try {
        const forceRefresh = (req.query.refresh === '1' || req.query.refresh === 'true');
        const summary = await getPortalSummary(req.user);
        const userName = (req.user && (req.user.nickname || req.user.username)) ? (req.user.nickname || req.user.username) : '가족';

        const aiResult = await generateAiDailyBriefing({
            blood: summary.blood,
            medication: summary.medication,
            weather: summary.weather,
            todayEvents: summary.todayEvents || [],
            asset: summary.asset,
            userName
        }, forceRefresh);

        if (aiResult && aiResult.message) {
            return res.json({
                success: true,
                briefing: aiResult.message,
                model: aiResult.model,
                generatedAt: aiResult.generatedAt
            });
        }

        // 폴백: AI 미응답 시 기존 규칙 브리핑 반환
        res.json({
            success: false,
            message: 'AI 응답 대기 중 또는 오프라인',
            fallback: summary.briefing ? summary.briefing.naturalSummary : null
        });
    } catch (err) {
        console.error('[API /api/ai/briefing] 오류:', err);
        res.status(500).json({ success: false, message: 'AI 브리핑 생성 오류' });
    }
});

// 3. 가족 AI 챗봇 실시간 대화
router.post('/api/ai/chat', authenticateToken, async (req, res) => {
    try {
        const { message, history } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, message: '메시지를 입력해 주세요.' });
        }

        // 사용자 권한에 따른 최신 요약 데이터 컨텍스트 주입
        const summary = await getPortalSummary(req.user);
        const userName = (req.user && (req.user.nickname || req.user.username)) ? (req.user.nickname || req.user.username) : '가족';

        const result = await askAiAssistant({
            prompt: message.trim(),
            history: Array.isArray(history) ? history : [],
            summaryContext: summary,
            userName
        });

        res.json(result);
    } catch (err) {
        console.error('[API /api/ai/chat] 오류:', err);
        res.status(500).json({
            success: false,
            message: 'AI 비서와의 연결에 실패했습니다. (로컬 PC의 Ollama 상태를 확인하세요)',
            error: err.message
        });
    }
});

module.exports = router;
