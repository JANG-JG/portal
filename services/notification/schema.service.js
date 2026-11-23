/**
 * ==============================================================================
 * 🔔 JG 통합 알림 허브 SQLite 표준 스키마 및 초기 시드 모듈
 * (portal/services/notification/schema.service.js)
 * ------------------------------------------------------------------------------
 * - portal.db 내 알림 허브 5대 표준 테이블 및 인덱스 생성
 * - 서비스별 수신 범위(scope_policy), 텔레그램 3모드(messenger_mode), 아이콘 시드
 * - [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const DEFAULT_SERVICES = [
    {
        service_key: 'health',
        display_name: '건강 관리 (약·혈압·병원)',
        scope_policy: 'family_opt_in',
        messenger_mode: 'both',
        icon_emoji: '💊',
        icon_path: '/icons/notif/health-192.png',
        is_active: 1,
        sort_order: 10
    },
    {
        service_key: 'album',
        display_name: '가족 앨범',
        scope_policy: 'family_default_on',
        messenger_mode: 'off',
        icon_emoji: '📸',
        icon_path: '/icons/notif/album-192.png',
        is_active: 1,
        sort_order: 20
    },
    {
        service_key: 'study',
        display_name: '어린이 학습실',
        scope_policy: 'family_opt_in',
        messenger_mode: 'both',
        icon_emoji: '🎒',
        icon_path: '/icons/notif/study-192.png',
        is_active: 1,
        sort_order: 30
    },
    {
        service_key: 'calendar',
        display_name: '일정 & 생활 D-Day',
        scope_policy: 'family_default_on',
        messenger_mode: 'fallback',
        icon_emoji: '📅',
        icon_path: '/icons/notif/calendar-192.png',
        is_active: 1,
        sort_order: 40
    },
    {
        service_key: 'news',
        display_name: '뉴스·날씨 브리핑',
        scope_policy: 'family_opt_in',
        messenger_mode: 'fallback',
        icon_emoji: '🌤️',
        icon_path: '/icons/notif/news-192.png',
        is_active: 1,
        sort_order: 50
    },
    {
        service_key: 'asset',
        display_name: '자산·증시 리포트',
        scope_policy: 'admin_only',
        messenger_mode: 'fallback',
        icon_emoji: '💰',
        icon_path: '/icons/notif/asset-192.png',
        is_active: 1,
        sort_order: 60
    },
    {
        service_key: 'system',
        display_name: '시스템·서버 관리',
        scope_policy: 'admin_only',
        messenger_mode: 'both',
        icon_emoji: '🖥️',
        icon_path: '/icons/notif/system-192.png',
        is_active: 1,
        sort_order: 70
    }
];

const DEFAULT_RULES = [
    // 건강 관리
    { event_type: 'health.medication', service_key: 'health', display_name: '정기 약 복용 알림', default_severity: 'high', default_channels: '["in_app","webpush","telegram"]', default_enabled_admin: 1, default_enabled_family: 1, save_in_app: 1, dedup_window_sec: 300 },
    { event_type: 'health.med_due', service_key: 'health', display_name: '가족 약 복용 시간 알림', default_severity: 'high', default_channels: '["in_app","webpush","telegram"]', default_enabled_admin: 1, default_enabled_family: 1, save_in_app: 1, dedup_window_sec: 300 },
    { event_type: 'health.med_missed', service_key: 'health', display_name: '약 미복용 리마인드', default_severity: 'normal', default_channels: '["in_app","webpush","telegram"]', default_enabled_admin: 1, default_enabled_family: 1, save_in_app: 1, dedup_window_sec: 1800 },
    { event_type: 'health.med_shared_done', service_key: 'health', display_name: '가족 약 복용 완료 공유', default_severity: 'low', default_channels: '["in_app","webpush"]', default_enabled_admin: 1, default_enabled_family: 1, save_in_app: 1, dedup_window_sec: 60 },
    { event_type: 'health.blood_pressure', service_key: 'health', display_name: '혈압 측정 시간 & 리마인드', default_severity: 'normal', default_channels: '["in_app","webpush","telegram"]', default_enabled_admin: 1, default_enabled_family: 0, save_in_app: 1, dedup_window_sec: 300 },
    { event_type: 'health.hospital', service_key: 'health', display_name: '병원 진료 예약 오픈 알림', default_severity: 'high', default_channels: '["in_app","webpush","telegram"]', default_enabled_admin: 1, default_enabled_family: 0, save_in_app: 1, dedup_window_sec: 3600 },

    // 가족 앨범
    { event_type: 'album.new_photo', service_key: 'album', display_name: '새 사진 등록 알림', default_severity: 'normal', default_channels: '["in_app","webpush"]', default_enabled_admin: 1, default_enabled_family: 1, save_in_app: 1, dedup_window_sec: 60 },
    { event_type: 'album.comment', service_key: 'album', display_name: '사진 댓글 알림', default_severity: 'normal', default_channels: '["in_app","webpush"]', default_enabled_admin: 1, default_enabled_family: 1, save_in_app: 1, dedup_window_sec: 30 },
    { event_type: 'album.mention', service_key: 'album', display_name: '가족 멘션(@) 알림', default_severity: 'high', default_channels: '["in_app","webpush"]', default_enabled_admin: 1, default_enabled_family: 1, save_in_app: 1, dedup_window_sec: 30 },

    // 어린이 학습실
    { event_type: 'study.worksheet_completed', service_key: 'study', display_name: '학습지 완료 알림', default_severity: 'normal', default_channels: '["in_app","webpush","telegram"]', default_enabled_admin: 1, default_enabled_family: 1, save_in_app: 1, dedup_window_sec: 60 },
    { event_type: 'study.egg_hatched', service_key: 'study', display_name: '도장판 10칸 & 포켓몬 알 부화', default_severity: 'high', default_channels: '["in_app","webpush","telegram"]', default_enabled_admin: 1, default_enabled_family: 1, save_in_app: 1, dedup_window_sec: 60 },

    // 일정 & 생활 D-Day
    { event_type: 'calendar.event', service_key: 'calendar', display_name: '캘린더 일정 알림', default_severity: 'normal', default_channels: '["in_app","webpush"]', default_enabled_admin: 1, default_enabled_family: 1, save_in_app: 1, dedup_window_sec: 300 },
    { event_type: 'calendar.dday', service_key: 'calendar', display_name: '생활 위키 D-Day 알림', default_severity: 'normal', default_channels: '["in_app","webpush"]', default_enabled_admin: 1, default_enabled_family: 1, save_in_app: 1, dedup_window_sec: 3600 },

    // 뉴스·날씨
    { event_type: 'news.breaking', service_key: 'news', display_name: '실시간 주요 속보', default_severity: 'high', default_channels: '["webpush"]', default_enabled_admin: 1, default_enabled_family: 0, save_in_app: 0, dedup_window_sec: 600 },
    { event_type: 'news.weather', service_key: 'news', display_name: '아침 날씨 & 우산 알림', default_severity: 'normal', default_channels: '["in_app","webpush"]', default_enabled_admin: 1, default_enabled_family: 0, save_in_app: 1, dedup_window_sec: 3600 },
    { event_type: 'news.briefing', service_key: 'news', display_name: '정기 뉴스 브리핑', default_severity: 'normal', default_channels: '["in_app","webpush","telegram"]', default_enabled_admin: 1, default_enabled_family: 0, save_in_app: 1, dedup_window_sec: 1800 },

    // 자산·증시 (관리자 전용)
    { event_type: 'asset.market_open', service_key: 'asset', display_name: '국내 증시 개장 리포트', default_severity: 'normal', default_channels: '["in_app","webpush"]', default_enabled_admin: 1, default_enabled_family: 0, save_in_app: 1, dedup_window_sec: 3600 },
    { event_type: 'asset.market_close', service_key: 'asset', display_name: '국내 증시 마감 리포트', default_severity: 'normal', default_channels: '["in_app","webpush"]', default_enabled_admin: 1, default_enabled_family: 0, save_in_app: 1, dedup_window_sec: 3600 },

    // 시스템·서버
    { event_type: 'system.alert', service_key: 'system', display_name: '서버·프로세스 상태 경보', default_severity: 'critical', default_channels: '["in_app","webpush","telegram"]', default_enabled_admin: 1, default_enabled_family: 0, save_in_app: 1, dedup_window_sec: 300 },
    { event_type: 'system.test', service_key: 'system', display_name: '푸시 연결 점검 테스트', default_severity: 'normal', default_channels: '["in_app","webpush"]', default_enabled_admin: 1, default_enabled_family: 1, save_in_app: 1, dedup_window_sec: 0 }
];

function runSql(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

async function initNotificationSchema(portalDb) {
    if (!portalDb) return;

    await runSql(portalDb, `
        CREATE TABLE IF NOT EXISTS notification_services (
            service_key TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            scope_policy TEXT NOT NULL DEFAULT 'admin_only'
                CHECK(scope_policy IN ('admin_only', 'family_opt_in', 'family_default_on')),
            messenger_mode TEXT NOT NULL DEFAULT 'fallback'
                CHECK(messenger_mode IN ('off', 'fallback', 'both')),
            icon_emoji TEXT NOT NULL DEFAULT '🔔',
            icon_path TEXT NOT NULL DEFAULT '/icons/notif/default-192.png',
            is_active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 100,
            created_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    `);

    await runSql(portalDb, `
        CREATE TABLE IF NOT EXISTS notification_rules (
            event_type TEXT PRIMARY KEY,
            service_key TEXT NOT NULL REFERENCES notification_services(service_key),
            display_name TEXT NOT NULL,
            default_severity TEXT NOT NULL DEFAULT 'normal'
                CHECK(default_severity IN ('low', 'normal', 'high', 'critical')),
            default_channels TEXT NOT NULL DEFAULT '["in_app","webpush"]',
            default_enabled_admin INTEGER NOT NULL DEFAULT 1,
            default_enabled_family INTEGER NOT NULL DEFAULT 0,
            save_in_app INTEGER NOT NULL DEFAULT 1,
            dedup_window_sec INTEGER NOT NULL DEFAULT 300,
            ttl_sec INTEGER NOT NULL DEFAULT 86400,
            is_active INTEGER NOT NULL DEFAULT 1,
            updated_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    `);

    await runSql(portalDb, `
        CREATE TABLE IF NOT EXISTS user_notification_prefs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            scope_key TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            channels_json TEXT DEFAULT NULL,
            schedule_json TEXT DEFAULT NULL,
            updated_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
            UNIQUE(user_id, scope_key)
        )
    `);
    await runSql(portalDb, `CREATE INDEX IF NOT EXISTS idx_user_notif_prefs_uid ON user_notification_prefs(user_id)`);

    await runSql(portalDb, `
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            service_key TEXT NOT NULL DEFAULT 'system',
            event_type TEXT NOT NULL DEFAULT 'system.alert',
            severity TEXT NOT NULL DEFAULT 'normal',
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            icon TEXT NOT NULL DEFAULT '🔔',
            image_url TEXT DEFAULT NULL,
            action_url TEXT NOT NULL DEFAULT 'https://j-jg.cc/',
            dedup_key TEXT DEFAULT NULL,
            channels_dispatched TEXT DEFAULT '[]',
            is_visible INTEGER NOT NULL DEFAULT 1,
            is_read INTEGER NOT NULL DEFAULT 0,
            read_at DATETIME DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    `);
    await runSql(portalDb, `CREATE INDEX IF NOT EXISTS idx_notifications_inbox ON notifications(user_id, is_visible, is_read, id DESC)`);
    await runSql(portalDb, `CREATE INDEX IF NOT EXISTS idx_notifications_dedup ON notifications(user_id, dedup_key, created_at DESC)`);

    await runSql(portalDb, `
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            endpoint TEXT NOT NULL UNIQUE,
            keys_p256dh TEXT NOT NULL,
            keys_auth TEXT NOT NULL,
            vapid_key_fingerprint TEXT DEFAULT '',
            content_encoding TEXT NOT NULL DEFAULT 'aes128gcm',
            sw_version TEXT DEFAULT '',
            device_id TEXT NOT NULL DEFAULT '',
            client_type TEXT NOT NULL DEFAULT 'browser' CHECK(client_type IN ('browser', 'pwa')),
            device_type TEXT NOT NULL DEFAULT 'mobile' CHECK(device_type IN ('mobile', 'tablet', 'desktop')),
            browser_name TEXT NOT NULL DEFAULT '기타 브라우저',
            user_agent TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'degraded', 'expired', 'revoked')),
            fail_count INTEGER NOT NULL DEFAULT 0,
            last_http_code INTEGER DEFAULT NULL,
            last_error TEXT DEFAULT '',
            last_success_at DATETIME DEFAULT NULL,
            last_failure_at DATETIME DEFAULT NULL,
            last_verified_at DATETIME DEFAULT (datetime('now', 'localtime')),
            created_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    `);
    await runSql(portalDb, `CREATE INDEX IF NOT EXISTS idx_push_subs_user_status ON push_subscriptions(user_id, status)`);
    await runSql(portalDb, `CREATE INDEX IF NOT EXISTS idx_push_subs_device ON push_subscriptions(user_id, device_id, client_type, browser_name)`);

    for (const svc of DEFAULT_SERVICES) {
        await runSql(
            portalDb,
            `INSERT OR IGNORE INTO notification_services
             (service_key, display_name, scope_policy, messenger_mode, icon_emoji, icon_path, is_active, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [svc.service_key, svc.display_name, svc.scope_policy, svc.messenger_mode, svc.icon_emoji, svc.icon_path, svc.is_active, svc.sort_order]
        );
    }

    for (const rule of DEFAULT_RULES) {
        await runSql(
            portalDb,
            `INSERT OR IGNORE INTO notification_rules
             (event_type, service_key, display_name, default_severity, default_channels, default_enabled_admin, default_enabled_family, save_in_app, dedup_window_sec)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                rule.event_type, rule.service_key, rule.display_name, rule.default_severity,
                rule.default_channels, rule.default_enabled_admin, rule.default_enabled_family,
                rule.save_in_app, rule.dedup_window_sec
            ]
        );
    }
}

module.exports = {
    DEFAULT_SERVICES,
    DEFAULT_RULES,
    initNotificationSchema
};
