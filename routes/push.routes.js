const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { db, newsDb } = require('../services/db');
const { authenticateToken } = require('../middleware/auth');
const { JWT_SECRET, ADMIN_USERS } = require('../config/constants');
const {
    VAPID_PUBLIC_KEY,
    detectBrowserName,
    recordPushDiagEvent,
    sendUnifiedPushNotification
} = require('../services/push.service');

function isMobileUserAgent(deviceType, userAgent) {
    if (deviceType === 'mobile' || deviceType === 'tablet') return true;
    return /mobi|iphone|ipod|ipad|android|samsungbrowser|wv/i.test(String(userAgent || ''));
}

// 1. VAPID 공개키 조회
router.get('/vapid-key', (req, res) => {
    res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

// 1-1. 내 기기 푸시 구독 상태 실시간 진단 API
router.get('/status', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const currentEndpoint = String(req.query.endpoint || '').trim();

    db.all(
        `SELECT id, endpoint, client_type, device_type, device_id, browser_name, last_success_at, last_error, updated_at
         FROM push_subscriptions
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC`,
        [userId],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, totalDevices: 0, isCurrentRegistered: false });
            const list = Array.isArray(rows) ? rows : [];
            const matched = currentEndpoint ? list.find(r => r.endpoint === currentEndpoint) : null;
            res.json({
                success: true,
                totalDevices: list.length,
                isCurrentRegistered: Boolean(matched),
                currentDevice: matched ? {
                    id: matched.id,
                    clientType: matched.client_type,
                    deviceType: matched.device_type,
                    browserName: matched.browser_name || '브라우저',
                    lastSuccessAt: matched.last_success_at,
                    updatedAt: matched.updated_at
                } : null
            });
        }
    );
});

// 1-2. 미확인 알림 개수 경량 조회 API
router.get('/unread-count', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const query = isAdmin
        ? "SELECT COUNT(*) as unread FROM notification_history WHERE (user_id = ? OR user_id = 'admin') AND type != 'breaking' AND is_read = 0"
        : "SELECT COUNT(*) as unread FROM notification_history WHERE user_id = ? AND type != 'system' AND type != 'breaking' AND is_read = 0";
    db.get(query, [userId], (err, row) => {
        if (err) return res.status(500).json({ success: false, unreadCount: 0 });
        res.json({ success: true, unreadCount: row ? (row.unread || 0) : 0 });
    });
});

// 2. 순정 표준 푸시 구독 토큰 등록 API
router.post('/subscribe', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const rawUserAgent = String(req.body.userAgent || req.headers['user-agent'] || '');
    const clientType = req.body.clientType === 'pwa' ? 'pwa' : 'browser';
    const deviceId = String(req.body.deviceId || '').trim();
    const previousEndpoint = String(req.body.previousEndpoint || '').trim();
    const subscription = req.body.subscription;
    const deviceType = isMobileUserAgent(req.body.deviceType, rawUserAgent) ? 'mobile' : 'desktop';

    if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
        return res.status(400).json({ success: false, message: '유효하지 않은 구독 정보입니다.' });
    }

    const { endpoint, keys } = subscription;
    const browserName = detectBrowserName(rawUserAgent, endpoint);

    const upsertSql = `
        INSERT INTO push_subscriptions
            (user_id, endpoint, keys_p256dh, keys_auth, client_type, device_type, device_id, browser_name, user_agent, last_error, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', datetime('now', 'localtime'))
        ON CONFLICT(endpoint) DO UPDATE SET
            user_id = excluded.user_id,
            keys_p256dh = excluded.keys_p256dh,
            keys_auth = excluded.keys_auth,
            client_type = excluded.client_type,
            device_type = excluded.device_type,
            device_id = excluded.device_id,
            browser_name = excluded.browser_name,
            user_agent = excluded.user_agent,
            last_error = '',
            updated_at = datetime('now', 'localtime')
    `;

    db.run(upsertSql, [userId, endpoint, keys.p256dh, keys.auth, clientType, deviceType, deviceId, browserName, rawUserAgent], function(err) {
        if (err) {
            console.error('[WebPush] 구독 토큰 저장 실패:', err.message);
            return res.status(500).json({ success: false, message: '구독 토큰 저장 실패' });
        }

        // 1) 재구독으로 폐기된 직전 엔드포인트 명시 정리
        if (previousEndpoint && previousEndpoint !== endpoint) {
            db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, previousEndpoint]);
        }

        // 2) 정확히 동일한 기기ID + 실행모드(pwa/browser) + 브라우저 종류의 이전 토큰만 안전 정리 (타 브라우저/웹앱 침범 절대 금지)
        if (deviceId && deviceId !== 'unknown') {
            db.run(
                `DELETE FROM push_subscriptions
                 WHERE user_id = ? AND endpoint != ? AND device_id = ? AND client_type = ? AND browser_name = ?`,
                [userId, endpoint, deviceId, clientType, browserName]
            );
        }

        console.log(`📥 [WebPush 등록] 계정=${userId}, 환경=${clientType}/${deviceType}, 브라우저=${browserName}`);
        recordPushDiagEvent({
            kind: 'subscribe',
            userId,
            clientType,
            deviceType,
            browserName
        });

        res.json({
            success: true,
            browserName,
            clientType,
            message: '푸시 알림 기기가 정상 등록되었습니다.'
        });
    });
});

