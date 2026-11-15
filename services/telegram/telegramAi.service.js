/**
 * ==============================================================================
 * 텔레그램 알림 비서 자연어 AI 대화 & 의도 실행 서비스 (telegramAi.service.js)
 * ------------------------------------------------------------------------------
 * - '/' 없는 일반 한국어 문장을 화이트리스트 + RBAC 권한 검증 후 처리
 * - 단순 실행("약 먹었어", "장보기 보여줘")은 즉시 처리, 복합 질문은 aiOrchestrator 연결
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 & XSS/HTML 안전 포맷팅
 * ==============================================================================
 */

const { runChatCompletion } = require('../ai/aiOrchestrator.service');
const { getSystemConfig } = require('../study/studyDb.service');
const { logTelegramCommand } = require('./telegramAuth.service');
const {
    sendTelegramReply,
    editTelegramMessage,
    sendTelegramChatAction
} = require('./telegramTransport.service');
const {
    getBloodStatusPayload,
    recordQuickMedicationFromTelegram
} = require('./telegramBlood.service');
const {
    buildInteractiveShoppingReply,
    buildInteractiveTodoReply
} = require('./telegramWiki.service');

const HISTORY_TTL_MS = 30 * 60 * 1000;
const conversationHistoryMap = new Map();

function getHistory(senderId) {
    const entry = conversationHistoryMap.get(senderId);
    if (!entry) return [];
    if (Date.now() - entry.updatedAt > HISTORY_TTL_MS) {
        conversationHistoryMap.delete(senderId);
        return [];
    }
    return entry.turns;
}

function pushHistory(senderId, userPrompt, assistantAnswer) {
    const prev = getHistory(senderId);
    const next = prev.concat([
        { role: 'user', content: String(userPrompt || '').slice(0, 400) },
        { role: 'assistant', content: String(assistantAnswer || '').slice(0, 600) }
    ]).slice(-6);
    conversationHistoryMap.set(senderId, { updatedAt: Date.now(), turns: next });
    if (conversationHistoryMap.size > 100) {
        const oldestKey = conversationHistoryMap.keys().next().value;
        conversationHistoryMap.delete(oldestKey);
    }
}

function formatMarkdownToTelegramHtml(rawText) {
    let escaped = String(rawText || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    escaped = escaped.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    escaped = escaped.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    return escaped.trim();
}

async function isTelegramAiEnabled() {
    try {
        const val = await getSystemConfig('telegram_ai_enabled', '1');
        return val !== '0';
    } catch (_) {
        return true;
    }
}

async function tryFastShortcutIntent(text, authUser) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const isAdminUser = authUser?.role === 'admin';

    if (/^(?:오늘\s*)?(?:혈압)?약\s*(?:먹었어|먹었다|먹음|먹었어요|챙겼어|복용\s*완료)[.!]?$/.test(normalized)) {
        if (!isAdminUser) {
            return { handled: true, text: '🔒 혈압 및 약 복용 기록은 관리자 계정 전용 기능이에요.' };
        }
        const res = await recordQuickMedicationFromTelegram();
        return { handled: true, text: res.messageHtml, replyMarkup: res.replyMarkup };
    }

    if (/^(?:오늘\s*)?(?:혈압|복약|약\s*복용)\s*(?:어때|알려줘|현황|상태|체크)[?？!]?$/.test(normalized)) {
        if (!isAdminUser) {
            return { handled: true, text: '🔒 혈압 및 약 복용 현황은 관리자 계정 전용 정보예요.' };
        }
        const card = await getBloodStatusPayload();
        return { handled: true, text: card.text, replyMarkup: card.replyMarkup };
    }

    if (/^(?:장보기\s*(?:목록|리스트|보여줘|뭐야|알려줘)|뭐\s*사야\s*돼)[?？!]?$/.test(normalized)) {
        const res = await buildInteractiveShoppingReply();
        return { handled: true, text: res.text, replyMarkup: res.replyMarkup };
    }

    if (/^(?:오늘\s*)?(?:할일|루틴)\s*(?:목록|리스트|보여줘|뭐야|알려줘)[?？!]?$/.test(normalized)) {
        const res = await buildInteractiveTodoReply();
        return { handled: true, text: res.text, replyMarkup: res.replyMarkup };
    }

    return { handled: false };
}

