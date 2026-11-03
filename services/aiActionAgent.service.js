/**
 * ⚡ JG 포털 AI 액션 에이전트 (aiActionAgent.service.js)
 * - [핵심 역할] 자연어 명령을 감지하여 캘린더 일정, 혈압 기록, 메모를 실시간 DB에 안전 등록
 * - [보안] 캘린더 및 메모 데이터 AES-256-GCM 암호화 저장 준수
 * - [규칙 2] 100% 일상 친화적인 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const { db, portalDb } = require('./db');
const { encryptCalendarText, encryptMemoText } = require('./crypto.service');
const { classifyBloodPressure } = require('./bloodClassifier.util');

/**
 * 🕒 한국 표준시(KST) 기준 날짜 및 시간 헬퍼
 */
function getKstDate() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (9 * 60 * 60000));
}

function formatDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * 📅 한국어 자연어 날짜 및 시간 파서
 */
function parseKoreanDateTime(text) {
    const baseDate = getKstDate();
    let targetDate = new Date(baseDate);
    let isAllDay = true;
    let eventTime = '';
    let dateFound = false;

    // 1. 상대 날짜 파싱 (오늘, 내일, 모레, 글피)
    if (/내일/.test(text)) {
        targetDate.setDate(targetDate.getDate() + 1);
        dateFound = true;
    } else if (/모레/.test(text)) {
        targetDate.setDate(targetDate.getDate() + 2);
        dateFound = true;
    } else if (/글피/.test(text)) {
        targetDate.setDate(targetDate.getDate() + 3);
        dateFound = true;
    } else if (/오늘/.test(text)) {
        dateFound = true;
    }

    // 2. N일 뒤 / N일 후
    const daysLaterMatch = text.match(/(\d+)\s*일\s*(뒤|후)/);
    if (daysLaterMatch) {
        targetDate.setDate(targetDate.getDate() + parseInt(daysLaterMatch[1], 10));
        dateFound = true;
    }

    // 3. 특정 요일 파싱 (이번주/다음주 [월~일]요일)
    const weekDayMap = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
    const weekMatch = text.match(/(이번\s*주|다음\s*주)?\s*([월화수목금토일])요일/);
    if (weekMatch && !dateFound) {
        const isNextWeek = (weekMatch[1] && weekMatch[1].includes('다음'));
        const targetDay = weekDayMap[weekMatch[2]];
        const currentDay = baseDate.getDay();
        let diff = targetDay - currentDay;
        if (diff <= 0) diff += 7;
        if (isNextWeek) diff += 7;
        targetDate.setDate(baseDate.getDate() + diff);
        dateFound = true;
    }

    // 4. 날짜 명시 (M월 D일, YYYY-MM-DD, M/D)
    const monthDayMatch = text.match(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/) ||
                          text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/) ||
                          text.match(/(\d{1,2})\/(\d{1,2})/);
    if (monthDayMatch) {
        const year = monthDayMatch[1] && monthDayMatch[1].length === 4 ? parseInt(monthDayMatch[1], 10) : baseDate.getFullYear();
        const month = parseInt(monthDayMatch[2] || monthDayMatch[1], 10) - 1;
        const day = parseInt(monthDayMatch[3] || monthDayMatch[2], 10);
        targetDate = new Date(year, month, day);
        dateFound = true;
    }

    // 5. 시간 파싱 (오전/오후/저녁/아침/새벽/밤 H시 (M분|반), HH:mm)
    const timeMatch = text.match(/(오전|오후|저녁|아침|새벽|밤)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|반)?/) ||
                      text.match(/(?:at|시간)?\s*([01]?\d|2[0-3]):([0-5]\d)/);

    if (timeMatch) {
        isAllDay = false;
        if (timeMatch[0].includes(':')) {
            eventTime = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
        } else {
            const period = timeMatch[1] || '';
            let hour = parseInt(timeMatch[2], 10);
            const minute = timeMatch[3] ? parseInt(timeMatch[3], 10) : (timeMatch[0].includes('반') ? 30 : 0);

            if ((period === '오후' || period === '저녁' || period === '밤') && hour < 12) {
                hour += 12;
            } else if ((period === '오전' || period === '새벽' || period === '아침') && hour === 12) {
                hour = 0;
            }
            eventTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        }
    }

    return {
        dateStr: formatDate(targetDate),
        eventTime,
        isAllDay,
        dateFound
    };
}

/**
 * 📅 1. 일정 등록 액션 파서
 */
