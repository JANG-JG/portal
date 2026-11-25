const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { portalDb, newsDb } = require('../services/db');
const { authenticateToken, getClientIp, revokedTokens } = require('../middleware/auth');
const { JWT_SECRET, INTERNAL_API_SECRET, ADMIN_USERS } = require('../config/constants');
const {
    VAPID_PUBLIC_KEY, getVapidKeyFingerprint, isAllowedWebPushEndpoint,
    detectBrowserName, recordPushDiagEvent, sendUnifiedPushNotification, publishNotificationEvent
} = require('../services/push.service');
const {
    getUserPrefsNormalized,
    getLegacySettingsObject,
    upsertUserPref,
    saveLegacySettings
} = require('../services/notification/prefs.service');

function isMobileUserAgent(deviceType, userAgent) {
    if (deviceType === 'mobile' || deviceType === 'tablet') return true;
    return /mobi|iphone|ipod|ipad|android|samsungbrowser|wv/i.test(String(userAgent || ''));
}

function resolveContentEncoding(supportedEncodings) {
    if (Array.isArray(supportedEncodings) && supportedEncodings.length > 0) {
        if (supportedEncodings.includes('aes128gcm')) return 'aes128gcm';
        if (supportedEncodings.includes('aesgcm')) return 'aesgcm';
    }
    return 'aes128gcm';
}

// 1. VAPID 공개키 조회
router.get('/vapid-key', (req, res) => {
    res.json({ success: true, publicKey: VAPID_PUBLIC_KEY, fingerprint: getVapidKeyFingerprint() });
});

