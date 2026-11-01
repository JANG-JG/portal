/**
 * 🤖 JG 포털 로컬 AI 비서 라우터 (ai.routes.js)
 * - LG EXAONE 3.5 기반 헬스체크, AI 브리핑, 실시간 가족 대화 API
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, getClientIp } = require('../middleware/auth');
const { checkAiHealth, generateAiDailyBriefing, askAiAssistant } = require('../services/aiAssistant.service');
const { getPortalSummary } = require('../services/portalSummary.service');

// 🛡️ [보안 강화] AI 채팅 레이트 리미터 & 동시성 제어 (로컬 PC 과부하 및 DoS 방어)
const chatRateLimitMap = new Map(); // key(user/ip) -> [timestamp]
const CHAT_RATE_LIMIT = 12; // 1분당 최대 12회 질문 가능
const CHAT_WINDOW_MS = 60 * 1000;
let activeAiRequests = 0;
const MAX_CONCURRENT_AI = 2; // 동시 추론 최대 2건 제한

function checkChatRateLimit(key) {
    const now = Date.now();
    let timestamps = chatRateLimitMap.get(key) || [];
    timestamps = timestamps.filter(t => now - t < CHAT_WINDOW_MS);
    if (timestamps.length >= CHAT_RATE_LIMIT) {
        return false;
    }
    timestamps.push(now);
    chatRateLimitMap.set(key, timestamps);
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [k, list] of chatRateLimitMap.entries()) {
        const valid = list.filter(t => now - t < CHAT_WINDOW_MS);
        if (valid.length === 0) chatRateLimitMap.delete(k);
        else chatRateLimitMap.set(k, valid);
    }
}, 10 * 60 * 1000);

// 1. AI 노드 헬스체크 (인증 필수 적용)
router.get('/api/ai/health', authenticateToken, async (req, res) => {
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

// 3. 가족 AI 챗봇 실시간 대화 (입력 검증 + 레이트 리미트 + 동시성 보호)
router.post('/api/ai/chat', authenticateToken, async (req, res) => {
    try {
        const { message, history } = req.body;
        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ success: false, message: '메시지를 올바르게 입력해 주세요.' });
        }

        // 🛡️ 입력 길이 제한 (500자 이하)
        if (message.length > 500) {
            return res.status(400).json({
                success: false,
                message: '질문이 너무 깁니다. 500자 이하로 간결하게 입력해 주세요.'
            });
        }

        // 🛡️ 요청 빈도 제한 (1분당 12회)
        const rateKey = req.user?.username || getClientIp(req);
        if (!checkChatRateLimit(rateKey)) {
            return res.status(429).json({
                success: false,
                message: 'AI 비서 질문 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요. (1분당 최대 12회)'
            });
        }

        // 🛡️ 로컬 PC 동시 추론 보호
        if (activeAiRequests >= MAX_CONCURRENT_AI) {
            return res.status(503).json({
                success: false,
                message: '현재 로컬 AI 엔진이 다른 가족의 요청을 처리 중입니다. 잠시 후 다시 질문해 주세요.'
            });
        }

        activeAiRequests++;
        try {
            // 사용자 권한에 따른 최신 요약 데이터 컨텍스트 주입
            const summary = await getPortalSummary(req.user);
            const userName = (req.user && (req.user.nickname || req.user.username)) ? (req.user.nickname || req.user.username) : '가족';
            const safeHistory = Array.isArray(history) ? history.slice(-4) : [];

            const result = await askAiAssistant({
                prompt: message.trim(),
                history: safeHistory,
                summaryContext: summary,
                userName
            });

            res.json(result);
        } finally {
            activeAiRequests = Math.max(0, activeAiRequests - 1);
        }
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