// 2-1. 푸시 구독 해제 API
router.post('/unsubscribe', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const endpoint = String((req.body && req.body.endpoint) || '').trim();
    if (!endpoint) return res.json({ success: true });

    db.run(
        `DELETE FROM push_subscriptions WHERE endpoint = ? AND (user_id = ? OR ? = 1)`,
        [endpoint, userId, isAdmin],
        function() {
            res.json({ success: true, message: '푸시 구독이 해제되었습니다.' });
        }
    );
});

// 2-2. 내 계정의 등록된 기기 구독 초기화 API (꼬인 토큰 원클릭 클린업)
router.post('/reset-devices', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    db.run('DELETE FROM push_subscriptions WHERE user_id = ?', [userId], function(err) {
        if (err) return res.status(500).json({ success: false, message: '기기 구독 초기화 실패' });
        const removed = this ? this.changes : 0;
        console.log(`🧹 [WebPush 기기 초기화] 계정=${userId}, 정리된 토큰=${removed}개`);
        res.json({ success: true, removed, message: '기존 등록 기기 정보를 깨끗이 초기화했습니다.' });
    });
});

// 3. 알림 맞춤 설정 조회 API
router.get('/settings', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const query = isAdmin
        ? "SELECT * FROM notification_settings WHERE user_id = ? OR user_id = 'admin' ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END LIMIT 1"
        : "SELECT * FROM notification_settings WHERE user_id = ? LIMIT 1";

    db.get(query, isAdmin ? [userId, userId] : [userId], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: '알림 설정 조회 실패' });
        const safeParse = (str, fallback) => {
            try { return JSON.parse(str) || fallback; } catch (e) { return fallback; }
        };

        if (!row) {
            return res.json({
                success: true,
                settings: {
                    enabled: 1,
                    album_push_enabled: 1, album_new_photo_enabled: 1, album_comment_enabled: 1, album_mention_enabled: 1,
                    hospital_push_enabled: isAdmin ? 1 : 0,
                    breaking_news_enabled: isAdmin ? 1 : 0,
                    weather_morning_enabled: isAdmin ? 1 : 0, weather_morning_time: '07:00',
                    asset_report_enabled: isAdmin ? 1 : 0, asset_open_enabled: isAdmin ? 1 : 0, asset_close_enabled: isAdmin ? 1 : 0,
                    bp_reminder_enabled: isAdmin ? 1 : 0, bp_reminder_time: '21:00',
                    system_alert_enabled: isAdmin ? 1 : 0,
                    telegram_briefing_times: ['07:30'],
                    weekday_med_times: ['08:00', '19:00'], weekday_bp_times: ['07:30', '21:30'],
                    weekend_med_times: ['09:00', '19:30'], weekend_bp_times: ['08:30', '22:00']
                }
            });
        }

        res.json({
            success: true,
            settings: {
                enabled: row.enabled !== undefined ? row.enabled : 1,
                album_push_enabled: row.album_push_enabled !== undefined ? row.album_push_enabled : 1,
                album_new_photo_enabled: row.album_new_photo_enabled !== undefined ? row.album_new_photo_enabled : 1,
                album_comment_enabled: row.album_comment_enabled !== undefined ? row.album_comment_enabled : 1,
                album_mention_enabled: row.album_mention_enabled !== undefined ? row.album_mention_enabled : 1,
                hospital_push_enabled: row.hospital_push_enabled !== undefined ? row.hospital_push_enabled : (isAdmin ? 1 : 0),
                breaking_news_enabled: row.breaking_news_enabled !== undefined ? row.breaking_news_enabled : (isAdmin ? 1 : 0),
                weather_morning_enabled: row.weather_morning_enabled !== undefined ? row.weather_morning_enabled : (isAdmin ? 1 : 0),
                weather_morning_time: row.weather_morning_time || '07:00',
                asset_report_enabled: row.asset_report_enabled !== undefined ? row.asset_report_enabled : (isAdmin ? 1 : 0),
                asset_open_enabled: row.asset_open_enabled !== undefined ? row.asset_open_enabled : (row.asset_report_enabled !== undefined ? row.asset_report_enabled : (isAdmin ? 1 : 0)),
                asset_close_enabled: row.asset_close_enabled !== undefined ? row.asset_close_enabled : (row.asset_report_enabled !== undefined ? row.asset_report_enabled : (isAdmin ? 1 : 0)),
                bp_reminder_enabled: row.bp_reminder_enabled !== undefined ? row.bp_reminder_enabled : (isAdmin ? 1 : 0),
                bp_reminder_time: row.bp_reminder_time || '21:00',
                system_alert_enabled: row.system_alert_enabled !== undefined ? row.system_alert_enabled : (isAdmin ? 1 : 0),
                telegram_briefing_times: safeParse(row.telegram_briefing_times, ['07:30']),
                weekday_med_times: safeParse(row.weekday_med_times, ['08:00', '19:00']),
                weekday_bp_times: safeParse(row.weekday_bp_times, ['07:30', '21:30']),
                weekend_med_times: safeParse(row.weekend_med_times, ['09:00', '19:30']),
                weekend_bp_times: safeParse(row.weekend_bp_times, ['08:30', '22:00'])
            }
        });
    });
});

