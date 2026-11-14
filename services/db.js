const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { BLOOD_DB_PATH, ASSET_DB_PATH, NEWS_DB_PATH, ALBUM_DB_PATH, WIKI_DB_PATH, PORTAL_DB_PATH, ADMIN_USERS } = require('../config/constants');


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
            db.run('PRAGMA cache_size = -8000;');

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
            db.run(`ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN created_at DATETIME`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN last_login_at DATETIME`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN birthdate TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN is_registered INTEGER DEFAULT 1`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN admin_memo TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN weather_city TEXT DEFAULT 'Seoul'`, () => {});
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
            db.run(`ALTER TABLE calendar_events ADD COLUMN is_family INTEGER DEFAULT 0`, () => {});

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
                            ['admin', '가족', '#ec4899'],
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
            // 🔔 통합 알림 설정·내역·구독 표준 스키마 보장
            db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT 'admin',
                endpoint TEXT NOT NULL UNIQUE,
                keys_p256dh TEXT NOT NULL,
                keys_auth TEXT NOT NULL,
                client_type TEXT DEFAULT 'browser',
                device_type TEXT DEFAULT 'desktop',
                device_id TEXT DEFAULT '',
                browser_name TEXT DEFAULT '',
                user_agent TEXT DEFAULT '',
                last_success_at DATETIME DEFAULT NULL,
                last_error TEXT DEFAULT '',
                updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS notification_settings (
                user_id TEXT PRIMARY KEY,
                enabled INTEGER DEFAULT 1,
                album_push_enabled INTEGER DEFAULT 1,
                album_new_photo_enabled INTEGER DEFAULT 1,
                album_comment_enabled INTEGER DEFAULT 1,
                album_mention_enabled INTEGER DEFAULT 1,
                hospital_push_enabled INTEGER DEFAULT 1,
                breaking_news_enabled INTEGER DEFAULT 1,
                weather_morning_enabled INTEGER DEFAULT 1,
                weather_morning_time TEXT DEFAULT '07:00',
                asset_report_enabled INTEGER DEFAULT 1,
                asset_open_enabled INTEGER DEFAULT 1,
                asset_close_enabled INTEGER DEFAULT 1,
                bp_reminder_enabled INTEGER DEFAULT 1,
                bp_reminder_time TEXT DEFAULT '21:00',
                system_alert_enabled INTEGER DEFAULT 1,
                telegram_briefing_times TEXT DEFAULT '["07:30"]',
                weekday_med_times TEXT DEFAULT '["08:00","19:00"]',
                weekday_bp_times TEXT DEFAULT '["07:30","21:30"]',
                weekend_med_times TEXT DEFAULT '["09:00","19:30"]',
                weekend_bp_times TEXT DEFAULT '["08:30","22:00"]',
                updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS notification_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT 'admin',
                type TEXT DEFAULT 'general',
                title TEXT,
                body TEXT,
                icon TEXT,
                url TEXT,
                is_read INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);
            db.run(`ALTER TABLE notification_settings ADD COLUMN asset_open_enabled INTEGER DEFAULT 1`, () => {});
            db.run(`ALTER TABLE notification_settings ADD COLUMN asset_close_enabled INTEGER DEFAULT 1`, () => {});
            db.run(`ALTER TABLE notification_settings ADD COLUMN telegram_briefing_times TEXT DEFAULT '["07:30"]'`, () => {});
            db.run(`ALTER TABLE notification_settings ADD COLUMN album_push_enabled INTEGER DEFAULT 1`, () => {});
            db.run(`ALTER TABLE notification_settings ADD COLUMN album_new_photo_enabled INTEGER DEFAULT 1`, () => {});
            db.run(`ALTER TABLE notification_settings ADD COLUMN album_comment_enabled INTEGER DEFAULT 1`, () => {});
            db.run(`ALTER TABLE notification_settings ADD COLUMN album_mention_enabled INTEGER DEFAULT 1`, () => {});
            // 🔔 푸시 구독 기기 진단용 메타데이터 컬럼
            db.run(`ALTER TABLE push_subscriptions ADD COLUMN client_type TEXT DEFAULT 'browser'`, () => {});
            db.run(`ALTER TABLE push_subscriptions ADD COLUMN device_type TEXT DEFAULT 'desktop'`, () => {});
            db.run(`ALTER TABLE push_subscriptions ADD COLUMN device_id TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE push_subscriptions ADD COLUMN browser_name TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE push_subscriptions ADD COLUMN user_agent TEXT DEFAULT ''`, () => {});
            db.run(`ALTER TABLE push_subscriptions ADD COLUMN last_success_at DATETIME DEFAULT NULL`, () => {});
            db.run(`ALTER TABLE push_subscriptions ADD COLUMN last_error TEXT DEFAULT ''`, () => {});
            db.run(`CREATE TABLE IF NOT EXISTS bp_ocr_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT DEFAULT 'admin',
                status TEXT DEFAULT 'completed',
                systolic INTEGER,
                diastolic INTEGER,
                pulse INTEGER,
                duration_ms INTEGER DEFAULT 0,
                message TEXT,
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);
            // 성능 인덱스 생성
            db.run(`CREATE INDEX IF NOT EXISTS idx_records_measured_at ON records (measured_at DESC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_notif_hist_user_created ON notification_history (user_id, created_at DESC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_notif_hist_unread ON notification_history (user_id, is_read)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_user_memos_user ON user_memos (user_id, is_pinned DESC, updated_at DESC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_cal_user_date ON calendar_events (user_id, event_date)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_login_logs_attempted_at ON login_logs (attempted_at DESC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_bp_ocr_logs_created ON bp_ocr_logs (created_at DESC)`);
        });
    }
});

