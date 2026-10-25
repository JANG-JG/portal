const express = require('express');
const router = express.Router();
const { db, newsDb } = require('../services/db');
const { authenticateToken } = require('../middleware/auth');
const { ADMIN_USERS } = require('../config/constants');
const { encryptCalendarText, decryptCalendarText } = require('../services/crypto.service');

// 📅 대한민국 주요 공휴일 (2026년)
const KOREAN_HOLIDAYS_2026 = [
    { date: '2026-01-01', title: '새해 첫날' },
    { date: '2026-02-16', title: '설날 연휴' },
    { date: '2026-02-17', title: '설날' },
    { date: '2026-02-18', title: '설날 연휴' },
    { date: '2026-03-01', title: '삼일절' },
    { date: '2026-03-02', title: '삼일절 대체공휴일' },
    { date: '2026-05-05', title: '어린이날' },
    { date: '2026-05-24', title: '부처님오신날' },
    { date: '2026-05-25', title: '대체공휴일' },
    { date: '2026-06-06', title: '현충일' },
    { date: '2026-08-15', title: '광복절' },
    { date: '2026-08-17', title: '광복절 대체공휴일' },
    { date: '2026-09-24', title: '추석 연휴' },
    { date: '2026-09-25', title: '추석' },
    { date: '2026-09-26', title: '추석 연휴' },
    { date: '2026-10-03', title: '개천절' },
    { date: '2026-10-05', title: '개천절 대체공휴일' },
    { date: '2026-10-09', title: '한글날' },
    { date: '2026-12-25', title: '기독탄신일(크리스마스)' }
];

