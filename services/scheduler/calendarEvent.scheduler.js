const { decryptCalendarText } = require('../crypto.service');

// 알림 시점(timing)을 분 단위 오프셋으로 변환
function parseOffsetMinutes(timing) {
    if (!timing || timing === 'exact' || timing === 'none') return 0;
    if (timing === '5m') return 5;
    if (timing === '10m') return 10;
    if (timing === '15m') return 15;
    if (timing === '30m') return 30;
    if (timing === '1h') return 60;
    if (timing === '2h') return 120;
    if (timing === '3h') return 180;
    if (timing === '1d') return 1440;
    if (timing === '2d') return 2880;

    // 직접 입력 패턴: custom_m:N, custom_h:N, custom_d:N
    const match = String(timing).match(/^custom_([mhd]):(\d+)$/);
    if (match) {
        const unit = match[1];
        const val = parseInt(match[2], 10) || 0;
        if (unit === 'm') return val;
        if (unit === 'h') return val * 60;
        if (unit === 'd') return val * 1440;
    }
    return 0;
}

// 사용자 친화적 알림 시점 한국어 라벨 생성
function getTimingLabel(timing) {
    if (!timing || timing === 'exact') return '시작';
    if (timing === '5m') return '5분 전';
    if (timing === '10m') return '10분 전';
    if (timing === '15m') return '15분 전';
    if (timing === '30m') return '30분 전';
    if (timing === '1h') return '1시간 전';
    if (timing === '2h') return '2시간 전';
    if (timing === '3h') return '3시간 전';
    if (timing === '1d') return '1일 전';
    if (timing === '2d') return '2일 전';

    const match = String(timing).match(/^custom_([mhd]):(\d+)$/);
    if (match) {
        const unit = match[1];
        const val = match[2];
        if (unit === 'm') return `${val}분 전`;
        if (unit === 'h') return `${val}시간 전`;
        if (unit === 'd') return `${val}일 전`;
    }
    return timing;
}

