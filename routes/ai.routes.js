/**
 * 🤖 JG 포털 로컬 AI 비서 라우터 (ai.routes.js)
 * - LG EXAONE 3.5 기반 헬스체크, AI 브리핑, 실시간 가족 대화 API
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, getClientIp } = require('../middleware/auth');
const {
    checkAiHealth,
    generateAiDailyBriefing,
    askAiAssistant,
    refineMemoToWiki,
    extractRoutineAndTodos,
    summarizeText,
    generateWikiDraft,
    smartMergeOrDraftWiki
} = require('../services/aiAssistant.service');
const { createWikiPage, searchWikiContent, getWikiPageDetail, updateWikiPage } = require('../services/wikiSummary.service');
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
            wiki: summary.wiki,
            album: summary.album,
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

        // 🛡️ 입력 길이 제한 (1,000자 이하)
        if (message.length > 1000) {
            return res.status(400).json({
                success: false,
                message: '질문이 너무 깁니다. 1,000자 이하로 간결하게 입력해 주세요.'
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

// 4. 메모 ➔ 위키 정돈 API
router.post('/api/ai/memo-to-wiki', authenticateToken, async (req, res) => {
    try {
        const { title, content } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, message: '정리할 메모 내용이 없습니다.' });
        }

        if (activeAiRequests >= MAX_CONCURRENT_AI) {
            return res.status(503).json({ success: false, message: 'AI 엔진이 다른 작업을 처리 중입니다. 잠시 후 시도해 주세요.' });
        }

        activeAiRequests++;
        try {
            const userName = req.user?.nickname || req.user?.username || '가족';
            const result = await refineMemoToWiki({ title, content, userName });
            res.json(result);
        } finally {
            activeAiRequests = Math.max(0, activeAiRequests - 1);
        }
    } catch (err) {
        console.error('[API /api/ai/memo-to-wiki] 오류:', err);
        res.status(500).json({ success: false, message: '위키 문서 변환 실패: ' + err.message });
    }
});

// 5. 메모에서 루틴 및 할 일 자동 감지 API
router.post('/api/ai/extract-routine', authenticateToken, async (req, res) => {
    try {
        const { title, content } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, message: '분석할 메모 내용이 없습니다.' });
        }

        if (activeAiRequests >= MAX_CONCURRENT_AI) {
            return res.status(503).json({ success: false, message: 'AI 엔진이 다른 작업을 처리 중입니다. 잠시 후 시도해 주세요.' });
        }

        activeAiRequests++;
        try {
            const result = await extractRoutineAndTodos({ title, content });
            res.json(result);
        } finally {
            activeAiRequests = Math.max(0, activeAiRequests - 1);
        }
    } catch (err) {
        console.error('[API /api/ai/extract-routine] 오류:', err);
        res.status(500).json({ success: false, message: '루틴 분석 실패: ' + err.message });
    }
});

// 6. 3줄 핵심 요약 API
router.post('/api/ai/summarize', authenticateToken, async (req, res) => {
    try {
        const { text, maxLines = 3 } = req.body;
        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, message: '요약할 본문 내용이 없습니다.' });
        }

        if (activeAiRequests >= MAX_CONCURRENT_AI) {
            return res.status(503).json({ success: false, message: 'AI 엔진이 다른 작업을 처리 중입니다. 잠시 후 시도해 주세요.' });
        }

        activeAiRequests++;
        try {
            const result = await summarizeText({ text, maxLines });
            res.json(result);
        } finally {
            activeAiRequests = Math.max(0, activeAiRequests - 1);
        }
    } catch (err) {
        console.error('[API /api/ai/summarize] 오류:', err);
        res.status(500).json({ success: false, message: '요약 생성 실패: ' + err.message });
    }
});

// 7. 프롬프트 기반 위키 초안 자동 작성 API
router.post('/api/ai/wiki-draft', authenticateToken, async (req, res) => {
    try {
        const { prompt, category = '생활' } = req.body;
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ success: false, message: '작성할 주제를 입력해 주세요.' });
        }

        if (activeAiRequests >= MAX_CONCURRENT_AI) {
            return res.status(503).json({ success: false, message: 'AI 엔진이 다른 작업을 처리 중입니다. 잠시 후 시도해 주세요.' });
        }

        activeAiRequests++;
        try {
            const result = await generateWikiDraft({ prompt, category });
            res.json(result);
        } finally {
            activeAiRequests = Math.max(0, activeAiRequests - 1);
        }
    } catch (err) {
        console.error('[API /api/ai/wiki-draft] 오류:', err);
        res.status(500).json({ success: false, message: '위키 초안 작성 실패: ' + err.message });
    }
});

// 8. 📚 [위키 1,2단계] 대화/메모 ➔ 원터치 지능형 자동 병합 & 발행 API
router.post('/api/ai/publish-to-wiki', authenticateToken, async (req, res) => {
    try {
        const { title = '', content, category = '생활', forceNew = false } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, message: '위키로 등록할 내용이 없습니다.' });
        }

        if (activeAiRequests >= MAX_CONCURRENT_AI) {
            return res.status(503).json({ success: false, message: 'AI 엔진이 다른 작업을 처리 중입니다. 잠시 후 시도해 주세요.' });
        }

        activeAiRequests++;
        try {
            const userName = req.user?.nickname || req.user?.username || '가족';
            const cleanContent = content.trim();

            let candidateDoc = null;
            if (!forceNew) {
                try {
                    const searchKey = title || cleanContent.slice(0, 80);
                    const candidates = await searchWikiContent(searchKey, 1);
                    if (Array.isArray(candidates) && candidates.length > 0 && candidates[0].slug) {
                        candidateDoc = await getWikiPageDetail(candidates[0].slug);
                    }
                } catch (e) {
                    console.warn('[publish-to-wiki] 후보 탐색 건너뜀:', e.message);
                }
            }

            const processed = await smartMergeOrDraftWiki({
                newContent: cleanContent,
                newTitle: title,
                candidateDoc,
                userName
            });

            if (processed.action === 'merge' && candidateDoc) {
                const updateRes = await updateWikiPage({
                    slug: candidateDoc.slug,
                    content_md: processed.content_md,
                    title: processed.title,
                    category: processed.category,
                    change_summary: processed.merge_summary || 'AI 지능형 보강',
                    author: userName || '가족'
                });

                return res.json({
                    success: true,
                    action: 'merge',
                    id: candidateDoc.id,
                    title: processed.title,
                    category: processed.category,
                    slug: candidateDoc.slug,
                    view_url: updateRes.view_url || `/wiki/${candidateDoc.slug}`,
                    message: `기존 '${processed.title}' 문서에 새 내용이 누적 보강되었습니다. (${processed.merge_summary || '업데이트'})`
                });
            }

            const saveRes = await createWikiPage({
                category: processed.category || category,
                title: processed.title,
                content_md: processed.content_md,
                slug: processed.slug
            });

            res.json({
                success: true,
                action: 'create',
                id: saveRes.id,
                title: saveRes.title || processed.title,
                category: saveRes.category || processed.category,
                slug: saveRes.slug || processed.slug,
                view_url: saveRes.view_url || `/wiki/${saveRes.slug}`,
                message: '가족 위키 새 문서가 성공적으로 발행되었습니다.'
            });
        } finally {
            activeAiRequests = Math.max(0, activeAiRequests - 1);
        }
    } catch (err) {
        console.error('[API /api/ai/publish-to-wiki] 오류:', err);
        res.status(500).json({ success: false, message: '위키 문서 처리 실패: ' + err.message });
    }
});

module.exports = router;
