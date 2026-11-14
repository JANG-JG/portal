/**
 * ==============================================================================
 * 텔레그램 양방향 봇 폴링 워커 (telegramBot.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 3] IPv4 강제 HTTPS Agent + 싱글톤(isPrimaryWorker) 실행 + 409 충돌 안전 회피
 * ==============================================================================
 */

const https = require('https');
const { isAuthorizedTelegramUser, logTelegramCommand } = require('./telegramAuth.service');
const { executeTelegramCommand } = require('./telegramCommands.service');

const ipv4HttpsAgent = new https.Agent({ family: 4 });

let isPollingStarted = false;
let stopRequested = false;
let currentOffset = 0;

function getBotToken() {
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
                    } catch (e) {
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

async function sendTelegramReply(token, chatId, htmlText) {
    if (!token || !chatId || !htmlText) return;
    try {
        await callTelegramApi(
            token,
            'sendMessage',
            {
                chat_id: chatId,
                text: htmlText,
                parse_mode: 'HTML',
                disable_web_page_preview: false
            },
            10000
        );
    } catch (e) {
        console.warn('⚠️ [Telegram Bot] 응답 발송 실패:', e.message);
    }
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
                    allowed_updates: ['message']
                },
                32000
            );

            if (res.status === 409) {
                console.warn('⚠️ [Telegram Bot] 409 Conflict 감지 (다른 폴링 인스턴스 동작 중) — 30초 대기');
                backoffMs = 30000;
            } else if (res.data && res.data.ok && Array.isArray(res.data.result)) {
                for (const update of res.data.result) {
                    currentOffset = Math.max(currentOffset, update.update_id + 1);
                    const msg = update.message;
                    if (!msg || !msg.text || !msg.from) continue;

                    const senderId = String(msg.from.id);
                    const chatId = String(msg.chat.id);
                    const text = String(msg.text || '').trim();
                    if (!text.startsWith('/')) continue;

                    const authUser = await isAuthorizedTelegramUser(senderId);
                    if (!authUser) {
                        await logTelegramCommand({
                            senderId,
                            command: text.split(/\s+/)[0],
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

                    const reply = await executeTelegramCommand(text, authUser, senderId);
                    if (reply) {
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
    console.log('🤖 [Telegram Bot] 양방향 제어 폴링 시작 (암호화 화이트리스트 인증 활성)');
    pollLoop(token).catch((err) => console.error('❌ [Telegram Bot] 치명적 오류:', err));
}

function stopTelegramBotPolling() {
    stopRequested = true;
}

module.exports = {
    initTelegramBotPolling,
    stopTelegramBotPolling
};
