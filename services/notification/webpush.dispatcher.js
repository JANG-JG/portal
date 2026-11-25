/**
 * ==============================================================================
 * 📲 JG 통합 알림 허브 WebPush 디스패처 (webpush.dispatcher.js)
 * ------------------------------------------------------------------------------
 * - aes128gcm 표준 암호화 명시 (삼성 인터넷 · 크롬 완벽 호환)
 * - HTTP 상태코드(201/404/410/429) 기반 구독 상태 전이(active/degraded/expired)
 * - [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const crypto = require('crypto');
const webPush = require('web-push');
const { portalDb } = require('../db');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (process.env.EMAIL_USER ? `mailto:${process.env.EMAIL_USER}` : 'mailto:admin@j-jg.cc');

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
    console.warn('⚠️ [WebPush] VAPID 키가 환경변수에 설정되지 않았습니다.');
}

function getVapidKeyFingerprint() {
    if (!VAPID_PUBLIC_KEY) return '';
    return crypto.createHash('sha256').update(VAPID_PUBLIC_KEY).digest('hex').slice(0, 16);
}

const kstDiagFormatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
});

const recentPushEvents = [];
function recordPushDiagEvent(evt) {
    recentPushEvents.unshift(Object.assign({
        timestamp: kstDiagFormatter.format(new Date())
    }, evt));
    if (recentPushEvents.length > 40) recentPushEvents.length = 40;
}

function getRecentPushDiagEvents() {
    return recentPushEvents.slice();
}

function dbRun(sql, params = []) {
    return new Promise((resolve) => {
        portalDb.run(sql, params, function (err) {
            if (err) console.error('⚠️ [WebPush DB]', err.message);
            resolve(this);
        });
    });
}

const ALLOWED_PUSH_HOST_SUFFIXES = [
    '.googleapis.com',
    'fcm.googleapis.com',
    '.push.services.mozilla.com',
    '.push.apple.com',
    '.notify.windows.com'
];

function isAllowedWebPushEndpoint(rawEndpoint) {
    if (!rawEndpoint || typeof rawEndpoint !== 'string' || rawEndpoint.length > 2048) return false;
    try {
        const u = new URL(rawEndpoint.trim());
        if (u.protocol !== 'https:' || u.username || u.password) return false;
        if (u.port && u.port !== '443') return false;
        const host = u.hostname.toLowerCase();
        if (!host || host === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return false;
        if (host.endsWith('.google.com') && (u.pathname.startsWith('/fcm/') || u.pathname.startsWith('/gcm/'))) return true;
        return ALLOWED_PUSH_HOST_SUFFIXES.some((sfx) => (sfx.startsWith('.') ? host.endsWith(sfx) : host === sfx));
    } catch (_) {
        return false;
    }
}

async function dispatchWebPushToSubscriptions(subscriptions, payloadObj, { severity = 'normal', ttl = 86400 } = {}) {
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        return { targetCount: 0, successCount: 0, failCount: 0, results: [] };
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        return { targetCount: subscriptions.length, successCount: 0, failCount: subscriptions.length, results: [] };
    }

    const payload = JSON.stringify(payloadObj);
    const urgency = (severity === 'high' || severity === 'critical') ? 'high' : 'normal';
    let successCount = 0;
    let failCount = 0;

    const tasks = subscriptions.map(async (subRow) => {
        if (!isAllowedWebPushEndpoint(subRow.endpoint)) {
            failCount += 1;
            return { endpoint: subRow.endpoint, userId: subRow.user_id, ok: false, statusCode: 0, error: '차단된 푸시 엔드포인트 도메인' };
        }
        const encoding = subRow.content_encoding === 'aesgcm' ? 'aesgcm' : 'aes128gcm';
        const pushOptions = {
            TTL: ttl,
            headers: { Urgency: urgency },
            contentEncoding: encoding
        };
        const sub = {
            endpoint: subRow.endpoint,
            keys: { p256dh: subRow.keys_p256dh, auth: subRow.keys_auth }
        };

        try {
            const res = await webPush.sendNotification(sub, payload, pushOptions);
            const code = (res && res.statusCode) ? res.statusCode : 201;
            successCount += 1;
            await dbRun(
                `UPDATE push_subscriptions
                 SET status = 'active', fail_count = 0, last_http_code = ?, last_error = '',
                     last_success_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
                 WHERE endpoint = ?`,
                [code, subRow.endpoint]
            );
            return { endpoint: subRow.endpoint, userId: subRow.user_id, ok: true, statusCode: code };
        } catch (pErr) {
            failCount += 1;
            const code = pErr && pErr.statusCode ? Number(pErr.statusCode) : 0;
            const errMsg = `HTTP ${code}: ${String((pErr && (pErr.body || pErr.message)) || '발송 오류').slice(0, 120)}`;
            console.error(`❌ [WebPush 발송 오류] (${subRow.user_id}, ${subRow.browser_name || '-'}):`, errMsg);

            const isExpired = (code === 404 || code === 410 || code === 401 || code === 403);
            if (isExpired) {
                await dbRun(
                    `UPDATE push_subscriptions
                     SET status = 'expired', fail_count = fail_count + 1, last_http_code = ?,
                         last_error = ?, last_failure_at = datetime('now', 'localtime')
                     WHERE endpoint = ?`,
                    [code, errMsg, subRow.endpoint]
                );
            } else {
                await dbRun(
                    `UPDATE push_subscriptions
                     SET status = CASE WHEN fail_count + 1 >= 3 THEN 'degraded' ELSE status END,
                         fail_count = fail_count + 1, last_http_code = ?,
                         last_error = ?, last_failure_at = datetime('now', 'localtime')
                     WHERE endpoint = ?`,
                    [code, errMsg, subRow.endpoint]
                );
            }
            return { endpoint: subRow.endpoint, userId: subRow.user_id, ok: false, statusCode: code, error: errMsg };
        }
    });

    const results = await Promise.all(tasks);
    return { targetCount: subscriptions.length, successCount, failCount, results };
}

module.exports = {
    VAPID_PUBLIC_KEY,
    getVapidKeyFingerprint,
    isAllowedWebPushEndpoint,
    recordPushDiagEvent,
    getRecentPushDiagEvents,
    dispatchWebPushToSubscriptions
};
