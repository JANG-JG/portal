/**
 * ==============================================================================
 * 텔레그램 인라인 버튼(callback_query) 중앙 라우터 (telegramCallbacks.service.js)
 * ------------------------------------------------------------------------------
 * - cb:blood:* -> 약 복용 원탭 완료 / 1시간 다시 알림 (관리자 role === 'admin' 전용)
 * - cb:wiki:*  -> 장보기·할일 원탭 완료 및 목록 새로고침
 * - cb:study:* -> 학습실 보너스 도장 / 맞춤 학습지 생성 / 알 부화 보상 승인
 * - [규칙 2] 100% 한국어 | [규칙 3] 화이트리스트 + 역할(RBAC) 재검증 & 감사 로그
 * ==============================================================================
 */

const { isAuthorizedTelegramUser, logTelegramCommand } = require('./telegramAuth.service');
const {
    sendTelegramReply,
    editTelegramMessage,
    answerCallbackQuery
} = require('./telegramTransport.service');
const {
    recordQuickMedicationFromTelegram,
    scheduleMedSnoozeJob
} = require('./telegramBlood.service');
const {
    toggleFamilyTodo,
    buildInteractiveShoppingReply,
    buildInteractiveTodoReply
} = require('./telegramWiki.service');
const {
    normalizeChildId,
    normalizeSubject,
    getProfiles,
    awardStamp,
    resetCurrentStampBoard,
    SUBJECT_NAMES
} = require('../study/studyDb.service');
const { approveEggReward } = require('../study/studyPokemon.service');
const { generateAndSaveWorksheet } = require('../study/geminiWorksheet.service');

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function handleBloodCallback(token, cbQuery, action, arg1, authUser) {
    const chatId = String(cbQuery.message?.chat?.id || '');
    const msgId = cbQuery.message?.message_id;

    if (authUser.role !== 'admin') {
        await answerCallbackQuery(token, cbQuery.id, '🔒 혈압·복약 제어는 관리자 전용 기능이에요.', true);
        return { status: 'denied', detail: 'non_admin_blood_callback' };
    }

    if (action === 'med_done') {
        const res = await recordQuickMedicationFromTelegram();
        await answerCallbackQuery(token, cbQuery.id, '💊 오늘 약 복용 완료로 기록했어요!');
        if (chatId && msgId) {
            await editTelegramMessage(token, chatId, msgId, res.messageHtml, { replyMarkup: res.replyMarkup });
        }
        return { status: 'ok', detail: `streak:${res.streakDays}` };
    }

    if (action === 'med_snooze') {
        const mins = Math.min(180, Math.max(10, Number(arg1) || 60));
        const dueTime = await scheduleMedSnoozeJob({
            chatId,
            senderId: String(cbQuery.from.id),
            delayMinutes: mins
        });
        await answerCallbackQuery(token, cbQuery.id, `⏰ ${dueTime}에 다시 알려드릴게요!`);
        if (chatId && msgId) {
            await editTelegramMessage(
                token,
                chatId,
                msgId,
                `⏰ <b>약 챙겨먹기 다시 알림 예약</b>\n• <b>${dueTime}</b> (${mins}분 뒤)에 다시 안내해 드릴게요!`,
                {
                    replyMarkup: {
                        inline_keyboard: [[{ text: '지금 먹었어요 ✅', callback_data: 'cb:blood:med_done:today' }]]
                    }
                }
            );
        }
        return { status: 'ok', detail: `snooze:${mins}m` };
    }

    await answerCallbackQuery(token, cbQuery.id, '지원하지 않는 요청이에요.');
    return { status: 'ignored', detail: action };
}