// 1-1. 내 기기 푸시 구독 상태 실시간 진단 API (삼성 인터넷 좀비 토큰 감지 포함)
router.get('/status', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const currentEndpoint = String(req.query.endpoint || '').trim();
    const curFingerprint = getVapidKeyFingerprint();

    portalDb.all(
        `SELECT id, endpoint, client_type, device_type, device_id, browser_name, status, fail_count,
                vapid_key_fingerprint, last_http_code, last_success_at, last_error, last_verified_at, updated_at
         FROM push_subscriptions
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC`,
        [userId],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, totalDevices: 0, isCurrentRegistered: false, needsResubscribe: false });
            const list = Array.isArray(rows) ? rows : [];
            const activeDevices = list.filter((r) => r.status === 'active' || r.status === 'degraded');
            const matched = currentEndpoint ? list.find((r) => r.endpoint === currentEndpoint) : null;

            let needsResubscribe = false;
            if (currentEndpoint) {
                if (!matched) {
                    needsResubscribe = true;
                } else if (matched.status === 'expired' || matched.status === 'revoked' || (matched.fail_count || 0) >= 2) {
                    needsResubscribe = true;
                } else if (curFingerprint && matched.vapid_key_fingerprint && matched.vapid_key_fingerprint !== curFingerprint) {
                    needsResubscribe = true;
                } else if (matched.browser_name === '삼성 인터넷' && matched.last_verified_at) {
                    const verifiedMs = new Date(String(matched.last_verified_at).replace(' ', 'T') + '+09:00').getTime();
                    if (!Number.isNaN(verifiedMs) && (Date.now() - verifiedMs) > 14 * 24 * 60 * 60 * 1000) {
                        needsResubscribe = true;
                    }
                }
            }

            if (matched && !needsResubscribe) {
                portalDb.run(
                    `UPDATE push_subscriptions SET last_verified_at = datetime('now', 'localtime') WHERE id = ?`,
                    [matched.id]
                );
            }

            res.json({
                success: true,
                totalDevices: activeDevices.length,
                isCurrentRegistered: Boolean(matched && matched.status !== 'expired' && matched.status !== 'revoked'),
                needsResubscribe,
                currentDevice: matched ? {
                    id: matched.id,
                    clientType: matched.client_type,
                    deviceType: matched.device_type,
                    browserName: matched.browser_name || '브라우저',
                    status: matched.status || 'active',
                    lastHttpCode: matched.last_http_code || null,
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
        ? "SELECT COUNT(*) as unread FROM notifications WHERE (user_id = ? OR user_id = 'admin') AND is_visible = 1 AND is_read = 0"
        : "SELECT COUNT(*) as unread FROM notifications WHERE user_id = ? AND service_key != 'system' AND is_visible = 1 AND is_read = 0";
    portalDb.get(query, [userId], (err, row) => {
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
    const swVersion = String(req.body.swVersion || '').slice(0, 40);
    const contentEncoding = resolveContentEncoding(req.body.supportedEncodings);
    const subscription = req.body.subscription;
    const deviceType = isMobileUserAgent(req.body.deviceType, rawUserAgent) ? 'mobile' : 'desktop';

    if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth || !isAllowedWebPushEndpoint(subscription.endpoint)) {
        return res.status(400).json({ success: false, message: '유효하지 않은 구독 정보입니다.' });
    }

    const { endpoint, keys } = subscription;
    const browserName = detectBrowserName(rawUserAgent, endpoint);
    const vapidFingerprint = getVapidKeyFingerprint();

    const upsertSql = `
        INSERT INTO push_subscriptions
            (user_id, endpoint, keys_p256dh, keys_auth, vapid_key_fingerprint, content_encoding, sw_version,
             client_type, device_type, device_id, browser_name, user_agent, status, fail_count, last_error,
             last_verified_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, '', datetime('now', 'localtime'), datetime('now', 'localtime'))
        ON CONFLICT(endpoint) DO UPDATE SET
            user_id = excluded.user_id,
            keys_p256dh = excluded.keys_p256dh,
            keys_auth = excluded.keys_auth,
            vapid_key_fingerprint = excluded.vapid_key_fingerprint,
            content_encoding = excluded.content_encoding,
            sw_version = excluded.sw_version,
            client_type = excluded.client_type,
            device_type = excluded.device_type,
            device_id = excluded.device_id,
            browser_name = excluded.browser_name,
            user_agent = excluded.user_agent,
            status = 'active',
            fail_count = 0,
            last_error = '',
            last_verified_at = datetime('now', 'localtime'),
            updated_at = datetime('now', 'localtime')
        WHERE push_subscriptions.user_id = excluded.user_id
           OR push_subscriptions.keys_auth = excluded.keys_auth
           OR push_subscriptions.status IN ('expired', 'revoked')
    `;

    portalDb.run(
        upsertSql,
        [userId, endpoint, keys.p256dh, keys.auth, vapidFingerprint, contentEncoding, swVersion, clientType, deviceType, deviceId, browserName, rawUserAgent],
        function (err) {
            if (err) {
                console.error('[WebPush] 구독 토큰 저장 실패:', err.message);
                return res.status(500).json({ success: false, message: '구독 토큰 저장 실패' });
            }

            if (previousEndpoint && previousEndpoint !== endpoint) {
                portalDb.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, previousEndpoint]);
            }
            if (deviceId && deviceId !== 'unknown') {
                portalDb.run(
                    `DELETE FROM push_subscriptions
                     WHERE user_id = ? AND endpoint != ? AND device_id = ? AND client_type = ? AND browser_name = ?`,
                    [userId, endpoint, deviceId, clientType, browserName]
                );
            }

            console.log(`📥 [WebPush 등록] 계정=${userId}, 환경=${clientType}/${deviceType}, 브라우저=${browserName}, enc=${contentEncoding}`);
            recordPushDiagEvent({ kind: 'subscribe', userId, clientType, deviceType, browserName });

            res.json({
                success: true,
                browserName,
                clientType,
                contentEncoding,
                message: '푸시 알림 기기가 정상 등록되었습니다.'
            });
        }
    );
});