// 1. 전체 일정 목록 조회 (개인 일정, 병원, 복약, 공휴일, 브리핑 시간 통합)
router.get('/events', authenticateToken, async (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const allowedServices = Array.isArray(req.user.allowed_services) ? req.user.allowed_services : [];
    const hasBlood = isAdmin || allowedServices.includes('blood') || allowedServices.includes('all');
    const events = [];

    // 1) 캘린더 등록 개인 일정
    // - 관리자/가족 공통: 본인이 등록한 일정 (user_id = ?) + 가족 공유 일정 (is_family = 1 또는 category = '가족')
    // * 엄격한 프라이버시 보호: 가족의 개인 일정은 관리자도 열람 불가, 관리자의 개인 일정은 가족도 열람 불가
    const personalPromise = new Promise((resolve) => {
        const query = "SELECT id, user_id, title, event_date, event_time, category, color, memo, is_completed, is_all_day, is_family, notify_timing, notify_repeat FROM calendar_events WHERE user_id = ? OR is_family = 1 OR category = '가족' ORDER BY event_date ASC";
        const params = [userId];

        db.all(query, params, (err, rows) => {
            if (!err && rows) {
                rows.forEach(r => {
                    const isFam = !!r.is_family || r.category === '가족';
                    const decTitle = decryptCalendarText(r.title, r.user_id, isFam);
                    const decMemo = decryptCalendarText(r.memo, r.user_id, isFam);
                    events.push({
                        id: `cal-${r.id}`,
                        dbId: r.id,
                        userId: r.user_id,
                        title: decTitle,
                        date: r.event_date,
                        time: r.event_time,
                        type: 'personal',
                        category: r.category || '일반',
                        color: r.color || '#6366f1',
                        memo: decMemo,
                        isCompleted: !!r.is_completed,
                        isAllDay: !!r.is_all_day,
                        isFamily: isFam,
                        notifyTiming: r.notify_timing || 'exact',
                        notifyRepeat: r.notify_repeat !== undefined ? r.notify_repeat : 1
                    });
                });
            }
            resolve();
        });
    });

    // 2) 병원 진료 예약일, 방문일, 다음 예정일 및 처방약 소진일 (health.db)
    // blood 서비스 권한이 없으면 가족 계정에 원천 비노출
    const hospitalPromise = new Promise((resolve) => {
        if (!hasBlood) return resolve();
        const hospQuery = isAdmin
            ? "SELECT id, visit_date, prescription_days, next_visit_date, reservation_open_date, hospital_name, department, memo FROM hospital_visits"
            : "SELECT id, visit_date, prescription_days, next_visit_date, reservation_open_date, hospital_name, department, memo FROM hospital_visits WHERE user_id = ?";
        const hospParams = isAdmin ? [] : [userId];

        db.all(hospQuery, hospParams, (err, rows) => {
            if (!err && rows) {
                rows.forEach(h => {
                    const hospName = h.hospital_name || '병원';
                    if (h.next_visit_date) {
                        const nextDate = String(h.next_visit_date).trim().slice(0, 10);
                        events.push({
                            id: `hosp-next-${h.id}`,
                            title: `🏥 ${hospName} 진료 예정`,
                            date: nextDate,
                            type: 'hospital-next',
                            color: '#059669',
                            memo: `${h.department || '외래'} 진료 예정일`
                        });
                    }
                    if (h.reservation_open_date) {
                        const resDate = String(h.reservation_open_date).trim().slice(0, 10);
                        events.push({
                            id: `hosp-res-${h.id}`,
                            title: `🔔 ${hospName} 예약 오픈일`,
                            date: resDate,
                            type: 'hospital-res',
                            color: '#d97706',
                            memo: '진료 예약 오픈 당일 빠른 신청 필요'
                        });
                    }
                    if (h.visit_date && h.prescription_days > 0) {
                        try {
                            const vDate = new Date(h.visit_date);
                            vDate.setDate(vDate.getDate() + parseInt(h.prescription_days, 10));
                            const expiryDateStr = vDate.toISOString().slice(0, 10);
                            events.push({
                                id: `hosp-rx-${h.id}`,
                                title: `💊 ${h.prescription_days}일분 처방약 소진 예정`,
                                date: expiryDateStr,
                                type: 'hospital-rx',
                                color: '#0284c7',
                                memo: `${hospName} 처방약 복용 완료일 (${h.prescription_days}일분)`
                            });
                        } catch(e) {}
                    }
                    if (h.visit_date) {
                        const vDateStr = String(h.visit_date).trim().slice(0, 10);
                        events.push({
                            id: `hosp-visit-${h.id}`,
                            title: `🏥 ${hospName} 진료 완료`,
                            date: vDateStr,
                            type: 'hospital',
                            color: '#64748b',
                            memo: `${h.department || '외래'} 진료 완료 (${h.prescription_days || 0}일분 처방)`
                        });
                    }
                });
            }
            resolve();
        });
    });

    // 3) 최근 혈압 측정 & 복약 기록 (health.db records)
    // blood 서비스 권한이 없으면 원천 비노출
    const bloodPromise = new Promise((resolve) => {
        if (!hasBlood) return resolve();
        const bloodQuery = isAdmin
            ? "SELECT id, measured_at, systolic, diastolic, pulse, medication_time FROM records ORDER BY measured_at DESC LIMIT 150"
            : "SELECT id, measured_at, systolic, diastolic, pulse, medication_time FROM records WHERE user_id = ? ORDER BY measured_at DESC LIMIT 150";
        const bloodParams = isAdmin ? [] : [userId];

        db.all(bloodQuery, bloodParams, (err, rows) => {
            if (err) {
                console.error('[Calendar Blood Fetch Error]:', err.message);
                return resolve();
            }
            if (rows) {
                const bpByDate = new Map();
                const medByDate = new Map();

                rows.forEach(r => {
                    const dateStr = (r.measured_at || r.medication_time || '').slice(0, 10);
                    if (!dateStr || dateStr.length < 10) return;

                    if (r.systolic && r.diastolic && !bpByDate.has(dateStr)) {
                        bpByDate.set(dateStr, r);
                    }
                    if (r.medication_time && !medByDate.has(dateStr)) {
                        medByDate.set(dateStr, r);
                    }
                });

                bpByDate.forEach((r, dateStr) => {
                    const timeStr = r.measured_at && r.measured_at.length >= 16 ? r.measured_at.slice(11, 16) : '';
                    events.push({
                        id: `blood-bp-${r.id}`,
                        title: `❤️ ${r.systolic}/${r.diastolic}`,
                        date: dateStr,
                        time: timeStr,
                        type: 'health-bp',
                        color: '#e11d48',
                        memo: `혈압: ${r.systolic}/${r.diastolic} mmHg (맥박 ${r.pulse || '-'} bpm)`
                    });
                });

                medByDate.forEach((r, dateStr) => {
                    const timeStr = r.medication_time && r.medication_time.length >= 16 ? r.medication_time.slice(11, 16) : '';
                    events.push({
                        id: `blood-med-${r.id}`,
                        title: timeStr ? `💊 복약 (${timeStr})` : '💊 혈압약 복용',
                        date: dateStr,
                        time: timeStr,
                        type: 'health-med',
                        color: '#0284c7',
                        memo: `혈압약 복용 완료 (${timeStr || '시간 미기록'})`
                    });
                });
            }
            resolve();
        });
    });

    // 4) 대한민국 주요 공휴일
    KOREAN_HOLIDAYS_2026.forEach(hol => {
        events.push({
            id: `hol-${hol.date}`,
            title: `🚩 ${hol.title}`,
            date: hol.date,
            type: 'holiday',
            color: '#dc2626',
            memo: '대한민국 법정 공휴일'
        });
    });

    // 5) 뉴스 브리핑 텔레그램 발송 시간표 (briefing.db system_settings)
    let routineBriefingTimes = ['07:30', '20:00'];
    const briefingPromise = new Promise((resolve) => {
        if (!newsDb) return resolve();
        newsDb.get("SELECT value FROM system_settings WHERE key = 'telegram_briefing_times'", (err, row) => {
            if (!err && row && row.value) {
                try {
                    const times = JSON.parse(row.value);
                    if (Array.isArray(times) && times.length > 0) {
                        routineBriefingTimes = times;
                    }
                } catch(e) {}
            }
            resolve();
        });
    });

    await Promise.allSettled([personalPromise, hospitalPromise, bloodPromise, briefingPromise]);
    res.json({ success: true, events, routineBriefingTimes });
});

