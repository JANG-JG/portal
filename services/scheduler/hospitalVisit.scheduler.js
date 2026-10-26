const nodemailer = require('nodemailer');

// 이메일 발송기 (Gmail SMTP)
const mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// 병원 진료 예약 오픈일 계산 (약 소진 3일 전 일자의 전주 금요일 11시)
function calculateReservationOpenDate(nextVisitDateStr) {
    const nextVisit = new Date(nextVisitDateStr);
    const dayOfWeek = nextVisit.getDay();
    const sunday = new Date(nextVisit);
    sunday.setDate(nextVisit.getDate() - dayOfWeek);

    const openFriday = new Date(sunday);
    openFriday.setDate(sunday.getDate() - 2);

    const year = openFriday.getFullYear();
    const month = String(openFriday.getMonth() + 1).padStart(2, '0');
    const day = String(openFriday.getDate()).padStart(2, '0');

    return `${year}-${month}-${day} 11:00:00`;
}

// 병원 진료 예약 오픈 알림 조건 검사 및 발송
function checkAndDispatchHospitalVisit(db, userId, currentTargetDateTime, sendBroadcastPush) {
    const summaryQuery = `
        SELECT MIN(visit_date) as first_visit, SUM(prescription_days) as total_prescribed
        FROM hospital_visits
        WHERE user_id = ?
    `;

    db.get(summaryQuery, [userId], (sumErr, visitSummary) => {
        if (sumErr || !visitSummary || !visitSummary.first_visit) return;

        const medQuery = `
            SELECT COUNT(DISTINCT substr(measured_at, 1, 10)) as total_taken 
            FROM records 
            WHERE substr(measured_at, 1, 10) >= ? 
              AND medication_time IS NOT NULL 
              AND length(medication_time) > 5
        `;

        db.get(medQuery, [visitSummary.first_visit], (medErr, medResult) => {
            const totalTaken = medResult ? medResult.total_taken : 0;
            const totalPrescribed = visitSummary.total_prescribed || 0;
            const remainingPills = Math.max(0, totalPrescribed - totalTaken);

            const now = new Date();
            const predictedVisit = new Date(now);
            predictedVisit.setDate(now.getDate() + remainingPills - 3);
            const predictedVisitStr = predictedVisit.toISOString().split('T')[0];

            const dynamicOpenDate = calculateReservationOpenDate(predictedVisitStr);

            if (dynamicOpenDate <= currentTargetDateTime) {
                db.get(
                    `SELECT * FROM hospital_visits WHERE user_id = ? AND send_notification = 1 AND notified = 0 ORDER BY visit_date DESC LIMIT 1`,
                    [userId],
                    (rowErr, row) => {
                        if (!row) return;

                        // 중복 발송 방지를 위해 먼저 알림 완료 처리
                        db.run(`UPDATE hospital_visits SET notified = 1 WHERE id = ?`, [row.id]);

                        const hospitalNameDisplay = row.hospital_name ? `[${row.hospital_name}] ` : '';
                        const targetEmail = row.notification_email || process.env.EMAIL_USER;

                        // 1. Gmail SMTP 이메일 발송
                        if (process.env.EMAIL_USER && process.env.EMAIL_PASS && targetEmail) {
                            const mailOptions = {
                                from: process.env.EMAIL_USER,
                                to: targetEmail,
                                subject: `[알림] 🏥 ${hospitalNameDisplay}진료 예약 오픈 안내`,
                                html: `
                                    <h3>🏥 병원 진료 예약 안내</h3>
                                    <p>현재 약 잔여량 기준, <strong>예약 오픈 시각(오전 11시)</strong>이 되었습니다.</p>
                                    <ul>
                                        <li><strong>진료 병원:</strong> ${row.hospital_name || '미지정'} ${row.department ? '(' + row.department + ')' : ''}</li>
                                        <li><strong>최근 진료일:</strong> ${row.visit_date}</li>
                                        <li><strong>현재 남은 약:</strong> ${remainingPills}일분</li>
                                        <li><strong>예측 방문일:</strong> ${predictedVisitStr}</li>
                                        <li><strong>메모:</strong> ${row.memo || '없음'}</li>
                                    </ul>
                                    <p><a href="https://blood.j-jg.cc/hospital.html" target="_blank" style="display:inline-block; padding:10px 18px; background:#4f46e5; color:#ffffff; text-decoration:none; border-radius:6px; font-weight:bold;">🏥 병원 진료 일정 관리 바로가기</a></p>
                                `
                            };
                            mailTransporter.sendMail(mailOptions, (error) => {
                                if (error) console.error('[HospitalScheduler] 예약 알림 메일 발송 실패:', error.message);
                                else console.log(`[HospitalScheduler] ✉️ 예약 알림 메일 발송 완료: ${targetEmail}`);
                            });
                        }

                        // 2. 통합 웹 푸시 발송
                        sendBroadcastPush({
                            title: `🏥 ${hospitalNameDisplay}진료 예약 오픈 알림`,
                            body: `오전 11시 예약 오픈 시간입니다! 남은 약: ${remainingPills}일분 (예상 진료일: ${predictedVisitStr})`,
                            url: 'https://blood.j-jg.cc/hospital.html',
                            type: 'hospital',
                            tag: 'jg-hospital',
                            userId
                        });
                    }
                );
            }
        });
    });
}

module.exports = {
    calculateReservationOpenDate,
    checkAndDispatchHospitalVisit
};
