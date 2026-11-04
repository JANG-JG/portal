/**
 * ⚡ JG 포털 AI 액션 에이전트 (aiActionAgent.service.js)
 * - [핵심 역할] 자연어 명령을 감지하여 캘린더 일정, 혈압 기록, 메모를 실시간 DB에 안전 등록
 * - [보안] 캘린더 및 메모 데이터 AES-256-GCM 암호화 저장 준수
 * - [규칙 2] 100% 일상 친화적인 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const { db, portalDb } = require('./db');
const { encryptCalendarText, encryptMemoText } = require('./crypto.service');
const { classifyBloodPressure } = require('./bloodClassifier.util');
const { ADMIN_USERS } = require('../config/constants');
const {
    parseNotifyTimingFromPrompt,
    getNotifyTimingDisplay,
    cleanCalendarTitle
} = require('./calendarTimingParser.util');

const isAdminUser = (u) => !!(u && (u.role === 'admin' || (u.username && ADMIN_USERS && (ADMIN_USERS.has ? ADMIN_USERS.has(u.username) : ADMIN_USERS.includes(u.username)))));
const isAdminPageQuery = (p) => typeof p === 'string' && /(관리자\s*(페이지|화면|메뉴|설정|계정|비번|비밀번호)|admin\s*(page|view)?|마스터\s*비번|db\s*(인스펙터|관리|원시)|서버\s*설정\s*(변경|수정))/i.test(p);

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
 * 🕒 시간 문자열을 일상 친화적인 한국어 12/24시간 병기 포맷으로 변환 (예: 14:00 -> 오후 2시 (14:00))
 */
