/**
 * ==============================================================================
 * 어린이 학습실 ↔ 알림 비서용 텔레그램 봇 부모 양방향 알림 서비스
 * (studyTelegramNotify.service.js)
 * ------------------------------------------------------------------------------
 * - 알림 비서용 봇(STUDY_TELEGRAM_BOT_TOKEN)으로 학습 완료·알 부화 알림 및 승인 버튼 발송
 * - 뉴스·자산 일방 알림 봇 및 서버 경보 봇과 완전 분리
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const { getSystemConfig, getProfiles, SUBJECT_NAMES } = require('./studyDb.service');
const { getPokemonById } = require('./pokemonCatalog.data');
const { publishNotificationEvent } = require('../notification/hub.service');

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getBaseUrl() {
    return (process.env.PORTAL_PUBLIC_URL || 'https://j-jg.cc').replace(/\/+$/, '');
}

async function isStudyTelegramNotifyEnabled() {
    try {
        const val = await getSystemConfig('telegram_study_notify_enabled', '1');
        return val !== '0';
    } catch (_) {
        return true;
    }
}

async function resolveChildProfile(childId) {
    try {
        const profiles = await getProfiles();
        return profiles.find((p) => p.id === childId) || null;
    } catch (_) {
        return null;
    }
}

async function notifyWorksheetCompletedToParents({ childId, sheetTitle, subject, level, earnedCount, alreadyAwarded }) {
    if (alreadyAwarded) return { sentCount: 0 };
    if (!(await isStudyTelegramNotifyEnabled())) return { sentCount: 0 };

    const profile = await resolveChildProfile(childId);
    const childName = profile?.display_name || (childId === 'first' ? '첫째' : '둘째');
    const childEmoji = profile?.avatar_emoji || '🎒';
    const subjectLabel = SUBJECT_NAMES[subject] || '학습';
    const baseUrl = getBaseUrl();

    const text = [
        `${childEmoji} <b>[${escapeHtml(childName)}] 학습지를 끝까지 풀었어요!</b>`,
        `• 과목: <b>${escapeHtml(subjectLabel)}</b> (Lv.${Number(level || 1)})`,
        `• 제목: ${escapeHtml(sheetTitle || '맞춤 학습지')}`,
        `• 칭찬 도장판: <b>${Number(earnedCount || 0)} / 10칸</b> 🌟`,
        '',
        `👉 <a href="${baseUrl}/study?childId=${encodeURIComponent(childId)}">학습실 현황 보기</a>`
    ].join('\n');

    const replyMarkup = {
        inline_keyboard: [
            [
                { text: '칭찬 도장 +1 더 🌟', callback_data: `cb:study:bonus:${childId}` },
                { text: '다음 학습지 만들기 📄', callback_data: `cb:study:gen:${childId}:${subject || 'korean'}` }
            ]
        ]
    };

    const result = await publishNotificationEvent({
        service_key: 'study',
        event_type: 'study.worksheet_completed',
        recipient_id: 'role:admin',
        title: `${childEmoji} [${childName}] 학습지를 끝까지 풀었어요!`,
        body: `${subjectLabel}(Lv.${Number(level || 1)}) · ${sheetTitle || '맞춤 학습지'} (도장 ${Number(earnedCount || 0)}/10칸)`,
        action_url: `${baseUrl}/study?childId=${encodeURIComponent(childId)}`,
        severity: 'normal',
        meta: {
            telegram_html: text,
            telegram_reply_markup: replyMarkup
        }
    });
    return { sentCount: result.telegramSentCount || 0 };
}

async function notifyEggHatchedToParents({ childId, cycleNo, pokemonId, totalEarned }) {
    if (!(await isStudyTelegramNotifyEnabled())) return { sentCount: 0 };

    const profile = await resolveChildProfile(childId);
    const childName = profile?.display_name || (childId === 'first' ? '첫째' : '둘째');
    const reward = profile?.target_reward || '약속한 칭찬 선물';
    const poke = getPokemonById(pokemonId);
    const baseUrl = getBaseUrl();

    const text = [
        `🥚🎉 <b>[${escapeHtml(childName)}] 10칸 완성! '${escapeHtml(poke.nameKo)}' 부화!</b>`,
        `• 도장판: <b>${Number(cycleNo || 1)}번째 판 완성</b> (총 ${Number(totalEarned || 10)}개)`,
        `• 새 포켓몬: ${poke.typeEmoji} <b>${escapeHtml(poke.nameKo)}</b> (${escapeHtml(poke.typeLabel)} · ${escapeHtml(poke.rarity)})`,
        `• 약속한 보상: 🎁 <b>${escapeHtml(reward)}</b>`,
        '',
        `아이 화면에 <b>부모님 보상 승인</b> 배지를 바로 띄워줄까요?`,
        `👉 <a href="${baseUrl}/study?childId=${encodeURIComponent(childId)}">학습실 열기</a>`
    ].join('\n');

    const replyMarkup = {
        inline_keyboard: [
            [
                { text: '보상 약속 승인 ✅', callback_data: `cb:study:approve:${childId}:${Number(cycleNo || 1)}` },
                { text: '다음 새 알 준비 🥚', callback_data: `cb:study:next:${childId}` }
            ]
        ]
    };

    const result = await publishNotificationEvent({
        service_key: 'study',
        event_type: 'study.egg_hatched',
        recipient_id: 'role:admin',
        title: `🥚 [${childName}] '${poke.nameKo}' 알 부화!`,
        body: `도장판 ${Number(cycleNo || 1)}번째 완성! 보상(${reward})을 확인해 주세요.`,
        action_url: `${baseUrl}/study?childId=${encodeURIComponent(childId)}`,
        severity: 'high',
        dedup_key: `study:egg_hatch:${childId}:${Number(cycleNo || 1)}`,
        meta: {
            telegram_html: text,
            telegram_reply_markup: replyMarkup
        }
    });
    return { sentCount: result.telegramSentCount || 0 };
}

module.exports = {
    isStudyTelegramNotifyEnabled,
    notifyWorksheetCompletedToParents,
    notifyEggHatchedToParents
};
