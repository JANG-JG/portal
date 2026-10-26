const { decryptCalendarText } = require('../crypto.service');

// 📅 개인 일정 푸시 알림 조건 검사 및 발송 (종일/시간지정, 사전/정시, 다회 알림)
function checkAndDispatchCalendarEvents(db, userId, kstDateStr, kstTimeStr, currentTargetDateTime, sendBroadcastPush, sentHistoryCache) {
    // 오늘 및 내일 일정 검색 (본인 일정 또는 가족 공유 일정)
    const query = `
        SELECT id, user_id, title, event_date, event_time, memo, is_all_day, is_family, notify_timing, notify_repeat, notify_sent_count
        FROM calendar_events
        WHERE (user_id = ? OR is_family = 1)
          AND is_completed = 0
          AND notify_timing != 'none'
          AND event_date >= date(?, '-1 day')
          AND event_date <= date(?, '+1 day')
    `;

    db.all(query, [userId, kstDateStr, kstDateStr], (err, rows) => {
        if (err || !rows || rows.length === 0) return;

        rows.forEach(ev => {
            const isFam = Boolean(ev.is_family);
            ev.title = decryptCalendarText(ev.title, ev.user_id || userId, isFam);
            ev.memo = decryptCalendarText(ev.memo, ev.user_id || userId, isFam);

            const isAllDay = !!ev.is_all_day;
            const timing = ev.notify_timing || 'exact'; // 'exact', '10m', '30m', '1h', '1d'
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

            // 1. 종일 일정 처리 (기본 오전 09:00 발송)
            if (isAllDay) {
                if (kstTimeStr !== '09:00') return;

                // 1일 전 알림
                if (timing === '1d') {
                    // 내일 일정인 경우 (1일 전 오전 9시 알림)
                    const tomorrow = new Date(Date.now() + 86400000 + 32400000).toISOString().slice(0, 10);
                    if (ev.event_date === tomorrow && sentCount === 0) {
                        dispatchCalPush(db, ev, userId, ev.title, buildCalPushBody('1일 전', '종일'), 1);
                        return;
                    }
                    // 당일 오전 9시 알림 (2회 발송 설정 시)
                    if (ev.event_date === kstDateStr && maxRepeat >= 2 && sentCount < 2) {
                        dispatchCalPush(db, ev, userId, ev.title, buildCalPushBody('오늘', '종일'), 2);
                        return;
                    }
                } else {
                    // 당일 알림 (timing === 'exact' 등)
                    if (ev.event_date === kstDateStr && sentCount === 0) {
                        dispatchCalPush(db, ev, userId, ev.title, buildCalPushBody('오늘', '종일'), 1);
                        return;
                    }
                }
                return;
            }

            // 2. 시간 지정 일정 처리
            if (!ev.event_time || ev.event_time.length < 4) return;

            // 밀리초 기준 시각 계산 (오프셋)
            let offsetMinutes = 0;
            if (timing === '10m') offsetMinutes = 10;
            else if (timing === '30m') offsetMinutes = 30;
            else if (timing === '1h') offsetMinutes = 60;
            else if (timing === '1d') offsetMinutes = 1440;

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
                    const label = timing === '10m' ? '10분 전' : (timing === '30m' ? '30분 전' : (timing === '1h' ? '1시간 전' : '1일 전'));
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
