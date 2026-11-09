const webPush = require('web-push');
const { db } = require('./db');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (process.env.EMAIL_USER ? `mailto:${process.env.EMAIL_USER}` : 'mailto:admin@j-jg.cc');

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
        VAPID_SUBJECT,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
} else {
    console.warn('⚠️ [VAPID] VAPID keys not configured in process.env!');
}

// 알림 수신 내역 DB 보관 헬퍼 함수
function saveNotificationHistory({ userId = 'admin', type = 'general', title, body, icon, url = 'https://j-jg.cc/' }, callback) {
    const typeIconMap = {
        'album': '📸',
        'breaking': '🚨',
        'weather': '🌤️',
        'asset': '💰',
        'economy': '💰',
        'finance': '💰',
        'stock': '💰',
        'blood_pressure': '🩸',
        'medication': '💊',
        'hospital': '🏥',
        'system': '🖥️',
        'test': '🔔'
    };
    const finalIcon = (!icon || icon.startsWith('http') || icon.startsWith('/')) ? (typeIconMap[type] || '🔔') : icon;

    const query = `
        INSERT INTO notification_history (user_id, type, title, body, icon, url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `;
    db.run(query, [userId, type, title, body, finalIcon, url], function(err) {
        if (err) console.error('[알림 내역 DB 저장 실패]:', err.message);
        const insertedId = this ? this.lastID : null;
        if (callback && typeof callback === 'function') {
            callback(insertedId);
        }
    });
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

// 🌟 [통합 포털 단일 WebPush 발송 엔진]
function sendUnifiedPushNotification({ title, body, url, type = 'general', subtype = null, tag, userId = null, excludeUserId = null, adminOnly = false, image = null, icon = null, badge = null, saveHistory = null }) {
    return new Promise((resolve) => {
        // 🌟 뉴스 속보(breaking)는 알림센터에 누적하지 않고 실시간 웹 푸시만 발송
        const shouldSaveHistory = (saveHistory !== null) ? Boolean(saveHistory) : (type !== 'breaking');

        let cleanTitle = sanitizePushText(title || '알림')
            .replace(/^\[?JG\s*통합\s*포털\]?\s*/i, '')
            .replace(/^\[?JG\s*포털\]?\s*/i, '')
            .trim();

        const cleanBody = sanitizePushText(body);

        let targetUrl = url || 'https://j-jg.cc/';
        if (targetUrl.startsWith('/')) {
            if (targetUrl.includes('dashboard') || targetUrl.includes('hospital')) {
                targetUrl = `https://blood.j-jg.cc${targetUrl}`;
            } else if (targetUrl.includes('album') || targetUrl.startsWith('/photos') || targetUrl.startsWith('/album')) {
                targetUrl = `https://album.j-jg.cc${targetUrl}`;
            } else {
                targetUrl = `https://j-jg.cc${targetUrl}`;
            }
        }

        // 수신 대상 필터 구성
        let userCondition = '';
        if (userId) {
            if (Array.isArray(userId)) {
                userCondition = `AND ps.user_id IN (${userId.map(u => `'${String(u).replace(/'/g, "''")}'`).join(',')})`;
            } else {
                userCondition = `AND ps.user_id = '${String(userId).replace(/'/g, "''")}'`;
            }
        } else if (adminOnly) {
            userCondition = "AND (ps.user_id = 'admin' OR u.role = 'admin' OR u.rowid = 1)";
        }
        if (excludeUserId) {
            userCondition += ` AND ps.user_id != '${String(excludeUserId).replace(/'/g, "''")}'`;
        }

        // 🌟 [가족 계정 기본 정책] 관리자는 전체 알림 기본 ON, 가족 계정은 오직 앨범(album) 알림만 기본 ON!
        // 그 외 모든 알림(속보, 날씨, 증시, 혈압, 병원, 시스템 등)은 가족 계정 기본 OFF (설정값이 1일 때만 수신)
        const isAdminExpr = "(ps.user_id = 'admin' OR u.role = 'admin' OR u.rowid = 1)";

        let categoryCondition = '';
        if (type === 'breaking') {
            categoryCondition = `AND (CASE WHEN ${isAdminExpr} THEN COALESCE(ns.breaking_news_enabled, 1) ELSE COALESCE(ns.breaking_news_enabled, 0) END = 1)`;
        } else if (type === 'weather') {
            categoryCondition = `AND (CASE WHEN ${isAdminExpr} THEN COALESCE(ns.weather_morning_enabled, 1) ELSE COALESCE(ns.weather_morning_enabled, 0) END = 1)`;
        } else if (type === 'asset' || type === 'economy' || type === 'finance' || type === 'stock') {
            categoryCondition = `AND (CASE WHEN ${isAdminExpr} THEN COALESCE(ns.asset_report_enabled, 1) ELSE COALESCE(ns.asset_report_enabled, 0) END = 1)`;
        } else if (type === 'system') {
            categoryCondition = `AND (${isAdminExpr} AND COALESCE(ns.system_alert_enabled, 1) = 1)`;
        } else if (type === 'blood_pressure') {
            categoryCondition = `AND (CASE WHEN ${isAdminExpr} THEN COALESCE(ns.bp_reminder_enabled, 1) ELSE COALESCE(ns.bp_reminder_enabled, 0) END = 1)`;
        } else if (type === 'hospital') {
            categoryCondition = `AND (CASE WHEN ${isAdminExpr} THEN COALESCE(ns.hospital_push_enabled, 1) ELSE COALESCE(ns.hospital_push_enabled, 0) END = 1)`;
        } else if (type === 'album') {
            categoryCondition = 'AND COALESCE(ns.album_push_enabled, 1) = 1';
            if (subtype === 'album_new_photo') {
                categoryCondition += ' AND COALESCE(ns.album_new_photo_enabled, 1) = 1';
            } else if (subtype === 'album_comment') {
                categoryCondition += ' AND COALESCE(ns.album_comment_enabled, 1) = 1';
            } else if (subtype === 'album_mention') {
                categoryCondition += ' AND COALESCE(ns.album_mention_enabled, 1) = 1';
            }
        }

        const query = `
            SELECT ps.*, COALESCE(ns.enabled, 1) as enabled
            FROM push_subscriptions ps
            LEFT JOIN users u ON ps.user_id = u.username
            LEFT JOIN notification_settings ns ON ps.user_id = ns.user_id
            WHERE COALESCE(ns.enabled, 1) = 1
            ${categoryCondition}
            ${userCondition}
        `;

        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) {
                console.log(`[UnifiedPush] 발송 대상 구독 기기 없음 (type: ${type}, user: ${userId || 'all'})`);
                if (!shouldSaveHistory) {
                    return resolve({ success: true, count: 0, targetCount: 0, successCount: 0 });
                }
                // 1) 단일 사용자 대상 알림이고 사용자가 알림을 끄지 않은 경우에만 내역 보존
                if (userId && typeof userId === 'string' && !Array.isArray(userId)) {
                    const checkSql = `
                        SELECT COALESCE(ns.enabled, 1) as enabled,
                               COALESCE(u.role, 'family') as role,
                               u.rowid as u_rowid
                        FROM users u
                        LEFT JOIN notification_settings ns ON u.username = ns.user_id
                        WHERE u.username = ?
                    `;
                    db.get(checkSql, [userId], (cErr, userCheck) => {
                        if (!cErr && userCheck && userCheck.enabled === 1) {
                            const isUserAdmin = (userId === 'admin' || userCheck.role === 'admin' || userCheck.u_rowid === 1);
                            if (!isUserAdmin && (type === 'system' || type === 'breaking' || type === 'weather' || type === 'asset' || type === 'economy' || type === 'finance' || type === 'stock' || type === 'hospital' || type === 'blood_pressure')) {
                                return resolve({ success: true, count: 0, targetCount: 0, successCount: 0 });
                            }
                            saveNotificationHistory({
                                userId,
                                type,
                                title: cleanTitle,
                                body: cleanBody,
                                icon: 'https://j-jg.cc/icon-monochrome.png',
                                url: targetUrl
                            });
                        }
                        resolve({ success: true, count: 0, targetCount: 0, successCount: 0 });
                    });
                    return;
                }
                // 2) 브로드캐스트 알림 (가족앨범 등): 푸시 구독 토큰이 없더라도 알림을 켜둔 대상자(관리자 포함) 알림함에 보존
                if (!userId && type === 'album') {
                    const targetUsersSql = `
                        SELECT u.username, COALESCE(ns.enabled, 1) as enabled, COALESCE(ns.album_push_enabled, 1) as album_push_enabled
                        FROM users u
                        LEFT JOIN notification_settings ns ON u.username = ns.user_id
                        WHERE COALESCE(ns.enabled, 1) = 1 AND COALESCE(ns.album_push_enabled, 1) = 1
                        ${excludeUserId ? `AND u.username != '${String(excludeUserId).replace(/'/g, "''")}'` : ''}
                    `;
                    db.all(targetUsersSql, [], (tErr, userList) => {
                        if (!tErr && Array.isArray(userList)) {
                            userList.forEach(u => {
                                saveNotificationHistory({
                                    userId: u.username,
                                    type,
                                    title: cleanTitle,
                                    body: cleanBody,
                                    icon: 'https://j-jg.cc/icon-monochrome.png',
                                    url: targetUrl
                                });
                            });
                        }
                        resolve({ success: true, count: 0, targetCount: 0, successCount: 0 });
                    });
                    return;
                }
                return resolve({ success: true, count: 0, targetCount: 0, successCount: 0 });
            }

            // 🌟 [기기별 스마트 토큰 발송 알고리즘: 서로 다른 기기(아이폰 vs 안드로이드 등) 독립 발송 보장]
            const deviceGroupMap = new Map();
            rows.forEach(r => {
                const uid = r.user_id || 'admin';
                const ep = String(r.endpoint || '');
                // 물리적 기기 플랫폼 식별 (애플 APNs vs 구글 FCM vs 기타)
                let platform = 'android';
                if (ep.includes('push.apple.com')) platform = 'apple';
                else if (ep.includes('windows.com')) platform = 'windows';
                else if (ep.includes('mozilla.com')) platform = 'firefox';

                const deviceKey = `${uid}__${platform}__${r.device_id || 'default'}`;
                if (!deviceGroupMap.has(deviceKey)) {
                    deviceGroupMap.set(deviceKey, []);
                }
                deviceGroupMap.get(deviceKey).push(r);
            });

            const sendRows = [];
            deviceGroupMap.forEach((tokens, devKey) => {
                if (tokens.length === 1) {
                    sendRows.push(tokens[0]);
                } else {
                    // 동일 기기 내 다중 토큰인 경우 PWA 우선, 최신 갱신 토큰 1개 선택
                    tokens.sort((a, b) => {
                        const aPwa = (a.client_type === 'pwa' || a.client_type === 'apk') ? 1 : 0;
                        const bPwa = (b.client_type === 'pwa' || b.client_type === 'apk') ? 1 : 0;
                        if (aPwa !== bPwa) return bPwa - aPwa;
                        const aTime = new Date(a.updated_at || 0).getTime();
                        const bTime = new Date(b.updated_at || 0).getTime();
                        if (aTime !== bTime) return bTime - aTime;
                        return (b.id || 0) - (a.id || 0);
                    });
                    sendRows.push(tokens[0]);
                }
            });

            const recipientUserIds = Array.from(new Set(sendRows.map(r => r.user_id).filter(Boolean)));
            if (recipientUserIds.length === 0 && userId && typeof userId === 'string') recipientUserIds.push(userId);
            if (recipientUserIds.length === 0) {
                return resolve({ success: true, count: 0, targetCount: 0 });
            }

            const sendPushMessages = (notifId) => {
                const sep = targetUrl.includes('?') ? '&' : '?';
                const linkWithId = notifId ? `${targetUrl}${sep}notif_id=${notifId}` : targetUrl;

                const uniqueTag = tag && tag.includes('-') && !tag.endsWith(type)
                    ? tag
                    : `jg-${type}-${notifId || Date.now()}-${Math.floor(Math.random() * 10000)}`;

                const notifIcon = icon || ((type === 'album') ? 'https://album.j-jg.cc/icons/icon-192.png' : 'https://j-jg.cc/icon-monochrome.png');
                const notifBadge = badge || ((type === 'album') ? 'https://album.j-jg.cc/icons/badge-72.png' : 'https://j-jg.cc/badge-monochrome.png');

                const pushPayloadObj = {
                    title: cleanTitle,
                    body: cleanBody,
                    icon: notifIcon,
                    badge: notifBadge,
                    tag: uniqueTag,
                    renotify: true,
                    requireInteraction: true,
                    data: {
                        url: linkWithId,
                        notifId: notifId || null
                    }
                };

                if (image) {
                    pushPayloadObj.image = image;
                }

                const payload = JSON.stringify(pushPayloadObj);

                let successCount = 0;
                let failCount = 0;

                const promises = sendRows.map(subRow => {
                    const isApplePush = Boolean(subRow.endpoint && subRow.endpoint.includes('push.apple.com'));
                    const pushHeaders = { 'Urgency': 'high' };
                    // 🍎 Apple APNs는 임의의 Topic 헤더 전송 시 400 BadWebPushTopic 에러를 반환하므로 제외
                    if (!isApplePush && type) {
                        pushHeaders['Topic'] = (type || 'general').replace(/[^a-zA-Z0-9_-]/g, '');
                    }

                    const pushOptions = {
                        headers: pushHeaders,
                        TTL: 86400
                    };

                    const pushSubscription = {
                        endpoint: subRow.endpoint,
                        keys: {
                            p256dh: subRow.keys_p256dh,
                            auth: subRow.keys_auth
                        }
                    };

                    return webPush.sendNotification(pushSubscription, payload, pushOptions)
                        .then(() => { successCount++; })
                        .catch(pErr => {
                            failCount++;
                            console.error(`❌ [WebPush Error] (${subRow.user_id}, ${subRow.endpoint.slice(0, 45)}...): Status ${pErr.statusCode}`, pErr.body || pErr.message);
                            if (pErr.statusCode === 410 || pErr.statusCode === 404) {
                                db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [subRow.endpoint]);
                            }
                        });
                });

                Promise.all(promises).then(() => {
                    console.log(`[UnifiedPush 완료] ${cleanTitle} (성공: ${successCount}/${sendRows.length})`);
                    resolve({
                        success: true,
                        targetCount: sendRows.length,
                        successCount,
                        failCount,
                        notifId
                    });
                });
            };

            if (shouldSaveHistory) {
                saveNotificationHistory({
                    userId: recipientUserIds[0],
                    type,
                    title: cleanTitle,
                    body: cleanBody,
                    icon: 'https://j-jg.cc/icon-monochrome.png',
                    url: targetUrl
                }, (notifId) => {
                    for (let i = 1; i < recipientUserIds.length; i++) {
                        saveNotificationHistory({
                            userId: recipientUserIds[i],
                            type,
                            title: cleanTitle,
                            body: cleanBody,
                            icon: 'https://j-jg.cc/icon-monochrome.png',
                            url: targetUrl
                        });
                    }
                    if (!userId && type === 'album') {
                        const extraSql = `
                            SELECT u.username
                            FROM users u
                            LEFT JOIN notification_settings ns ON u.username = ns.user_id
                            WHERE COALESCE(ns.enabled, 1) = 1 AND COALESCE(ns.album_push_enabled, 1) = 1
                            ${excludeUserId ? `AND u.username != '${String(excludeUserId).replace(/'/g, "''")}'` : ''}
                        `;
                        db.all(extraSql, [], (eErr, extraUsers) => {
                            if (!eErr && Array.isArray(extraUsers)) {
                                extraUsers.forEach(eu => {
                                    if (eu.username && !recipientUserIds.includes(eu.username)) {
                                        saveNotificationHistory({
                                            userId: eu.username,
                                            type,
                                            title: cleanTitle,
                                            body: cleanBody,
                                            icon: 'https://j-jg.cc/icon-monochrome.png',
                                            url: targetUrl
                                        });
                                    }
                                });
                            }
                        });
                    }
                    sendPushMessages(notifId);
                });
            } else {
                sendPushMessages(null);
            }
        });
    });
}

module.exports = {
    VAPID_PUBLIC_KEY,
    saveNotificationHistory,
    sanitizePushText,
    sendUnifiedPushNotification
};
