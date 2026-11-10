const webPush = require('web-push');
const { db } = require('./db');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (process.env.EMAIL_USER ? `mailto:${process.env.EMAIL_USER}` : 'mailto:admin@j-jg.cc');

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
    console.warn('⚠️ [WebPush] VAPID 키가 환경변수에 설정되지 않았습니다.');
}

// 실시간 운영 진단용 최근 발송·수신(SW-ACK) 이벤트 링버퍼 (최대 40건, 대한민국 표준시 KST 기록)
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

// 브라우저/플랫폼 식별 헬퍼 (한국어 친화 라벨)
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

// 푸시 알림 텍스트 정제 헬퍼
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

// 알림 수신 내역 DB 보관 헬퍼
function saveNotificationHistory({ userId = 'admin', type = 'general', title, body, icon, url = 'https://j-jg.cc/' }, callback) {
    const typeIconMap = {
        album: '📸', breaking: '🚨', weather: '🌤️',
        asset: '💰', economy: '💰', finance: '💰', stock: '💰',
        blood_pressure: '🩸', medication: '💊', hospital: '🏥',
        calendar: '📅', dday: '📅', system: '🖥️', test: '🔔'
    };
    const finalIcon = (!icon || icon.startsWith('http') || icon.startsWith('/'))
        ? (typeIconMap[type] || '🔔')
        : icon;

    const sql = `
        INSERT INTO notification_history (user_id, type, title, body, icon, url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `;
    db.run(sql, [userId, type, title, body, finalIcon, url], function(err) {
        if (err) console.error('[WebPush] 알림 내역 DB 저장 실패:', err.message);
        if (typeof callback === 'function') callback(this ? this.lastID : null);
    });
}

// 상대 URL을 서비스별 절대 URL로 보정
function normalizeTargetUrl(rawUrl) {
    const u = rawUrl || 'https://j-jg.cc/';
    if (!u.startsWith('/')) return u;
    if (u.includes('dashboard') || u.includes('hospital')) return `https://blood.j-jg.cc${u}`;
    if (u.includes('album') || u.startsWith('/photos')) return `https://album.j-jg.cc${u}`;
    return `https://j-jg.cc${u}`;
}

