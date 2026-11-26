const express = require('express');
const router = express.Router();
const {
    loadAlertConfig,
    saveAlertConfig,
    getServerAlertHistory
} = require('../../services/scheduler/serverAlertConfig.service');

// 서버 텔레그램 알림 설정 및 최근 발송 이력 조회
router.get('/system/alert-config', (req, res) => {
    res.json({
        success: true,
        config: loadAlertConfig(),
        history: getServerAlertHistory()
    });
});

// 서버 텔레그램 알림 설정 저장
router.post('/system/alert-config', (req, res) => {
    const saved = saveAlertConfig(req.body || {});
    res.json({
        success: true,
        config: saved,
        message: '서버 텔레그램 알림 설정이 저장되었습니다.'
    });
});

module.exports = router;