// 2-0. Service Worker 백그라운드 토큰 자동 회전 API (pushsubscriptionchange 전용)
router.post('/rotate', (req, res) => {
    const body = req.body || {};
    const oldEndpoint = String(body.oldEndpoint || '').trim();
    const oldAuth = String(body.oldAuth || '').trim();
    const newSub = body.newSubscription;
    const swVersion = String(body.swVersion || '').slice(0, 40);

    if (!oldEndpoint || !oldAuth || !newSub || !newSub.endpoint || !newSub.keys || !newSub.keys.p256dh || !newSub.keys.auth || !isAllowedWebPushEndpoint(newSub.endpoint)) {
        return res.status(400).json({ success: false, message: '유효하지 않은 토큰 회전 요청입니다.' });
    }

    portalDb.get(
        'SELECT id, user_id, keys_auth FROM push_subscriptions WHERE endpoint = ?',
        [oldEndpoint],
        (err, row) => {
            if (err || !row || row.keys_auth !== oldAuth) {
                return res.status(403).json({ success: false, message: '기존 구독 검증 실패' });
            }
            portalDb.run(
                `UPDATE push_subscriptions
                 SET endpoint = ?, keys_p256dh = ?, keys_auth = ?, vapid_key_fingerprint = ?,
                     sw_version = COALESCE(NULLIF(?, ''), sw_version),
                     status = 'active', fail_count = 0, last_error = '',
                     last_verified_at = datetime('now', 'localtime'),
                     updated_at = datetime('now', 'localtime')
                 WHERE id = ?`,
                [newSub.endpoint, newSub.keys.p256dh, newSub.keys.auth, getVapidKeyFingerprint(), swVersion, row.id],
                (uErr) => {
                    if (uErr) return res.status(500).json({ success: false, message: '토큰 회전 저장 실패' });
                    recordPushDiagEvent({ kind: 'subscribe', userId: row.user_id, clientType: 'sw-rotate', browserName: 'SW 자동갱신' });
                    res.json({ success: true });
                }
            );
        }
    );
});

// 2-1. 푸시 구독 해제 API
router.post('/unsubscribe', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const endpoint = String((req.body && req.body.endpoint) || '').trim();
    if (!endpoint) return res.json({ success: true });

    portalDb.run(
        `DELETE FROM push_subscriptions WHERE endpoint = ? AND (user_id = ? OR ? = 1)`,
        [endpoint, userId, isAdmin],
        () => res.json({ success: true, message: '푸시 구독이 해제되었습니다.' })
    );
});

// 2-2. 내 계정의 등록된 기기 구독 초기화 API
router.post('/reset-devices', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    portalDb.run('DELETE FROM push_subscriptions WHERE user_id = ?', [userId], function (err) {
        if (err) return res.status(500).json({ success: false, message: '기기 구독 초기화 실패' });
        const removed = this ? this.changes : 0;
        console.log(`🧹 [WebPush 기기 초기화] 계정=${userId}, 정리된 토큰=${removed}개`);
        res.json({ success: true, removed, message: '기존 등록 기기 정보를 깨끗이 초기화했습니다.' });
    });
});

// 3. 신규 표준 사용자 알림 설정 API (/prefs) + 레거시 호환 (/settings)
router.get('/prefs', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId));
    try {
        const data = await getUserPrefsNormalized(userId, isAdmin);
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(500).json({ success: false, message: '알림 설정 조회 실패' });
    }
});

router.put('/prefs', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    const { scope_key, enabled, channels, schedule } = req.body || {};
    if (!scope_key) return res.status(400).json({ success: false, message: 'scope_key가 필요합니다.' });
    try {
        await upsertUserPref(userId, String(scope_key), { enabled: enabled ? 1 : 0, channels, schedule });
        res.json({ success: true, message: '알림 설정이 저장되었습니다.' });
    } catch (e) {
        res.status(500).json({ success: false, message: '알림 설정 저장 실패' });
    }
});

router.get('/settings', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId));
    try {
        const settings = await getLegacySettingsObject(userId, isAdmin);
        res.json({ success: true, settings });
    } catch (e) {
        res.status(500).json({ success: false, message: '알림 설정 조회 실패' });
    }
});

