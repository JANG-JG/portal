const express = require('express');
const router = express.Router();
const { db, newsDb } = require('../services/db');
const { authenticateToken } = require('../middleware/auth');
const { VAPID_PUBLIC_KEY, sendUnifiedPushNotification } = require('../services/push.service');

// 1. VAPID 공개키 조회
router.get('/vapid-key', (req, res) => {
    res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

// 1-1. 미확인 알림 개수 경량 조회 API
router.get('/unread-count', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const query = `
        SELECT COUNT(*) as unread
        FROM notification_history
        WHERE (user_id = ? OR user_id = 'admin') AND is_read = 0
    `;
    db.get(query, [userId], (err, row) => {
        if (err) {
            return res.status(500).json({ success: false, unreadCount: 0 });
        }
        res.json({
            success: true,
            unreadCount: row ? (row.unread || 0) : 0
        });
    });
});

// 모바일 기기 여부 정밀 판별 헬퍼 (삼성 인터넷 데스크톱 모드 등 포함)
function isMobileDeviceRecord(deviceType, userAgent) {
    if (deviceType === 'mobile' || deviceType === 'tablet') return true;
    const ua = String(userAgent || '').toLowerCase();
    return /mobi|iphone|ipod|ipad|android|samsungbrowser|wv/i.test(ua);
}

// 2. 푸시 구독 토큰 등록 API (중복 토큰 스마트 정리)
router.post('/subscribe', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const rawUserAgent = req.body.userAgent || req.headers['user-agent'] || '';
    const clientType = req.body.clientType || 'browser';
    const deviceId = req.body.deviceId || '';
    const subscription = req.body.subscription;
    const isMobile = isMobileDeviceRecord(req.body.deviceType, rawUserAgent);
    const deviceType = isMobile ? 'mobile' : (req.body.deviceType || 'desktop');

    if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({ success: false, message: '유효하지 않은 구독 정보입니다.' });
    }

    const { endpoint, keys } = subscription;

    // 🌟 모바일 일반 브라우저(삼성 인터넷 탭 등)에서 구독 요청 시, 이미 전용 웹앱(PWA/APK) 구독이 있으면 저장하지 않고 즉시 차단
    if (isMobile && clientType === 'browser') {
        return db.get(
            `SELECT endpoint FROM push_subscriptions WHERE user_id = ? AND (client_type = 'pwa' OR client_type = 'apk') LIMIT 1`,
            [userId],
            (chkErr, appRow) => {
                if (appRow && appRow.endpoint !== endpoint) {
                    db.run(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [endpoint], () => {});
                    console.log(`🧹 [WebPush Guard] 유저(${userId}) 전용 웹앱(PWA) 구독이 존재하므로 브라우저(${endpoint.slice(-12)}) 중복 등록 원천 차단`);
                    return res.json({
                        success: true,
                        skippedBrowser: true,
                        message: '전용 웹앱(PWA) 알림이 이미 등록되어 있어 브라우저 중복 알림을 자동으로 차단했습니다.'
                    });
                }
                proceedSaveSubscription();
            }
        );
    } else {
        proceedSaveSubscription();
    }

    function proceedSaveSubscription() {
        const query = `
            INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth, client_type, device_type, device_id, user_agent, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(endpoint) DO UPDATE SET
                user_id = excluded.user_id,
                keys_p256dh = excluded.keys_p256dh,
                keys_auth = excluded.keys_auth,
                client_type = excluded.client_type,
                device_type = excluded.device_type,
                device_id = excluded.device_id,
                user_agent = excluded.user_agent,
                updated_at = CURRENT_TIMESTAMP
        `;

        db.run(query, [userId, endpoint, keys.p256dh, keys.auth, clientType, deviceType, deviceId, rawUserAgent], function(err) {
            if (err) {
                console.error('[WebPush] 포털 구독 토큰 저장 실패:', err);
                return res.status(500).json({ success: false, message: '구독 토큰 저장 실패' });
            }

            // 🌟 [중복 방지 스마트 정리]
            // 1) 모바일 PWA 또는 APK 전용 앱으로 등록된 경우 다른 모든 모바일/미분류 브라우저 토큰 정리
            if (isMobile && (clientType === 'pwa' || clientType === 'apk')) {
                db.run(
                    `DELETE FROM push_subscriptions 
                     WHERE user_id = ? AND endpoint != ? AND (
                         device_type = 'mobile' 
                         OR user_agent LIKE '%Mobile%' 
                         OR user_agent LIKE '%Android%'
                         OR user_agent LIKE '%SamsungBrowser%'
                         OR client_type = 'pwa'
                         OR client_type = 'apk'
                         OR client_type = 'browser'
                         OR (device_id = '' OR device_id IS NULL)
                     )`,
                    [userId, endpoint],
                    function(delErr) {
                        if (!delErr && this.changes > 0) {
                            console.log(`🧹 [WebPush Cleanup] 유저(${userId}) 최신 전용 앱(${clientType.toUpperCase()}) 등록에 따라 다른 이전 토큰 ${this.changes}개 자동 정리 완료`);
                        }
                    }
                );
            }

            // 2) 동일 device_id를 가진 다른 엔드포인트 자동 정리
            if (deviceId && deviceId !== 'unknown') {
                db.run(
                    `DELETE FROM push_subscriptions 
                     WHERE user_id = ? AND endpoint != ? AND device_id = ?`,
                    [userId, endpoint, deviceId],
                    function(delErr) {
                        if (!delErr && this.changes > 0) {
                            console.log(`🧹 [WebPush Cleanup] 유저(${userId}) 동일 기기(${deviceId}) 이전 토큰 ${this.changes}개 자동 정리 완료`);
                        }
                    }
                );
            }

            res.json({ success: true, message: '푸시 알림 구독이 등록되었습니다.' });
        });
    }
});

