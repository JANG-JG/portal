/**
 * 🔔 캘린더 알림 시점 자연어 파서 및 표시 유틸리티 (calendarTimingParser.util.js)
 * - [핵심 역할] 자연어 명령에서 알림 시점(정시/N분 전/N시간 전/종일 맞춤시각) 파싱 및 제목 정제
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

/**
 * 🕒 자연어 프롬프트에서 알림 시점(notifyTiming) 추출
 * @param {string} prompt 사용자 발화 문장
 * @param {boolean} isAllDay 종일 일정 여부
 * @returns {string} timing 코드 ('exact', '5m', '10m', '15m', '30m', '1h', '2h', '3h', '1d', '2d', 'custom_m:N', 'custom_h:N', 'custom_d:N', 'allday:Nd:HH:mm', 'none')
 */
function parseNotifyTimingFromPrompt(prompt, isAllDay = false) {
    if (!prompt || typeof prompt !== 'string') return 'exact';

    // 0. 알림 끄기 / 해제
    if (/(?:알림\s*(?:없|끄|해제|끄기|안\s*울리게|없이))/i.test(prompt)) {
        return 'none';
    }

    // 1. 종일 일정 맞춤 시각 패턴: (당일|오늘|전날|하루 전|1일 전|이틀 전|2일 전) + (오전/오후/시각)
    // 예: "당일 오전 8시 30분", "전날 저녁 8시", "하루 전 20:00"
    const allDayTimeMatch = prompt.match(/(당일|오늘|전날|하루\s*전|1일\s*전|이틀\s*전|2일\s*전)\s*(?:(?:오전|오후|저녁|아침|새벽|밤)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?|[0-2]?\d:[0-5]\d)/);
    if (isAllDay && allDayTimeMatch) {
        let diffDays = 0;
        const dayPart = allDayTimeMatch[1];
        if (/전날|하루\s*전|1일\s*전/.test(dayPart)) diffDays = 1;
        else if (/이틀\s*전|2일\s*전/.test(dayPart)) diffDays = 2;

        const sub = allDayTimeMatch[0];
        let hour = 9;
        let minute = 0;
        const colonMatch = sub.match(/([01]?\d|2[0-3]):([0-5]\d)/);
        if (colonMatch) {
            hour = parseInt(colonMatch[1], 10);
            minute = parseInt(colonMatch[2], 10);
        } else {
            const hMatch = sub.match(/(오전|오후|저녁|아침|새벽|밤)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
            if (hMatch) {
                const period = hMatch[1] || '';
                hour = parseInt(hMatch[2], 10);
                minute = hMatch[3] ? parseInt(hMatch[3], 10) : 0;
                if ((period === '오후' || period === '저녁' || period === '밤') && hour < 12) hour += 12;
                else if ((period === '오전' || period === '새벽' || period === '아침') && hour === 12) hour = 0;
            }
        }
        const hh = String(hour).padStart(2, '0');
        const mm = String(minute).padStart(2, '0');
        return `allday:${diffDays}d:${hh}:${mm}`;
    }

    // 2. 분 단위 알림 (예: 5분 전, 10분 전, 15분 전, 30분 전, 반시간 전, 45분 전 등)
    if (/반\s*시간\s*전/.test(prompt)) return '30m';
    const minMatch = prompt.match(/(\d+)\s*분\s*전/);
    if (minMatch) {
        const m = parseInt(minMatch[1], 10);
        if (m === 5) return '5m';
        if (m === 10) return '10m';
        if (m === 15) return '15m';
        if (m === 30) return '30m';
        return `custom_m:${m}`;
    }

    // 3. 시간 단위 알림 (예: 1시간 전, 한시간 전, 2시간 전, 두시간 전, 3시간 전, 세시간 전 등)
    if (/(?:한|1)\s*시간\s*전/.test(prompt)) return '1h';
    if (/(?:두|2)\s*시간\s*전/.test(prompt)) return '2h';
    if (/(?:세|3)\s*시간\s*전/.test(prompt)) return '3h';
    const hrMatch = prompt.match(/(\d+)\s*시간\s*전/);
    if (hrMatch) {
        const h = parseInt(hrMatch[1], 10);
        if (h === 1) return '1h';
        if (h === 2) return '2h';
        if (h === 3) return '3h';
        return `custom_h:${h}`;
    }

    // 4. 일 단위 알림 (예: 하루 전, 1일 전, 전날, 이틀 전, 2일 전, N일 전)
    if (/(?:하루|1일|전날)\s*전?/.test(prompt) && /(?:알림|알려|울리|등록|잡아|설정)/.test(prompt)) {
        return '1d';
    }
    if (/(?:이틀|2일)\s*전/.test(prompt)) {
        return '2d';
    }
    const dayMatch = prompt.match(/(\d+)\s*일\s*전/);
    if (dayMatch) {
        const d = parseInt(dayMatch[1], 10);
        if (d === 1) return '1d';
        if (d === 2) return '2d';
        return `custom_d:${d}`;
    }

    return 'exact';
}

/**
 * 🏷️ 알림 시점 코드(timing)를 일상 친화적 한국어 라벨로 변환
 */
function getNotifyTimingDisplay(timing) {
    if (!timing || timing === 'exact') return '정시 알림 🔔';
    if (timing === 'none') return '알림 없음 🔕';
    if (timing === '5m') return '5분 전 알림 🔔';
    if (timing === '10m') return '10분 전 알림 🔔';
    if (timing === '15m') return '15분 전 알림 🔔';
    if (timing === '30m') return '30분 전 알림 🔔';
    if (timing === '1h') return '1시간 전 알림 🔔';
    if (timing === '2h') return '2시간 전 알림 🔔';
    if (timing === '3h') return '3시간 전 알림 🔔';
    if (timing === '1d') return '1일 전 알림 🔔';
    if (timing === '2d') return '2일 전 알림 🔔';

    const customMatch = String(timing).match(/^custom_([mhd]):(\d+)$/);
    if (customMatch) {
        const unit = customMatch[1];
        const val = customMatch[2];
        if (unit === 'm') return `${val}분 전 맞춤 알림 🔔`;
        if (unit === 'h') return `${val}시간 전 맞춤 알림 🔔`;
        if (unit === 'd') return `${val}일 전 맞춤 알림 🔔`;
    }

    if (String(timing).startsWith('allday:')) {
        const parts = timing.split(':');
        const days = parseInt(parts[1], 10) || 0;
        const time = `${parts[2] || '09'}:${parts[3] || '00'}`;
        const dayLabel = days === 0 ? '당일' : `${days}일 전`;
        return `${dayLabel} ${time} 맞춤 알림 🔔`;
    }

    return `${timing} 알림 🔔`;
}

/**
 * 🧹 일정 프롬프트에서 알림 관련 문구 완전 제거
 */
function stripNotifyTimingPatterns(text) {
    if (!text || typeof text !== 'string') return '';
    let res = text;

    // 1. "알림"이 앞에 오거나 중간에 오는 복합 패턴:
    // 예: "알림 2시간 전에 보내줘", "알림 두시간 전으로 설정해줘", "알림 15분 전에 알려줘", "알림 보내줘"
    res = res.replace(/알림(?:은|을|이)?\s*(?:정시|정각|반\s*시간\s*전|\d+\s*분\s*전|(?:한|두|세|\d+)\s*시간\s*전|(?:하루|이틀|\d+\s*일)\s*전|(?:당일|오늘|전날|하루\s*전|이틀\s*전|\d+\s*일\s*전)\s*(?:오전|오후|저녁|아침|새벽|밤)?\s*(?:\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?|[0-2]?\d:[0-5]\d))?(?:에|으로)?\s*(?:보내|알려|울리|설정|등록|잡아|띄워)?\s*(?:줘|달라|주세요|해줘|해달라|해주세요|줄래|바래|부탁해|주라)?/gi, '');

    // 2. 시간/시점이 앞에 오고 "알림" 또는 "알려줘"가 오는 패턴:
    // 예: "2시간 전에 알림 보내줘", "30분 전에 알려줘", "하루 전 오전 9시에 알림 보내줘", "1시간 전 알림"
    res = res.replace(/(?:당일|오늘|전날|하루\s*전|이틀\s*전|\d+\s*일\s*전)\s*(?:오전|오후|저녁|아침|새벽|밤)?\s*(?:\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?|[0-2]?\d:[0-5]\d)(?:에|으로)?\s*(?:알림(?:을|은|이)?|알려|울리게|울려|보내)?\s*(?:보내|띄워|설정|등록|잡아)?\s*(?:줘|달라|주세요|해줘|해달라|해주세요|줄래|바래|부탁해|주라)?/gi, '');
    res = res.replace(/(?:정시|정각|반\s*시간\s*전|\d+\s*분\s*전|(?:한|두|세|\d+)\s*시간\s*전|(?:하루|이틀|\d+\s*일)\s*전)(?:에|으로)?\s*(?:알림(?:을|은|이)?|알려|울리게|울려)?\s*(?:보내|띄워|설정|등록|잡아)?\s*(?:줘|달라|주세요|해줘|해달라|해주세요|줄래|바래|부탁해|주라)?/gi, '');

    // 3. 단순 알림 요청/해제 잔여 문구:
    res = res.replace(/알림\s*(?:없|끄|해제|끄기|안\s*울리게|없이|빼고)/gi, '');
    res = res.replace(/알림\s*(?:보내|띄워|울려|설정|등록)?\s*(?:줘|달라|주세요|해줘|해달라|해주세요|줄래|바래|부탁해|주라)/gi, '');
    res = res.replace(/(?:정시|정각)에\s*/gi, '');

    // 4. "보내줘 / 알려줘" 단독 어미 제거 (알림 문구 뒤에 남은 경우)
    res = res.replace(/\s*(?:보내\s*줘|보내\s*주세요|보내\s*달라|보내\s*줄래|보내\s*주라|보내)\s*$/gi, '');

    return res;
}

/**
 * 🕒 날짜/시간 토큰 패턴 제거 (장소 추출 정확도 향상용)
 */
function removeDateTimePatterns(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일|\d{1,2}\/\d{1,2}|\d{4}-\d{1,2}-\d{1,2}|\d+\s*일\s*(?:뒤|후)/gi, ' ')
        .replace(/(?:오늘|내일|모레|글피|이번\s*주|다음\s*주|[월화수목금토일]요일)/gi, ' ')
        .replace(/(?:at|시간)?\s*([01]?\d|2[0-3]):([0-5]\d)/gi, ' ')
        .replace(/(?:오전|오후|저녁|아침|새벽|밤)?\s*\d{1,2}\s*시(?![간명])(?:\s*\d{1,2}\s*분(?!\s*전)|반)?/gi, ' ')
        .replace(/\s+/g, ' ');
}