// 🌟 순정 웹 표준 단일 Web Push 발송 엔진 (Clean-Slate v2)
function sendUnifiedPushNotification({
    title, body, url, type = 'general', subtype = null, tag,
    userId = null, excludeUserId = null, adminOnly = false,
    image = null, icon = null, saveHistory = null
}) {
    return new Promise((resolve) => {
        const shouldSaveHistory = (saveHistory !== null) ? Boolean(saveHistory) : (type !== 'breaking');
        const cleanTitle = sanitizePushText(title || '알림')
            .replace(/^\[?JG\s*통합\s*포털\]?\s*/i, '')
            .replace(/^\[?JG\s*포털\]?\s*/i, '')
            .trim();
        const cleanBody = sanitizePushText(body);
        const targetUrl = normalizeTargetUrl(url);

        const params = [];
        let userCondition = '';
        if (userId) {
            if (Array.isArray(userId) && userId.length > 0) {
                userCondition = `AND ps.user_id IN (${userId.map(() => '?').join(',')})`;
                userId.forEach(u => params.push(String(u)));
            } else if (typeof userId === 'string') {
                userCondition = 'AND ps.user_id = ?';
                params.push(userId);
            }
        } else if (adminOnly) {
            userCondition = "AND (ps.user_id = 'admin' OR u.role = 'admin' OR u.rowid = 1)";
        }
        if (excludeUserId) {
            userCondition += ' AND ps.user_id != ?';
            params.push(String(excludeUserId));
        }

        // 가족 계정 기본 정책: 관리자는 전체 기본 ON, 가족 계정은 가족앨범(album)만 기본 ON
        const isAdminExpr = "(ps.user_id = 'admin' OR u.role = 'admin' OR u.rowid = 1)";
        let categoryCondition = '';
        if (type === 'breaking') {
            categoryCondition = `AND (CASE WHEN ${isAdminExpr} THEN COALESCE(ns.breaking_news_enabled, 1) ELSE COALESCE(ns.breaking_news_enabled, 0) END = 1)`;
        } else if (type === 'weather') {
            categoryCondition = `AND (CASE WHEN ${isAdminExpr} THEN COALESCE(ns.weather_morning_enabled, 1) ELSE COALESCE(ns.weather_morning_enabled, 0) END = 1)`;
        } else if (['asset', 'economy', 'finance', 'stock'].includes(type)) {
            categoryCondition = `AND (CASE WHEN ${isAdminExpr} THEN COALESCE(ns.asset_report_enabled, 1) ELSE COALESCE(ns.asset_report_enabled, 0) END = 1)`;
        } else if (type === 'system') {
            categoryCondition = `AND (${isAdminExpr} AND COALESCE(ns.system_alert_enabled, 1) = 1)`;
        } else if (type === 'blood_pressure') {
            categoryCondition = `AND (CASE WHEN ${isAdminExpr} THEN COALESCE(ns.bp_reminder_enabled, 1) ELSE COALESCE(ns.bp_reminder_enabled, 0) END = 1)`;
        } else if (type === 'hospital') {
            categoryCondition = `AND (CASE WHEN ${isAdminExpr} THEN COALESCE(ns.hospital_push_enabled, 1) ELSE COALESCE(ns.hospital_push_enabled, 0) END = 1)`;
        } else if (type === 'album') {
            categoryCondition = 'AND COALESCE(ns.album_push_enabled, 1) = 1';
            if (subtype === 'album_new_photo') categoryCondition += ' AND COALESCE(ns.album_new_photo_enabled, 1) = 1';
            else if (subtype === 'album_comment') categoryCondition += ' AND COALESCE(ns.album_comment_enabled, 1) = 1';
            else if (subtype === 'album_mention') categoryCondition += ' AND COALESCE(ns.album_mention_enabled, 1) = 1';
        }

        const query = `
            SELECT ps.*, COALESCE(ns.enabled, 1) as enabled
            FROM push_subscriptions ps
            LEFT JOIN users u ON ps.user_id = u.username
            LEFT JOIN notification_settings ns ON ps.user_id = ns.user_id
            WHERE COALESCE(ns.enabled, 1) = 1
            ${categoryCondition}
            ${userCondition}
            ORDER BY ps.updated_at DESC, ps.id DESC
        `;

        db.all(query, params, (err, rows) => {
            // 1) 구독된 기기가 없더라도 알림 센터 수신 내역(history)은 대상자에게 정상 기록
            if (err || !rows || rows.length === 0) {
                if (!shouldSaveHistory) {
                    return resolve({ success: true, count: 0, targetCount: 0, successCount: 0 });
                }
                if (userId && typeof userId === 'string') {
                    const checkSql = `
                        SELECT COALESCE(ns.enabled, 1) as enabled, COALESCE(u.role, 'family') as role, u.rowid as u_rowid
                        FROM users u LEFT JOIN notification_settings ns ON u.username = ns.user_id
                        WHERE u.username = ?
                    `;
                    db.get(checkSql, [userId], (cErr, uc) => {
                        if (!cErr && uc && uc.enabled === 1) {
                            const isAdm = (userId === 'admin' || uc.role === 'admin' || uc.u_rowid === 1);
                            const adminDefaultTypes = ['system', 'breaking', 'weather', 'asset', 'economy', 'finance', 'stock', 'hospital', 'blood_pressure'];
                            if (isAdm || !adminDefaultTypes.includes(type)) {
                                saveNotificationHistory({ userId, type, title: cleanTitle, body: cleanBody, url: targetUrl });
                            }
                        }
                        resolve({ success: true, count: 0, targetCount: 0, successCount: 0 });
                    });
                    return;
                }
                if (!userId && type === 'album') {
                    const exParams = excludeUserId ? [String(excludeUserId)] : [];
                    const targetSql = `
                        SELECT u.username FROM users u
                        LEFT JOIN notification_settings ns ON u.username = ns.user_id
                        WHERE COALESCE(ns.enabled, 1) = 1 AND COALESCE(ns.album_push_enabled, 1) = 1
                        ${excludeUserId ? 'AND u.username != ?' : ''}
                    `;
                    db.all(targetSql, exParams, (tErr, list) => {
                        if (!tErr && Array.isArray(list)) {
                            list.forEach(u => saveNotificationHistory({ userId: u.username, type, title: cleanTitle, body: cleanBody, url: targetUrl }));
                        }
                        resolve({ success: true, count: 0, targetCount: 0, successCount: 0 });
                    });
                    return;
                }
                return resolve({ success: true, count: 0, targetCount: 0, successCount: 0 });
            }

            // 2) 순정 표준 엔드포인트 단위 중복 제거 (서로 다른 브라우저/웹앱을 임의로 누락시키지 않음)
            const sendRows = [];
            const seenEndpoints = new Set();
            rows.forEach((r) => {
                if (r && r.endpoint && r.keys_p256dh && r.keys_auth && !seenEndpoints.has(r.endpoint)) {
                    seenEndpoints.add(r.endpoint);
                    sendRows.push(r);
                }
            });

            const recipientUserIds = Array.from(new Set(sendRows.map(r => r.user_id).filter(Boolean)));
            if (recipientUserIds.length === 0 && typeof userId === 'string') recipientUserIds.push(userId);
            if (recipientUserIds.length === 0) {
                return resolve({ success: true, count: 0, targetCount: 0, successCount: 0 });
            }

            const dispatchWebPush = (notifId) => {
                const sep = targetUrl.includes('?') ? '&' : '?';
                const linkWithId = notifId ? `${targetUrl}${sep}notif_id=${notifId}` : targetUrl;
                const uniqueTag = (tag && tag.includes('-') && !tag.endsWith(type))
                    ? tag
                    : `jg-${type}-${notifId || Date.now()}-${Math.floor(Math.random() * 1000)}`;

                // 호환성 100% 정적 PNG 아이콘 표준 적용 (모노크롬/커스텀 배지 제거로 WebAPK 충돌 원천 차단)
                const stdIcon = icon || (type === 'album' ? 'https://album.j-jg.cc/icons/icon-192.png' : 'https://j-jg.cc/icon-v2-192.png');

                const payloadObj = {
                    title: cleanTitle,
                    body: cleanBody,
                    icon: stdIcon,
                    tag: uniqueTag,
                    data: {
                        url: linkWithId,
                        notifId: notifId || null,
                        type
                    }
                };
                if (image) payloadObj.image = image;
                const payload = JSON.stringify(payloadObj);

                let successCount = 0;
                let failCount = 0;

                const tasks = sendRows.map((subRow) => {
                    const pushOptions = {
                        TTL: 86400,
                        headers: { Urgency: 'high' }
                    };
                    const sub = {
                        endpoint: subRow.endpoint,
                        keys: { p256dh: subRow.keys_p256dh, auth: subRow.keys_auth }
                    };

                    return webPush.sendNotification(sub, payload, pushOptions)
                        .then(() => {
                            successCount++;
                            db.run(
                                `UPDATE push_subscriptions SET last_success_at = datetime('now', 'localtime'), last_error = '' WHERE endpoint = ?`,
                                [subRow.endpoint]
                            );
                        })
                        .catch((pErr) => {
                            failCount++;
                            const code = pErr && pErr.statusCode ? pErr.statusCode : 0;
                            const errMsg = `HTTP ${code}: ${String((pErr && (pErr.body || pErr.message)) || '발송 오류').slice(0, 120)}`;
                            console.error(`❌ [WebPush 발송 오류] (${subRow.user_id}, ${subRow.browser_name || '-'}):`, errMsg);
                            if (code === 404 || code === 410) {
                                db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [subRow.endpoint]);
                            } else {
                                db.run('UPDATE push_subscriptions SET last_error = ? WHERE endpoint = ?', [errMsg, subRow.endpoint]);
                            }
                        });
                });

                Promise.all(tasks).then(() => {
                    console.log(`📨 [WebPush 발송 완료] "${cleanTitle}" (성공: ${successCount}/${sendRows.length})`);
                    recordPushDiagEvent({
                        kind: 'send',
                        type,
                        title: cleanTitle,
                        targetCount: sendRows.length,
                        successCount,
                        failCount,
                        tag: uniqueTag
                    });
                    resolve({
                        success: true,
                        targetCount: sendRows.length,
                        successCount,
                        failCount,
                        notifId,
                        tag: uniqueTag
                    });
                });
            };

            if (!shouldSaveHistory) {
                return dispatchWebPush(null);
            }

            saveNotificationHistory({
                userId: recipientUserIds[0],
                type,
                title: cleanTitle,
                body: cleanBody,
                url: targetUrl
            }, (notifId) => {
                for (let i = 1; i < recipientUserIds.length; i++) {
                    saveNotificationHistory({
                        userId: recipientUserIds[i],
                        type,
                        title: cleanTitle,
                        body: cleanBody,
                        url: targetUrl
                    });
                }
                if (!userId && type === 'album') {
                    const exParams = excludeUserId ? [String(excludeUserId)] : [];
                    const extraSql = `
                        SELECT u.username FROM users u
                        LEFT JOIN notification_settings ns ON u.username = ns.user_id
                        WHERE COALESCE(ns.enabled, 1) = 1 AND COALESCE(ns.album_push_enabled, 1) = 1
                        ${excludeUserId ? 'AND u.username != ?' : ''}
                    `;
                    db.all(extraSql, exParams, (eErr, extraUsers) => {
                        if (!eErr && Array.isArray(extraUsers)) {
                            extraUsers.forEach(eu => {
                                if (eu.username && !recipientUserIds.includes(eu.username)) {
                                    saveNotificationHistory({ userId: eu.username, type, title: cleanTitle, body: cleanBody, url: targetUrl });
                                }
                            });
                        }
                    });
                }
                dispatchWebPush(notifId);
            });
        });
    });
}

module.exports = {
    VAPID_PUBLIC_KEY,
    detectBrowserName,
    recordPushDiagEvent,
    getRecentPushDiagEvents,
    saveNotificationHistory,
    sanitizePushText,
    sendUnifiedPushNotification
};
