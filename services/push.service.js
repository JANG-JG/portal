const webPush = require('web-push');
const { db } = require('./db');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
        'mailto:upt0731@gmail.com',
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
} else {
    console.warn('⚠️ [VAPID] VAPID keys not configured in process.env!');
}

// 알림 수신 내역 DB 보관 헬퍼 함수
function saveNotificationHistory({ userId = 'admin', type = 'general', title, body, icon, url = 'https://j-jg.cc/' }, callback) {
    const typeIconMap = {
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
function sendUnifiedPushNotification({ title, body, url, type = 'general', tag, userId = null, adminOnly = false }) {
    return new Promise((resolve) => {
        let cleanTitle = sanitizePushText(title || '알림')
            .replace(/^\[?JG\s*통합\s*포털\]?\s*/i, '')
            .replace(/^\[?JG\s*포털\]?\s*/i, '')
            .trim();

        const cleanBody = sanitizePushText(body);

        let targetUrl = url || 'https://j-jg.cc/';
        if (targetUrl.startsWith('/')) {
            if (targetUrl.includes('dashboard') || targetUrl.includes('hospital')) {
                targetUrl = `https://blood.j-jg.cc${targetUrl}`;
            } else {
                targetUrl = `https://j-jg.cc${targetUrl}`;
            }
        }

        // 수신 대상 필터 구성
        let userCondition = '';
        if (userId) {
            userCondition = `AND ps.user_id = '${userId}'`;
        } else if (adminOnly) {
            userCondition = "AND ps.user_id IN ('upt0731', 'admin')";
        }

        let categoryCondition = '';
        if (type === 'breaking') {
            categoryCondition = 'AND (ns.breaking_news_enabled IS NULL OR ns.breaking_news_enabled = 1)';
        } else if (type === 'weather') {
            categoryCondition = 'AND (ns.weather_morning_enabled IS NULL OR ns.weather_morning_enabled = 1)';
        } else if (type === 'asset') {
            categoryCondition = 'AND (ns.asset_report_enabled IS NULL OR ns.asset_report_enabled = 1)';
        } else if (type === 'system') {
            categoryCondition = 'AND (ns.system_alert_enabled IS NULL OR ns.system_alert_enabled = 1)';
        }

        const query = `
            SELECT ps.*, COALESCE(ns.enabled, 1) as enabled
            FROM push_subscriptions ps
            LEFT JOIN notification_settings ns ON ps.user_id = ns.user_id
            WHERE (ns.enabled IS NULL OR ns.enabled = 1)
            ${categoryCondition}
            ${userCondition}
        `;

        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) {
                console.log(`[UnifiedPush] 발송 대상 구독 기기 없음 (type: ${type}, user: ${userId || 'all'})`);
                return resolve({ success: true, count: 0, targetCount: 0 });
            }

            // 🌟 [3중 방어막: 모바일 중복 수신 원천 차단 알고리즘]
            const userTokensMap = new Map();
            rows.forEach(r => {
                const uid = r.user_id || 'admin';
                if (!userTokensMap.has(uid)) {
                    userTokensMap.set(uid, { mobile: [], desktop: [] });
                }
                const isMobile = r.device_type === 'mobile' || (r.user_agent && (r.user_agent.includes('Mobile') || r.user_agent.includes('Android')));
                if (isMobile) {
                    userTokensMap.get(uid).mobile.push(r);
                } else {
                    userTokensMap.get(uid).desktop.push(r);
                }
            });

            const sendRows = [];
            const obsoleteEndpoints = [];

            userTokensMap.forEach((tokens, uid) => {
                tokens.desktop.forEach(dt => sendRows.push(dt));

                if (tokens.mobile.length === 1) {
                    sendRows.push(tokens.mobile[0]);
                } else if (tokens.mobile.length > 1) {
                    tokens.mobile.sort((a, b) => {
                        const aPwa = (a.client_type === 'pwa' || a.client_type === 'apk') ? 1 : 0;
                        const bPwa = (b.client_type === 'pwa' || b.client_type === 'apk') ? 1 : 0;
                        if (aPwa !== bPwa) return bPwa - aPwa;
                        const aTime = new Date(a.updated_at || 0).getTime();
                        const bTime = new Date(b.updated_at || 0).getTime();
                        if (aTime !== bTime) return bTime - aTime;
                        return (b.id || 0) - (a.id || 0);
                    });

                    const winner = tokens.mobile[0];
                    sendRows.push(winner);
                    console.log(`[UnifiedPush] 유저(${uid}) 모바일 다중 토큰(${tokens.mobile.length}개) 중 최적 토큰(ID: ${winner.id}, type: ${winner.client_type}) 1개만 단일 발송`);

                    for (let i = 1; i < tokens.mobile.length; i++) {
                        obsoleteEndpoints.push(tokens.mobile[i].endpoint);
                    }
                }
            });

            // 탈락된 중복 모바일 토큰 DB 자동 정리
            if (obsoleteEndpoints.length > 0) {
                const placeholders = obsoleteEndpoints.map(() => '?').join(',');
                db.run(`DELETE FROM push_subscriptions WHERE endpoint IN (${placeholders})`, obsoleteEndpoints, function(delErr) {
                    if (!delErr && this.changes > 0) {
                        console.log(`🧹 [UnifiedPush Cleanup] 중복 모바일 토큰 ${this.changes}개 DB 자동 정리 완료`);
                    }
                });
            }

            saveNotificationHistory({
                userId: userId || (adminOnly ? 'admin' : (sendRows[0] ? sendRows[0].user_id : 'admin')),
                type,
                title: cleanTitle,
                body: cleanBody,
                icon: 'https://j-jg.cc/icon-monochrome.png',
                url: targetUrl
            }, (notifId) => {
                const sep = targetUrl.includes('?') ? '&' : '?';
                const linkWithId = notifId ? `${targetUrl}${sep}notif_id=${notifId}` : targetUrl;

                const uniqueTag = tag && tag.includes('-') && !tag.endsWith(type)
                    ? tag
                    : `jg-${type}-${notifId || Date.now()}-${Math.floor(Math.random() * 10000)}`;

                const payload = JSON.stringify({
                    title: cleanTitle,
                    body: cleanBody,
                    icon: 'https://j-jg.cc/icon-monochrome.png',
                    badge: 'https://j-jg.cc/badge-monochrome.png',
                    tag: uniqueTag,
                    renotify: true,
                    requireInteraction: true,
                    data: {
                        url: linkWithId,
                        notifId: notifId || null
                    }
                });

                const pushOptions = {
                    headers: {
                        'Urgency': 'high',
                        'Topic': (type || 'general').replace(/[^a-zA-Z0-9_-]/g, '')
                    },
                    TTL: 86400
                };

                let successCount = 0;
                let failCount = 0;

                const promises = sendRows.map(subRow => {
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
            });
        });
    });
}

module.exports = {
    VAPID_PUBLIC_KEY,
    saveNotificationHistory,
    sanitizePushText,
    sendUnifiedPushNotification
};
