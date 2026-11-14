const express = require('express');
const router = express.Router();
const path = require('path');
const { execFile } = require('child_process');
const { BLOOD_DIR } = require('../../config/constants');
const { db } = require('../../services/db');

function csvSafeCell(val) {
    let s = val !== null && val !== undefined ? String(val) : '';
    if (/^[=+\-@\t\r]/.test(s)) {
        s = "'" + s;
    }
    return `"${s.replace(/"/g, '""')}"`;
}

// 1. 혈압 CSV 내보내기
router.get('/export-csv', (req, res) => {
    db.all(`SELECT id, systolic, diastolic, pulse, measured_at, medication_time FROM records ORDER BY measured_at DESC`, [], (recErr, records) => {
        if (recErr) return res.status(500).json({ success: false, message: '혈압 데이터 조회 실패' });

        db.all(`SELECT id, visit_date, hospital_name, department, memo, prescription_days, next_visit_date, reservation_open_date, notification_email, send_notification FROM hospital_visits ORDER BY visit_date DESC`, [], (hospErr, visits) => {
            let csvContent = '\uFEFF[혈압 및 복약 기록]\n';
            csvContent += '번호,최고혈압(수축기),최저혈압(이완기),맥박,측정일시,복약일시\n';
            (records || []).forEach(row => {
                csvContent += `${row.id},${row.systolic ?? ''},${row.diastolic ?? ''},${row.pulse ?? ''},${csvSafeCell(row.measured_at)},${csvSafeCell(row.medication_time)}\n`;
            });

            csvContent += '\n[병원 진료 및 처방 기록]\n';
            csvContent += '번호,진료일,병원명,진료과,메모,처방일수,다음진료예정일,예약오픈일시,알림이메일,알림여부\n';
            (visits || []).forEach(v => {
                csvContent += `${v.id},${csvSafeCell(v.visit_date)},${csvSafeCell(v.hospital_name)},${csvSafeCell(v.department)},${csvSafeCell(v.memo)},${v.prescription_days || ''},${csvSafeCell(v.next_visit_date)},${csvSafeCell(v.reservation_open_date)},${csvSafeCell(v.notification_email)},${v.send_notification ? '켜짐' : '꺼짐'}\n`;
            });

            const kstToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
            const exportFilename = `health_data_export_${kstToday}.csv`;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${exportFilename}"`);
            res.status(200).send(csvContent);
        });
    });
});