// 4. 알림 맞춤 설정 저장 API
router.post('/settings', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const {
        enabled,
        album_push_enabled, album_new_photo_enabled, album_comment_enabled, album_mention_enabled,
        hospital_push_enabled, breaking_news_enabled,
        weather_morning_enabled, weather_morning_time,
        asset_report_enabled, asset_open_enabled, asset_close_enabled,
        bp_reminder_enabled, bp_reminder_time,
        system_alert_enabled,
        telegram_briefing_times,
        weekday_med_times, weekday_bp_times,
        weekend_med_times, weekend_bp_times
    } = req.body;

    const query = `
        INSERT INTO notification_settings 
        (user_id, enabled, album_push_enabled, album_new_photo_enabled, album_comment_enabled, album_mention_enabled, hospital_push_enabled, breaking_news_enabled, weather_morning_enabled, weather_morning_time, asset_report_enabled, asset_open_enabled, asset_close_enabled, bp_reminder_enabled, bp_reminder_time, system_alert_enabled, telegram_briefing_times, weekday_med_times, weekday_bp_times, weekend_med_times, weekend_bp_times)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            enabled = excluded.enabled, album_push_enabled = excluded.album_push_enabled,
            album_new_photo_enabled = excluded.album_new_photo_enabled, album_comment_enabled = excluded.album_comment_enabled,
            album_mention_enabled = excluded.album_mention_enabled, hospital_push_enabled = excluded.hospital_push_enabled,
            breaking_news_enabled = excluded.breaking_news_enabled, weather_morning_enabled = excluded.weather_morning_enabled,
            weather_morning_time = excluded.weather_morning_time, asset_report_enabled = excluded.asset_report_enabled,
            asset_open_enabled = excluded.asset_open_enabled, asset_close_enabled = excluded.asset_close_enabled,
            bp_reminder_enabled = excluded.bp_reminder_enabled, bp_reminder_time = excluded.bp_reminder_time,
            system_alert_enabled = excluded.system_alert_enabled, telegram_briefing_times = excluded.telegram_briefing_times,
            weekday_med_times = excluded.weekday_med_times, weekday_bp_times = excluded.weekday_bp_times,
            weekend_med_times = excluded.weekend_med_times, weekend_bp_times = excluded.weekend_bp_times,
            updated_at = datetime('now', 'localtime')
    `;

    const albumPushVal = album_push_enabled !== undefined ? (album_push_enabled ? 1 : 0) : 1;
    const albumPhotoVal = album_new_photo_enabled !== undefined ? (album_new_photo_enabled ? 1 : 0) : 1;
    const albumCommentVal = album_comment_enabled !== undefined ? (album_comment_enabled ? 1 : 0) : 1;
    const albumMentionVal = album_mention_enabled !== undefined ? (album_mention_enabled ? 1 : 0) : 1;

    const openVal = asset_open_enabled !== undefined ? (asset_open_enabled ? 1 : 0) : (isAdmin ? 1 : 0);
    const closeVal = asset_close_enabled !== undefined ? (asset_close_enabled ? 1 : 0) : (isAdmin ? 1 : 0);
    const reportVal = (openVal || closeVal) ? 1 : (asset_report_enabled !== undefined ? (asset_report_enabled ? 1 : 0) : (isAdmin ? 1 : 0));

    const hospVal = isAdmin ? (hospital_push_enabled !== undefined ? (hospital_push_enabled ? 1 : 0) : 1) : 0;
    const bpVal = isAdmin ? (bp_reminder_enabled !== undefined ? (bp_reminder_enabled ? 1 : 0) : 1) : 0;
    const sysVal = isAdmin ? (system_alert_enabled !== undefined ? (system_alert_enabled ? 1 : 0) : 1) : 0;

    let cleanBriefingTimes = Array.isArray(telegram_briefing_times)
        ? telegram_briefing_times.filter(t => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t.trim())).map(t => t.trim())
        : ['07:30'];
    cleanBriefingTimes = Array.from(new Set(cleanBriefingTimes)).sort();
    if (cleanBriefingTimes.length === 0) cleanBriefingTimes = ['07:30'];

    db.run(query, [
        userId,
        enabled !== undefined ? (enabled ? 1 : 0) : 1,
        albumPushVal, albumPhotoVal, albumCommentVal, albumMentionVal,
        hospVal,
        breaking_news_enabled !== undefined ? (breaking_news_enabled ? 1 : 0) : (isAdmin ? 1 : 0),
        weather_morning_enabled !== undefined ? (weather_morning_enabled ? 1 : 0) : (isAdmin ? 1 : 0),
        (weather_morning_time || '07:00').trim(),
        reportVal, openVal, closeVal,
        bpVal, (bp_reminder_time || '21:00').trim(),
        sysVal,
        JSON.stringify(cleanBriefingTimes),
        JSON.stringify(Array.isArray(weekday_med_times) ? weekday_med_times : ['08:00', '19:00']),
        JSON.stringify(Array.isArray(weekday_bp_times) ? weekday_bp_times : ['07:30', '21:30']),
        JSON.stringify(Array.isArray(weekend_med_times) ? weekend_med_times : ['09:00', '19:30']),
        JSON.stringify(Array.isArray(weekend_bp_times) ? weekend_bp_times : ['08:30', '22:00'])
    ], function(err) {
        if (err) {
            console.error('[WebPush] 알림 설정 저장 실패:', err.message);
            return res.status(500).json({ success: false, message: '알림 설정 저장 실패' });
        }

        if (newsDb && isAdmin) {
            newsDb.run(`
                INSERT INTO system_settings (key, value, updated_at)
                VALUES ('telegram_briefing_times', ?, datetime('now', '+9 hours'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            `, [JSON.stringify(cleanBriefingTimes)], () => {});
        }

        res.json({ success: true, message: '통합 알림 설정이 저장되었습니다.' });
    });
});

