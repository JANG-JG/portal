/**
 * ==============================================================================
 * ⚙️ JG 통합 알림 허브 사용자 설정(Prefs) & 레거시 호환 어댑터
 * (portal/services/notification/prefs.service.js)
 * ------------------------------------------------------------------------------
 * - user_notification_prefs ↔ 기존 /api/notification/settings JSON 포맷 양방향 변환
 * - [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const { portalDb } = require('../db');

function pAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function pRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function safeJson(str, fallback) {
    try {
        const v = JSON.parse(str);
        return v !== null && v !== undefined ? v : fallback;
    } catch (_) {
        return fallback;
    }
}

async function getUserPrefsNormalized(userId, isAdmin) {
    const [services, prefRows] = await Promise.all([
        pAll('SELECT * FROM notification_services ORDER BY sort_order ASC, service_key ASC'),
        pAll('SELECT scope_key, enabled, channels_json, schedule_json FROM user_notification_prefs WHERE user_id = ?', [userId])
    ]);

    const prefMap = new Map();
    for (const r of prefRows) {
        prefMap.set(r.scope_key, {
            enabled: r.enabled === 1,
            channels: r.channels_json ? safeJson(r.channels_json, null) : null,
            schedule: r.schedule_json ? safeJson(r.schedule_json, null) : null
        });
    }

    const visibleServices = services.filter((s) => isAdmin || s.scope_policy !== 'admin_only');
    return {
        globalEnabled: prefMap.has('global') ? prefMap.get('global').enabled : true,
        services: visibleServices.map((s) => {
            const p = prefMap.get(s.service_key);
            const defaultEnabled = isAdmin ? true : (s.scope_policy === 'family_default_on');
            return {
                service_key: s.service_key,
                display_name: s.display_name,
                icon_emoji: s.icon_emoji,
                icon_path: s.icon_path,
                scope_policy: s.scope_policy,
                is_active: s.is_active === 1,
                enabled: p ? p.enabled : defaultEnabled,
                channels: p ? p.channels : null,
                schedule: p ? p.schedule : null
            };
        }),
        scopes: Object.fromEntries(prefMap.entries())
    };
}

async function getLegacySettingsObject(userId, isAdmin) {
    const rows = await pAll(
        'SELECT scope_key, enabled, schedule_json FROM user_notification_prefs WHERE user_id = ?',
        [userId]
    );
    const map = new Map(rows.map((r) => [r.scope_key, r]));
    const isOn = (key, defVal) => (map.has(key) ? (map.get(key).enabled ? 1 : 0) : defVal);
    const getSched = (key, fallback) => (map.has(key) && map.get(key).schedule_json ? safeJson(map.get(key).schedule_json, fallback) : fallback);

    const medSched = getSched('health.medication', {});
    const bpSched = getSched('health.blood_pressure', {});
    const weatherSched = getSched('news.weather', {});
    const briefingSched = getSched('news.briefing', {});

    const adminDef = isAdmin ? 1 : 0;
    const assetOpen = isOn('asset.market_open', adminDef);
    const assetClose = isOn('asset.market_close', adminDef);

    return {
        enabled: isOn('global', 1),
        album_push_enabled: isOn('album', 1),
        album_new_photo_enabled: isOn('album.new_photo', 1),
        album_comment_enabled: isOn('album.comment', 1),
        album_mention_enabled: isOn('album.mention', 1),
        hospital_push_enabled: isOn('health.hospital', adminDef),
        breaking_news_enabled: isOn('news.breaking', adminDef),
        weather_morning_enabled: isOn('news.weather', adminDef),
        weather_morning_time: weatherSched.time || '07:00',
        asset_report_enabled: isOn('asset', (assetOpen || assetClose) ? 1 : adminDef),
        asset_open_enabled: assetOpen,
        asset_close_enabled: assetClose,
        bp_reminder_enabled: isOn('health.blood_pressure', adminDef),
        bp_reminder_time: bpSched.reminder_time || '21:00',
        system_alert_enabled: isOn('system', adminDef),
        telegram_briefing_times: Array.isArray(briefingSched.times) ? briefingSched.times : ['07:30'],
        weekday_med_times: Array.isArray(medSched.weekday_times) ? medSched.weekday_times : ['08:00', '19:00'],
        weekday_bp_times: Array.isArray(bpSched.weekday_times) ? bpSched.weekday_times : ['07:30', '21:30'],
        weekend_med_times: Array.isArray(medSched.weekend_times) ? medSched.weekend_times : ['09:00', '19:30'],
        weekend_bp_times: Array.isArray(bpSched.weekend_times) ? bpSched.weekend_times : ['08:30', '22:00']
    };
}

async function upsertUserPref(userId, scopeKey, { enabled = 1, channels = null, schedule = null }) {
    const chStr = channels ? JSON.stringify(channels) : null;
    const scStr = schedule ? JSON.stringify(schedule) : null;
    await pRun(
        `INSERT INTO user_notification_prefs (user_id, scope_key, enabled, channels_json, schedule_json, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT(user_id, scope_key) DO UPDATE SET
            enabled = excluded.enabled,
            channels_json = COALESCE(excluded.channels_json, user_notification_prefs.channels_json),
            schedule_json = COALESCE(excluded.schedule_json, user_notification_prefs.schedule_json),
            updated_at = datetime('now', 'localtime')`,
        [userId, scopeKey, enabled ? 1 : 0, chStr, scStr]
    );
}

async function saveLegacySettings(userId, isAdmin, body = {}) {
    const albumPushVal = body.album_push_enabled !== undefined ? (body.album_push_enabled ? 1 : 0) : 1;
    const openVal = body.asset_open_enabled !== undefined ? (body.asset_open_enabled ? 1 : 0) : (isAdmin ? 1 : 0);
    const closeVal = body.asset_close_enabled !== undefined ? (body.asset_close_enabled ? 1 : 0) : (isAdmin ? 1 : 0);
    const reportVal = (openVal || closeVal) ? 1 : (body.asset_report_enabled !== undefined ? (body.asset_report_enabled ? 1 : 0) : (isAdmin ? 1 : 0));

    let cleanBriefingTimes = Array.isArray(body.telegram_briefing_times)
        ? body.telegram_briefing_times.filter((t) => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t.trim())).map((t) => t.trim())
        : ['07:30'];
    cleanBriefingTimes = Array.from(new Set(cleanBriefingTimes)).sort();
    if (cleanBriefingTimes.length === 0) cleanBriefingTimes = ['07:30'];

    const items = [
        ['global', body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1, null],
        ['album', albumPushVal, null],
        ['album.new_photo', body.album_new_photo_enabled !== undefined ? (body.album_new_photo_enabled ? 1 : 0) : 1, null],
        ['album.comment', body.album_comment_enabled !== undefined ? (body.album_comment_enabled ? 1 : 0) : 1, null],
        ['album.mention', body.album_mention_enabled !== undefined ? (body.album_mention_enabled ? 1 : 0) : 1, null],
        ['health.hospital', isAdmin ? (body.hospital_push_enabled !== undefined ? (body.hospital_push_enabled ? 1 : 0) : 1) : 0, null],
        ['health.medication', 1, {
            weekday_times: Array.isArray(body.weekday_med_times) ? body.weekday_med_times : ['08:00', '19:00'],
            weekend_times: Array.isArray(body.weekend_med_times) ? body.weekend_med_times : ['09:00', '19:30']
        }],
        ['health.blood_pressure', isAdmin ? (body.bp_reminder_enabled !== undefined ? (body.bp_reminder_enabled ? 1 : 0) : 1) : 0, {
            reminder_time: (body.bp_reminder_time || '21:00').trim(),
            weekday_times: Array.isArray(body.weekday_bp_times) ? body.weekday_bp_times : ['07:30', '21:30'],
            weekend_times: Array.isArray(body.weekend_bp_times) ? body.weekend_bp_times : ['08:30', '22:00']
        }],
        ['news.breaking', body.breaking_news_enabled !== undefined ? (body.breaking_news_enabled ? 1 : 0) : (isAdmin ? 1 : 0), null],
        ['news.weather', body.weather_morning_enabled !== undefined ? (body.weather_morning_enabled ? 1 : 0) : (isAdmin ? 1 : 0), {
            time: (body.weather_morning_time || '07:00').trim()
        }],
        ['news.briefing', 1, { times: cleanBriefingTimes }],
        ['asset', reportVal, null],
        ['asset.market_open', openVal, null],
        ['asset.market_close', closeVal, null],
        ['system', isAdmin ? (body.system_alert_enabled !== undefined ? (body.system_alert_enabled ? 1 : 0) : 1) : 0, null]
    ];

    for (const [scopeKey, enabled, schedule] of items) {
        await upsertUserPref(userId, scopeKey, { enabled, schedule });
    }
    return cleanBriefingTimes;
}

module.exports = {
    getUserPrefsNormalized,
    getLegacySettingsObject,
    upsertUserPref,
    saveLegacySettings
};
