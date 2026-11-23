const express = require('express');
const router = express.Router();
const { portalDb } = require('../../services/db');
const { getRecentPushDiagEvents, sendUnifiedPushNotification } = require('../../services/push.service');

const ICON_PRESETS = [
    { label: '기본 포털', path: '/icons/notif/default-192.png' },
    { label: '건강·약', path: '/icons/notif/health-192.png' },
    { label: '가족 앨범', path: '/icons/notif/album-192.png' },
    { label: '어린이 학습', path: '/icons/notif/study-192.png' },
    { label: '일정·D-Day', path: '/icons/notif/calendar-192.png' },
    { label: '뉴스·날씨', path: '/icons/notif/news-192.png' },
    { label: '자산·증시', path: '/icons/notif/asset-192.png' },
    { label: '시스템·서버', path: '/icons/notif/system-192.png' }
];

// 1. 전체 등록 푸시 기기 목록, 서비스 정책 및 최근 발송·수신(SW-ACK) 진단 이벤트 조회
router.get('/overview', (req, res) => {
    const devSql = `
        SELECT id, user_id, endpoint, client_type, device_type, device_id, browser_name,
               content_encoding, status, fail_count, last_http_code,
               last_success_at, last_failure_at, last_verified_at, last_error, updated_at
        FROM push_subscriptions
        ORDER BY updated_at DESC, id DESC
    `;
    const svcSql = `
        SELECT service_key, display_name, scope_policy, messenger_mode, icon_emoji, icon_path, is_active, sort_order
        FROM notification_services
        ORDER BY sort_order ASC, service_key ASC
    `;

    portalDb.all(devSql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: '구독 기기 목록 조회 실패: ' + err.message });
        }
        const devices = (rows || []).map((r) => ({
            id: r.id,
            userId: r.user_id,
            clientType: r.client_type || 'browser',
            deviceType: r.device_type || 'desktop',
            browserName: r.browser_name || '브라우저',
            contentEncoding: r.content_encoding || 'aes128gcm',
            status: r.status || 'active',
            failCount: r.fail_count || 0,
            lastHttpCode: r.last_http_code || null,
            endpointShort: r.endpoint ? (r.endpoint.slice(0, 42) + '...') : '-',
            lastSuccessAt: r.last_success_at || '',
            lastFailureAt: r.last_failure_at || '',
            lastVerifiedAt: r.last_verified_at || '',
            lastError: r.last_error || '',
            updatedAt: r.updated_at || ''
        }));

        portalDb.all(svcSql, [], (sErr, svcRows) => {
            res.json({
                success: true,
                devices,
                services: (!sErr && Array.isArray(svcRows)) ? svcRows : [],
                iconPresets: ICON_PRESETS,
                recentEvents: getRecentPushDiagEvents()
            });
        });
    });
});

// 1-1. 서비스별 알림 정책(전역 ON/OFF, 수신 범위, 텔레그램 3모드, 아이콘) 수정
router.patch('/services/:serviceKey', (req, res) => {
    const serviceKey = String(req.params.serviceKey || '').trim();
    const { is_active, scope_policy, messenger_mode, icon_path, icon_emoji } = req.body || {};

    const validScopes = ['admin_only', 'family_opt_in', 'family_default_on'];
    const validModes = ['off', 'fallback', 'both'];

    if (scope_policy && !validScopes.includes(scope_policy)) {
        return res.status(400).json({ success: false, message: '유효하지 않은 수신 범위 정책입니다.' });
    }
    if (messenger_mode && !validModes.includes(messenger_mode)) {
        return res.status(400).json({ success: false, message: '유효하지 않은 텔레그램 발송 모드입니다.' });
    }

    portalDb.run(
        `UPDATE notification_services
         SET is_active = COALESCE(?, is_active),
             scope_policy = COALESCE(?, scope_policy),
             messenger_mode = COALESCE(?, messenger_mode),
             icon_path = COALESCE(?, icon_path),
             icon_emoji = COALESCE(?, icon_emoji),
             updated_at = datetime('now', 'localtime')
         WHERE service_key = ?`,
        [
            is_active !== undefined ? (is_active ? 1 : 0) : null,
            scope_policy || null,
            messenger_mode || null,
            icon_path ? String(icon_path).slice(0, 150) : null,
            icon_emoji ? String(icon_emoji).slice(0, 16) : null,
            serviceKey
        ],
        function (err) {
            if (err) return res.status(500).json({ success: false, message: '알림 정책 저장 실패: ' + err.message });
            if (!this || this.changes === 0) {
                return res.status(404).json({ success: false, message: '대상 서비스를 찾을 수 없습니다.' });
            }
            res.json({ success: true, message: '서비스 알림 정책이 저장되었습니다.' });
        }
    );
});

// 2. 특정 기기 구독 강제 만료(다음 접속 시 자동 재구독 유도) 및 삭제
router.post('/devices/:id/force-expire', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: '유효하지 않은 기기 ID입니다.' });

    portalDb.run(
        `UPDATE push_subscriptions
         SET status = 'expired', last_error = '관리자 재연결 요청', updated_at = datetime('now', 'localtime')
         WHERE id = ?`,
        [id],
        function (err) {
            if (err) return res.status(500).json({ success: false, message: '상태 변경 실패: ' + err.message });
            res.json({ success: true, changed: this ? this.changes : 0, message: '해당 기기가 다음 접속 시 자동으로 새 푸시 토큰을 재발급받습니다.' });
        }
    );
});

router.delete('/devices/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: '유효하지 않은 기기 ID입니다.' });

    portalDb.run('DELETE FROM push_subscriptions WHERE id = ?', [id], function (err) {
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
