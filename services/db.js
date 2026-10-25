const sqlite3 = require('sqlite3').verbose();
const { BLOOD_DB_PATH, ASSET_DB_PATH, NEWS_DB_PATH, ADMIN_USERS } = require('../config/constants');

// 마스터 계정 DB 연결 (혈압 앱 health.db)
const db = new sqlite3.Database(BLOOD_DB_PATH, (err) => {
    if (err) console.error('❌ 혈압 DB 연결 실패:', err);
    else {
        console.log('✅ 마스터 계정 DB 로드 완료:', BLOOD_DB_PATH);
        db.serialize(() => {
            db.run('PRAGMA journal_mode = WAL;');
            db.run('PRAGMA synchronous = NORMAL;');
            db.run('PRAGMA busy_timeout = 5000;');
            db.run('PRAGMA temp_store = MEMORY;');

            // 🛡️ 통합 계정(RBAC) 및 가족 PIN/초기화 컬럼 마이그레이션 및 관리자 동적 로드
            db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'family'`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN allowed_services TEXT DEFAULT '["album","news"]'`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN pin TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN pin_reset_required INTEGER DEFAULT 1`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN invite_token TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN failed_pin_attempts INTEGER DEFAULT 0`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN locked_until DATETIME DEFAULT NULL`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN phone_hash TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN avatar_emoji TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN created_at DATETIME`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN last_login_at DATETIME`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN birthdate TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN is_registered INTEGER DEFAULT 1`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN admin_memo TEXT DEFAULT ''`, () => {});
            db.run(`UPDATE users SET role = 'admin', allowed_services = '["all"]', pin_reset_required = 0 WHERE rowid = 1 OR role IS NULL`, () => {
                db.all(`SELECT username FROM users WHERE role = 'admin' OR rowid = 1`, (uErr, uRows) => {
                    if (!uErr && Array.isArray(uRows)) {
                        uRows.forEach(r => {
                            if (r && r.username) ADMIN_USERS.add(r.username);
                        });
                    }
                });
            });

            db.run(`CREATE TABLE IF NOT EXISTS login_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,
                ip TEXT,
                status TEXT,
                attempted_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS system_configs (
                key TEXT PRIMARY KEY,
                value TEXT
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS user_memos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT 'admin',
                title TEXT,
                content TEXT NOT NULL,
                category TEXT DEFAULT 'idea',
                color TEXT DEFAULT '#fef3c7',
                is_pinned INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT (datetime('now', 'localtime')),
                updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS calendar_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT 'admin',
                title TEXT NOT NULL,
                event_date TEXT NOT NULL,
                event_time TEXT DEFAULT '',
                category TEXT DEFAULT 'general',
                color TEXT DEFAULT '#4f46e5',
                memo TEXT DEFAULT '',
                is_completed INTEGER DEFAULT 0,
                is_all_day INTEGER DEFAULT 0,
                notify_timing TEXT DEFAULT 'exact',
                notify_repeat INTEGER DEFAULT 1,
                notify_sent_count INTEGER DEFAULT 0,
                last_notified_at DATETIME,
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);
            db.run(`ALTER TABLE calendar_events ADD COLUMN is_all_day INTEGER DEFAULT 0`, () => {});
            db.run(`ALTER TABLE calendar_events ADD COLUMN notify_timing TEXT DEFAULT 'exact'`, () => {});
            db.run(`ALTER TABLE calendar_events ADD COLUMN notify_repeat INTEGER DEFAULT 1`, () => {});
            db.run(`ALTER TABLE calendar_events ADD COLUMN notify_sent_count INTEGER DEFAULT 0`, () => {});
            db.run(`ALTER TABLE calendar_events ADD COLUMN last_notified_at DATETIME`, () => {});

            // 📅 캘린더 커스텀 범례/카테고리 관리 테이블
            db.run(`CREATE TABLE IF NOT EXISTS calendar_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT 'admin',
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`, () => {
                // 초기 기본 범례가 없으면 기본값 삽입
                db.get("SELECT COUNT(*) as count FROM calendar_categories", (cErr, cRow) => {
                    if (!cErr && cRow && cRow.count === 0) {
                        const defaultCats = [
                            ['admin', '업무', '#6366f1'],
                            ['admin', '개인', '#10b981'],
                            ['admin', '중요', '#f43f5e'],
                            ['admin', '모임', '#f59e0b'],
                            ['admin', '기타', '#0ea5e9']
                        ];
                        const stmt = db.prepare("INSERT INTO calendar_categories (user_id, name, color) VALUES (?, ?, ?)");
                        defaultCats.forEach(c => stmt.run(c));
                        stmt.finalize();
                    }
                });
            });
            db.run(`ALTER TABLE notification_settings ADD COLUMN asset_open_enabled INTEGER DEFAULT 1`, () => {});
            db.run(`ALTER TABLE notification_settings ADD COLUMN asset_close_enabled INTEGER DEFAULT 1`, () => {});
            db.run(`ALTER TABLE notification_settings ADD COLUMN telegram_briefing_times TEXT DEFAULT '["07:30"]'`, () => {});
            // 🔔 푸시 알림 중복 방지용 디바이스/클라이언트 메타데이터 컬럼
            db.run(`ALTER TABLE push_subscriptions ADD COLUMN client_type TEXT DEFAULT 'browser'`, () => {});
            db.run(`ALTER TABLE push_subscriptions ADD COLUMN device_type TEXT DEFAULT 'desktop'`, () => {});
            db.run(`ALTER TABLE push_subscriptions ADD COLUMN device_id TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE push_subscriptions ADD COLUMN user_agent TEXT DEFAULT ''`, () => {});
            // 7일 이상 미갱신된 오래된 과거 비표준 중복 토큰 안전 정리
            db.run(`DELETE FROM push_subscriptions WHERE updated_at < datetime('now', '-7 days')`, () => {});
            // 기기 식별자(device_id)가 없는 과거 레거시 브라우저 중복 토큰 안전 정리
            db.run(`DELETE FROM push_subscriptions WHERE (device_id = '' OR device_id IS NULL) AND client_type = 'browser'`, () => {});
            // 성능 인덱스 생성
            db.run(`CREATE INDEX IF NOT EXISTS idx_records_measured_at ON records (measured_at DESC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_notif_hist_user_created ON notification_history (user_id, created_at DESC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_notif_hist_unread ON notification_history (user_id, is_read)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_user_memos_user ON user_memos (user_id, is_pinned DESC, updated_at DESC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_cal_user_date ON calendar_events (user_id, event_date)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_login_logs_attempted_at ON login_logs (attempted_at DESC)`);
        });
    }
});

// 자산관리 DB 연결 (asset.db)
const assetDb = new sqlite3.Database(ASSET_DB_PATH, (err) => {
    if (err) console.error('❌ 자산 DB 연결 실패:', err);
    else {
        console.log('✅ 자산 DB 로드 완료:', ASSET_DB_PATH);
        assetDb.run('PRAGMA journal_mode = WAL;');
        assetDb.run('PRAGMA synchronous = NORMAL;');
        assetDb.run('PRAGMA busy_timeout = 5000;');
        assetDb.run('PRAGMA temp_store = MEMORY;');
    }
});

// 뉴스 대시보드 DB 연결 (briefing.db)
const newsDb = new sqlite3.Database(NEWS_DB_PATH, (err) => {
    if (err) console.error('❌ 뉴스 DB 연결 실패:', err);
    else {
        console.log('✅ 뉴스 DB 로드 완료:', NEWS_DB_PATH);
        newsDb.run('PRAGMA journal_mode = WAL;');
        newsDb.run('PRAGMA synchronous = NORMAL;');
        newsDb.run('PRAGMA busy_timeout = 5000;');
        newsDb.run('PRAGMA temp_store = MEMORY;');
    }
});

module.exports = {
    db,
    assetDb,
    newsDb
};