/**
 * 📍 장소명 후보 문자열 정제
 */
function cleanLocationCandidate(loc) {
    if (!loc) return '';
    let l = removeDateTimePatterns(loc);
    l = l.replace(/^[,\s.:;~-]+|[,\s.:;~-]+$/g, '')
         .replace(/^(?:에|은|는|이|가|을|를)\s+/gi, '')
         .replace(/\s*(?:에서)$/gi, '')
         .trim();
    return l;
}

/**
 * 📍 장소(Location) 및 메모(Memo) 분리 추출
 * @param {string} text 
 * @returns {{ location: string, note: string, combinedMemo: string, textWithoutMemo: string }}
 */
function extractLocationAndMemo(text) {
    if (!text || typeof text !== 'string') return { location: '', note: '', combinedMemo: '', textWithoutMemo: '' };

    let cleanedText = text;
    let location = '';
    let note = '';

    // 1. 명시적 메모/준비물/비고/참석자/내용 추출
    const memoPrefixMatch = cleanedText.match(/(?:메모|내용|준비물|참석자|비고|참고)\s*[:：]\s*([^\n,]+)/i);
    if (memoPrefixMatch) {
        note = memoPrefixMatch[0].trim();
        cleanedText = cleanedText.replace(memoPrefixMatch[0], ' ');
    }

    // 2. 명시적 장소/위치 접두사 추출 (예: "장소: 판교 카카오아지트", "위치: 강남역 11번 출구")
    const locPrefixMatch = cleanedText.match(/(?:장소|위치)\s*[:：]\s*([^\n,]+)/i);
    if (locPrefixMatch) {
        let locRaw = locPrefixMatch[1].trim();
        const eventBoundary = locRaw.match(/^(.*?(?:역|출구|점|센터|빌딩|타워|아지트|사옥|본사|병원|치과|카페|스벅|스타벅스|룸|회의실|식당|호텔|홀|관|캠퍼스|도서관|아울렛|매장|지점|학교))\s+(미팅|회의|보고|모임|약속|진료|식사|점심|저녁|세미나|워크숍|파티|행사.*)$/i);
        if (eventBoundary) {
            locRaw = eventBoundary[1].trim();
            cleanedText = cleanedText.replace(locPrefixMatch[0], ` ${eventBoundary[2]} `);
        } else {
            cleanedText = cleanedText.replace(locPrefixMatch[0], ' ');
        }
        location = cleanLocationCandidate(locRaw);
    }

    // 3. '~에서', '~서', '~앞에서', '~근처에서', '~맞은편에서' 자연어 장소 추출
    if (!location) {
        const textForLocSearch = removeDateTimePatterns(cleanedText);
        const locRegex = /([가-힣a-zA-Z0-9_\-\(\)·\s]{1,30}?)(?:\s*(?:앞|근처|주변|맞은편|인근|입구|출구))?\s*(?:에서|서\b)/g;
        let match;
        while ((match = locRegex.exec(textForLocSearch)) !== null) {
            const rawCandidate = match[0].trim();
            const candidate = cleanLocationCandidate(match[1]);

            // 시스템 키워드, 시간, 조사, 대명사 배제
            if (/^(?:캘린더|일정|스케줄|앱|여기|거기|어디|밖|내용|등록|추가|잡아|예약)$/.test(candidate)) continue;
            if (!candidate || candidate.length < 2) continue;

            location = cleanLocationCandidate(rawCandidate);
            const escapedPattern = rawCandidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
            cleanedText = cleanedText.replace(new RegExp(escapedPattern, 'g'), ' ');
            break;
        }
    }

    // 4. 최종 조합 메모 생성
    const memoParts = [];
    if (location) memoParts.push(`장소: ${location}`);
    if (note) memoParts.push(note);
    const combinedMemo = memoParts.join('\n');

    return {
        location,
        note,
        combinedMemo,
        textWithoutMemo: cleanedText
    };
}

