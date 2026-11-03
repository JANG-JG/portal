/**
 * 🤖 관리자 AI 비서 제어 라우터 (ai.admin.routes.js)
 * - 첫 환영 인사말 및 1회 질문 글자 수 제한 관리
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const express = require('express');
const router = express.Router();
const { getAiConfig, updateAiConfig } = require('../../services/aiConfig.service');
const { checkAiHealth } = require('../../services/aiAssistant.service');

// 1. AI 설정 조회 (관리자)
router.get('/', (req, res) => {
    try {
        const config = getAiConfig();
        res.json({ success: true, config });
    } catch (err) {
        res.status(500).json({ success: false, message: 'AI 설정을 불러오지 못했습니다.', error: err.message });
    }
});

// 2. AI 설정 저장 (관리자)
router.post('/', async (req, res) => {
    try {
        const { welcomeMessage, maxPromptLength, heroIcon, heroTitle, heroDescription } = req.body;

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
            heroDescription
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
