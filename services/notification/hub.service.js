/**
 * ==============================================================================
 * 🔔 JG 통합 알림 허브 중앙 엔진 (hub.service.js)
 * ------------------------------------------------------------------------------
 * - 표준 이벤트(service_key, event_type, recipient_id, title, body, action_url,
 *   severity, dedup_key) 수신 → 권한/수신범위/Dedup 검증 → 멀티채널(WebPush,
 *   인앱 알림함, 텔레그램 3모드) 라우팅
 * - [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const { db, portalDb } = require('../db');
const { dispatchWebPushToSubscriptions, recordPushDiagEvent } = require('./webpush.dispatcher');
const { dispatchTelegramForUsers } = require('./telegram.dispatcher');

function pGet(sql, params = []) {
    return new Promise((resolve) => {
        portalDb.get(sql, params, (err, row) => resolve(err ? null : (row || null)));
    });
}

function pAll(sql, params = []) {
    return new Promise((resolve) => {
        portalDb.all(sql, params, (err, rows) => resolve(err || !Array.isArray(rows) ? [] : rows));
    });
}

function pRun(sql, params = []) {
    return new Promise((resolve) => {
        portalDb.run(sql, params, function (err) {
            if (err) console.error('⚠️ [NotifHub DB]', err.message);
            resolve({ lastID: this ? this.lastID : null, changes: this ? this.changes : 0 });
        });
    });
}

function hAll(sql, params = []) {
    return new Promise((resolve) => {
        db.all(sql, params, (err, rows) => resolve(err || !Array.isArray(rows) ? [] : rows));
    });
}

function sanitizePushText(text) {
    if (!text) return '';
    return String(text)
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\u00a0/g, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/[^\S\r\n]+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .replace(/\s+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function normalizeTargetUrl(rawUrl) {
    const u = rawUrl || 'https://j-jg.cc/';
    if (!u.startsWith('/')) return u;
    if (u.includes('dashboard') || u.includes('hospital')) return `https://blood.j-jg.cc${u}`;
    if (u.includes('album') || u.startsWith('/photos')) return `https://album.j-jg.cc${u}`;
    return `https://j-jg.cc${u}`;
}

function mapLegacyTypeToEvent(type = 'general', subtype = null) {
    const t = String(type || 'general').toLowerCase();
    const s = String(subtype || '').toLowerCase();
    if (t === 'album') {
        if (s === 'album_comment') return { service_key: 'album', event_type: 'album.comment' };
        if (s === 'album_mention') return { service_key: 'album', event_type: 'album.mention' };
        return { service_key: 'album', event_type: 'album.new_photo' };
    }
    if (t === 'breaking') return { service_key: 'news', event_type: 'news.breaking' };
    if (t === 'weather') return { service_key: 'news', event_type: 'news.weather' };
    if (t === 'briefing') return { service_key: 'news', event_type: 'news.briefing' };
    if (['asset', 'economy', 'finance', 'stock'].includes(t)) {
        if (s === 'market_close') return { service_key: 'asset', event_type: 'asset.market_close' };
        return { service_key: 'asset', event_type: 'asset.market_open' };
    }
    if (t === 'medication') return { service_key: 'health', event_type: 'health.medication' };
    if (t === 'blood_pressure') return { service_key: 'health', event_type: 'health.blood_pressure' };
    if (t === 'hospital') return { service_key: 'health', event_type: 'health.hospital' };
    if (t === 'calendar') return { service_key: 'calendar', event_type: 'calendar.event' };
    if (t === 'dday') return { service_key: 'calendar', event_type: 'calendar.dday' };
    if (t === 'study') return { service_key: 'study', event_type: s || 'study.worksheet_completed' };
    if (t === 'test') return { service_key: 'system', event_type: 'system.test' };
    return { service_key: 'system', event_type: 'system.alert' };
}

async function resolveTargetUsers({ recipient_id = 'role:all', exclude_user_id = null }) {
    const users = await hAll('SELECT username, COALESCE(role, \'family\') as role, rowid FROM users');
    const normalizedUsers = users.map((u) => ({
        username: u.username,
        isAdmin: u.username === 'admin' || u.role === 'admin' || u.rowid === 1
    }));

    if (normalizedUsers.length === 0) {
        normalizedUsers.push({ username: 'admin', isAdmin: true });
    }

    let selected = [];
    if (Array.isArray(recipient_id) && recipient_id.length > 0) {
        const set = new Set(recipient_id.map(String));
        selected = normalizedUsers.filter((u) => set.has(u.username));
    } else if (recipient_id === 'role:admin') {
        selected = normalizedUsers.filter((u) => u.isAdmin);
    } else if (recipient_id && recipient_id !== 'role:all') {
        const target = String(recipient_id);
        selected = normalizedUsers.filter((u) => u.username === target);
        if (selected.length === 0) {
            selected = [{ username: target, isAdmin: target === 'admin' }];
        }
    } else {
        selected = normalizedUsers;
    }

    if (exclude_user_id) {
        const ex = String(exclude_user_id);
        selected = selected.filter((u) => u.username !== ex);
    }
    return selected;
}

function isUserEnabledForEvent({ user, service, rule, userPrefsMap, explicitTarget }) {
    const globalPref = userPrefsMap.get('global');
    if (globalPref && globalPref.enabled === 0) return false;

    if (rule && rule.event_type === 'system.test' && explicitTarget) {
        return true;
    }

    const scopePolicy = service ? service.scope_policy : 'admin_only';
    if (scopePolicy === 'admin_only' && !user.isAdmin) {
        return false;
    }

    const svcPref = service ? userPrefsMap.get(service.service_key) : null;
    const evtPref = rule ? userPrefsMap.get(rule.event_type) : null;

    if (evtPref) return evtPref.enabled === 1;
    if (svcPref) return svcPref.enabled === 1;

    if (user.isAdmin) {
        return rule ? rule.default_enabled_admin === 1 : true;
    }
    if (scopePolicy === 'family_default_on') {
        return rule ? rule.default_enabled_family !== 0 : true;
    }
    return false;
}

async function publishNotificationEvent(rawEvent = {}) {
    const legacyMapped = (!rawEvent.service_key || !rawEvent.event_type)
        ? mapLegacyTypeToEvent(rawEvent.type, rawEvent.subtype)
        : null;

    const serviceKey = rawEvent.service_key || legacyMapped.service_key;
    const eventType = rawEvent.event_type || legacyMapped.event_type;
    const cleanTitle = sanitizePushText(rawEvent.title || '알림')
        .replace(/^\[?JG\s*통합\s*포털\]?\s*/i, '')
        .replace(/^\[?JG\s*포털\]?\s*/i, '')
        .trim();
    const cleanBody = sanitizePushText(rawEvent.body || '');
    const targetUrl = normalizeTargetUrl(rawEvent.action_url || rawEvent.url);
    const meta = (rawEvent.meta && typeof rawEvent.meta === 'object') ? rawEvent.meta : {};

    const service = await pGet('SELECT * FROM notification_services WHERE service_key = ?', [serviceKey]);
    if (service && service.is_active === 0) {
        return { success: true, skipped: true, reason: 'service_disabled', targetCount: 0, successCount: 0 };
    }
    const rule = await pGet('SELECT * FROM notification_rules WHERE event_type = ?', [eventType]);
    if (rule && rule.is_active === 0) {
        return { success: true, skipped: true, reason: 'rule_disabled', targetCount: 0, successCount: 0 };
    }

    const severity = rawEvent.severity || (rule ? rule.default_severity : 'normal');
    const ttl = rule ? rule.ttl_sec : 86400;
    const dedupKey = rawEvent.dedup_key ? String(rawEvent.dedup_key).slice(0, 120) : null;
    const dedupWin = rule ? Number(rule.dedup_window_sec || 0) : 300;
    const shouldSaveVisible = rawEvent.save_history !== undefined && rawEvent.save_history !== null
        ? Boolean(rawEvent.save_history)
        : (rule ? rule.save_in_app === 1 : true);

    const recipientId = rawEvent.recipient_id !== undefined
        ? rawEvent.recipient_id
        : (rawEvent.adminOnly ? 'role:admin' : (rawEvent.userId || 'role:all'));
    const explicitTarget = Boolean(
        (rawEvent.recipient_id && !String(rawEvent.recipient_id).startsWith('role:')) || rawEvent.userId
    );

    const candidates = await resolveTargetUsers({
        recipient_id: recipientId,
        exclude_user_id: rawEvent.exclude_user_id || rawEvent.excludeUserId || null
    });
    if (candidates.length === 0) {
        return { success: true, targetCount: 0, successCount: 0 };
    }

    const allPrefs = await pAll(
        `SELECT user_id, scope_key, enabled FROM user_notification_prefs
         WHERE user_id IN (${candidates.map(() => '?').join(',')})`,
        candidates.map((u) => u.username)
    );
    const prefsByUser = new Map();
    for (const p of allPrefs) {
        if (!prefsByUser.has(p.user_id)) prefsByUser.set(p.user_id, new Map());
        prefsByUser.get(p.user_id).set(p.scope_key, p);
    }

    const eligibleUsers = [];
    for (const u of candidates) {
        const uPrefs = prefsByUser.get(u.username) || new Map();
        if (!isUserEnabledForEvent({ user: u, service, rule, userPrefsMap: uPrefs, explicitTarget })) {
            continue;
        }
        if (dedupKey && dedupWin > 0) {
            const dup = await pGet(
                `SELECT id FROM notifications
                 WHERE user_id = ? AND dedup_key = ?
                   AND datetime(created_at) >= datetime('now', '-' || ? || ' seconds', 'localtime')
                 LIMIT 1`,
                [u.username, dedupKey, dedupWin]
            );
            if (dup) continue;
        }
        eligibleUsers.push(u.username);
    }

    if (eligibleUsers.length === 0) {
        return { success: true, targetCount: 0, successCount: 0, deduped: Boolean(dedupKey) };
    }

    const iconEmoji = (service && service.icon_emoji) || '🔔';
    const iconPath = meta.icon || rawEvent.icon || (service && service.icon_path) || '/icons/notif/default-192.png';
    const imageUrl = meta.image || rawEvent.image || null;
    const messengerMode = service ? service.messenger_mode : 'off';

    // 1) 인앱 알림함 / 발송 원장 기록
    let primaryNotifId = null;
    for (let i = 0; i < eligibleUsers.length; i++) {
        const uid = eligibleUsers[i];
        const ins = await pRun(
            `INSERT INTO notifications
             (user_id, service_key, event_type, severity, title, body, icon, image_url, action_url, dedup_key, is_visible)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [uid, serviceKey, eventType, severity, cleanTitle, cleanBody, iconEmoji, imageUrl, targetUrl, dedupKey, shouldSaveVisible ? 1 : 0]
        );
        if (i === 0) primaryNotifId = ins.lastID;
    }

    // 2) 활성 WebPush 구독 조회 및 발송
    const subs = await pAll(
        `SELECT * FROM push_subscriptions
         WHERE user_id IN (${eligibleUsers.map(() => '?').join(',')})
           AND status IN ('active', 'degraded')
         ORDER BY updated_at DESC, id DESC`,
        eligibleUsers
    );

    const uniqueSubs = [];
    const seenEndpoints = new Set();
    for (const s of subs) {
        if (s && s.endpoint && s.keys_p256dh && s.keys_auth && !seenEndpoints.has(s.endpoint)) {
            seenEndpoints.add(s.endpoint);
            uniqueSubs.push(s);
        }
    }

    const sep = targetUrl.includes('?') ? '&' : '?';
    const linkWithId = primaryNotifId ? `${targetUrl}${sep}notif_id=${primaryNotifId}` : targetUrl;
    const uniqueTag = rawEvent.tag && String(rawEvent.tag).includes('-')
        ? String(rawEvent.tag)
        : `jg-${serviceKey}-${primaryNotifId || Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const wpPayload = {
        title: cleanTitle,
        body: cleanBody,
        icon: iconPath.startsWith('http') ? iconPath : `https://j-jg.cc${iconPath}`,
        badge: 'https://j-jg.cc/badge-monochrome.png',
        tag: uniqueTag,
        data: { url: linkWithId, notifId: primaryNotifId, serviceKey, eventType }
    };
    if (imageUrl) wpPayload.image = imageUrl;

    const wpResult = await dispatchWebPushToSubscriptions(uniqueSubs, wpPayload, { severity, ttl });
    const webPushSuccessUsers = new Set(
        wpResult.results.filter((r) => r.ok && r.userId).map((r) => r.userId)
    );

    // 3) 외부 메신저(텔레그램) 3모드 라우팅 (직접 sendServerTelegram 발송 건은 중복 방지 스킵)
    const tgResult = (meta && meta.skipTelegram)
        ? { sentCount: 0, skipped: true }
        : await dispatchTelegramForUsers({
            targetUserIds: eligibleUsers,
            messengerMode,
            webPushSuccessUsers,
            serviceKey,
            severity,
            title: cleanTitle,
            body: cleanBody,
            action_url: targetUrl,
            iconEmoji,
            meta
        });

    if (wpResult.targetCount > 0 || tgResult.sentCount > 0) {
        console.log(`📨 [NotifHub] "${cleanTitle}" (${eventType}) WebPush:${wpResult.successCount}/${wpResult.targetCount}, TG:${tgResult.sentCount}`);
    }

    recordPushDiagEvent({
        kind: 'send',
        type: eventType,
        title: cleanTitle,
        targetCount: wpResult.targetCount,
        successCount: wpResult.successCount,
        failCount: wpResult.failCount,
        tag: uniqueTag
    });

    return {
        success: true,
        targetCount: wpResult.targetCount,
        successCount: wpResult.successCount,
        failCount: wpResult.failCount,
        telegramSentCount: tgResult.sentCount,
        notifId: primaryNotifId,
        tag: uniqueTag
    };
}

module.exports = {
    sanitizePushText,
    normalizeTargetUrl,
    mapLegacyTypeToEvent,
    publishNotificationEvent
};
