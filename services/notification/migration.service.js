/**
 * ==============================================================================
 * 📦 JG 통합 알림 허브 무손실 데이터 마이그레이션 모듈
 * (portal/services/notification/migration.service.js)
 * ------------------------------------------------------------------------------
 * - health.db의 push_subscriptions, notification_settings, notification_history를
 *   portal.db 신규 표준 테이블로 1회성 무손실 이관
 * - [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

function dbGet(db, sql, params = []) {
    return new Promise((resolve) => {
        db.get(sql, params, (err, row) => resolve(err ? null : (row || null)));
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve) => {
        db.all(sql, params, (err, rows) => resolve(err || !Array.isArray(rows) ? [] : rows));
    });
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function detectBrowserName(userAgent = '', endpoint = '') {
    const ua = String(userAgent || '');
    const ep = String(endpoint || '');
    if (/SamsungBrowser/i.test(ua)) return '삼성 인터넷';
    if (/EdgA?\//i.test(ua)) return '엣지(Edge)';
    if (/Firefox|FxiOS/i.test(ua)) return '파이어폭스';
    if (ep.includes('push.apple.com') || (/iPhone|iPad|Macintosh/i.test(ua) && !/Chrome|CriOS|SamsungBrowser|Edg/i.test(ua))) {
        return '사파리(Safari)';
    }
    if (/Chrome|CriOS/i.test(ua)) return '크롬(Chrome)';
    return '기타 브라우저';
}

function mapLegacyType(legacyType) {
    const t = String(legacyType || 'general').toLowerCase();
    const table = {
        album: ['album', 'album.new_photo'],
        breaking: ['news', 'news.breaking'],
        weather: ['news', 'news.weather'],
        briefing: ['news', 'news.briefing'],
        asset: ['asset', 'asset.market_open'],
        economy: ['asset', 'asset.market_open'],
        finance: ['asset', 'asset.market_open'],
        stock: ['asset', 'asset.market_open'],
        blood_pressure: ['health', 'health.blood_pressure'],
        medication: ['health', 'health.medication'],
        hospital: ['health', 'health.hospital'],
        calendar: ['calendar', 'calendar.event'],
        dday: ['calendar', 'calendar.dday'],
        study: ['study', 'study.worksheet_completed'],
        test: ['system', 'system.test'],
        system: ['system', 'system.alert']
    };
    return table[t] || ['system', 'system.alert'];
}

function safeJsonArray(str, fallback) {
    try {
        const parsed = JSON.parse(str);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch (_) {
        return fallback;
    }
}

async function migratePushSubscriptions(healthDb, portalDb) {
    const rows = await dbAll(healthDb, 'SELECT * FROM push_subscriptions');
    if (rows.length === 0) return 0;

    let count = 0;
    for (const r of rows) {
        if (!r || !r.endpoint || !r.keys_p256dh || !r.keys_auth) continue;
        const browserName = r.browser_name || detectBrowserName(r.user_agent, r.endpoint);
        const clientType = r.client_type === 'pwa' ? 'pwa' : 'browser';
        const deviceType = ['mobile', 'tablet', 'desktop'].includes(r.device_type) ? r.device_type : 'mobile';

        await dbRun(
            portalDb,
            `INSERT OR IGNORE INTO push_subscriptions
             (user_id, endpoint, keys_p256dh, keys_auth, content_encoding, device_id, client_type, device_type, browser_name, user_agent, status, last_error, last_success_at, updated_at)
             VALUES (?, ?, ?, ?, 'aes128gcm', ?, ?, ?, ?, ?, 'active', ?, ?, COALESCE(?, datetime('now', 'localtime')))`,
            [
                r.user_id || 'admin',
                r.endpoint,
                r.keys_p256dh,
                r.keys_auth,
                r.device_id || '',
                clientType,
                deviceType,
                browserName,
                r.user_agent || '',
                r.last_error || '',
                r.last_success_at || null,
                r.updated_at || null
            ]
        );
        count += 1;
    }
    return count;
}

async function migrateNotificationSettings(healthDb, portalDb) {
    const rows = await dbAll(healthDb, 'SELECT * FROM notification_settings');
    if (rows.length === 0) return 0;

    let count = 0;
    for (const s of rows) {
        if (!s || !s.user_id) continue;
        const uid = s.user_id;

        const entries = [
            { scope: 'global', enabled: s.enabled !== 0 ? 1 : 0, schedule: null },
            { scope: 'album', enabled: s.album_push_enabled !== 0 ? 1 : 0, schedule: null },
            { scope: 'album.new_photo', enabled: s.album_new_photo_enabled !== 0 ? 1 : 0, schedule: null },
            { scope: 'album.comment', enabled: s.album_comment_enabled !== 0 ? 1 : 0, schedule: null },
            { scope: 'album.mention', enabled: s.album_mention_enabled !== 0 ? 1 : 0, schedule: null },
            { scope: 'health.hospital', enabled: s.hospital_push_enabled ? 1 : 0, schedule: null },
            {
                scope: 'health.medication',
                enabled: s.enabled !== 0 ? 1 : 0,
                schedule: JSON.stringify({
                    weekday_times: safeJsonArray(s.weekday_med_times, ['08:00', '19:00']),
                    weekend_times: safeJsonArray(s.weekend_med_times, ['09:00', '19:30'])
                })
            },
            {
                scope: 'health.blood_pressure',
                enabled: s.bp_reminder_enabled ? 1 : 0,
                schedule: JSON.stringify({
                    reminder_time: s.bp_reminder_time || '21:00',
                    weekday_times: safeJsonArray(s.weekday_bp_times, ['07:30', '21:30']),
                    weekend_times: safeJsonArray(s.weekend_bp_times, ['08:30', '22:00'])
                })
            },
            { scope: 'news.breaking', enabled: s.breaking_news_enabled ? 1 : 0, schedule: null },
            {
                scope: 'news.weather',
                enabled: s.weather_morning_enabled ? 1 : 0,
                schedule: JSON.stringify({ time: s.weather_morning_time || '07:00' })
            },
            {
                scope: 'news.briefing',
                enabled: 1,
                schedule: JSON.stringify({ times: safeJsonArray(s.telegram_briefing_times, ['07:30']) })
            },
            { scope: 'asset', enabled: s.asset_report_enabled ? 1 : 0, schedule: null },
            { scope: 'asset.market_open', enabled: s.asset_open_enabled ? 1 : 0, schedule: null },
            { scope: 'asset.market_close', enabled: s.asset_close_enabled ? 1 : 0, schedule: null },
            { scope: 'system', enabled: s.system_alert_enabled ? 1 : 0, schedule: null }
        ];

        for (const item of entries) {
            await dbRun(
                portalDb,
                `INSERT OR IGNORE INTO user_notification_prefs (user_id, scope_key, enabled, schedule_json)
                 VALUES (?, ?, ?, ?)`,
                [uid, item.scope, item.enabled, item.schedule]
            );
        }
        count += 1;
    }
    return count;
}

async function migrateNotificationHistory(healthDb, portalDb) {
    const rows = await dbAll(healthDb, 'SELECT * FROM notification_history ORDER BY id ASC');
    if (rows.length === 0) return 0;

    const existing = await dbGet(portalDb, 'SELECT COUNT(*) as cnt FROM notifications');
    if (existing && existing.cnt > 0) return 0;

    let count = 0;
    for (const h of rows) {
        if (!h) continue;
        const [serviceKey, eventType] = mapLegacyType(h.type);
        await dbRun(
            portalDb,
            `INSERT OR IGNORE INTO notifications
             (id, user_id, service_key, event_type, severity, title, body, icon, action_url, channels_dispatched, is_visible, is_read, created_at)
             VALUES (?, ?, ?, ?, 'normal', ?, ?, ?, ?, '["in_app","webpush"]', 1, ?, COALESCE(?, datetime('now', 'localtime')))`,
            [
                h.id,
                h.user_id || 'admin',
                serviceKey,
                eventType,
                h.title || '알림',
                h.body || '',
                h.icon || '🔔',
                h.url || 'https://j-jg.cc/',
                h.is_read ? 1 : 0,
                h.created_at || null
            ]
        );
        count += 1;
    }
    return count;
}

async function migrateNotificationDataFromHealthDb(healthDb, portalDb) {
    if (!healthDb || !portalDb) return;

    try {
        const flag = await dbGet(portalDb, "SELECT value FROM system_configs WHERE key = 'notif_hub_migrated_v1'");
        if (flag && flag.value === '1') return;

        const subCnt = await migratePushSubscriptions(healthDb, portalDb);
        const setCnt = await migrateNotificationSettings(healthDb, portalDb);
        const histCnt = await migrateNotificationHistory(healthDb, portalDb);

        await dbRun(
            portalDb,
            `INSERT OR REPLACE INTO system_configs (key, value) VALUES ('notif_hub_migrated_v1', '1')`
        );

        console.log(`📦 [알림 허브 마이그레이션 완료] 구독 ${subCnt}건, 설정 ${setCnt}명, 내역 ${histCnt}건 이관`);
    } catch (err) {
        console.error('⚠️ [알림 허브 마이그레이션 오류]:', err.message);
    }
}

module.exports = {
    detectBrowserName,
    mapLegacyType,
    migrateNotificationDataFromHealthDb
};