// 자산관리 DB 연결 (asset.db)
const assetDb = new sqlite3.Database(ASSET_DB_PATH, (err) => {
    if (err) console.error('❌ 자산 DB 연결 실패:', err);
    else {
        console.log('✅ 자산 DB 로드 완료:', ASSET_DB_PATH);
        assetDb.serialize(() => {
            assetDb.run('PRAGMA journal_mode = WAL;');
            assetDb.run('PRAGMA synchronous = NORMAL;');
            assetDb.run('PRAGMA busy_timeout = 5000;');
            assetDb.run('PRAGMA temp_store = MEMORY;');
            assetDb.run('PRAGMA cache_size = -8000;');
            assetDb.run(`CREATE TABLE IF NOT EXISTS ocr_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_type TEXT DEFAULT 'image_ocr',
                file_count INTEGER DEFAULT 1,
                parsed_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'completed',
                duration_ms INTEGER DEFAULT 0,
                summary_json TEXT,
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);
            assetDb.run(`CREATE INDEX IF NOT EXISTS idx_ocr_logs_date ON ocr_logs (created_at DESC)`);
        });
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
        newsDb.run('PRAGMA cache_size = -8000;');
    }
});

// 가족 사진첩 DB 연결 (album.db)
const albumDb = new sqlite3.Database(ALBUM_DB_PATH, (err) => {
    if (err) console.error('❌ 사진첩 DB 연결 실패:', err);
    else {
        console.log('✅ 사진첩 DB 로드 완료:', ALBUM_DB_PATH);
        albumDb.run('PRAGMA journal_mode = WAL;');
        albumDb.run('PRAGMA synchronous = NORMAL;');
        albumDb.run('PRAGMA busy_timeout = 5000;');
        albumDb.run('PRAGMA temp_store = MEMORY;');
        albumDb.run('PRAGMA cache_size = -8000;');
    }
});

// 가족 위키 DB 연결 (wiki.db - 안전 연결 및 온디맨드 폴백)
let wikiDb = null;
if (fs.existsSync(WIKI_DB_PATH)) {
    wikiDb = new sqlite3.Database(WIKI_DB_PATH, (err) => {
        if (err) console.error('❌ 가족 위키 DB 연결 실패:', err);
        else {
            console.log('✅ 가족 위키 DB 로드 완료:', WIKI_DB_PATH);
            wikiDb.run('PRAGMA journal_mode = WAL;');
            wikiDb.run('PRAGMA synchronous = NORMAL;');
            wikiDb.run('PRAGMA busy_timeout = 5000;');
        }
    });
} else {
    wikiDb = {
        all: (sql, params, cb) => {
            if (typeof params === 'function') { cb = params; params = []; }
            if (fs.existsSync(WIKI_DB_PATH)) {
                const realDb = new sqlite3.Database(WIKI_DB_PATH);
                realDb.run('PRAGMA busy_timeout = 5000;');
                return realDb.all(sql, params, (err, rows) => { realDb.close(); cb(err, rows); });
            }
            cb(null, []);
        },
        get: (sql, params, cb) => {
            if (typeof params === 'function') { cb = params; params = []; }
            if (fs.existsSync(WIKI_DB_PATH)) {
                const realDb = new sqlite3.Database(WIKI_DB_PATH);
                realDb.run('PRAGMA busy_timeout = 5000;');
                return realDb.get(sql, params, (err, row) => { realDb.close(); cb(err, row); });
            }
            cb(null, null);
        },
        run: (sql, params, cb) => {
            if (typeof params === 'function') { cb = params; params = []; }
            if (fs.existsSync(WIKI_DB_PATH)) {
                const realDb = new sqlite3.Database(WIKI_DB_PATH);
                realDb.serialize(() => {
                    realDb.run('PRAGMA journal_mode = WAL;');
                    realDb.run('PRAGMA synchronous = NORMAL;');
                    realDb.run('PRAGMA busy_timeout = 5000;');
                    realDb.run(sql, params, function(err) { realDb.close(); if (cb) cb.call(this, err); });
                });
                return;
            }
            if (cb) cb(new Error('WIKI_DB_NOT_FOUND'));
        }
    };
}

// 포털 전용 DB 연결 (portal.db - 메모, 캘린더, 시스템 설정 독립 분리)
const portalDb = new sqlite3.Database(PORTAL_DB_PATH, (err) => {

    if (err) console.error('❌ 포털 DB 연결 실패:', err);
    else {
        console.log('✅ 포털 DB 로드 완료:', PORTAL_DB_PATH);
        portalDb.serialize(() => {
            portalDb.run('PRAGMA journal_mode = WAL;');
            portalDb.run('PRAGMA synchronous = NORMAL;');
            portalDb.run('PRAGMA busy_timeout = 5000;');
            portalDb.run('PRAGMA temp_store = MEMORY;');
            portalDb.run('PRAGMA cache_size = -8000;');

            // 1. 메모 테이블
            portalDb.run(`CREATE TABLE IF NOT EXISTS user_memos (
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
            portalDb.run(`CREATE INDEX IF NOT EXISTS idx_user_memos_user ON user_memos (user_id, is_pinned DESC, updated_at DESC)`);

            // 2. 캘린더 일정 테이블
            portalDb.run(`CREATE TABLE IF NOT EXISTS calendar_events (
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
                is_family INTEGER DEFAULT 0,
                notify_timing TEXT DEFAULT 'exact',
                notify_repeat INTEGER DEFAULT 1,
                notify_sent_count INTEGER DEFAULT 0,
                last_notified_at DATETIME,
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);
            portalDb.run(`CREATE INDEX IF NOT EXISTS idx_cal_user_date ON calendar_events (user_id, event_date)`);

            // 3. 캘린더 커스텀 범례/카테고리 테이블
            portalDb.run(`CREATE TABLE IF NOT EXISTS calendar_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT 'admin',
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`, () => {
                portalDb.get("SELECT COUNT(*) as count FROM calendar_categories", (cErr, cRow) => {
                    if (!cErr && cRow && cRow.count === 0) {
                        const defaultCats = [
                            ['admin', '업무', '#6366f1'],
                            ['admin', '개인', '#10b981'],
                            ['admin', '가족', '#ec4899'],
                            ['admin', '중요', '#f43f5e'],
                            ['admin', '모임', '#f59e0b'],
                            ['admin', '기타', '#0ea5e9']
                        ];
                        const stmt = portalDb.prepare("INSERT INTO calendar_categories (user_id, name, color) VALUES (?, ?, ?)");
                        defaultCats.forEach(c => stmt.run(c));
                        stmt.finalize();
                    }
                });
            });

            // 4. 시스템 설정 테이블
            portalDb.run(`CREATE TABLE IF NOT EXISTS system_configs (
                key TEXT PRIMARY KEY,
                value TEXT
            )`);

            // 5. 어린이 적응형 학습실 테이블군 (2021년생 첫째 / 2022년생 둘째)
            portalDb.run(`CREATE TABLE IF NOT EXISTS study_profiles (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                birth_year INTEGER NOT NULL,
                avatar_emoji TEXT DEFAULT '🧒',
                target_reward TEXT DEFAULT '스티커 판 10칸 완성 선물 🎁',
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`, () => {
                portalDb.get("SELECT COUNT(*) as cnt FROM study_profiles", (err, row) => {
                    if (!err && row && row.cnt === 0) {
                        portalDb.run(
                            "INSERT OR IGNORE INTO study_profiles (id, display_name, birth_year, avatar_emoji, target_reward) VALUES (?, ?, ?, ?, ?)",
                            ['first', '첫째', 2021, '🦖', '공룡 스티커 10개 모으기!']
                        );
                        portalDb.run(
                            "INSERT OR IGNORE INTO study_profiles (id, display_name, birth_year, avatar_emoji, target_reward) VALUES (?, ?, ?, ?, ?)",
                            ['second', '둘째', 2022, '🐰', '토끼 스티커 10개 모으기!']
                        );
                    }
                });
                portalDb.run("ALTER TABLE study_profiles ADD COLUMN linked_username TEXT DEFAULT ''", () => {});
            });

            portalDb.run(`CREATE TABLE IF NOT EXISTS study_levels (
                child_id TEXT NOT NULL,
                subject TEXT NOT NULL CHECK(subject IN ('korean', 'math', 'english')),
                level INTEGER NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 5),
                updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
                PRIMARY KEY (child_id, subject)
            )`, () => {
                const seedSubjects = ['korean', 'math', 'english'];
                ['first', 'second'].forEach(cid => {
                    seedSubjects.forEach(subj => {
                        portalDb.run(
                            "INSERT OR IGNORE INTO study_levels (child_id, subject, level) VALUES (?, ?, 1)",
                            [cid, subj]
                        );
                    });
                });
            });

            portalDb.run(`CREATE TABLE IF NOT EXISTS study_stamps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                child_id TEXT NOT NULL,
                cycle_no INTEGER NOT NULL DEFAULT 1,
                source_type TEXT NOT NULL DEFAULT 'online',
                sheet_id INTEGER,
                note TEXT DEFAULT '',
                earned_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);
            portalDb.run(`CREATE INDEX IF NOT EXISTS idx_study_stamps_child_cycle ON study_stamps (child_id, cycle_no, earned_at DESC)`);

            portalDb.run(`CREATE TABLE IF NOT EXISTS study_sheets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                child_id TEXT NOT NULL,
                subject TEXT NOT NULL,
                level INTEGER NOT NULL DEFAULT 1,
                theme TEXT NOT NULL,
                title TEXT NOT NULL,
                source TEXT DEFAULT 'gemini',
                content_json TEXT NOT NULL,
                completed_at DATETIME,
                created_by TEXT DEFAULT 'web',
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);
            portalDb.run(`CREATE INDEX IF NOT EXISTS idx_study_sheets_child ON study_sheets (child_id, created_at DESC)`);

            portalDb.run(`CREATE TABLE IF NOT EXISTS study_level_tests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                child_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'in_progress',
                state_json TEXT NOT NULL,
                result_json TEXT DEFAULT '{}',
                started_at DATETIME DEFAULT (datetime('now', 'localtime')),
                completed_at DATETIME
            )`);

            portalDb.run(`CREATE TABLE IF NOT EXISTS study_daily_quota (
                quota_date TEXT PRIMARY KEY,
                gemini_calls INTEGER DEFAULT 0,
                fallback_calls INTEGER DEFAULT 0,
                daily_limit INTEGER DEFAULT 30,
                updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);

            // 6. 텔레그램 양방향 제어 화이트리스트 (AES-256-GCM 암호화 + HMAC 블라인드 인덱스)
            portalDb.run(`CREATE TABLE IF NOT EXISTS telegram_allowed_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id_enc TEXT NOT NULL,
                telegram_id_hash TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                portal_username TEXT NOT NULL DEFAULT 'upt0731',
                role TEXT NOT NULL DEFAULT 'family',
                enabled INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);

            portalDb.run(`CREATE TABLE IF NOT EXISTS telegram_bot_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_hash TEXT DEFAULT '',
                command TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ok',
                detail TEXT DEFAULT '',
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`);

            // 🛡️ 기존 health.db로부터 데이터 1회성 무손실 자동 마이그레이션
            migrateFromHealthDb();
        });
    }
});

function migrateFromHealthDb() {
    // health.db의 user_memos 이전
    db.all("SELECT * FROM user_memos", [], (err, rows) => {
        if (!err && Array.isArray(rows) && rows.length > 0) {
            portalDb.get("SELECT COUNT(*) as cnt FROM user_memos", (pErr, pRow) => {
                if (!pErr && pRow && pRow.cnt === 0) {
                    console.log(`📦 [마이그레이션] health.db에서 user_memos ${rows.length}건 portal.db로 복제 중...`);
                    const stmt = portalDb.prepare(`INSERT OR IGNORE INTO user_memos (id, user_id, title, content, category, color, is_pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                    rows.forEach(r => stmt.run([r.id, r.user_id, r.title, r.content, r.category, r.color, r.is_pinned, r.created_at, r.updated_at]));
                    stmt.finalize();
                }
            });
        }
    });

    // health.db의 calendar_events 이전
    db.all("SELECT * FROM calendar_events", [], (err, rows) => {
        if (!err && Array.isArray(rows) && rows.length > 0) {
            portalDb.get("SELECT COUNT(*) as cnt FROM calendar_events", (pErr, pRow) => {
                if (!pErr && pRow && pRow.cnt === 0) {
                    console.log(`📦 [마이그레이션] health.db에서 calendar_events ${rows.length}건 portal.db로 복제 중...`);
                    const stmt = portalDb.prepare(`INSERT OR IGNORE INTO calendar_events (id, user_id, title, event_date, event_time, category, color, memo, is_completed, is_all_day, is_family, notify_timing, notify_repeat, notify_sent_count, last_notified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                    rows.forEach(r => stmt.run([r.id, r.user_id, r.title, r.event_date, r.event_time, r.category, r.color, r.memo, r.is_completed, r.is_all_day, r.is_family, r.notify_timing, r.notify_repeat, r.notify_sent_count, r.last_notified_at, r.created_at]));
                    stmt.finalize();
                }
            });
        }
    });

    // health.db의 calendar_categories 이전
    db.all("SELECT * FROM calendar_categories", [], (err, rows) => {
        if (!err && Array.isArray(rows) && rows.length > 0) {
            portalDb.get("SELECT COUNT(*) as cnt FROM calendar_categories", (pErr, pRow) => {
                if (!pErr && pRow && pRow.cnt === 0) {
                    const stmt = portalDb.prepare(`INSERT OR IGNORE INTO calendar_categories (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)`);
                    rows.forEach(r => stmt.run([r.id, r.user_id, r.name, r.color, r.created_at]));
                    stmt.finalize();
                }
            });
        }
    });

    // health.db의 system_configs 이전
    db.all("SELECT * FROM system_configs", [], (err, rows) => {
        if (!err && Array.isArray(rows) && rows.length > 0) {
            const stmt = portalDb.prepare(`INSERT OR IGNORE INTO system_configs (key, value) VALUES (?, ?)`);
            rows.forEach(r => stmt.run([r.key, r.value]));
            stmt.finalize();
        }
    });
}

module.exports = {
    db,
    assetDb,
    newsDb,
    albumDb,
    wikiDb,
    portalDb
};

