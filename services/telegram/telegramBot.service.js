/**
 * ==============================================================================
 * 텔레그램 양방향 봇 폴링 워커 (telegramBot.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 3] IPv4 강제 HTTPS Agent + 싱글톤(isPrimaryWorker) 실행 + 409 충돌 안전 회피
 * ==============================================================================
 */

const { isAuthorizedTelegramUser, logTelegramCommand } = require('./telegramAuth.service');
const { executeTelegramCommand } = require('./telegramCommands.service');
const { handleNaturalTelegramMessage } = require('./telegramAi.service');
const { handleTelegramCallbackQuery } = require('./telegramCallbacks.service');
const {
    getAssistantBotToken,
    callTelegramApi,
    sendTelegramReply
} = require('./telegramTransport.service');

let isPollingStarted = false;
let stopRequested = false;
let currentOffset = 0;

function getBotToken() {
    return getAssistantBotToken();
}

async function pollLoop(token) {
    while (!stopRequested) {
        let backoffMs = 1500;
        try {
            const res = await callTelegramApi(
                token,
                'getUpdates',
                {
                    offset: currentOffset,
                    timeout: 25,
                    allowed_updates: ['message', 'callback_query']
                },
                32000
            );

            if (res.status === 409) {
                console.warn('⚠️ [Telegram Bot] 409 Conflict 감지 (다른 폴링 인스턴스 동작 중) — 30초 대기');
                backoffMs = 30000;
            } else if (res.data && res.data.ok && Array.isArray(res.data.result)) {
                for (const update of res.data.result) {
                    currentOffset = Math.max(currentOffset, update.update_id + 1);

                    if (update.callback_query) {
                        await handleTelegramCallbackQuery(token, update.callback_query);
                        continue;
                    }

                    const msg = update.message;
                    if (!msg || !msg.text || !msg.from) continue;

                    const senderId = String(msg.from.id);
                    const chatId = String(msg.chat.id);
                    const text = String(msg.text || '').trim();
                    if (!text) continue;

                    const authUser = await isAuthorizedTelegramUser(senderId);
                    if (!authUser) {
                        await logTelegramCommand({
                            senderId,
                            command: text.startsWith('/') ? text.split(/\s+/)[0] : 'natural_denied',
                            status: 'denied',
                            detail: 'unauthorized_sender'
                        });
                        await sendTelegramReply(
                            token,
                            chatId,
                            '🔒 등록된 가족 계정만 이용할 수 있어요. 관리자 페이지에서 텔레그램 ID를 먼저 등록해 주세요.'
                        );
                        continue;
                    }

                    if (!text.startsWith('/')) {
                        handleNaturalTelegramMessage({ token, chatId, senderId, text, authUser }).catch((aiErr) => {
                            console.warn('⚠️ [Telegram Bot] 자연어 처리 비동기 오류:', aiErr.message);
                        });
                        continue;
                    }

                    const reply = await executeTelegramCommand(text, authUser, senderId);
                    if (reply && typeof reply === 'object' && reply.text) {
                        await sendTelegramReply(token, chatId, reply.text, {
                            replyMarkup: reply.replyMarkup
                        });
                    } else if (typeof reply === 'string' && reply) {
                        await sendTelegramReply(token, chatId, reply);
                    }
                }
                backoffMs = 500;
            }
        } catch (err) {
            if (err.message !== 'TELEGRAM_TIMEOUT') {
                console.warn('⚠️ [Telegram Bot] 폴링 오류:', err.message);
                backoffMs = 8000;
            } else {
                backoffMs = 500;
            }
        }
        await new Promise((r) => setTimeout(r, backoffMs));
    }
}

function initTelegramBotPolling() {
    if (isPollingStarted) return;
    if (process.env.DISABLE_TELEGRAM_POLLING === 'true') {
        console.log('🧪 [Telegram Bot] DISABLE_TELEGRAM_POLLING=true 설정으로 폴링 생략');
        return;
    }
    const token = getBotToken();
    if (!token) {
        console.log('ℹ️ [Telegram Bot] 봇 토큰 미설정으로 양방향 폴링 대기');
        return;
    }
    isPollingStarted = true;
    stopRequested = false;
    console.log('🤖 [Telegram Bot] 양방향 제어 + AI 대화 + 인라인 버튼 폴링 시작 (암호화 화이트리스트 인증 활성)');
    pollLoop(token).catch((err) => console.error('❌ [Telegram Bot] 치명적 오류:', err));
}

function stopTelegramBotPolling() {
    stopRequested = true;
}

module.exports = {
    initTelegramBotPolling,
    stopTelegramBotPolling
};
