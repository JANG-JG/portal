/**
 * ==============================================================================
 * 텔레그램 양방향 명령 파서 & 포털 DB/학습지 실행기 (telegramCommands.service.js)
 * ------------------------------------------------------------------------------
 * - /메모 [내용] -> portalDb user_memos AES-256-GCM 암호화 저장
 * - /일정 [날짜/시간 + 내용] -> portalDb calendar_events AES-256-GCM 저장
 * - /조회 [메모|일정] -> 복호화된 최근 메모·다가오는 일정 요약
 * - /삭제 [메모|일정] [ID] -> 소유권 검증 후 삭제
 * - /학습지 [첫째|둘째] [한글|수학|영어] [테마] -> 즉시 생성 후 /study/sheet/:id 링크 회신
 * ==============================================================================
 */

const { portalDb } = require('../db');
const {
    encryptMemoText,
    decryptMemoText,
    encryptCalendarText,
    decryptCalendarText
} = require('../crypto.service');
const { parseKoreanDateTime, getKstDate } = require('../aiActionAgent.service');
const {
    normalizeChildId,
    normalizeSubject,
    getWeeklyBalanceRecommendation,
    SUBJECT_NAMES
} = require('../study/studyDb.service');
const { generateAndSaveWorksheet } = require('../study/geminiWorksheet.service');
const { logTelegramCommand } = require('./telegramAuth.service');
const {
    handleWikiCommand,
    handleWikiCreateCommand,
    handleShoppingCommand,
    handleTodoCommand,
    handleDoneCommand,
    deleteFamilyTodo
} = require('./telegramWiki.service');
const {
    getBloodStatusPayload,
    recordQuickMedicationFromTelegram
} = require('./telegramBlood.service');

function pGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
}
function pAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}
function pRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function cleanScheduleTitle(rawText) {
    return String(rawText || '')
        .replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/g, ' ')
        .replace(/\d{1,2}월\s*\d{1,2}일/g, ' ')
        .replace(/(?:오늘|내일|모레|글피)\b/g, ' ')
        .replace(/\d+\s*일\s*(?:뒤|후)/g, ' ')
        .replace(/(?:이번|다음)\s*주?\s*[월화수목금토일]요일/g, ' ')
        .replace(/(?:오전|오후|아침|저녁|밤|새벽|낮)\s*\d{1,2}시(?:\s*\d{1,2}분|\s*반)?/g, ' ')
        .replace(/\d{1,2}:\d{2}/g, ' ')
        .replace(/\d{1,2}시(?:\s*\d{1,2}분|\s*반)?/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildHelpText() {
    return [
        '🤖 <b>[JG 포털] 알림 비서 &amp; AI 도우미 안내</b>',
        '',
        '💬 <b>자연어 대화 (슬래시 / 없이 바로 질문 가능!)</b>',
        '• <i>"오늘 날씨랑 뉴스 요약해줘"</i> / <i>"이번 주 일정 알려줘"</i> / <i>"약 먹었어"</i>',
        '',
        '⚡ <b>빠른 명령어</b>',
        '• <code>/혈압</code> / <code>/약</code> / <code>/약먹음</code> — 혈압·복약 상태 조회 및 원탭 체크 (관리자)',
        '• <code>/메모 장보기 우유, 계란</code> — 포털 메모장에 암호화 저장',
        '• <code>/일정 내일 오후 3시 첫째 소아과</code> — 가족 공유 일정 등록',
        '• <code>/개인일정 내일 오후 2시 치과</code> (또는 <code>/일정 개인 치과</code>) — 내 개인 일정 등록',
        '• <code>/조회</code> (<code>메모</code> | <code>일정</code> | <code>장보기</code> | <code>할일</code> | <code>위키</code>) — 최근 목록 조회',
        '• <code>/삭제 메모 12</code> / <code>/삭제 일정 5</code> / <code>/삭제 할일 3</code> — 해당 번호 삭제',
        '• <code>/위키 공기청정기</code> / <code>/위키등록 제목 | 내용</code> — 가족 위키 검색·등록',
        '• <code>/장보기 우유, 계란</code> / <code>/할일 필터 청소</code> / <code>/완료 3</code> — 위키 버튼 원탭 완료 연동',
        '• <code>/학습지 첫째 공룡</code> (또는 <code>/학습지 둘째 한글 딸기</code>) — 태블릿 학습지 생성 후 링크 발송'
    ].join('\n');
}

async function handleMemoCommand(argText, authUser) {
    const content = argText.trim();
    if (!content) {
        return '📝 저장할 내용을 함께 입력해 주세요.\n예: <code>/메모 우유, 계란 사기</code>';
    }
    const titleRaw = content.length > 20 ? `${content.slice(0, 20)}...` : content;
    const encTitle = encryptMemoText(titleRaw, authUser.portalUsername);
    const encContent = encryptMemoText(content, authUser.portalUsername);

    const res = await pRun(
        `INSERT INTO user_memos (user_id, title, content, category, color, is_pinned, updated_at)
         VALUES (?, ?, ?, '텔레그램', '#fbbf24', 0, datetime('now', 'localtime'))`,
        [authUser.portalUsername, encTitle, encContent]
    );
    return `✅ <b>메모 저장 완료</b> (번호: #${res.lastID})\n• 내용: ${escapeHtml(content)}`;
}

async function handleScheduleCommand(argText, authUser, forcedScope = 'auto') {
    let text = argText.trim();
    if (!text) {
        return [
            '📅 일정 날짜와 내용을 입력해 주세요.',
            '• 가족 공유: <code>/일정 내일 오후 3시 소아과 예방접종</code>',
            '• 개인 일정: <code>/개인일정 내일 오후 2시 치과</code> 또는 <code>/일정 개인 치과</code>'
        ].join('\n');
    }

    let isFamily = 1;
    if (forcedScope === 'personal') {
        isFamily = 0;
    } else if (forcedScope === 'family') {
        isFamily = 1;
    } else if (/^(?:개인|개인용|개인일정|나만|비공개)\s+/.test(text) || /(?:^|\s)(?:개인\s*일정|개인용|나만\s*볼|비공개)(?:\s|$)/.test(text)) {
        isFamily = 0;
    }

    // 선행 구분 키워드('개인 ...', '가족공유 ...')만 깔끔히 제거 (예: '가족 외식'의 '가족'은 제목으로 유지)
    text = text
        .replace(/^(?:개인용|개인일정|개인|나만|비공개|가족공유|가족용|공유일정|공유)\s+/i, '')
        .trim();

    const parsed = parseKoreanDateTime(text);
    const cleaned = cleanScheduleTitle(text) || text;
    const encTitle = encryptCalendarText(cleaned, authUser.portalUsername, Boolean(isFamily));
    const category = isFamily ? '가족' : '개인';
    const color = isFamily ? '#ec4899' : '#6366f1';

    const res = await pRun(
        `INSERT INTO calendar_events (user_id, title, event_date, event_time, category, color, memo, is_all_day, is_family, notify_timing, notify_repeat)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 'exact', 1)`,
        [authUser.portalUsername, encTitle, parsed.dateStr, parsed.eventTime || '', category, color, parsed.isAllDay ? 1 : 0, isFamily]
    );

    const timeLabel = parsed.isAllDay || !parsed.eventTime ? '종일' : parsed.eventTime;
    const scopeLabel = isFamily ? '가족 공유 일정 👨‍👩‍👧‍👦' : '내 개인 일정 🔒';
    return [
        `📅 <b>${scopeLabel} 등록 완료</b> (번호: #${res.lastID})`,
        `• 날짜: <b>${parsed.dateStr}</b> (${timeLabel})`,
        `• 내용: ${escapeHtml(cleaned)}`
    ].join('\n');
}

async function handleQueryCommand(argText, authUser) {
    const mode = argText.trim();
    if (mode.includes('장보기')) return handleShoppingCommand('조회');
    if (mode.includes('할일') || mode.includes('루틴')) return handleTodoCommand('조회');
    if (mode.includes('위키')) return handleWikiCommand('');

    const today = getKstDate();
    const lines = [];

    if (!mode || mode.includes('일정')) {
        const events = await pAll(
            `SELECT id, user_id, title, event_date, event_time, is_all_day, is_family, category
             FROM calendar_events
             WHERE (user_id = ? OR is_family = 1 OR category = '가족')
               AND event_date >= ?
             ORDER BY event_date ASC, event_time ASC
             LIMIT 7`,
            [authUser.portalUsername, today]
        );
        lines.push('📅 <b>다가오는 일정 (개인 · 가족)</b>');
        if (events.length === 0) {
            lines.push('  • 예정된 일정이 없어요.');
        } else {
            events.forEach((ev) => {
                const isFam = Boolean(ev.is_family) || ev.category === '가족';
                let title = decryptCalendarText(ev.title, ev.user_id, isFam);
                if (title === '🔒 [암호화된 일정]' && isFam) {
                    title = decryptCalendarText(ev.title, ev.user_id, false);
                }
                const t = ev.is_all_day || !ev.event_time ? '종일' : ev.event_time;
                const badge = isFam ? '[가족]' : '[개인]';
                lines.push(`  • <b>#${ev.id}</b> ${badge} [${ev.event_date} ${t}] ${escapeHtml(title)}`);
            });
        }
    }

    if (!mode || mode.includes('메모')) {
        if (lines.length > 0) lines.push('');
        const memos = await pAll(
            `SELECT id, user_id, content, created_at
             FROM user_memos
             WHERE user_id = ?
             ORDER BY id DESC
             LIMIT 5`,
            [authUser.portalUsername]
        );
        lines.push('📝 <b>최근 저장된 메모</b>');
        if (memos.length === 0) {
            lines.push('  • 저장된 메모가 없어요.');
        } else {
            memos.forEach((m) => {
                const txt = decryptMemoText(m.content, m.user_id);
                const preview = txt.length > 45 ? `${txt.slice(0, 45)}...` : txt;
                lines.push(`  • <b>#${m.id}</b> ${escapeHtml(preview)}`);
            });
        }
    }

    lines.push('\n💡 삭제하려면 <code>/삭제 일정 번호</code> 또는 <code>/삭제 메모 번호</code>');
    return lines.join('\n');
}

async function handleDeleteCommand(argText, authUser) {
    const tokens = argText.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
        return '🗑️ 삭제할 구분과 번호를 입력해 주세요.\n예: <code>/삭제 메모 12</code>, <code>/삭제 일정 5</code> 또는 <code>/삭제 할일 3</code>';
    }
    const kind = tokens[0];
    const targetId = Number(String(tokens[1]).replace('#', ''));
    if (!Number.isInteger(targetId) || targetId <= 0) {
        return '⚠️ 올바른 숫자 번호를 입력해 주세요.';
    }

    if (kind.includes('할일') || kind.includes('장보기') || kind.includes('루틴')) {
        const ok = await deleteFamilyTodo(targetId);
        return ok
            ? `🗑️ 위키 할일·장보기 <b>#${targetId}</b>를 삭제했습니다.`
            : `⚠️ 할일·장보기 #${targetId}을 찾을 수 없어요.`;
    }

    if (kind.includes('메모')) {
        const row = await pGet('SELECT id, user_id FROM user_memos WHERE id = ?', [targetId]);
        if (!row) return `⚠️ 메모 #${targetId}을 찾을 수 없어요.`;
        if (row.user_id !== authUser.portalUsername && authUser.role !== 'admin') {
            return '🚫 본인 메모만 삭제할 수 있어요.';
        }
        await pRun('DELETE FROM user_memos WHERE id = ?', [targetId]);
        return `🗑️ 메모 <b>#${targetId}</b>를 삭제했습니다.`;
    }

    if (kind.includes('일정')) {
        const row = await pGet('SELECT id, user_id, is_family FROM calendar_events WHERE id = ?', [targetId]);
        if (!row) return `⚠️ 일정 #${targetId}을 찾을 수 없어요.`;
        if (row.user_id !== authUser.portalUsername && row.is_family !== 1 && authUser.role !== 'admin') {
            return '🚫 해당 일정을 삭제할 권한이 없어요.';
        }
        await pRun('DELETE FROM calendar_events WHERE id = ?', [targetId]);
        return `🗑️ 일정 <b>#${targetId}</b>를 삭제했습니다.`;
    }

    return '⚠️ 구분은 <code>메모</code>, <code>일정</code> 또는 <code>할일</code>로 입력해 주세요.';
}