// 5. 알림 수신 내역 조회 API
router.get('/history', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const countQuery = isAdmin
        ? "SELECT COUNT(*) as total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread FROM notification_history WHERE (user_id = ? OR user_id = 'admin') AND type != 'breaking'"
        : "SELECT COUNT(*) as total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread FROM notification_history WHERE user_id = ? AND type != 'system' AND type != 'breaking'";

    db.get(countQuery, [userId], (cntErr, counts) => {
        if (cntErr) return res.status(500).json({ success: false, message: '알림 카운트 조회 실패' });

        const dataQuery = isAdmin
            ? "SELECT id, user_id, type, title, body, icon, url, is_read, created_at FROM notification_history WHERE (user_id = ? OR user_id = 'admin') AND type != 'breaking' ORDER BY id DESC LIMIT ? OFFSET ?"
            : "SELECT id, user_id, type, title, body, icon, url, is_read, created_at FROM notification_history WHERE user_id = ? AND type != 'system' AND type != 'breaking' ORDER BY id DESC LIMIT ? OFFSET ?";

        db.all(dataQuery, [userId, limit, offset], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: '알림 내역 조회 실패' });
            res.json({
                success: true,
                history: rows || [],
                unreadCount: counts ? (counts.unread || 0) : 0,
                totalCount: counts ? (counts.total || 0) : 0,
                limit,
                offset
            });
        });
    });
});