// 2. 혈압 CSV 복원 (Import)
router.post('/import-csv', async (req, res) => {
    const { csvData } = req.body;
    if (!csvData) return res.status(400).json({ success: false, message: 'CSV 내용이 비어있습니다.' });

    const lines = csvData.split(/\r?\n/);
    let currentMode = 'RECORDS';
    let addedCount = 0;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        if (line.includes('[혈압 및 복약 기록]')) { currentMode = 'RECORDS'; continue; }
        if (line.includes('[병원 진료 및 처방 기록]')) { currentMode = 'HOSPITAL'; continue; }
        if (line.startsWith('번호,')) continue;

        const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(p => p.replace(/^"|"$/g, '').trim());

        if (currentMode === 'RECORDS' && parts.length >= 5) {
            const [, systolic, diastolic, pulse, measured_at, medication_time] = parts;
            if (measured_at) {
                await new Promise((resolve) => {
                    db.run(
                        `INSERT INTO records (systolic, diastolic, pulse, measured_at, medication_time) VALUES (?, ?, ?, ?, ?)`,
                        [systolic ? parseInt(systolic) : null, diastolic ? parseInt(diastolic) : null, pulse ? parseInt(pulse) : null, measured_at, medication_time || null],
                        () => { addedCount++; resolve(); }
                    );
                });
            }
        } else if (currentMode === 'HOSPITAL' && parts.length >= 3) {
            const [, visit_date, hospital_name, department, memo, prescription_days, next_visit_date, reservation_open_date, notification_email, send_notification] = parts;
            if (visit_date && hospital_name) {
                await new Promise((resolve) => {
                    db.run(
                        `INSERT INTO hospital_visits (visit_date, hospital_name, department, memo, prescription_days, next_visit_date, reservation_open_date, notification_email, send_notification) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [visit_date, hospital_name, department || '', memo || '', prescription_days ? parseInt(prescription_days) : null, next_visit_date || null, reservation_open_date || null, notification_email || '', send_notification === '켜짐' ? 1 : 0],
                        () => { addedCount++; resolve(); }
                    );
                });
            }
        }
    }
    res.json({ success: true, count: addedCount });
});

// 3. 혈압 최근 기록 미리보기
router.get('/recent', (req, res) => {
    db.all(`SELECT id, systolic, diastolic, pulse, measured_at, medication_time FROM records WHERE systolic IS NOT NULL ORDER BY measured_at DESC LIMIT 10`, [], (err, records) => {
        db.all(`SELECT id, visit_date, hospital_name, department FROM hospital_visits ORDER BY visit_date DESC LIMIT 5`, [], (vErr, visits) => {
            res.json({ success: true, records: records || [], visits: visits || [] });
        });
    });
});

// 4. 혈압 알림 메일 (SMTP) 전송 테스트
router.post('/test-email', (req, res) => {
    const bloodEnvPath = path.join(BLOOD_DIR, '.env');
    const testScript = "require('dotenv').config({ path: process.env.BLOOD_ENV_PATH }); const nodemailer = require('nodemailer'); if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) { console.error('MISSING_ENV'); process.exit(1); } const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } }); transporter.sendMail({ from: process.env.EMAIL_USER, to: process.env.EMAIL_USER, subject: '🩸 JG 포털 통합 관리자 - 구글 SMTP 연결 테스트', text: '통합 관리자 센터에서 요청하신 Gmail SMTP 알림 메일 발송 테스트가 성공하였습니다! 일시: ' + new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) }).then(() => { process.exit(0); }).catch(e => { console.error(e.message); process.exit(2); });";

    execFile('node', ['-e', testScript], { cwd: BLOOD_DIR, env: { ...process.env, BLOOD_ENV_PATH: bloodEnvPath } }, (err, stdout, stderr) => {
        if (err) {
            return res.status(500).json({ success: false, message: `발송 실패: ${stderr || err.message}` });
        }
        db.run(
            `INSERT INTO notification_history (user_id, type, title, body, icon, url, created_at)
             VALUES ('admin', 'hospital', '📧 구글 SMTP 알림 메일 점검', '관리자 센터에서 발송한 알림 메일 연결 테스트가 완료되었습니다.', '📧', '/admin#tab-blood', datetime('now', 'localtime'))`,
            () => {}
        );
        res.json({ success: true, message: '구글 알림 메일이 관리자 계정으로 정상 발송되었습니다!' });
    });
});

// 5. 혈압 대시보드 환경설정 조회 API
router.get('/configs', (req, res) => {
    db.all(`SELECT key, value FROM system_configs`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '설정 조회 실패' });
        
        const configs = {};
        (rows || []).forEach(row => { configs[row.key] = row.value; });
        
        if (!configs.session_timeout) configs.session_timeout = '30';
        if (!configs.high_systolic) configs.high_systolic = '135';
        if (!configs.high_diastolic) configs.high_diastolic = '85';
        if (!configs.low_systolic) configs.low_systolic = '90';
        if (!configs.low_diastolic) configs.low_diastolic = '60';

        res.json({ success: true, configs });
    });
});

// 6. 혈압 대시보드 환경설정 저장 API
router.post('/configs', (req, res) => {
    const { high_systolic, high_diastolic, low_systolic, low_diastolic, session_timeout } = req.body;

    if (!high_systolic || !high_diastolic || !low_systolic || !low_diastolic) {
        return res.status(400).json({ success: false, message: '모든 혈압 기준치를 올바르게 입력해주세요.' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare(`INSERT OR REPLACE INTO system_configs (key, value) VALUES (?, ?)`);
        stmt.run('high_systolic', high_systolic.toString());
        stmt.run('high_diastolic', high_diastolic.toString());
        stmt.run('low_systolic', low_systolic.toString());
        stmt.run('low_diastolic', low_diastolic.toString());
        if (session_timeout) {
            stmt.run('session_timeout', session_timeout.toString());
        }
        stmt.finalize();
        db.run("COMMIT", (err) => {
            if (err) {
                console.error('혈압 환경설정 저장 실패:', err);
                return res.status(500).json({ success: false, message: '설정 저장 중 오류가 발생했습니다.' });
            }
            res.json({ success: true, message: '대시보드 환경설정이 성공적으로 저장되었습니다.' });
        });
    });
});

// 7. 혈압계 사진 OCR 판독 로그 및 약 챙겨먹기·병원 일정 알림 발송 이력 조회
router.get('/events', (req, res) => {
    const dbAll = (sql, params = []) => new Promise(r => db.all(sql, params, (e, rows) => r(e ? [] : (rows || []))));
    const dbGet = (sql, params = []) => new Promise(r => db.get(sql, params, (e, row) => r(e ? null : row)));

    Promise.all([
        dbAll(`SELECT id, username, status, systolic, diastolic, pulse, duration_ms, message, created_at
               FROM bp_ocr_logs ORDER BY id DESC LIMIT 30`),
        dbGet(`SELECT COUNT(*) as total_count,
                      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as ok_count,
                      COALESCE(AVG(duration_ms), 0) as avg_ms
               FROM bp_ocr_logs`),
        dbAll(`SELECT id, user_id, type, title, body, icon, is_read, created_at
               FROM notification_history
               WHERE type IN ('blood_pressure', 'medication', 'hospital')
               ORDER BY id DESC LIMIT 40`),
        dbGet(`SELECT COUNT(*) as total_count,
                      COALESCE(SUM(CASE WHEN type = 'medication' THEN 1 ELSE 0 END), 0) as med_count,
                      COALESCE(SUM(CASE WHEN type = 'hospital' THEN 1 ELSE 0 END), 0) as hosp_count,
                      COALESCE(SUM(CASE WHEN type = 'blood_pressure' THEN 1 ELSE 0 END), 0) as bp_count
               FROM notification_history
               WHERE type IN ('blood_pressure', 'medication', 'hospital')`)
    ]).then(([ocrLogs, ocrStat, notificationLogs, notifStat]) => {
        const totalOcr = ocrStat ? ocrStat.total_count : 0;
        const okOcr = ocrStat ? ocrStat.ok_count : 0;
        res.json({
            success: true,
            ocrLogs,
            ocrStats: {
                totalCount: totalOcr,
                successCount: okOcr,
                successRate: totalOcr > 0 ? Math.round((okOcr / totalOcr) * 100) : 100,
                avgDurationMs: ocrStat ? Math.round(ocrStat.avg_ms) : 0
            },
            notificationLogs,
            notifStats: {
                totalCount: notifStat ? notifStat.total_count : 0,
                medCount: notifStat ? notifStat.med_count : 0,
                hospCount: notifStat ? notifStat.hosp_count : 0,
                bpCount: notifStat ? notifStat.bp_count : 0
            }
        });
    }).catch(e => {
        res.status(500).json({ success: false, message: '건강 이벤트 로그 조회 실패: ' + e.message });
    });
});

module.exports = router;