function formatKoreanTime(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    const hour = parseInt(parts[0], 10);
    const minute = parseInt(parts[1], 10);
    if (isNaN(hour) || isNaN(minute)) return timeStr;

    const period = hour >= 12 ? '오후' : '오전';
    const displayHour = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
    const minuteStr = minute > 0 ? ` ${minute}분` : '';
    return `${period} ${displayHour}시${minuteStr} (${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')})`;
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

    // 4. 날짜 명시 (M월 D일, YYYY-MM-DD, M/D) - 앞서 상대 날짜 미발견 시에만 적용
    if (!dateFound) {
        const monthDayMatch = text.match(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/) ||
                              text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/) ||
                              text.match(/\b([1-9]|1[0-2])\/([1-9]|[12]\d|3[01])\b/);
        if (monthDayMatch) {
            const year = monthDayMatch[1] && monthDayMatch[1].length === 4 ? parseInt(monthDayMatch[1], 10) : baseDate.getFullYear();
            const month = parseInt(monthDayMatch[2] || monthDayMatch[1], 10) - 1;
            const day = parseInt(monthDayMatch[3] || monthDayMatch[2], 10);
            targetDate = new Date(year, month, day);
            dateFound = true;
        }
    }

    // 5. 시간 파싱 (HH:mm 포맷 우선 또는 오전/오후/저녁/아침/새벽/밤 H시 (M분|반))
    // ⚠️ '1시간 전'과 같은 알림 시간 표현이 '1시'로 오인되지 않도록 시(?![간명]) 음성 룩어헤드 적용
    const timeMatch = text.match(/(?:at|시간)?\s*([01]?\d|2[0-3]):([0-5]\d)/) ||
                      text.match(/(오전|오후|저녁|아침|새벽|밤)?\s*(\d{1,2})\s*시(?![간명])\s*(?:(\d{1,2})\s*분(?!\s*전)|반)?/);

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
            if (hour >= 24) hour = hour % 24;
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
    if (!prompt || typeof prompt !== 'string') return null;

    // 1. 기능 지원 여부 및 사용 방법 문의 가드
    if (/(지원\s*(돼|되나|하나|해요|됩니까)|가능\s*(해|한가|해요|합니까)|할\s*수\s*(있어|있나|있나요|있습니까)|어떻게\s*(해|하나요|등록해|잡아|써)|기능\s*(있어|있나요)|방법)/i.test(prompt)) return null;

    // 2. 조회 / 추천 / 정리 / 검색 / 질문 의도 배제 (단, '~전에 알려줘' 알림 요청 문구는 제외)
    const promptForQueryCheck = prompt.replace(/(?:\d+\s*분|(?:한|두|세|\d+)\s*시간|(?:하루|이틀|\d+\s*일))\s*전(?:에)?\s*알려\s*(?:줘|달라|주세요|줄래|주라)/gi, '');
    const isQueryOrRecommend = /(추천|알려\s*(줘|달라|주세요|줄래|주라)|보여\s*(줘|달라|주세요|줄래)|정리\s*(해|해줘|해달라|해주세요)|요약|뭐\s*있|무엇이|어떤|어때|있니|있나요|있어\?|조회|검색|찾아|골라|안\s*될까|왜\s*안)/i.test(promptForQueryCheck);
    const hasExplicitCalendarCommand = /(?:캘린더|스케줄|일정|약속)\s*(?:에|으로)?\s*(?:등록|추가|잡아|예약)\s*(?:해줘|해\s*주세요|해주세요|해|줘|줄래|바래|부탁|할래)/i.test(prompt);
    if (isQueryOrRecommend && !hasExplicitCalendarCommand) return null;

    // 3. 위키 지식 / 생활 팁 / 레시피 관련 질문 가드
    const hasWikiContext = /(위키|wiki|생활\s*팁|꿀팁|레시피|매뉴얼|노하우|살림)/i.test(prompt);
    if (hasWikiContext && !hasExplicitCalendarCommand) return null;

    // 4. "저장된", "등록된", "추가된" 등 과거분사/수식어 제거 후 판별
    const promptWithoutAdjectives = prompt.replace(/(?:저장|등록|추가|기록|예약)된/g, '');
    const dt = parseKoreanDateTime(prompt);

    // 5. 명확한 등록 동사 판별 ('~전에 알려줘' 리마인더 요청 동사 포함)
    const hasReminderVerb = /(?:\d+\s*분|(?:한|두|세|\d+)\s*시간|(?:하루|이틀|\d+\s*일))\s*전(?:에)?\s*알려/i.test(prompt);
    const hasRegisterVerb = /(등록|추가|잡아|넣어|예약)\s*(해줘|해\s*주세요|해주세요|해|줘|줄래|바래|부탁|할래)|(?:일정|스케줄|약속|캘린더)\s*(?:저장|기록)\s*(?:해줘|해\s*주세요|해주세요|해|줘|줄래|바래|부탁|할래)/i.test(promptWithoutAdjectives) || hasReminderVerb;
    const hasCalendarKeyword = /(일정|약속|스케줄|캘린더|행사)/i.test(prompt);

    const isValidCalendarCommand = (hasCalendarKeyword && hasRegisterVerb) ||
                                  (dt.dateFound && (hasCalendarKeyword || hasRegisterVerb)) ||
                                  (dt.eventTime && hasRegisterVerb);

    if (!isValidCalendarCommand) return null;

    // 알림 설정 파싱 (exact, 5m, 10m, 15m, 30m, 1h, 2h, 3h, 1d, 2d, custom, allday)
    const notifyTiming = parseNotifyTimingFromPrompt(prompt, dt.isAllDay);

    // 제목 정제
    const cleanTitle = cleanCalendarTitle(prompt);

    // 카테고리 및 가족 공유 여부 판정
    let category = '개인';
    let isFamily = 0;
    if (/(가족|모임|외식|제사|명절|여행|엄마|아빠|아이)/.test(prompt)) {
        category = '가족';
        isFamily = 1;
    } else if (/(업무|회의|미팅|출장|보고|마감|프로젝트|사건처리비|국내여비|예산|서류)/.test(prompt)) {
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
        isFamily,
        notifyTiming
    };
}

/**
 * 🩺 2. 혈압/건강 기록 등록 액션 파서
 */