// 2-1. 푸시 구독 해제 API
router.post('/unsubscribe', (req, res) => {
    const { endpoint } = req.body;
    if (endpoint) {
        db.run(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [endpoint], function(delErr) {
            if (!delErr && this.changes > 0) {
                console.log(`🧹 [WebPush Unsubscribe] 푸시 구독 해제 완료 (${endpoint.slice(0, 40)}...)`);
            }
            res.json({ success: true, message: '푸시 구독이 해제되었습니다.' });
        });
    } else {
        res.json({ success: true });
    }
});

// 3. 알림 맞춤 설정 조회 API
router.get('/settings', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';

    db.get("SELECT * FROM notification_settings WHERE user_id = ? OR user_id = 'admin' ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END LIMIT 1", [userId, userId], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: '알림 설정 조회 실패' });

        const safeParse = (str, fallback) => {
            try { return JSON.parse(str) || fallback; } catch (e) { return fallback; }
        };

        if (!row) {
            return res.json({
                success: true,
                settings: {
                    enabled: 1,
                    hospital_push_enabled: 1,
                    breaking_news_enabled: 1,
                    weather_morning_enabled: 1,
                    weather_morning_time: '07:00',
                    asset_report_enabled: 1,
                    asset_open_enabled: 1,
                    asset_close_enabled: 1,
                    bp_reminder_enabled: 1,
                    bp_reminder_time: '21:00',
                    system_alert_enabled: 1,
                    telegram_briefing_times: ['07:30'],
                    weekday_med_times: ['08:00', '19:00'],
                    weekday_bp_times: ['07:30', '21:30'],
                    weekend_med_times: ['09:00', '19:30'],
                    weekend_bp_times: ['08:30', '22:00']
                }
            });
        }

        res.json({
            success: true,
            settings: {
                enabled: row.enabled !== undefined ? row.enabled : 1,
                hospital_push_enabled: row.hospital_push_enabled !== undefined ? row.hospital_push_enabled : 1,
                breaking_news_enabled: row.breaking_news_enabled !== undefined ? row.breaking_news_enabled : 1,
                weather_morning_enabled: row.weather_morning_enabled !== undefined ? row.weather_morning_enabled : 1,
                weather_morning_time: row.weather_morning_time || '07:00',
                asset_report_enabled: row.asset_report_enabled !== undefined ? row.asset_report_enabled : 1,
                asset_open_enabled: row.asset_open_enabled !== undefined ? row.asset_open_enabled : (row.asset_report_enabled !== undefined ? row.asset_report_enabled : 1),
                asset_close_enabled: row.asset_close_enabled !== undefined ? row.asset_close_enabled : (row.asset_report_enabled !== undefined ? row.asset_report_enabled : 1),
                bp_reminder_enabled: row.bp_reminder_enabled !== undefined ? row.bp_reminder_enabled : 1,
                bp_reminder_time: row.bp_reminder_time || '21:00',
                system_alert_enabled: row.system_alert_enabled !== undefined ? row.system_alert_enabled : 1,
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
    const {
        enabled, hospital_push_enabled, breaking_news_enabled,
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
        (user_id, enabled, hospital_push_enabled, breaking_news_enabled, weather_morning_enabled, weather_morning_time, asset_report_enabled, asset_open_enabled, asset_close_enabled, bp_reminder_enabled, bp_reminder_time, system_alert_enabled, telegram_briefing_times, weekday_med_times, weekday_bp_times, weekend_med_times, weekend_bp_times)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            enabled = excluded.enabled,
            hospital_push_enabled = excluded.hospital_push_enabled,
            breaking_news_enabled = excluded.breaking_news_enabled,
            weather_morning_enabled = excluded.weather_morning_enabled,
            weather_morning_time = excluded.weather_morning_time,
            asset_report_enabled = excluded.asset_report_enabled,
            asset_open_enabled = excluded.asset_open_enabled,
            asset_close_enabled = excluded.asset_close_enabled,
            bp_reminder_enabled = excluded.bp_reminder_enabled,
            bp_reminder_time = excluded.bp_reminder_time,
            system_alert_enabled = excluded.system_alert_enabled,
            telegram_briefing_times = excluded.telegram_briefing_times,
            weekday_med_times = excluded.weekday_med_times,
            weekday_bp_times = excluded.weekday_bp_times,
            weekend_med_times = excluded.weekend_med_times,
            weekend_bp_times = excluded.weekend_bp_times,
            updated_at = CURRENT_TIMESTAMP
    `;

    const openVal = asset_open_enabled !== undefined ? (asset_open_enabled ? 1 : 0) : 1;
    const closeVal = asset_close_enabled !== undefined ? (asset_close_enabled ? 1 : 0) : 1;
    const reportVal = (openVal || closeVal) ? 1 : (asset_report_enabled !== undefined ? (asset_report_enabled ? 1 : 0) : 1);

    let cleanBriefingTimes = Array.isArray(telegram_briefing_times)
        ? telegram_briefing_times.filter(t => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t.trim())).map(t => t.trim())
        : ['07:30'];
    cleanBriefingTimes = Array.from(new Set(cleanBriefingTimes)).sort();
    if (cleanBriefingTimes.length === 0) cleanBriefingTimes = ['07:30'];

    db.run(query, [
        userId,
        enabled !== undefined ? (enabled ? 1 : 0) : 1,
        hospital_push_enabled !== undefined ? (hospital_push_enabled ? 1 : 0) : 1,
        breaking_news_enabled !== undefined ? (breaking_news_enabled ? 1 : 0) : 1,
        weather_morning_enabled !== undefined ? (weather_morning_enabled ? 1 : 0) : 1,
        (weather_morning_time || '07:00').trim(),
        reportVal,
        openVal,
        closeVal,
        bp_reminder_enabled !== undefined ? (bp_reminder_enabled ? 1 : 0) : 1,
        (bp_reminder_time || '21:00').trim(),
        system_alert_enabled !== undefined ? (system_alert_enabled ? 1 : 0) : 1,
        JSON.stringify(cleanBriefingTimes),
        JSON.stringify(Array.isArray(weekday_med_times) ? weekday_med_times : ['08:00', '19:00']),
        JSON.stringify(Array.isArray(weekday_bp_times) ? weekday_bp_times : ['07:30', '21:30']),
        JSON.stringify(Array.isArray(weekend_med_times) ? weekend_med_times : ['09:00', '19:30']),
        JSON.stringify(Array.isArray(weekend_bp_times) ? weekend_bp_times : ['08:30', '22:00'])
    ], function(err) {
        if (err) {
            console.error('[WebPush] 포털 알림 설정 저장 실패:', err);
            return res.status(500).json({ success: false, message: '알림 설정 저장 실패' });
        }

        if (newsDb) {
            newsDb.run(`
                INSERT INTO system_settings (key, value, updated_at)
                VALUES ('telegram_briefing_times', ?, datetime('now', '+9 hours'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            `, [JSON.stringify(cleanBriefingTimes)], (nErr) => {
                if (nErr) console.error('[NewsDB] telegram_briefing_times 동기화 실패:', nErr);
                else console.log('✅ [NewsDB] telegram_briefing_times 동기화 완료:', cleanBriefingTimes);
            });
        }

        res.json({ success: true, message: '포털 통합 알림 설정 및 뉴스 브리핑 시각이 저장되었습니다.' });
    });
});

// 5. 알림 수신 내역 조회 API
router.get('/history', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const countQuery = `
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
        FROM notification_history 
        WHERE user_id = ? OR user_id = 'admin'
    `;

    db.get(countQuery, [userId], (cntErr, counts) => {
        if (cntErr) {
            console.error('[WebPush] 포털 알림 카운트 조회 오류:', cntErr);
            return res.status(500).json({ success: false, message: '알림 카운트 조회 실패' });
        }

        const dataQuery = `
            SELECT id, user_id, type, title, body, icon, url, is_read, created_at 
            FROM notification_history 
            WHERE user_id = ? OR user_id = 'admin'
            ORDER BY id DESC 
            LIMIT ? OFFSET ?
        `;

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

// 5-1. 전체 알림 읽음 처리 API
router.post('/history/read-all', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const query = `UPDATE notification_history SET is_read = 1 WHERE user_id = ? OR user_id = 'admin'`;
    db.run(query, [userId], function(err) {
        if (err) {
            console.error('[WebPush] 전체 읽음 처리 오류:', err);
            return res.status(500).json({ success: false, message: '전체 읽음 처리 실패' });
        }
        res.json({ success: true, message: '모든 알림을 읽음 처리했습니다.', updated: this.changes });
    });
});

// 5-2. 개별 알림 읽음 처리 API
router.post('/history/:id/read', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const id = req.params.id;
    const query = `UPDATE notification_history SET is_read = 1 WHERE id = ? AND (user_id = ? OR user_id = 'admin' OR ? = 'admin' OR ? = 'upt0731')`;
    db.run(query, [id, userId, userId, userId], function(err) {
        if (err) {
            console.error('[WebPush] 개별 읽음 처리 오류:', err);
            return res.status(500).json({ success: false, message: '개별 읽음 처리 실패' });
        }
        res.json({ success: true, message: '알림을 읽음 처리했습니다.', changed: this ? this.changes : 0 });
    });
});

// 6. 알림 수신 내역 개별 삭제 API
router.delete('/history/:id', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const id = req.params.id;
    db.run("DELETE FROM notification_history WHERE id = ? AND (user_id = ? OR user_id = 'admin')", [id, userId], (err) => {
        if (err) return res.status(500).json({ success: false, message: '알림 삭제 실패' });
        res.json({ success: true, message: '알림이 삭제되었습니다.' });
    });
});

// 7. 알림 수신 내역 전체 삭제 API
router.delete('/history/clear/all', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    db.run("DELETE FROM notification_history WHERE user_id = ? OR user_id = 'admin'", [userId], (err) => {
        if (err) return res.status(500).json({ success: false, message: '전체 알림 삭제 실패' });
        res.json({ success: true, message: '모든 알림 내역이 삭제되었습니다.' });
    });
});

// 8. 테스트 푸시 즉시 발송 API
router.post('/test', authenticateToken, async (req, res) => {
    try {
        const result = await sendUnifiedPushNotification({
            title: '🔔 알림 테스트',
            body: '통합 포털 단일 알림 허브가 성공적으로 연결되었습니다! 속보, 날씨, 증시, 복약 및 혈압 알림을 실시간 수신할 수 있습니다.',
            url: 'https://j-jg.cc/',
            type: 'test',
            tag: 'jg-test',
            userId: req.user.username || 'admin'
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: '테스트 알림 발송 실패: ' + e.message });
    }
});

// 9. 통합 포털 단일 알림 브로드캐스트 엔진 API
router.post('/broadcast', async (req, res) => {
    const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const hasCookie = req.cookies && req.cookies.portal_token;

    if (!isLocal && !token && !hasCookie) {
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
