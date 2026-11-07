/**
 * 🤖 관리자 AI 비서 제어 라우터 (ai.admin.routes.js)
 * - 첫 환영 인사말 및 1회 질문 글자 수 제한 관리
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const express = require('express');
const router = express.Router();
const { getAiConfig, updateAiConfig } = require('../../services/aiConfig.service');
const { checkAiHealth } = require('../../services/aiAssistant.service');
const { CHAT_MODEL, REASONING_MODEL } = require('../../services/aiModelRouter.service');

// 1. AI 설정 조회 (관리자)
router.get('/', (req, res) => {
    try {
        const config = getAiConfig();
        res.json({ success: true, config, envDefaults: { chatModel: CHAT_MODEL, reasoningModel: REASONING_MODEL } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'AI 설정을 불러오지 못했습니다.', error: err.message });
    }
});

// 2. AI 설정 저장 (관리자)
router.post('/', async (req, res) => {
    try {
        const { welcomeMessage, maxPromptLength, heroIcon, heroTitle, heroDescription } = req.body;
        const { chatModel, reasoningModel, chatNumCtx, reasoningNumCtx } = req.body;
        const MODEL_RE = /^[A-Za-z0-9._:\/-]{0,100}$/;
        if ((chatModel !== undefined && !MODEL_RE.test(String(chatModel).trim())) ||
            (reasoningModel !== undefined && !MODEL_RE.test(String(reasoningModel).trim()))) {
            return res.status(400).json({ success: false, message: '모델명은 영문/숫자/.:_-/ 만 사용할 수 있습니다. (예: exaone4:opt)' });
        }
        for (const v of [chatNumCtx, reasoningNumCtx]) {
            const n = parseInt(v, 10);
            if (v !== undefined && v !== '' && !(n === 0 || (n >= 512 && n <= 131072))) {
                return res.status(400).json({ success: false, message: '컨텍스트 창은 0(기본값) 또는 512~131,072 사이여야 합니다.' });
            }
        }

        if (welcomeMessage !== undefined && (typeof welcomeMessage !== 'string' || !welcomeMessage.trim())) {
            return res.status(400).json({ success: false, message: '첫 인사말을 올바르게 입력해 주세요.' });
        }

        if (maxPromptLength !== undefined) {
            const len = parseInt(maxPromptLength, 10);
            if (isNaN(len) || len < 100 || len > 4000) {
                return res.status(400).json({ success: false, message: '최대 글자 수는 100자에서 4,000자 사이여야 합니다.' });
            }
        }

        if (heroIcon !== undefined && (typeof heroIcon !== 'string' || !heroIcon.trim())) {
            return res.status(400).json({ success: false, message: '히어로 아이콘을 올바르게 입력해 주세요.' });
        }

        if (heroTitle !== undefined && (typeof heroTitle !== 'string' || !heroTitle.trim())) {
            return res.status(400).json({ success: false, message: '히어로 타이틀을 올바르게 입력해 주세요.' });
        }

        const result = await updateAiConfig({
            welcomeMessage,
            maxPromptLength,
            heroIcon,
            heroTitle,
            heroDescription,
            chatModel,
            reasoningModel,
            chatNumCtx,
            reasoningNumCtx
        });

        if (!result.success) {
            return res.status(500).json({ success: false, message: '설정 데이터베이스 저장에 실패했습니다.' });
        }

        res.json({ success: true, message: 'AI 비서 설정이 성공적으로 저장되었습니다.', config: result.config });
    } catch (err) {
        res.status(500).json({ success: false, message: '설정 저장 중 오류가 발생했습니다.', error: err.message });
    }
});

// 3. AI 노드 상태 및 진단 (관리자)
router.get('/health', async (req, res) => {
    try {
        const health = await checkAiHealth();
        res.json({ success: true, health });
    } catch (err) {
        res.status(500).json({ success: false, message: 'AI 헬스체크 실패', error: err.message });
    }
});

module.exports = router;
