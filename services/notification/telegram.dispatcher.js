/**
 * ==============================================================================
 * ✈️ JG 통합 알림 허브 외부 메신저(텔레그램) 3모드 디스패처
 * (portal/services/notification/telegram.dispatcher.js)
 * ------------------------------------------------------------------------------
 * - mode: 'off' (미발송) | 'fallback' (웹푸시 0건 성공 시 백업) | 'both' (항상 동시 발송)
 * - telegram_allowed_users 기반 사용자 매칭 (현재 관리자, 향후 희망 가족 확장 대응)
 * - [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const { listAuthorizedTelegramRecipients } = require('../telegram/telegramAuth.service');
const { getAssistantBotToken, sendTelegramReply } = require('../telegram/telegramTransport.service');
const { sendServerTelegram } = require('../telegramAlert.service');

function escapeTelegramHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function buildTelegramMessageHtml({ title, body, action_url, iconEmoji, meta }) {
    if (meta && meta.telegram_html) {
        return String(meta.telegram_html);
    }
    const safeTitle = escapeTelegramHtml(title || '알림');
    const safeBody = escapeTelegramHtml(body || '');
    const prefix = iconEmoji && !safeTitle.startsWith(iconEmoji) ? `${iconEmoji} ` : '';
    const lines = [`${prefix}<b>${safeTitle}</b>`];
    if (safeBody) lines.push(safeBody);
    if (action_url) {
        lines.push('');
        lines.push(`👉 <a href="${escapeTelegramHtml(action_url)}">바로 열기</a>`);
    }
    return lines.join('\n');
}

async function dispatchTelegramForUsers({
    targetUserIds = [],
    messengerMode = 'off',
    webPushSuccessUsers = new Set(),
    serviceKey = 'system',
    severity = 'normal',
    title = '',
    body = '',
    action_url = 'https://j-jg.cc/',
    iconEmoji = '🔔',
    meta = {}
}) {
    if (messengerMode === 'off') return { sentCount: 0, skipped: true };

    const candidates = messengerMode === 'fallback'
        ? targetUserIds.filter((uid) => !webPushSuccessUsers.has(uid))
        : targetUserIds;

    if (candidates.length === 0) {
        return { sentCount: 0, skipped: true };
    }

    if (serviceKey === 'system') {
        const prefix = severity === 'critical' ? '🚨' : (iconEmoji || '🖥️');
        const plain = `${prefix} *[${title}]*\n${body}`;
        const srvRes = await sendServerTelegram(plain);
        return { sentCount: (srvRes && srvRes.success) ? 1 : 0, skipped: false };
    }

    const token = getAssistantBotToken();
    const recipients = await listAuthorizedTelegramRecipients();
    const matchedChatIds = new Set();

    for (const r of recipients) {
        const isMatch = candidates.some((uid) =>
            uid === r.portalUsername || (uid === 'admin' && r.role === 'admin')
        );
        if (isMatch && r.chatId) {
            matchedChatIds.add(r.chatId);
        }
    }

    let sentCount = 0;
    if (token && matchedChatIds.size > 0) {
        const htmlText = buildTelegramMessageHtml({ title, body, action_url, iconEmoji, meta });
        const extra = {};
        if (meta && meta.telegram_reply_markup) {
            extra.replyMarkup = meta.telegram_reply_markup;
        }
        for (const chatId of matchedChatIds) {
            const res = await sendTelegramReply(token, chatId, htmlText, extra);
            if (res) sentCount += 1;
        }
    }

    return { sentCount, skipped: false };
}

module.exports = {
    escapeTelegramHtml,
    dispatchTelegramForUsers
};