async function handleNaturalTelegramMessage({ token, chatId, senderId, text, authUser }) {
    const clean = String(text || '').trim();
    if (!clean) return;

    const fast = await tryFastShortcutIntent(clean, authUser);
    if (fast.handled) {
        await sendTelegramReply(token, chatId, fast.text, fast.replyMarkup ? { replyMarkup: fast.replyMarkup } : {});
        await logTelegramCommand({ senderId, command: 'natural_quick', status: 'ok', detail: clean.slice(0, 60) });
        return;
    }

    if (!(await isTelegramAiEnabled())) {
        await sendTelegramReply(
            token,
            chatId,
            '🤖 현재 일반 대화 AI 비서가 잠시 꺼져 있어요.\n<code>/도움말</code>을 입력하시면 빠른 명령어를 바로 쓰실 수 있어요!'
        );
        await logTelegramCommand({ senderId, command: 'ai_disabled', status: 'ok', detail: clean.slice(0, 40) });
        return;
    }

    await sendTelegramChatAction(token, chatId, 'typing');
    const placeholder = await sendTelegramReply(token, chatId, '🤔 <b>잠시만요, 확인하고 있어요...</b>');
    const typingInterval = setInterval(() => {
        sendTelegramChatAction(token, chatId, 'typing').catch(() => {});
    }, 4500);
    let noticeUpdated = false;
    let finished = false;
    const slowNoticeTimer = setTimeout(() => {
        if (!finished && !noticeUpdated && placeholder && placeholder.message_id) {
            noticeUpdated = true;
            editTelegramMessage(
                token,
                chatId,
                placeholder.message_id,
                '⏳ <b>AI가 포털 데이터를 읽고 답변을 정리하고 있어요...</b>\n(처음 답할 때는 30초~1분 이상 걸릴 수 있어요 😊)'
            ).catch(() => {});
        }
    }, 18000);

    try {
        const userCtx = {
            username: authUser.portalUsername || 'upt0731',
            role: authUser.role || 'family'
        };
        const result = await runChatCompletion({
            prompt: clean,
            history: getHistory(senderId),
            user: userCtx,
            preference: 'auto',
            requestType: 'telegram_chat',
            onStatus: async (evt) => {
                if (!finished && evt?.type === 'model_loading' && !noticeUpdated && placeholder?.message_id) {
                    noticeUpdated = true;
                    await editTelegramMessage(
                        token,
                        chatId,
                        placeholder.message_id,
                        '⏳ <b>AI 대화 모델을 메모리에 새로 불러오는 중이에요...</b>\n(모델 준비에 약 30~60초 정도 걸릴 수 있어요 😊)'
                    ).catch(() => {});
                }
            }
        });

        finished = true;
        clearTimeout(slowNoticeTimer);
        clearInterval(typingInterval);

        const formattedHtml = formatMarkdownToTelegramHtml(result.answer || '답변을 준비하지 못했어요.');
        if (!result.blocked && !result.fallback && result.ok) {
            pushHistory(senderId, clean, result.answer);
        }

        if (placeholder && placeholder.message_id && formattedHtml.length <= 3800) {
            const edited = await editTelegramMessage(token, chatId, placeholder.message_id, formattedHtml);
            if (!edited) {
                await sendTelegramReply(token, chatId, formattedHtml);
            }
        } else {
            await sendTelegramReply(token, chatId, formattedHtml);
        }

        await logTelegramCommand({
            senderId,
            command: 'ai_chat',
            status: result.ok ? (result.fallback ? 'fallback' : 'ok') : 'error',
            detail: `${result.model || 'ai'}:${clean.slice(0, 45)}`
        });
    } catch (err) {
        clearTimeout(slowNoticeTimer);
        clearInterval(typingInterval);
        console.error('⚠️ [Telegram AI] 자연어 처리 오류:', err.message);
        await logTelegramCommand({ senderId, command: 'ai_chat', status: 'error', detail: err.message });
        const errMsg = '⚠️ 답변을 만드는 중 일시적인 문제가 생겼어요. 잠시 후 다시 말씀해 주세요!';
        if (placeholder && placeholder.message_id) {
            await editTelegramMessage(token, chatId, placeholder.message_id, errMsg);
        } else {
            await sendTelegramReply(token, chatId, errMsg);
        }
    }
}

module.exports = {
    handleNaturalTelegramMessage
};