// 2. 커스텀 범례/카테고리 목록 조회
router.get('/categories', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    db.all("SELECT id, name, color FROM calendar_categories WHERE user_id = ? OR user_id = 'admin' ORDER BY id ASC", [userId], (err, rows) => {
        if (err) {
            console.error('[Calendar 범례 조회 실패]:', err.message);
            return res.status(500).json({ success: false, message: '범례 조회 실패' });
        }
        res.json({ success: true, categories: rows || [] });
    });
});

// 3. 커스텀 범례 추가
router.post('/categories', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const { name, color = '#6366f1' } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: '범례 이름을 입력해주세요.' });
    }
    const cleanName = name.trim();
    const cleanColor = (color || '#6366f1').trim();

    db.run("INSERT INTO calendar_categories (user_id, name, color) VALUES (?, ?, ?)", [userId, cleanName, cleanColor], function(err) {
        if (err) {
            console.error('[Calendar 범례 추가 실패]:', err.message);
            return res.status(500).json({ success: false, message: '범례 추가 실패' });
        }
        res.json({ success: true, id: this.lastID, name: cleanName, color: cleanColor, message: '새 범례가 추가되었습니다.' });
    });
});

// 4. 커스텀 범례 삭제
router.delete('/categories/:id', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const catId = req.params.id;
    db.run("DELETE FROM calendar_categories WHERE id = ? AND (user_id = ? OR ? = 1)", [catId, userId, isAdmin], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: '범례 삭제 실패' });
        }
        res.json({ success: true, message: '범례가 삭제되었습니다.' });
    });
});