router.post('/settings', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId));
    try {
        const cleanBriefingTimes = await saveLegacySettings(userId, isAdmin, req.body);
        if (newsDb && isAdmin) {
            newsDb.run(`
                INSERT INTO system_settings (key, value, updated_at)
                VALUES ('telegram_briefing_times', ?, datetime('now', '+9 hours'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            `, [JSON.stringify(cleanBriefingTimes)], () => {});
        }
        res.json({ success: true, message: '통합 알림 설정이 저장되었습니다.' });
    } catch (e) {
        console.error('[WebPush] 알림 설정 저장 실패:', e.message);
        res.status(500).json({ success: false, message: '알림 설정 저장 실패' });
    }
});

// 5. 알림 수신 내역 조회 API
router.get('/history', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const serviceFilter = String(req.query.service || '').trim();

    const baseWhere = isAdmin
        ? "(user_id = ? OR user_id = 'admin') AND is_visible = 1"
        : "user_id = ? AND service_key != 'system' AND is_visible = 1";
    const whereSql = serviceFilter ? `${baseWhere} AND service_key = ?` : baseWhere;
    const params = serviceFilter ? [userId, serviceFilter] : [userId];

    portalDb.get(
        `SELECT COUNT(*) as total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread FROM notifications WHERE ${whereSql}`,
        params,
        (cntErr, counts) => {
            if (cntErr) return res.status(500).json({ success: false, message: '알림 카운트 조회 실패' });

            portalDb.all(
                `SELECT id, user_id, service_key, event_type, service_key as type, severity,
                        title, body, icon, image_url, action_url as url, is_read, read_at, created_at
                 FROM notifications
                 WHERE ${whereSql}
                 ORDER BY id DESC LIMIT ? OFFSET ?`,
                [...params, limit, offset],
                (err, rows) => {
                    if (err) return res.status(500).json({ success: false, message: '알림 내역 조회 실패' });
                    res.json({
                        success: true,
                        history: rows || [],
                        unreadCount: counts ? (counts.unread || 0) : 0,
                        totalCount: counts ? (counts.total || 0) : 0,
                        limit,
                        offset
                    });
                }
            );
        }
    );
});

// 5-1. 전체/개별 알림 읽음 및 삭제 API
router.post('/history/read-all', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const query = isAdmin
        ? "UPDATE notifications SET is_read = 1, read_at = datetime('now', 'localtime') WHERE (user_id = ? OR user_id = 'admin') AND is_read = 0"
        : "UPDATE notifications SET is_read = 1, read_at = datetime('now', 'localtime') WHERE user_id = ? AND service_key != 'system' AND is_read = 0";
    portalDb.run(query, [userId], function (err) {
        if (err) return res.status(500).json({ success: false, message: '전체 읽음 처리 실패' });
        res.json({ success: true, message: '모든 알림을 읽음 처리했습니다.', updated: this.changes });
    });
});

router.post('/history/:id/read', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const query = isAdmin
        ? "UPDATE notifications SET is_read = 1, read_at = datetime('now', 'localtime') WHERE id = ? AND (user_id = ? OR user_id = 'admin')"
        : "UPDATE notifications SET is_read = 1, read_at = datetime('now', 'localtime') WHERE id = ? AND user_id = ? AND service_key != 'system'";
    portalDb.run(query, [req.params.id, userId], function (err) {
        if (err) return res.status(500).json({ success: false, message: '개별 읽음 처리 실패' });
        res.json({ success: true, changed: this ? this.changes : 0 });
    });
});

router.delete('/history/clear/all', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const query = isAdmin
        ? "DELETE FROM notifications WHERE user_id = ? OR user_id = 'admin'"
        : "DELETE FROM notifications WHERE user_id = ? AND service_key != 'system'";
    portalDb.run(query, [userId], (err) => {
        if (err) return res.status(500).json({ success: false, message: '전체 알림 삭제 실패' });
        res.json({ success: true, message: '모든 알림 내역이 삭제되었습니다.' });
    });
});

router.delete('/history/:id', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const query = isAdmin
        ? "DELETE FROM notifications WHERE id = ? AND (user_id = ? OR user_id = 'admin')"
        : "DELETE FROM notifications WHERE id = ? AND user_id = ? AND service_key != 'system'";
    portalDb.run(query, [req.params.id, userId], (err) => {
        if (err) return res.status(500).json({ success: false, message: '알림 삭제 실패' });
        res.json({ success: true, message: '알림이 삭제되었습니다.' });
    });
});