async function handleWikiCallback(token, cbQuery, action, arg1, arg2) {
    const chatId = String(cbQuery.message?.chat?.id || '');
    const msgId = cbQuery.message?.message_id;
    const scope = (action === 'refresh' ? arg1 : arg2) === 'shop' ? 'shop' : 'todo';

    if (action === 'done') {
        const todoId = Number(arg1);
        if (!Number.isInteger(todoId) || todoId <= 0) {
            await answerCallbackQuery(token, cbQuery.id, '올바르지 않은 항목 번호예요.');
            return { status: 'error', detail: 'invalid_todo_id' };
        }
        const toggled = await toggleFamilyTodo(todoId);
        if (!toggled) {
            await answerCallbackQuery(token, cbQuery.id, '이미 삭제되었거나 찾지 못했어요.');
            return { status: 'error', detail: `not_found:${todoId}` };
        }
        await answerCallbackQuery(
            token,
            cbQuery.id,
            toggled.isCompleted ? '✅ 완료 처리했어요!' : '⬜ 미완료로 되돌렸어요.'
        );
    } else if (action === 'refresh') {
        await answerCallbackQuery(token, cbQuery.id, '🔄 최신 목록으로 새로고침했어요!');
    } else {
        await answerCallbackQuery(token, cbQuery.id, '알 수 없는 요청이에요.');
        return { status: 'ignored', detail: action };
    }

    if (chatId && msgId) {
        const refreshed = scope === 'shop'
            ? await buildInteractiveShoppingReply()
            : await buildInteractiveTodoReply();
        await editTelegramMessage(token, chatId, msgId, refreshed.text, { replyMarkup: refreshed.replyMarkup });
    }
    return { status: 'ok', detail: `${scope}:${action}:${arg1 || ''}` };
}

async function handleStudyCallback(token, cbQuery, action, arg1, arg2, authUser) {
    const chatId = String(cbQuery.message?.chat?.id || '');
    const msgId = cbQuery.message?.message_id;
    const baseUrl = (process.env.PORTAL_PUBLIC_URL || 'https://j-jg.cc').replace(/\/+$/, '');

    if (authUser.role !== 'admin') {
        await answerCallbackQuery(token, cbQuery.id, '🔒 부모님 확인 기능은 관리자만 누를 수 있어요.', true);
        return { status: 'denied', detail: 'non_admin_study_callback' };
    }

    const childId = normalizeChildId(arg1 || 'first');
    const profiles = await getProfiles().catch(() => []);
    const childProfile = profiles.find((p) => p.id === childId);
    const childName = childProfile?.display_name || (childId === 'first' ? '첫째' : '둘째');

    if (action === 'bonus') {
        const out = await awardStamp({
            childId,
            sourceType: 'paper',
            note: `부모님 텔레그램 보너스 도장 (${authUser.label || '부모'}) 🌟`,
            byParent: true
        });
        await answerCallbackQuery(
            token,
            cbQuery.id,
            out.reachedTen
                ? `🎉 [${childName}] 10칸 완성! 알이 부화했어요!`
                : `🌟 [${childName}] 칭찬 도장 +1 (${out.board?.earnedCount || 0}/10칸)`
        );
        if (chatId && msgId && cbQuery.message?.text) {
            const stampText = `\n\n✅ <i>부모님 보너스 도장 +1 부여 완료 (${out.board?.earnedCount || 0}/10칸)</i>`;
            if (!cbQuery.message.text.includes('보너스 도장 +1 부여 완료')) {
                await editTelegramMessage(token, chatId, msgId, `${escapeHtml(cbQuery.message.text)}${stampText}`);
            }
        }
        return { status: 'ok', detail: `bonus:${childId}:${out.board?.earnedCount || 0}` };
    }

    if (action === 'approve') {
        const cycleNo = Math.max(1, Number(arg2) || 1);
        await approveEggReward(childId, cycleNo, authUser.label || authUser.portalUsername || '부모님');
        await answerCallbackQuery(token, cbQuery.id, `🎁 [${childName}] 보상 약속 승인 완료!`);
        if (chatId && msgId) {
            await editTelegramMessage(
                token,
                chatId,
                msgId,
                [
                    `🎉 <b>[${escapeHtml(childName)}] ${cycleNo}번째 도장판 보상 약속 승인 완료!</b>`,
                    `• 승인자: <b>${escapeHtml(authUser.label || '부모님')}</b>`,
                    `• 아이 태블릿 학습실에 "부모님이 선물을 승인했어요!" 배지가 표시됩니다.`,
                    `👉 <a href="${baseUrl}/study?childId=${encodeURIComponent(childId)}">학습실 열기</a>`
                ].join('\n'),
                {
                    replyMarkup: {
                        inline_keyboard: [[{ text: '다음 새 알 준비하기 🥚', callback_data: `cb:study:next:${childId}` }]]
                    }
                }
            );
        }
        return { status: 'ok', detail: `approve:${childId}:${cycleNo}` };
    }

    if (action === 'next') {
        const out = await resetCurrentStampBoard(childId);
        await answerCallbackQuery(token, cbQuery.id, `🥚 [${childName}] 새 도장판을 준비했어요!`);
        await sendTelegramReply(
            token,
            chatId,
            `🥚 <b>[${escapeHtml(childName)}] 새 도장판(${out.cycleNo}번째)이 시작되었어요!</b>\n도장 10칸을 모으면 새로운 포켓몬 친구가 깨어납니다.`
        );
        return { status: 'ok', detail: `next:${childId}:${out.cycleNo}` };
    }

    if (action === 'gen') {
        const subject = normalizeSubject(arg2 || 'korean');
        const sheet = await generateAndSaveWorksheet({
            childId,
            subject,
            theme: '동물 친구',
            createdBy: `telegram_btn:${authUser.portalUsername}`
        });
        await answerCallbackQuery(token, cbQuery.id, `📄 [${childName}] ${SUBJECT_NAMES[sheet.subject]} 학습지 완성!`);
        await sendTelegramReply(
            token,
            chatId,
            `🎒 <b>[${escapeHtml(childName)}] 새 ${SUBJECT_NAMES[sheet.subject]} 학습지가 준비되었어요!</b>\n👉 <a href="${baseUrl}/study/sheet/${sheet.id}">태블릿으로 바로 열기</a>`
        );
        return { status: 'ok', detail: `gen:${childId}:${sheet.id}` };
    }

    await answerCallbackQuery(token, cbQuery.id, '알 수 없는 학습실 작업이에요.');
    return { status: 'ignored', detail: action };
}