// 5. 새 일정 등록
router.post('/events', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const {
        title,
        event_date,
        event_time = '',
        category = '일반',
        color = '#6366f1',
        memo = '',
        is_all_day = 0,
        is_family = 0,
        notify_timing = 'exact',
        notify_repeat = 1
    } = req.body;

    if (!title || !event_date) {
        return res.status(400).json({ success: false, message: '일정 제목과 날짜(YYYY-MM-DD)를 입력해주세요.' });
    }

    const isAllDayVal = is_all_day ? 1 : 0;
    const isFamilyVal = (is_family || category === '가족') ? 1 : 0;
    const timeVal = isAllDayVal ? '' : (event_time || '').trim();

    const encryptedTitle = encryptCalendarText(title.trim(), userId, isFamilyVal);
    const encryptedMemo = encryptCalendarText((memo || '').trim(), userId, isFamilyVal);

    const query = `
        INSERT INTO calendar_events (user_id, title, event_date, event_time, category, color, memo, is_all_day, is_family, notify_timing, notify_repeat)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(query, [
        userId,
        encryptedTitle,
        event_date.trim(),
        timeVal,
        category.trim(),
        color.trim(),
        encryptedMemo,
        isAllDayVal,
        isFamilyVal,
        notify_timing || 'exact',
        parseInt(notify_repeat, 10) || 1
    ], function(err) {
        if (err) {
            console.error('[Calendar 등록 실패]:', err.message);
            return res.status(500).json({ success: false, message: '일정 등록 실패' });
        }
        res.json({ success: true, id: this.lastID, message: '새 일정이 등록되었습니다.' });
    });
});

// 6. 기존 일정 수정
router.put('/events/:id', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const eventId = req.params.id;
    const {
        title,
        event_date,
        event_time = '',
        category = '일반',
        color = '#6366f1',
        memo = '',
        is_all_day = 0,
        is_family = 0,
        notify_timing = 'exact',
        notify_repeat = 1
    } = req.body;

    if (!title || !event_date) {
        return res.status(400).json({ success: false, message: '일정 제목과 날짜(YYYY-MM-DD)를 입력해주세요.' });
    }

    const isAllDayVal = is_all_day ? 1 : 0;
    const isFamilyVal = (is_family || category === '가족') ? 1 : 0;
    const timeVal = isAllDayVal ? '' : (event_time || '').trim();

    const encryptedTitle = encryptCalendarText(title.trim(), userId, isFamilyVal);
    const encryptedMemo = encryptCalendarText((memo || '').trim(), userId, isFamilyVal);

    const query = `
        UPDATE calendar_events
        SET title = ?, event_date = ?, event_time = ?, category = ?, color = ?, memo = ?,
            is_all_day = ?, is_family = ?, notify_timing = ?, notify_repeat = ?, notify_sent_count = 0
        WHERE id = ? AND (user_id = ? OR (? = 1 AND (is_family = 1 OR category = '가족')))
    `;
    db.run(query, [
        encryptedTitle,
        event_date.trim(),
        timeVal,
        category.trim(),
        color.trim(),
        encryptedMemo,
        isAllDayVal,
        isFamilyVal,
        notify_timing || 'exact',
        parseInt(notify_repeat, 10) || 1,
        eventId,
        userId,
        isAdmin
    ], function(err) {
        if (err) {
            console.error('[Calendar 일정 수정 실패]:', err.message);
            return res.status(500).json({ success: false, message: '일정 수정 실패' });
        }
        res.json({ success: true, message: '일정이 수정되었습니다.' });
    });
});

// 7. 일정 삭제
router.delete('/events/:id', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const eventId = req.params.id;

    db.run("DELETE FROM calendar_events WHERE id = ? AND (user_id = ? OR (? = 1 AND (is_family = 1 OR category = '가족')))", [eventId, userId, isAdmin], function(err) {
        if (err) return res.status(500).json({ success: false, message: '일정 삭제 실패' });
        res.json({ success: true, message: '일정이 삭제되었습니다.' });
    });
});

// 8. 일정 완료 토글
router.patch('/events/:id/toggle', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const eventId = req.params.id;

    db.run(`
        UPDATE calendar_events 
        SET is_completed = CASE WHEN is_completed = 1 THEN 0 ELSE 1 END
        WHERE id = ? AND (user_id = ? OR (? = 1 AND (is_family = 1 OR category = '가족')))
    `, [eventId, userId, isAdmin], function(err) {
        if (err) return res.status(500).json({ success: false, message: '완료 토글 실패' });
        res.json({ success: true, message: '일정 상태가 변경되었습니다.' });
    });
});

module.exports = router;