async function handleStudySheetCommand(argText, authUser) {
    const tokens = argText.trim().split(/\s+/).filter(Boolean);
    let childId = 'first';
    let subject = null;
    const themeTokens = [];

    for (const tok of tokens) {
        if (tok === '첫째' || tok === '1' || tok === 'first') {
            childId = 'first';
        } else if (tok === '둘째' || tok === '2' || tok === 'second') {
            childId = 'second';
        } else if (tok === '한글' || tok === 'korean') {
            subject = 'korean';
        } else if (tok === '수학' || tok === 'math') {
            subject = 'math';
        } else if (tok === '영어' || tok === 'english') {
            subject = 'english';
        } else {
            themeTokens.push(tok);
        }
    }

    if (!subject) {
        const rec = await getWeeklyBalanceRecommendation(childId);
        subject = rec.recommendedSubject || 'korean';
    }
    const theme = themeTokens.join(' ') || '동물 친구';
    const sheet = await generateAndSaveWorksheet({
        childId: normalizeChildId(childId),
        subject: normalizeSubject(subject),
        theme,
        createdBy: `telegram:${authUser.portalUsername}`
    });

    const baseUrl = (process.env.PORTAL_PUBLIC_URL || 'https://j-jg.cc').replace(/\/+$/, '');
    const directUrl = `${baseUrl}/study/sheet/${sheet.id}`;
    const childLabel = sheet.childId === 'first' ? '첫째' : '둘째';

    return [
        `🎒 <b>[${childLabel}] 맞춤 학습지가 완성되었어요!</b>`,
        `• 영역: <b>${SUBJECT_NAMES[sheet.subject]}</b> (Lv.${sheet.level})`,
        `• 주제: ${escapeHtml(sheet.title)}`,
        `• 방식: ${sheet.source.startsWith('gemini') ? '✨ AI 맞춤 생성' : '📚 안전 문제은행'}`,
        '',
        `👉 <a href="${directUrl}">태블릿으로 바로 풀기 열기</a>`,
        `<code>${directUrl}</code>`
    ].join('\n');
}