/**
 * ✂️ 사용자 발화에서 일정 제목을 깔끔하게 추출/정제
 */
function cleanCalendarTitle(prompt) {
    if (!prompt || typeof prompt !== 'string') return '새로운 일정';
    let t = stripNotifyTimingPatterns(prompt);

    // 장소 및 메모 부분 분리/제거
    const extracted = extractLocationAndMemo(t);
    t = extracted.textWithoutMemo;

    t = t
        .replace(/\s*(?:을|를)?\s*(?:확인하고\s*)?(?:등록|추가|잡아|넣어|적어|기록|저장|예약)\s*(?:해줘|해\s*주세요|해주세요|줄래|바래|요|부탁(?:해|드립니다)?|할래)?/gi, '')
        .replace(/\s*(?:을|를)?\s*(?:잡아줘|넣어줘|적어줘|기록해줘|저장해줘|등록해줘|추가해줘|예약해줘)/gi, '')
        .replace(/(?:해줘|해\s*주세요|해주세요|줄래|바래|부탁해|부탁드립니다|보내줘|보내주세요|보내달라|보내|줘)\s*$/gi, '')
        .replace(/(?:캘린더|스케줄|일정)(?:에|으로|을|를)?/gi, '')
        .replace(/(?:오늘|내일|모레|글피|이번\s*주|다음\s*주|[월화수목금토일]요일)/gi, '')
        .replace(/(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일|\d{1,2}\/\d{1,2}|\d{4}-\d{1,2}-\d{1,2}|\d+\s*일\s*(?:뒤|후)/gi, '')
        .replace(/(?:at|시간)?\s*([01]?\d|2[0-3]):([0-5]\d)/gi, '')
        .replace(/(?:오전|오후|저녁|아침|새벽|밤)?\s*\d{1,2}\s*시(?![간명])(?:\s*\d{1,2}\s*분(?!\s*전)|반)?/gi, '')
        .replace(/^[,\s.:;~-]+|[,\s.:;~-]+$/g, '').trim()
        .replace(/^(?:에|으로|은|는|이|가|을|를|좀|새로|새로운|내용은)\s+/gi, '')
        .replace(/\s+(?:을|를|은|는|이|가|에|으로|좀)$/gi, '')
        .replace(/^[,\s.:;~-]+|[,\s.:;~-]+$/g, '').trim();

    if (!t || t.length < 2) {
        if (extracted.location) return extracted.location;
        return '새로운 일정';
    }

    return t;
}

/**
 * 🧩 일정 자연어에서 제목, 메모(장소 포함), 알림 시점을 원스톱 파싱
 */
function parseCalendarDetails(prompt, isAllDay = false) {
    const notifyTiming = parseNotifyTimingFromPrompt(prompt, isAllDay);
    const timingStripped = stripNotifyTimingPatterns(prompt);
    const { location, combinedMemo, textWithoutMemo } = extractLocationAndMemo(timingStripped);
    const title = cleanCalendarTitle(prompt);

    return {
        title,
        memo: combinedMemo,
        location,
        notifyTiming
    };
}

module.exports = {
    parseNotifyTimingFromPrompt,
    getNotifyTimingDisplay,
    stripNotifyTimingPatterns,
    extractLocationAndMemo,
    cleanCalendarTitle,
    parseCalendarDetails
};
