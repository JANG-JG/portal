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

const { getSystemConfig, getProfiles, SUBJECT_NAMES, dbAll } = require('./studyDb.service');
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

async function sendWeeklyStudyDigestToParents({ force = false } = {}) {
    if (!force && !(await isStudyTelegramNotifyEnabled())) return { sentCount: 0, skipped: true };
    const [profiles, completedRows, wrongRows] = await Promise.all([
        getProfiles(),
        dbAll(
            `SELECT child_id, subject, COUNT(*) AS cnt
             FROM study_worksheets
             WHERE completed_at IS NOT NULL AND completed_at >= datetime('now', 'localtime', '-7 days')
             GROUP BY child_id, subject`
        ).catch(() => []),
        dbAll(
            `SELECT child_id, subject, prompt, wrong_count
             FROM study_wrong_notes
             WHERE resolved = 0
             ORDER BY wrong_count DESC, id DESC LIMIT 6`
        ).catch(() => [])
    ]);

    const baseUrl = getBaseUrl();
    const lines = ['📊 <b>[어린이 학습실] 이번 주 성장 요약 리포트</b>', ''];
    for (const p of profiles) {
        const myDone = completedRows.filter((r) => r.child_id === p.id);
        const total = myDone.reduce((acc, r) => acc + Number(r.cnt || 0), 0);
        const subjSummary = myDone.map((r) => `${SUBJECT_NAMES[r.subject] || r.subject} ${r.cnt}`).join(', ') || '아직 없음';
        lines.push(`${p.avatar_emoji || '🎒'} <b>${escapeHtml(p.display_name)}</b>: 완료 <b>${total}장</b> (${escapeHtml(subjSummary)})`);
        const myWrong = wrongRows.filter((w) => w.child_id === p.id).slice(0, 2);
        if (myWrong.length) {
            lines.push(`   ↳ 복습 추천: ${myWrong.map((w) => escapeHtml(String(w.prompt || '').slice(0, 22))).join(' / ')}`);
        }
    }
    lines.push('', `👉 <a href="${baseUrl}/study">학습실 바로 열기</a>`);

    const primaryChild = profiles[0]?.id || 'first';
    const result = await publishNotificationEvent({
        service_key: 'study',
        event_type: 'study.weekly_digest',
        recipient_id: 'role:admin',
        title: '📊 이번 주 어린이 학습실 성장 요약',
        body: '아이별 완료 학습지와 복습 추천 문제를 확인해 주세요.',
        action_url: `${baseUrl}/study`,
        severity: 'normal',
        meta: {
            telegram_html: lines.join('\n'),
            telegram_reply_markup: {
                inline_keyboard: [[
                    { text: '주말 복습 학습지 만들기 📄', callback_data: `cb:study:gen:${primaryChild}:korean` }
                ]]
            }
        }
    });
    return { sentCount: result.telegramSentCount || 0, summaryLines: lines.length };
}

module.exports = {
    isStudyTelegramNotifyEnabled,
    notifyWorksheetCompletedToParents,
    notifyEggHatchedToParents,
    sendWeeklyStudyDigestToParents
};