function parseCalendarAction(prompt) {
    const isRegisterCommand = /(일정|약속|스케줄|캘린더|행사)\s*(등록|추가|잡아|넣어|적어|기록|저장)/i.test(prompt) ||
                              /(등록|추가|잡아|넣어)\s*(해줘|줄래|바래|요)/i.test(prompt);
    const isQueryCommand = /(알려|뭐|어때|있어|조회|확인|검색|보여)/i.test(prompt);

    if (!isRegisterCommand || isQueryCommand) return null;

    const dt = parseKoreanDateTime(prompt);

    // 제목 정제: 일정 등록 명령어 및 날짜/시간 수식어 제거
    let cleanTitle = prompt
        .replace(/(일정|약속|스케줄|캘린더|행사)\s*(등록|추가|잡아|넣어|적어|기록|저장|해줘|줄래|바래|요)+/gi, '')
        .replace(/(오늘|내일|모레|글피|이번\s*주|다음\s*주|[월화수목금토일]요일)/gi, '')
        .replace(/(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일|\d{1,2}\/\d{1,2}/gi, '')
        .replace(/(오전|오후|저녁|아침|새벽|밤)?\s*\d{1,2}\s*시\s*(?:\d{1,2}\s*분|반)?/gi, '')
        .replace(/[0-2]?\d:[0-5]\d/gi, '')
        .replace(/(에|으로|을|를|좀|새로|새로운|내용은)\s*/gi, '')
        .trim();

    if (!cleanTitle || cleanTitle.length < 2) {
        cleanTitle = '새로운 일정';
    }

    // 카테고리 및 가족 공유 여부 판정
    let category = '개인';
    let isFamily = 0;
    if (/(가족|모임|외식|제사|명절|여행|엄마|아빠|아이)/.test(prompt)) {
        category = '가족';
        isFamily = 1;
    } else if (/(업무|회의|미팅|출장|보고|마감|프로젝트)/.test(prompt)) {
        category = '업무';
    } else if (/(병원|치과|내과|안과|진료|처방|검진)/.test(prompt)) {
        category = '중요';
    }

    return {
        type: 'CALENDAR',
        title: cleanTitle,
        eventDate: dt.dateStr,
        eventTime: dt.eventTime,
        isAllDay: dt.isAllDay,
        category,
        isFamily
    };
}

/**
 * 🩺 2. 혈압/건강 기록 등록 액션 파서
 */
function parseBloodAction(prompt) {
    const hasBloodKeyword = /(혈압|수축기|이완기|최고혈압|최저혈압|맥박|심박)/i.test(prompt);
    const hasRecordKeyword = /(기록|저장|등록|적어|입력|측정|쟀어|나왔어)/i.test(prompt);

    if (!hasBloodKeyword && !hasRecordKeyword) return null;

    let sys = null;
    let dia = null;
    let pulse = null;

    // 패턴 1: "수축기 125 이완기 82 맥박 70" 형식
    const p1 = prompt.match(/수축기\s*[:：]?\s*(\d{2,3})/);
    const p2 = prompt.match(/이완기\s*[:：]?\s*(\d{2,3})/);
    const p3 = prompt.match(/(?:맥박|심박)\s*[:：]?\s*(\d{2,3})/);

    if (p1 && p2) {
        sys = parseInt(p1[1], 10);
        dia = parseInt(p2[1], 10);
        if (p3) pulse = parseInt(p3[1], 10);
    } else {
        // 패턴 2: "혈압 125에 82", "125/82", "125 82 70" 형식
        const numbers = prompt.match(/\b\d{2,3}\b/g);
        if (numbers && numbers.length >= 2 && (hasBloodKeyword || hasRecordKeyword)) {
            const n1 = parseInt(numbers[0], 10);
            const n2 = parseInt(numbers[1], 10);
            if (n1 >= 80 && n1 <= 240 && n2 >= 40 && n2 <= 140) {
                sys = n1;
                dia = n2;
                if (numbers[2]) {
                    const n3 = parseInt(numbers[2], 10);
                    if (n3 >= 40 && n3 <= 180) pulse = n3;
                }
            }
        }
    }

    if (!sys || !dia) return null;

    // 측정 시각 및 시간대 구분(timing)
    const kst = getKstDate();
    const yyyy = kst.getFullYear();
    const mm = String(kst.getMonth() + 1).padStart(2, '0');
    const dd = String(kst.getDate()).padStart(2, '0');
    const hh = String(kst.getHours()).padStart(2, '0');
    const min = String(kst.getMinutes()).padStart(2, '0');
    const measuredAt = `${yyyy}-${mm}-${dd}T${hh}:${min}`;

    const hour = kst.getHours();
    let timing = 'day';
    if (hour >= 5 && hour < 12) timing = 'morning';
    else if (hour >= 18 || hour < 5) timing = 'evening';

    return {
        type: 'BLOOD',
        systolic: sys,
        diastolic: dia,
        pulse,
        measuredAt,
        timing
    };
}

/**
 * 📝 3. 메모 등록 액션 파서
 */
function parseMemoAction(prompt) {
    const isMemoCommand = /(메모|메모장)\s*(해줘|남겨|추가|등록|저장|적어)/i.test(prompt) ||
                          /^메모\s*[:：]/i.test(prompt);
    const isQueryCommand = /(알려|뭐|어때|있어|조회|확인|검색|보여)/i.test(prompt);

    // 위키 또는 혈압/일정 관련은 메모 처리에서 제외
    if (!isMemoCommand || isQueryCommand || /위키|wiki/i.test(prompt)) return null;

    let content = prompt
        .replace(/^(메모\s*[:：]|메모장에\s*적어줘|메모해줘|메모\s*추가|메모\s*등록)\s*/gi, '')
        .replace(/(메모|메모장)\s*(해줘|남겨|추가|등록|저장|적어|줄래|요)+/gi, '')
        .replace(/^[:：\s]+/, '')
        .trim();

    if (!content || content.length < 2) return null;

    let title = content.replace(/^[:：\s]+/, '').split(/[\n,.]/)[0].slice(0, 30).trim();
    if (!title) title = '새로운 메모';

    let category = 'memo';
    let color = '#e0f2fe'; // 연파랑

    if (/(할\s*일|투두|todo|장보기|사야|살\s*것|준비물|체크)/i.test(prompt)) {
        category = 'todo';
        color = '#dcfce7'; // 연초록
    } else if (/(아이디어|생각|구상|발상|idea)/i.test(prompt)) {
        category = 'idea';
        color = '#fef3c7'; // 연노랑
    }

    return {
        type: 'MEMO',
        title,
        content,
        category,
        color
    };
}

/**
 * 🚀 액션 실행기: 실제 DB 등록 및 결과 카드 생성
 */
async function executeAction({ action, user, userName }) {
    const userId = user?.username || 'admin';

    // 1. 📅 캘린더 일정 등록
    if (action.type === 'CALENDAR') {
        const encryptedTitle = encryptCalendarText(action.title, userId, action.isFamily);
        const isAllDayVal = action.isAllDay ? 1 : 0;
        const color = action.category === '가족' ? '#ec4899' : (action.category === '업무' ? '#6366f1' : '#10b981');

        return new Promise((resolve) => {
            const query = `
                INSERT INTO calendar_events (user_id, title, event_date, event_time, category, color, memo, is_all_day, is_family, notify_timing, notify_repeat)
                VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 'exact', 1)
            `;
            portalDb.run(query, [
                userId,
                encryptedTitle,
                action.eventDate,
                action.eventTime || '',
                action.category,
                color,
                isAllDayVal,
                action.isFamily
            ], function(err) {
                if (err) {
                    console.error('[ActionAgent 캘린더 등록 실패]:', err);
                    return resolve({
                        success: false,
                        message: `일정 등록 중 오류가 발생했습니다: ${err.message}`
                    });
                }

                const timeDesc = action.isAllDay ? '종일 일정' : `${action.eventTime}`;
                const familyBadge = action.isFamily ? ' (가족 공유 👨‍👩‍👧‍👦)' : '';
                const card = `새로운 일정을 **캘린더**에 성공적으로 등록했습니다! 📅\n\n` +
                    `- **일정 내용**: **${action.title}**${familyBadge}\n` +
                    `- **일정 날짜**: ${action.eventDate}\n` +
                    `- **시간**: ${timeDesc}\n` +
                    `- **분류**: ${action.category}\n\n` +
                    `👉 [**캘린더 바로가기**](/calendar)`;

                resolve({
                    success: true,
                    actionType: 'CALENDAR',
                    id: this.lastID,
                    message: card,
                    meta: { id: this.lastID, title: action.title, date: action.eventDate, time: action.eventTime }
                });
            });
        });
    }

    // 2. 🩺 혈압/건강 기록 등록
    if (action.type === 'BLOOD') {
        const grade = classifyBloodPressure(action.systolic, action.diastolic);
        const gradeText = grade ? `${grade.name} (${grade.label})` : '정상 범위';

        return new Promise((resolve) => {
            const query = `
                INSERT INTO records (systolic, diastolic, pulse, measured_at, timing)
                VALUES (?, ?, ?, ?, ?)
            `;
            db.run(query, [
                action.systolic,
                action.diastolic,
                action.pulse || null,
                action.measuredAt,
                action.timing
            ], function(err) {
                if (err) {
                    console.error('[ActionAgent 혈압 등록 실패]:', err);
                    return resolve({
                        success: false,
                        message: `혈압 기록 저장 중 오류가 발생했습니다: ${err.message}`
                    });
                }

                const pulseDesc = action.pulse ? `, 맥박 **${action.pulse}** bpm` : '';
                const timingDesc = action.timing === 'morning' ? '아침 측정 🌅' : (action.timing === 'evening' ? '저녁 측정 🌙' : '낮 측정 ☀️');
                const card = `방금 측정한 혈압 수치를 **혈압·건강 관리**에 기록했습니다! 🩺\n\n` +
                    `- **측정 수치**: **${action.systolic} / ${action.diastolic}** mmHg${pulseDesc}\n` +
                    `- **진단 결과**: **${gradeText}**\n` +
                    `- **측정 구분**: ${timingDesc}\n\n` +
                    `👉 [**혈압·건강 관리 바로가기**](/blood)`;

                resolve({
                    success: true,
                    actionType: 'BLOOD',
                    id: this.lastID,
                    message: card,
                    meta: { id: this.lastID, systolic: action.systolic, diastolic: action.diastolic, pulse: action.pulse }
                });
            });
        });
    }

    // 3. 📝 메모 등록
    if (action.type === 'MEMO') {
        const encTitle = encryptMemoText(action.title, userId);
        const encContent = encryptMemoText(action.content, userId);

        return new Promise((resolve) => {
            const query = `
                INSERT INTO user_memos (user_id, title, content, category, color, is_pinned, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 0, datetime('now', 'localtime'), datetime('now', 'localtime'))
            `;
            portalDb.run(query, [userId, encTitle, encContent, action.category, action.color], function(err) {
                if (err) {
                    console.error('[ActionAgent 메모 등록 실패]:', err);
                    return resolve({
                        success: false,
                        message: `메모 저장 중 오류가 발생했습니다: ${err.message}`
                    });
                }

                const catBadge = action.category === 'todo' ? '할 일 (To-Do) ✅' : (action.category === 'idea' ? '아이디어 💡' : '일반 메모 📝');
                const card = `새로운 메모를 **포털 메모장**에 안전하게 보관했습니다! 📝\n\n` +
                    `- **제목**: **${action.title}**\n` +
                    `- **내용**: ${action.content}\n` +
                    `- **분류**: ${catBadge}\n\n` +
                    `👉 [**포털 메모장 바로가기**](/portal)`;

                resolve({
                    success: true,
                    actionType: 'MEMO',
                    id: this.lastID,
                    message: card,
                    meta: { id: this.lastID, title: action.title, category: action.category }
                });
            });
        });
    }

    return { success: false, message: '지원되지 않는 액션 유형입니다.' };
}

/**
 * 🎯 사용자 입력에서 액션 의도 감지 및 즉시 실행
 * @returns {Promise<{ handled: boolean, message?: string, meta?: any }>}
 */
async function handleActionIntent({ prompt, user, userName }) {
    if (!prompt || typeof prompt !== 'string') return { handled: false };

    // 1. 혈압 등록 액션 감지
    const bloodAction = parseBloodAction(prompt);
    if (bloodAction) {
        const result = await executeAction({ action: bloodAction, user, userName });
        return { handled: true, ...result };
    }

    // 2. 일정 등록 액션 감지
    const calendarAction = parseCalendarAction(prompt);
    if (calendarAction) {
        const result = await executeAction({ action: calendarAction, user, userName });
        return { handled: true, ...result };
    }

    // 3. 메모 등록 액션 감지
    const memoAction = parseMemoAction(prompt);
    if (memoAction) {
        const result = await executeAction({ action: memoAction, user, userName });
        return { handled: true, ...result };
    }

    return { handled: false };
}

module.exports = {
    parseKoreanDateTime,
    parseCalendarAction,
    parseBloodAction,
    parseMemoAction,
    handleActionIntent
};
