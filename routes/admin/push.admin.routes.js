const express = require('express');
const router = express.Router();
const { db } = require('../../services/db');
const { getRecentPushDiagEvents, sendUnifiedPushNotification } = require('../../services/push.service');

// 1. 전체 등록 푸시 기기 목록 및 최근 발송/수신(SW-ACK) 진단 이벤트 조회
router.get('/overview', (req, res) => {
    const sql = `
        SELECT id, user_id, endpoint, client_type, device_type, device_id, browser_name, last_success_at, last_error, updated_at
        FROM push_subscriptions
        ORDER BY updated_at DESC, id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: '구독 기기 목록 조회 실패: ' + err.message });
        }
        const devices = (rows || []).map((r) => ({
            id: r.id,
            userId: r.user_id,
            clientType: r.client_type || 'browser',
            deviceType: r.device_type || 'desktop',
            browserName: r.browser_name || '브라우저',
            endpointShort: r.endpoint ? (r.endpoint.slice(0, 42) + '...') : '-',
            lastSuccessAt: r.last_success_at || '',
            lastError: r.last_error || '',
            updatedAt: r.updated_at || ''
        }));

        res.json({
            success: true,
            devices,
            recentEvents: getRecentPushDiagEvents()
        });
    });
});

// 2. 특정 기기 구독 강제 삭제
router.delete('/devices/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: '유효하지 않은 기기 ID입니다.' });

    db.run('DELETE FROM push_subscriptions WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ success: false, message: '기기 삭제 실패: ' + err.message });
        res.json({ success: true, removed: this ? this.changes : 0, message: '선택한 푸시 기기 등록이 삭제되었습니다.' });
    });
});

// 3. 특정 계정 대상 관리자 점검 푸시 즉시 발송
router.post('/test/:userId', async (req, res) => {
    const targetUser = String(req.params.userId || 'admin').trim();
    try {
        const result = await sendUnifiedPushNotification({
            title: '🔔 관리자 알림 점검',
            body: `${targetUser} 계정의 등록 기기로 발송된 웹 푸시 연결 점검 알림입니다.`,
            url: 'https://j-jg.cc/',
            type: 'test',
            userId: targetUser
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: '점검 알림 발송 오류: ' + e.message });
    }
});

module.exports = router;
