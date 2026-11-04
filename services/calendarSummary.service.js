/**
 * 📅 JG 포털 오늘 캘린더 일정 요약 서비스 (calendarSummary.service.js)
 * - portal.db (portalDb) 기반 실시간 오늘 일정 조회
 * - AES-256-GCM 복호화 (본인 일정 + 가족 공유 일정 안전 분리)
 * - 관리자 전용 병원 예약/진료 오늘 일정 지능형 연동
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const { portalDb, db } = require('./db');
const { decryptCalendarText } = require('./crypto.service');

/**
 * KST (Asia/Seoul) 기준 오늘 날짜 문자열 반환 (YYYY-MM-DD)
 */
function getTodayKstString() {
    const kstFormatter = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = kstFormatter.formatToParts(new Date());
    const getPart = (type) => parts.find(p => p.type === type)?.value || '';
    return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
}

/**
 * 사용자별 오늘 캘린더 일정 조회 및 복호화
 * @param {number|string} userId 사용자 식별자
 * @param {boolean} isAdmin 관리자 여부
 * @returns {Promise<Array>} 오늘 일정 목록
 */
async function getTodayCalendarEvents(userId, isAdmin = false) {
    const todayKst = getTodayKstString();
    const todayEvents = [];

    // 1) 캘린더 등록 개인 일정 및 가족 공유 일정 조회 (portal.db)
    const calPromise = new Promise((resolve) => {
        if (!portalDb) return resolve([]);
        const timer = setTimeout(() => resolve([]), 1500);
        const query = `
            SELECT id, user_id, title, event_date, event_time, category, color, memo, is_completed, is_all_day, is_family 
            FROM calendar_events 
            WHERE event_date = ? 
              AND (user_id = ? OR is_family = 1 OR category = '가족')
            ORDER BY is_all_day DESC, event_time ASC, id ASC
        `;
        const params = [todayKst, userId || 1];

        portalDb.all(query, params, (err, rows) => {
            clearTimeout(timer);
            if (err) {
                console.warn('⚠️ [CalendarSummary] 오늘 캘린더 일정 조회 실패:', err.message);
                return resolve([]);
            }
            if (!rows || rows.length === 0) return resolve([]);

            const list = rows.map(r => {
                const isFam = !!r.is_family || r.category === '가족';
                const decTitle = decryptCalendarText(r.title, r.user_id, isFam);
                const decMemo = decryptCalendarText(r.memo, r.user_id, isFam);
                return {
                    id: `cal-${r.id}`,
                    dbId: r.id,
                    userId: r.user_id,
                    title: decTitle || '일정',
                    event_date: r.event_date,
                    event_time: r.event_time || '',
                    category: r.category || '일반',
                    color: r.color || '#6366f1',
                    memo: decMemo || '',
                    is_completed: !!r.is_completed,
                    is_all_day: !!r.is_all_day,
                    is_family: isFam
                };
            });
            resolve(list);
        });
    });

    // 2) 관리자인 경우 오늘 예정된 병원 진료/예약 오픈 확인 (health.db)
    const hospPromise = new Promise((resolve) => {
        if (!isAdmin || !db) return resolve([]);
        const timer = setTimeout(() => resolve([]), 1500);
        const hospQuery = `
            SELECT id, visit_date, next_visit_date, reservation_open_date, hospital_name, department, memo 
            FROM hospital_visits 
            WHERE next_visit_date = ? OR reservation_open_date = ?
        `;
        db.all(hospQuery, [todayKst, todayKst], (err, rows) => {
            clearTimeout(timer);
            if (err || !rows) return resolve([]);
            const hList = [];
            rows.forEach(h => {
                const hospName = h.hospital_name || '병원';
                if (h.next_visit_date && String(h.next_visit_date).trim().slice(0, 10) === todayKst) {
                    hList.push({
                        id: `hosp-next-${h.id}`,
                        title: `🏥 ${hospName} 진료`,
                        event_date: todayKst,
                        event_time: '오전',
                        category: '진료',
                        color: '#059669',
                        memo: `${h.department || '외래'} 진료 예정일`,
                        is_all_day: false,
                        is_family: false
                    });
                }
                if (h.reservation_open_date && String(h.reservation_open_date).trim().slice(0, 10) === todayKst) {
                    hList.push({
                        id: `hosp-res-${h.id}`,
                        title: `🔔 ${hospName} 예약 오픈`,
                        event_date: todayKst,
                        event_time: '09:00',
                        category: '예약',
                        color: '#d97706',
                        memo: '진료 예약 오픈 당일 빠른 신청 필요',
                        is_all_day: false,
                        is_family: false
                    });
                }
            });
            resolve(hList);
        });
    });

    try {
        const [calList, hospList] = await Promise.all([calPromise, hospPromise]);
        todayEvents.push(...calList, ...hospList);
    } catch (e) {
        console.warn('⚠️ [CalendarSummary] 일정 종합 실패:', e.message);
    }

    return todayEvents;
}

module.exports = {
    getTodayKstString,
    getTodayCalendarEvents
};
