/**
 * ==============================================================================
 * 🔔 JG 통합 웹 푸시 서비스 파사드 (push.service.js)
 * ------------------------------------------------------------------------------
 * - 신규 중앙 알림 허브(notification/hub.service.js)로 위임하면서
 *   기존 호출자(sendUnifiedPushNotification 등)와의 100% 하위 호환 유지
 * ==============================================================================
 */

const { portalDb } = require('./db');
const { detectBrowserName } = require('./notification/migration.service');
const {
    VAPID_PUBLIC_KEY,
    getVapidKeyFingerprint,
    recordPushDiagEvent,
    getRecentPushDiagEvents
} = require('./notification/webpush.dispatcher');
const {
    sanitizePushText,
    mapLegacyTypeToEvent,
    publishNotificationEvent
} = require('./notification/hub.service');

function saveNotificationHistory({ userId = 'admin', type = 'general', title, body, icon, url = 'https://j-jg.cc/' }, callback) {
    const mapped = mapLegacyTypeToEvent(type);
    const sql = `
        INSERT INTO notifications (user_id, service_key, event_type, severity, title, body, icon, action_url, is_visible, created_at)
        VALUES (?, ?, ?, 'normal', ?, ?, ?, ?, 1, datetime('now', 'localtime'))
    `;
    portalDb.run(
        sql,
        [userId, mapped.service_key, mapped.event_type, title || '알림', body || '', icon || '🔔', url],
        function (err) {
            if (err) console.error('[NotifHub] 알림 내역 DB 저장 실패:', err.message);
            if (typeof callback === 'function') callback(this ? this.lastID : null);
        }
    );
}

function sendUnifiedPushNotification({
    title, body, url, type = 'general', subtype = null, tag,
    userId = null, excludeUserId = null, adminOnly = false,
    image = null, icon = null, badge = null, saveHistory = null,
    dedupKey = null, meta = null
}) {
    const mapped = mapLegacyTypeToEvent(type, subtype);
    return publishNotificationEvent({
        service_key: mapped.service_key,
        event_type: mapped.event_type,
        recipient_id: adminOnly ? 'role:admin' : (userId || 'role:all'),
        exclude_user_id: excludeUserId,
        title,
        body,
        action_url: url,
        tag,
        dedup_key: dedupKey,
        save_history: saveHistory,
        icon,
        image,
        meta: meta || (badge ? { badge } : {})
    });
}

module.exports = {
    VAPID_PUBLIC_KEY,
    getVapidKeyFingerprint,
    detectBrowserName,
    recordPushDiagEvent,
    getRecentPushDiagEvents,
    saveNotificationHistory,
    sanitizePushText,
    sendUnifiedPushNotification,
    publishNotificationEvent
};