function parseBloodAction(prompt) {
    // 기능 지원 여부 및 방법 문의 가드
    const isCapabilityQuery = /(지원\s*(돼|되나|하나|해요|됩니까)|가능\s*(해|한가|해요|합니까)|할\s*수\s*(있어|있나|있나요|있습니까)|어떻게\s*(해|하나요|등록해|기록해|써)|기능\s*(있어|있나요)|방법)/i.test(prompt);
    if (isCapabilityQuery) return null;

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
    const measuredAt = `${formatDate(kst)}T${String(kst.getHours()).padStart(2, '0')}:${String(kst.getMinutes()).padStart(2, '0')}`;
    const hour = kst.getHours();
    const timing = (hour >= 5 && hour < 12) ? 'morning' : ((hour >= 18 || hour < 5) ? 'evening' : 'day');

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
    // 기능 지원 여부 및 방법 문의 가드
    const isCapabilityQuery = /(지원\s*(돼|되나|하나|해요|됩니까)|가능\s*(해|한가|해요|합니까)|할\s*수\s*(있어|있나|있나요|있습니까)|어떻게\s*(해|하나요|등록해|기록해|작성해|써)|기능\s*(있어|있나요)|방법)/i.test(prompt);
    if (isCapabilityQuery) return null;

    const isMemoCommand = /(메모|메모장)\s*(해줘|남겨|추가|등록|저장|적어)/i.test(prompt) ||
                          /^메모\s*[:：]/i.test(prompt);
    const isQueryCommand = /(알려\s*줘|보여\s*줘|뭐\s*있어|어때|있니|있나요|조회\s*해줘|검색\s*해줘)\s*$/i.test(prompt.trim());

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
        const color = action.category === '가족' ? '#ec4899' : (action.category === '업무' ? '#6366f1' : (action.category === '중요' ? '#ef4444' : '#10b981'));
        const notifyTiming = action.notifyTiming || 'exact';

        return new Promise((resolve) => {
            const query = `INSERT INTO calendar_events (user_id, title, event_date, event_time, category, color, memo, is_all_day, is_family, notify_timing, notify_repeat) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, 1)`;
            portalDb.run(query, [
                userId,
                encryptedTitle,
                action.eventDate,
                action.eventTime || '',
                action.category,
                color,
                isAllDayVal,
                action.isFamily,
                notifyTiming
            ], function(err) {
                if (err) {
                    console.error('[ActionAgent 캘린더 등록 실패]:', err);
                    return resolve({
                        success: false,
                        message: `일정 등록 중 오류가 발생했습니다: ${err.message}`
                    });
                }

                const timeDesc = action.isAllDay ? '종일 일정 ☀️' : formatKoreanTime(action.eventTime);
                const notifyDesc = getNotifyTimingDisplay(notifyTiming);
                const familyBadge = action.isFamily ? ' (가족 공유 👨‍👩‍👧‍👦)' : '';
                const card = `새로운 일정을 **캘린더**에 성공적으로 등록했습니다! 📅\n\n` +
                    `- **일정 내용**: **${action.title}**${familyBadge}\n` +
                    `- **일정 날짜**: ${action.eventDate}\n` +
                    `- **일정 시간**: ${timeDesc}\n` +
                    `- **알림 설정**: ${notifyDesc}\n` +
                    `- **분류**: ${action.category}\n\n` +
                    `👉 [**캘린더 바로가기**](/calendar)`;

                resolve({
                    success: true,
                    actionType: 'CALENDAR',
                    id: this.lastID,
                    message: card,
                    meta: { id: this.lastID, title: action.title, date: action.eventDate, time: action.eventTime, notifyTiming }
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
 * 🎯 사용자 입력에서 액션 의도 감지 및 즉시 실행 (보안 가드 및 권한 분기)
 */
async function handleActionIntent({ prompt, user, userName }) {
    if (!prompt || typeof prompt !== 'string') return { handled: false };
    if (isAdminPageQuery(prompt)) return { handled: false };

    // 1. 혈압 등록 액션 감지 (관리자 전용 기능)
    if (isAdminUser(user)) {
        const bloodAction = parseBloodAction(prompt);
        if (bloodAction) return { handled: true, ...(await executeAction({ action: bloodAction, user, userName })) };
    }

    // 2. 일정 등록 액션 감지
    const calendarAction = parseCalendarAction(prompt);
    if (calendarAction) return { handled: true, ...(await executeAction({ action: calendarAction, user, userName })) };

    // 3. 메모 등록 액션 감지
    const memoAction = parseMemoAction(prompt);
    if (memoAction) return { handled: true, ...(await executeAction({ action: memoAction, user, userName })) };

    return { handled: false };
}

module.exports = {
    formatKoreanTime,
    parseKoreanDateTime,
    parseCalendarAction,
    parseBloodAction,
    parseMemoAction,
    handleActionIntent
};