// 6. 테스트 푸시 즉시 발송 API
router.post('/test', authenticateToken, async (req, res) => {
    try {
        const result = await publishNotificationEvent({
            service_key: 'system',
            event_type: 'system.test',
            recipient_id: req.user.username || 'admin',
            title: '🔔 알림 연결 확인',
            body: '현재 기기로 실시간 웹 푸시 알림이 정상 연결되었습니다!',
            action_url: 'https://j-jg.cc/',
            severity: 'normal'
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: '테스트 알림 발송 실패: ' + e.message });
    }
});

// 7. 서비스 워커 푸시 수신/표시 ACK 로깅 API
const swAckRateMap = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of swAckRateMap.entries()) {
        if (now - entry.windowStart > 120 * 1000) swAckRateMap.delete(ip);
    }
}, 5 * 60 * 1000).unref();

router.post('/sw-ack', (req, res) => {
    const clientIp = getClientIp(req);
    const now = Date.now();
    const rate = swAckRateMap.get(clientIp);
    if (!rate || now - rate.windowStart > 60 * 1000) {
        swAckRateMap.set(clientIp, { count: 1, windowStart: now });
    } else {
        if (rate.count >= 30) return res.status(429).json({ success: false, message: '요청이 너무 많습니다.' });
        rate.count += 1;
    }

    const body = req.body || {};
    const status = String(body.status || 'shown').slice(0, 20).replace(/[\r\n]/g, ' ');
    const title = String(body.title || '-').slice(0, 120).replace(/[\r\n]/g, ' ');
    const tag = String(body.tag || '-').slice(0, 60).replace(/[\r\n]/g, ' ');
    const error = String(body.error || '').slice(0, 200).replace(/[\r\n]/g, ' ');

    recordPushDiagEvent({ kind: 'sw-ack', status, title, tag, error });
    if (status === 'error') {
        console.error(`❌ [SW-Push-ACK] 알림 표시 오류: title=${title}, error=${error || 'unknown'}`);
    } else {
        console.log(`📲 [SW-Push-ACK] 기기 알림 표시 완료 (${status}): title=${title}`);
    }
    res.json({ success: true });
});

// 8. 내부/외부 서비스 연동 표준 이벤트 발행(/events) 및 레거시 브로드캐스트(/broadcast)
async function handleInternalEventPublish(req, res) {
    const internalSecret = req.headers['x-internal-secret'];
    const isInternalValid =
        typeof INTERNAL_API_SECRET === 'string' &&
        INTERNAL_API_SECRET.length > 0 &&
        typeof internalSecret === 'string' &&
        internalSecret.length === INTERNAL_API_SECRET.length &&
        crypto.timingSafeEqual(Buffer.from(internalSecret), Buffer.from(INTERNAL_API_SECRET));

    let isAdminTokenValid = false;
    const authHeader = req.headers['authorization'];
    const rawToken = (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null) || (req.cookies && req.cookies.portal_token);
    if (!isInternalValid && rawToken && !revokedTokens.has(rawToken)) {
        try {
            const decoded = jwt.verify(rawToken, JWT_SECRET, { algorithms: ['HS256'] });
            if (decoded && decoded.username && !decoded.purpose && (decoded.role === 'admin' || ADMIN_USERS.has(decoded.username))) {
                isAdminTokenValid = true;
            }
        } catch (err) {}
    }

    if (!isInternalValid && !isAdminTokenValid) {
        return res.status(401).json({ success: false, message: '알림 발송 권한이 필요합니다.' });
    }

    try {
        const body = req.body || {};
        const result = (body.service_key && body.event_type)
            ? await publishNotificationEvent(body)
            : await sendUnifiedPushNotification(body);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: '알림 이벤트 발행 실패' });
    }
}

router.post('/events', handleInternalEventPublish);
router.post('/broadcast', handleInternalEventPublish);

module.exports = router;