async function handleTelegramCallbackQuery(token, cbQuery) {
    if (!cbQuery || !cbQuery.id || !cbQuery.from) return;
    const senderId = String(cbQuery.from.id);
    const data = String(cbQuery.data || '').trim();

    const authUser = await isAuthorizedTelegramUser(senderId);
    if (!authUser) {
        await answerCallbackQuery(token, cbQuery.id, '🔒 등록된 가족 계정만 이용할 수 있어요.', true);
        await logTelegramCommand({ senderId, command: data.slice(0, 50) || 'callback', status: 'denied', detail: 'unauthorized_sender' });
        return;
    }

    const parts = data.split(':');
    if (parts[0] !== 'cb' || parts.length < 3) {
        await answerCallbackQuery(token, cbQuery.id, '올바르지 않은 버튼 요청이에요.');
        return;
    }

    const [, domain, action, arg1, arg2] = parts;
    let outcome = { status: 'ignored', detail: data };
    try {
        if (domain === 'blood') {
            outcome = await handleBloodCallback(token, cbQuery, action, arg1, authUser);
        } else if (domain === 'wiki') {
            outcome = await handleWikiCallback(token, cbQuery, action, arg1, arg2);
        } else if (domain === 'study') {
            outcome = await handleStudyCallback(token, cbQuery, action, arg1, arg2, authUser);
        } else {
            await answerCallbackQuery(token, cbQuery.id, '알 수 없는 버튼 도메인이에요.');
        }
    } catch (err) {
        console.error(`⚠️ [Telegram Callback] 처리 오류 (${data}):`, err);
        outcome = { status: 'error', detail: err.message };
        await answerCallbackQuery(token, cbQuery.id, '⚠️ 처리 중 오류가 발생했어요.', true);
    }

    await logTelegramCommand({
        senderId,
        command: data.slice(0, 55),
        status: outcome.status,
        detail: String(outcome.detail || '').slice(0, 120)
    });
}

module.exports = {
    handleTelegramCallbackQuery
};
