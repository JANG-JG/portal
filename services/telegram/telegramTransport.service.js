/**
 * ==============================================================================
 * 텔레그램 알림 비서 봇 공통 전송 레이어 (telegramTransport.service.js)
 * ------------------------------------------------------------------------------
 * - 뉴스/자산 일방 알림 봇 및 서버 경보 봇(telegramAlert.service.js)과 완전 분리
 * - 알림 비서용 폴링 봇 토큰(STUDY_TELEGRAM_BOT_TOKEN 우선) 전용 송신/편집/콜백 응답
 * - [규칙 3] 순환 참조 방지용 하위 전송 계층 (500줄 이하 모듈화)
 * ==============================================================================
 */

const https = require('https');
const { listAuthorizedTelegramRecipients } = require('./telegramAuth.service');

const ipv4HttpsAgent = new https.Agent({ family: 4, keepAlive: true });

function getAssistantBotToken() {
    return (
        process.env.STUDY_TELEGRAM_BOT_TOKEN ||
        process.env.SERVER_TELEGRAM_BOT_TOKEN ||
        process.env.TELEGRAM_BOT_TOKEN ||
        ''
    ).trim();
}

function callTelegramApi(token, method, payload = null, timeoutMs = 35000) {
    return new Promise((resolve, reject) => {
        const bodyStr = payload ? JSON.stringify(payload) : '';
        const req = https.request(
            {
                hostname: 'api.telegram.org',
                path: `/bot${token}/${method}`,
                method: 'POST',
                agent: ipv4HttpsAgent,
                timeout: timeoutMs,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr)
                }
            },
            (res) => {
                let raw = '';
                res.on('data', (chunk) => { raw += chunk; });
                res.on('end', () => {
                    try {
                        resolve({ status: res.statusCode || 500, data: JSON.parse(raw) });
                    } catch (_) {
                        resolve({ status: res.statusCode || 500, data: null });
                    }
                });
            }
        );
        req.on('timeout', () => req.destroy(new Error('TELEGRAM_TIMEOUT')));
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

function splitTelegramHtmlChunks(htmlText, maxLen = 3800) {
    const str = String(htmlText || '');
    if (str.length <= maxLen) return [str];
    const chunks = [];
    let rest = str;
    while (rest.length > 0) {
        if (rest.length <= maxLen) {
            chunks.push(rest);
            break;
        }
        let cut = rest.lastIndexOf('\n', maxLen);
        if (cut < maxLen * 0.4) cut = maxLen;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^\n+/, '');
    }
    return chunks;
}

async function sendTelegramReply(token, chatId, htmlText, extra = {}) {
    if (!token || !chatId || !htmlText) return null;
    const chunks = splitTelegramHtmlChunks(htmlText);
    let lastMessage = null;
    for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        const payload = {
            chat_id: chatId,
            text: chunks[i],
            parse_mode: 'HTML',
            disable_web_page_preview: extra.disableWebPreview !== false
        };
        if (isLast && extra.replyMarkup) {
            payload.reply_markup = extra.replyMarkup;
        }
        if (i === 0 && extra.replyToMessageId) {
            payload.reply_to_message_id = extra.replyToMessageId;
        }
        try {
            const res = await callTelegramApi(token, 'sendMessage', payload, 12000);
            if (res?.data?.ok) {
                lastMessage = res.data.result;
            }
        } catch (err) {
            console.warn('⚠️ [Telegram Bot] 응답 발송 실패:', err.message);
        }
    }
    return lastMessage;
}

async function editTelegramMessage(token, chatId, messageId, htmlText, extra = {}) {
    if (!token || !chatId || !messageId || !htmlText) return false;
    const safeText = String(htmlText).slice(0, 4000);
    const payload = {
        chat_id: chatId,
        message_id: Number(messageId),
        text: safeText,
        parse_mode: 'HTML',
        disable_web_page_preview: extra.disableWebPreview !== false
    };
    if (extra.replyMarkup !== undefined) {
        payload.reply_markup = extra.replyMarkup;
    }
    try {
        const res = await callTelegramApi(token, 'editMessageText', payload, 12000);
        return Boolean(res?.data?.ok);
    } catch (err) {
        console.warn('⚠️ [Telegram Bot] 메시지 수정 실패:', err.message);
        return false;
    }
}

async function answerCallbackQuery(token, callbackQueryId, text = '', showAlert = false) {
    if (!token || !callbackQueryId) return false;
    try {
        const payload = { callback_query_id: callbackQueryId };
        if (text) payload.text = String(text).slice(0, 180);
        if (showAlert) payload.show_alert = true;
        const res = await callTelegramApi(token, 'answerCallbackQuery', payload, 8000);
        return Boolean(res?.data?.ok);
    } catch (_) {
        return false;
    }
}

async function sendTelegramChatAction(token, chatId, action = 'typing') {
    if (!token || !chatId) return;
    try {
        await callTelegramApi(token, 'sendChatAction', { chat_id: chatId, action }, 5000);
    } catch (_) {}
}

/**
 * 📤 알림 비서용 봇으로 인가된 관리자 텔레그램에 버튼 포함 메시지 발송
 */
async function sendAssistantTelegramToAdmins(htmlText, extra = {}) {
    const token = getAssistantBotToken();
    if (!token || !htmlText) return { sentCount: 0 };

    const recipients = await listAuthorizedTelegramRecipients({ role: 'admin' });
    let sentCount = 0;
    for (const r of recipients) {
        const msg = await sendTelegramReply(token, r.chatId, htmlText, extra);
        if (msg) sentCount += 1;
    }
    return { sentCount };
}

module.exports = {
    getAssistantBotToken,
    callTelegramApi,
    sendTelegramReply,
    editTelegramMessage,
    answerCallbackQuery,
    sendTelegramChatAction,
    sendAssistantTelegramToAdmins
};