// 📅 개인 일정 푸시 알림 조건 검사 및 발송 (종일/시간지정, 사전/정시, 다회 알림)
function checkAndDispatchCalendarEvents(db, userId, kstDateStr, kstTimeStr, currentTargetDateTime, sendBroadcastPush, sentHistoryCache) {
    // 오늘 및 향후 7일 이내 일정 검색 (사전 알림 고려, 본인 일정 또는 가족 공유 일정)
    const query = `
        SELECT id, user_id, title, event_date, event_time, memo, is_all_day, is_family, notify_timing, notify_repeat, notify_sent_count
        FROM calendar_events
        WHERE (user_id = ? OR is_family = 1)
          AND is_completed = 0
          AND notify_timing != 'none'
          AND event_date >= date(?, '-1 day')
          AND event_date <= date(?, '+7 day')
    `;

    db.all(query, [userId, kstDateStr, kstDateStr], (err, rows) => {
        if (err || !rows || rows.length === 0) return;

        rows.forEach(ev => {
            const isFam = Boolean(ev.is_family);
            ev.title = decryptCalendarText(ev.title, ev.user_id || userId, isFam);
            ev.memo = decryptCalendarText(ev.memo, ev.user_id || userId, isFam);

            const isAllDay = !!ev.is_all_day;
            const timing = ev.notify_timing || 'exact';
            const maxRepeat = ev.notify_repeat || 1;
            const sentCount = ev.notify_sent_count || 0;

            if (sentCount >= maxRepeat) return;

            // 🌟 사용자 요청 포맷: 
            // 일정 제목
            // 일정 메모
            // 일정 시점 - 일정 시간
            function buildCalPushBody(pointLabel, timeLabel) {
                const memoText = (ev.memo && ev.memo.trim()) ? `${ev.memo.trim()}\n` : '';
                return `${memoText}${pointLabel} - ${timeLabel}`;
            }

            // 1. 종일 일정 처리 (당일/1일 전/2일 전 및 사용자 지정 시각)
            if (isAllDay) {
                let targetDiffDays = 0;
                let targetTime = '09:00';

                if (timing === 'exact') {
                    targetDiffDays = 0;
                    targetTime = '09:00';
                } else if (timing === '1d') {
                    targetDiffDays = 1;
                    targetTime = '09:00';
                } else if (timing === '2d') {
                    targetDiffDays = 2;
                    targetTime = '09:00';
                } else if (timing.startsWith('allday:')) {
                    // 포맷: allday:{0|1|2}d:{HH:mm}
                    const parts = timing.split(':');
                    if (parts.length >= 3) {
                        targetDiffDays = parseInt(parts[1], 10) || 0;
                        targetTime = `${parts[2]}:${parts[3] || '00'}`;
                    }
                }

                const [ey, em, ed] = ev.event_date.split('-').map(Number);
                const [cy, cm, cd] = kstDateStr.split('-').map(Number);
                const eventDayMs = Date.UTC(ey, em - 1, ed);
                const currentDayMs = Date.UTC(cy, cm - 1, cd);
                const diffDays = Math.round((eventDayMs - currentDayMs) / 86400000);

                // A. 1회차 사전 또는 당일 알림
                if (diffDays === targetDiffDays && kstTimeStr === targetTime && sentCount === 0) {
                    const dayLabel = targetDiffDays === 0 ? '오늘' : `${targetDiffDays}일 전`;
                    dispatchCalPush(db, ev, userId, ev.title, buildCalPushBody(dayLabel, `종일 (${targetTime})`), 1);
                    return;
                }

                // B. 2회차 당일 오전 9시 알림 (사전 알림 후 2회 발송 설정 시)
                if (targetDiffDays > 0 && diffDays === 0 && kstTimeStr === '09:00' && maxRepeat >= 2 && sentCount === 1) {
                    dispatchCalPush(db, ev, userId, ev.title, buildCalPushBody('오늘', '종일 (09:00)'), 2);
                    return;
                }
                return;
            }

            // 2. 시간 지정 일정 처리
            if (!ev.event_time || ev.event_time.length < 4) return;

            const offsetMinutes = parseOffsetMinutes(timing);

            try {
                // KST 기준 Date 객체 생성
                const [ey, em, ed] = ev.event_date.split('-').map(Number);
                const [eh, emn] = ev.event_time.split(':').map(Number);
                const eventMs = new Date(ey, em - 1, ed, eh, emn, 0).getTime();

                const [cy, cm, cd] = kstDateStr.split('-').map(Number);
                const [ch, cmn] = kstTimeStr.split(':').map(Number);
                const currentMs = new Date(cy, cm - 1, cd, ch, cmn, 0).getTime();

                const diffMinutes = Math.round((eventMs - currentMs) / 60000);

                // A. 1회차 사전 알림 (timing이 'exact'가 아닐 때 offsetMinutes 시점에 발송)
                if (offsetMinutes > 0 && diffMinutes === offsetMinutes && sentCount === 0) {
                    const label = getTimingLabel(timing);
                    dispatchCalPush(
                        db,
                        ev,
                        userId,
                        ev.title,
                        buildCalPushBody(label, ev.event_time),
                        1
                    );
                    return;
                }

                // B. 정시 알림 (사전 알림 후 2회차 발송이거나, 애초에 timing이 'exact'인 경우)
                if (diffMinutes === 0) {
                    if (timing === 'exact' && sentCount === 0) {
                        dispatchCalPush(
                            db,
                            ev,
                            userId,
                            ev.title,
                            buildCalPushBody('시작', ev.event_time),
                            1
                        );
                    } else if (maxRepeat >= 2 && sentCount === 1) {
                        dispatchCalPush(
                            db,
                            ev,
                            userId,
                            ev.title,
                            buildCalPushBody('시작', ev.event_time),
                            2
                        );
                    }
                }
            } catch (calcErr) {
                console.error('[CalendarScheduler] 캘린더 시간 연산 오류:', calcErr.message);
            }
        });
    });

    function dispatchCalPush(dbInstance, ev, targetUser, title, body, stageNum) {
        const cacheKey = `${targetUser}:cal_push:${ev.id}:${stageNum}:${kstDateStr}_${kstTimeStr}`;
        if (sentHistoryCache && sentHistoryCache.has(cacheKey)) return;
        if (sentHistoryCache) sentHistoryCache.add(cacheKey);

        sendBroadcastPush({
            title,
            body,
            url: 'https://j-jg.cc/calendar',
            type: 'calendar',
            tag: `jg-cal-${ev.id}`,
            userId: targetUser
        });

        dbInstance.run(
            `UPDATE calendar_events SET notify_sent_count = notify_sent_count + 1, last_notified_at = datetime('now', 'localtime') WHERE id = ?`,
            [ev.id],
            (uErr) => {
                if (uErr) console.error('[CalendarScheduler] 일정 알림 상태 갱신 실패:', uErr.message);
            }
        );
        console.log(`[CalendarScheduler] 📅 캘린더 푸시 발송 완료 [${stageNum}회차]: ${ev.title}`);
    }
}

module.exports = {
    checkAndDispatchCalendarEvents
};