async function executeTelegramCommand(rawText, authUser, senderId) {
    const trimmed = String(rawText || '').trim();
    if (!trimmed.startsWith('/')) {
        return null;
    }
    const spaceIdx = trimmed.indexOf(' ');
    const cmdRaw = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
    const cmd = cmdRaw.split('@')[0];
    const argText = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

    let reply = '';
    try {
        if (cmd === '/start' || cmd === '/help' || cmd === '/도움말') {
            reply = buildHelpText();
        } else if (cmd === '/메모' || cmd === '/memo') {
            reply = await handleMemoCommand(argText, authUser);
        } else if (cmd === '/개인일정' || cmd === '/personal') {
            reply = await handleScheduleCommand(argText, authUser, 'personal');
        } else if (cmd === '/가족일정' || cmd === '/family') {
            reply = await handleScheduleCommand(argText, authUser, 'family');
        } else if (cmd === '/일정' || cmd === '/schedule') {
            reply = await handleScheduleCommand(argText, authUser, 'auto');
        } else if (cmd === '/조회' || cmd === '/list') {
            reply = await handleQueryCommand(argText, authUser);
        } else if (cmd === '/삭제' || cmd === '/delete') {
            reply = await handleDeleteCommand(argText, authUser);
        } else if (cmd === '/학습지' || cmd === '/study') {
            reply = await handleStudySheetCommand(argText, authUser);
        } else if (cmd === '/위키' || cmd === '/wiki') {
            reply = await handleWikiCommand(argText);
        } else if (cmd === '/위키등록' || cmd === '/위키저장' || cmd === '/위키추가') {
            reply = await handleWikiCreateCommand(argText);
        } else if (cmd === '/장보기' || cmd === '/shop') {
            reply = await handleShoppingCommand(argText);
        } else if (cmd === '/할일' || cmd === '/todo' || cmd === '/루틴') {
            reply = await handleTodoCommand(argText);
        } else if (cmd === '/완료' || cmd === '/체크' || cmd === '/done') {
            reply = await handleDoneCommand(argText);
        } else if (cmd === '/혈압' || cmd === '/약' || cmd === '/약먹음' || cmd === '/blood' || cmd === '/med') {
            if (authUser.role !== 'admin') {
                reply = '🔒 혈압 및 약 복용 관리는 관리자 계정 전용 기능이에요.';
            } else if (cmd === '/약먹음' || argText.includes('완료') || argText.includes('먹었')) {
                const res = await recordQuickMedicationFromTelegram();
                reply = { text: res.messageHtml, replyMarkup: res.replyMarkup };
            } else {
                const card = await getBloodStatusPayload();
                reply = { text: card.text, replyMarkup: card.replyMarkup };
            }
        } else {
            reply = `❓ 알 수 없는 명령어예요.\n\n${buildHelpText()}`;
        }
        await logTelegramCommand({ senderId, command: cmd, status: 'ok', detail: argText.slice(0, 60) });
    } catch (err) {
        console.error(`텔레그램 명령(${cmd}) 처리 오류:`, err);
        await logTelegramCommand({ senderId, command: cmd, status: 'error', detail: err.message });
        reply = '⚠️ 요청을 처리하는 중 일시적인 오류가 발생했습니다.';
    }
    return reply;
}

module.exports = {
    executeTelegramCommand
};
