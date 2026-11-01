const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const kindergartenService = require('../services/kindergarten.service');

// 1. 유치원 수집기 설정 조회 (비밀번호 마스킹)
router.get('/config', authenticateToken, (req, res) => {
    try {
        const config = kindergartenService.getPublicConfig();
        return res.json({ success: true, config });
    } catch (err) {
        return res.status(500).json({ success: false, error: '설정 조회 중 오류가 발생했습니다: ' + err.message });
    }
});

// 2. 유치원 수집기 설정 저장 (계정 암호화, 게시판 목록 업데이트)
router.post('/config', authenticateToken, async (req, res) => {
    try {
        const { userId, userPw, targetBoards, hddBasePath } = req.body;
        const result = await kindergartenService.saveCredentialsAndSettings({
            userId,
            userPw,
            targetBoards,
            hddBasePath
        });
        if (!result.success) {
            return res.status(500).json({ success: false, error: '설정 저장에 실패했습니다.' });
        }
        return res.json({ success: true, message: '설정이 안전하게 저장되었습니다.', config: result.config });
    } catch (err) {
        return res.status(500).json({ success: false, error: '설정 저장 중 오류: ' + err.message });
    }
});

// 3. 사진 수집 프로세스 실행
router.post('/run', authenticateToken, async (req, res) => {
    try {
        const result = await kindergartenService.startCrawler();
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, error: '프로세스 실행 요청 실패: ' + err.message });
    }
});

// 4. 실시간 상태 및 최근 로그 조회
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const status = await kindergartenService.getStatus();
        return res.json({ success: true, status });
    } catch (err) {
        return res.status(500).json({ success: false, error: '상태 조회 실패: ' + err.message });
    }
});

// 5. 누적 로그 파일(collection_history.log) 조회
router.get('/history-log', authenticateToken, async (req, res) => {
    try {
        const logData = await kindergartenService.getCumulativeHistoryLog();
        return res.json({ success: true, log: logData });
    } catch (err) {
        return res.status(500).json({ success: false, error: '누적 로그 조회 실패: ' + err.message });
    }
});

module.exports = router;