// 5-1. 전체/개별 알림 읽음 및 삭제 API
router.post('/history/read-all', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const query = isAdmin
        ? "UPDATE notification_history SET is_read = 1 WHERE user_id = ? OR user_id = 'admin'"
        : "UPDATE notification_history SET is_read = 1 WHERE user_id = ? AND type != 'system'";
    db.run(query, [userId], function(err) {
        if (err) return res.status(500).json({ success: false, message: '전체 읽음 처리 실패' });
        res.json({ success: true, message: '모든 알림을 읽음 처리했습니다.', updated: this.changes });
    });
});

router.post('/history/:id/read', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const query = isAdmin
        ? "UPDATE notification_history SET is_read = 1 WHERE id = ? AND (user_id = ? OR user_id = 'admin')"
        : "UPDATE notification_history SET is_read = 1 WHERE id = ? AND user_id = ? AND type != 'system'";
    db.run(query, [req.params.id, userId], function(err) {
        if (err) return res.status(500).json({ success: false, message: '개별 읽음 처리 실패' });
        res.json({ success: true, changed: this ? this.changes : 0 });
    });
});

router.delete('/history/clear/all', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const query = isAdmin
        ? "DELETE FROM notification_history WHERE user_id = ? OR user_id = 'admin'"
        : "DELETE FROM notification_history WHERE user_id = ? AND type != 'system'";
    db.run(query, [userId], (err) => {
        if (err) return res.status(500).json({ success: false, message: '전체 알림 삭제 실패' });
        res.json({ success: true, message: '모든 알림 내역이 삭제되었습니다.' });
    });
});

router.delete('/history/:id', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const query = isAdmin
        ? "DELETE FROM notification_history WHERE id = ? AND (user_id = ? OR user_id = 'admin')"
        : "DELETE FROM notification_history WHERE id = ? AND user_id = ? AND type != 'system'";
    db.run(query, [req.params.id, userId], (err) => {
        if (err) return res.status(500).json({ success: false, message: '알림 삭제 실패' });
        res.json({ success: true, message: '알림이 삭제되었습니다.' });
    });
});

// 6. 테스트 푸시 즉시 발송 API
router.post('/test', authenticateToken, async (req, res) => {
    try {
        const result = await sendUnifiedPushNotification({
            title: '🔔 알림 연결 확인',
            body: '현재 기기로 실시간 웹 푸시 알림이 정상 연결되었습니다!',
            url: 'https://j-jg.cc/',
            type: 'test',
            userId: req.user.username || 'admin'
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: '테스트 알림 발송 실패: ' + e.message });
    }
});

// 7. 서비스 워커 푸시 수신/표시 ACK 로깅 API
router.post('/sw-ack', (req, res) => {
    const { status, title, tag, error } = req.body || {};
    recordPushDiagEvent({
        kind: 'sw-ack',
        status: status || 'shown',
        title: title || '-',
        tag: tag || '-',
        error: error || ''
    });
    if (status === 'error') {
        console.error(`❌ [SW-Push-ACK] 알림 표시 오류: title=${title || '-'}, error=${error || 'unknown'}`);
    } else {
        console.log(`📲 [SW-Push-ACK] 기기 알림 표시 완료 (${status || 'shown'}): title=${title || '-'}`);
    }
    res.json({ success: true });
});

// 8. 외부 서비스 연동 단일 브로드캐스트 API
router.post('/broadcast', async (req, res) => {
    const internalSecret = req.headers['x-internal-secret'];
    const isInternalValid =
        typeof JWT_SECRET === 'string' &&
        JWT_SECRET.length > 0 &&
        typeof internalSecret === 'string' &&
        internalSecret.length === JWT_SECRET.length &&
        crypto.timingSafeEqual(Buffer.from(internalSecret), Buffer.from(JWT_SECRET));

    let isAdminTokenValid = false;
    const authHeader = req.headers['authorization'];
    const rawToken = (authHeader && authHeader.split(' ')[1]) || (req.cookies && req.cookies.portal_token);
    if (!isInternalValid && rawToken) {
        try {
            const decoded = jwt.verify(rawToken, JWT_SECRET, { algorithms: ['HS256'] });
            if (decoded && decoded.username && ADMIN_USERS.has(decoded.username)) {
                isAdminTokenValid = true;
            }
        } catch (err) {}
    }

    if (!isInternalValid && !isAdminTokenValid) {
        return res.status(401).json({ success: false, message: '알림 발송 권한이 필요합니다.' });
    }

    try {
        const result = await sendUnifiedPushNotification(req.body);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: '브로드캐스트 발송 실패: ' + e.message });
    }
});

module.exports = router;
