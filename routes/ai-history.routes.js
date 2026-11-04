/**
 * 🤖 JG 포털 로컬 AI 비서 대화 히스토리 라우터 (ai-history.routes.js)
 * - 계정별 격리 SQLite DB 기반 세션 및 대화 내역 CRUD API
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
    getUserSessions,
    getSessionDetail,
    createSession,
    addMessage,
    deleteSession,
    deleteAllSessions,
    syncSessionsFromClient,
    updateSessionTitle
} = require('../services/aiHistory.service');

// 1. 현재 사용자의 대화 세션 목록 조회
router.get('/api/ai/history/sessions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.username;
        if (!userId) {
            return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
        }
        const sessions = await getUserSessions(userId);
        res.json({ success: true, sessions });
    } catch (err) {
        console.error('[API /api/ai/history/sessions] 세션 목록 조회 오류:', err);
        res.status(500).json({ success: false, message: '대화 목록을 불러오지 못했습니다.', error: err.message });
    }
});

// 2. 신규 대화 세션 생성
router.post('/api/ai/history/sessions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.username;
        if (!userId) {
            return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
        }
        const { id, title } = req.body;
        const sessionId = id || ('sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
        const session = await createSession(userId, sessionId, title || '새 대화');
        res.json({ success: true, session });
    } catch (err) {
        console.error('[API POST /api/ai/history/sessions] 세션 생성 오류:', err);
        res.status(500).json({ success: false, message: '새 대화 세션을 생성하지 못했습니다.', error: err.message });
    }
});

// 3. 특정 세션의 전체 메시지 조회
router.get('/api/ai/history/sessions/:sessionId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.username;
        const { sessionId } = req.params;
        if (!userId) {
            return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
        }
        const session = await getSessionDetail(userId, sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: '대화 세션을 찾을 수 없습니다.' });
        }
        res.json({ success: true, session });
    } catch (err) {
        console.error('[API GET /api/ai/history/sessions/:sessionId] 상세 조회 오류:', err);
        res.status(500).json({ success: false, message: '대화 내역을 불러오지 못했습니다.', error: err.message });
    }
});

// 4. 특정 세션에 메시지 추가
router.post('/api/ai/history/sessions/:sessionId/messages', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.username;
        const { sessionId } = req.params;
        const { role, content, timestamp } = req.body;

        if (!userId) {
            return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
        }
        if (!role || !content) {
            return res.status(400).json({ success: false, message: '메시지 내용과 역할이 올바르지 않습니다.' });
        }

        const result = await addMessage(userId, sessionId, role, content, timestamp);
        res.json({ success: true, result });
    } catch (err) {
        console.error('[API POST /api/ai/history/sessions/:sessionId/messages] 메시지 저장 오류:', err);
        res.status(500).json({ success: false, message: '메시지를 저장하지 못했습니다.', error: err.message });
    }
});

// 5. 특정 대화 세션 삭제
router.delete('/api/ai/history/sessions/:sessionId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.username;
        const { sessionId } = req.params;

        if (!userId) {
            return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
        }

        const success = await deleteSession(userId, sessionId);
        res.json({ success, message: success ? '대화 세션이 삭제되었습니다.' : '세션을 찾을 수 없거나 삭제할 수 없습니다.' });
    } catch (err) {
        console.error('[API DELETE /api/ai/history/sessions/:sessionId] 세션 삭제 오류:', err);
        res.status(500).json({ success: false, message: '대화 세션을 삭제하지 못했습니다.', error: err.message });
    }
});

// 6. 전체 대화 세션 비우기
router.delete('/api/ai/history/sessions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.username;
        if (!userId) {
            return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
        }

        const success = await deleteAllSessions(userId);
        res.json({ success, message: '전체 대화 세션이 비워졌습니다.' });
    } catch (err) {
        console.error('[API DELETE /api/ai/history/sessions] 전체 삭제 오류:', err);
        res.status(500).json({ success: false, message: '대화 세션을 비우지 못했습니다.', error: err.message });
    }
});

// 7. 클라이언트 로컬스토리지 대화 서버 일괄 동기화 (기존 대화 무손실 마이그레이션)
router.post('/api/ai/history/sync', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.username;
        const { sessions } = req.body;

        if (!userId) {
            return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
        }
        if (!Array.isArray(sessions)) {
            return res.status(400).json({ success: false, message: '동기화할 세션 데이터가 올바르지 않습니다.' });
        }

        const count = await syncSessionsFromClient(userId, sessions);
        res.json({ success: true, count, message: `${count}개의 대화 세션이 동기화되었습니다.` });
    } catch (err) {
        console.error('[API POST /api/ai/history/sync] 동기화 오류:', err);
        res.status(500).json({ success: false, message: '대화 세션 동기화에 실패했습니다.', error: err.message });
    }
});

// 8. 특정 대화 세션의 제목(대화명) 수정
router.patch('/api/ai/history/sessions/:sessionId/title', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.username;
        const { sessionId } = req.params;
        const { title } = req.body;

        if (!userId) {
            return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
        }
        if (!title || typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ success: false, message: '유효한 대화명을 입력해주세요.' });
        }

        const cleanTitle = title.trim().substring(0, 50);
        const success = await updateSessionTitle(userId, sessionId, cleanTitle);
        if (!success) {
            return res.status(404).json({ success: false, message: '대화 세션을 찾을 수 없거나 수정 권한이 없습니다.' });
        }
        res.json({ success: true, title: cleanTitle, message: '대화명이 성공적으로 변경되었습니다.' });
    } catch (err) {
        console.error('[API PATCH /api/ai/history/sessions/:sessionId/title] 대화명 변경 오류:', err);
        res.status(500).json({ success: false, message: '대화명을 수정하지 못했습니다.', error: err.message });
    }
});

module.exports = router;
