/**
 * ==============================================================================
 * 텔레그램 ↔ 혈압·약 챙겨먹기 양방향 제어 & 다시 알림 스케줄 서비스
 * (telegramBlood.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적 한국어 | [규칙 3] health.db / portalDb 공유 연동
 * ==============================================================================
 */

const { db, portalDb } = require('../db');
const { classifyBloodPressure } = require('../bloodClassifier.util');
const { invalidateSummaryCache } = require('../portalSummary.service');
const { sendTelegramReply } = require('./telegramTransport.service');
const { isAuthorizedTelegramUser } = require('./telegramAuth.service');

let snoozeTableReady = false;

function getKstNowInfo(offsetMinutes = 0) {
    const target = new Date(Date.now() + offsetMinutes * 60 * 1000);
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const parts = Object.fromEntries(fmt.formatToParts(target).map((p) => [p.type, p.value]));
    const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
    const timeStr = `${parts.hour}:${parts.minute}`;
    return {
        dateStr,
        timeStr,
        isoMinute: `${dateStr}T${timeStr}`
    };
}

function pRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function pAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function hGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
}

function hAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function hRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

async function ensureSnoozeTable() {
    if (snoozeTableReady) return;
    await pRun(`
        CREATE TABLE IF NOT EXISTS telegram_snooze_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            job_type TEXT NOT NULL DEFAULT 'medication',
            due_at TEXT NOT NULL,
            sent INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);
    snoozeTableReady = true;
}

async function computeMedicationStreakDays() {
    const today = getKstNowInfo().dateStr;
    const rows = await hAll(
        `SELECT DISTINCT substr(COALESCE(NULLIF(medication_time, ''), measured_at), 1, 10) AS d
         FROM records
         WHERE (medication_time IS NOT NULL AND medication_time != '')
            OR systolic IS NOT NULL
         ORDER BY d DESC
         LIMIT 40`
    );
    const daySet = new Set(rows.map((r) => r.d).filter(Boolean));
    let streak = 0;
    const baseMs = new Date(`${today}T00:00:00+09:00`).getTime();
    for (let i = 0; i < 31; i++) {
        const dStr = new Date(baseMs - i * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
        if (daySet.has(dStr)) {
            streak += 1;
        } else if (i === 0) {
            continue;
        } else {
            break;
        }
    }
    return streak;
}

async function getBloodStatusPayload() {
    const today = getKstNowInfo().dateStr;
    const [latestBp, todayMed, streakDays] = await Promise.all([
        hGet('SELECT systolic, diastolic, pulse, measured_at FROM records WHERE systolic IS NOT NULL ORDER BY measured_at DESC LIMIT 1'),
        hGet("SELECT medication_time FROM records WHERE substr(medication_time, 1, 10) = ? ORDER BY medication_time DESC LIMIT 1", [today]),
        computeMedicationStreakDays()
    ]);

    const lines = ['💊 <b>오늘 혈압 &amp; 약 챙겨먹기 현황</b>'];
    if (todayMed) {
        const timePart = String(todayMed.medication_time || '').slice(11, 16) || '완료';
        lines.push(`• 약 복용: <b>오늘 약 복용 완료 ✅</b> (${timePart})`);
    } else {
        lines.push('• 약 복용: <b>오늘 약을 아직 안 챙겨드셨어요</b> ⏳');
    }

    if (latestBp) {
        const sys = Number(latestBp.systolic);
        const dia = Number(latestBp.diastolic);
        const grade = classifyBloodPressure(sys, dia) || { label: '안정' };
        const isToday = String(latestBp.measured_at || '').startsWith(today);
        const when = isToday ? `오늘 ${String(latestBp.measured_at).slice(11, 16)}` : String(latestBp.measured_at).replace('T', ' ');
        lines.push(`• 최근 혈압: <b>${sys}/${dia} mmHg</b> (맥박 ${latestBp.pulse || '-'}) · ${grade.label}`);
        lines.push(`  └ 측정 시각: ${when}`);
    } else {
        lines.push('• 최근 혈압: 아직 등록된 측정 기록이 없어요.');
    }

    lines.push(`• 건강 챙김 연속 기록: <b>${streakDays}일째</b> 🌿`);

    const inlineRows = [];
    if (!todayMed) {
        inlineRows.push([
            { text: '약 먹었어요 ✅', callback_data: 'cb:blood:med_done:today' },
            { text: '1시간 뒤 알림 ⏰', callback_data: 'cb:blood:med_snooze:60' }
        ]);
    }
    inlineRows.push([{ text: '혈압·건강 관리 열기 ↗', url: 'https://blood.j-jg.cc/dashboard.html' }]);

    return {
        isTodayMedTaken: Boolean(todayMed),
        streakDays,
        text: lines.join('\n'),
        replyMarkup: { inline_keyboard: inlineRows }
    };
}

async function recordQuickMedicationFromTelegram() {
    const nowInfo = getKstNowInfo();
    const existing = await hGet(
        "SELECT medication_time FROM records WHERE substr(medication_time, 1, 10) = ? ORDER BY medication_time DESC LIMIT 1",
        [nowInfo.dateStr]
    );

    let recordedTime = existing?.medication_time || nowInfo.isoMinute;
    let alreadyRecorded = Boolean(existing);

    if (!existing) {
        await hRun(
            'INSERT INTO records (systolic, diastolic, pulse, measured_at, medication_time) VALUES (NULL, NULL, NULL, ?, ?)',
            [nowInfo.isoMinute, nowInfo.isoMinute]
        );
        invalidateSummaryCache();
    }

    const streakDays = await computeMedicationStreakDays();
    const buddyPraise = streakDays >= 7
        ? `건강 단짝이 <b>${streakDays}일 연속</b> 기록에 신나서 방방 뛰고 있어요! ✨`
        : `건강 단짝이 고맙다고 반짝반짝 응원해요! (${streakDays}일 연속 🌿)`;

    return {
        alreadyRecorded,
        recordedTime: recordedTime.slice(11, 16) || nowInfo.timeStr,
        streakDays,
        messageHtml: [
            alreadyRecorded
                ? `✅ <b>오늘 약 복용이 이미 기록되어 있어요!</b> (${recordedTime.slice(11, 16)})`
                : `💊 <b>오늘 약 복용 완료 ✅</b> (${nowInfo.timeStr} 기록됨)`,
            buddyPraise
        ].join('\n'),
        replyMarkup: {
            inline_keyboard: [[{ text: '혈압·건강 관리 열기 ↗', url: 'https://blood.j-jg.cc/dashboard.html' }]]
        }
    };
}

async function scheduleMedSnoozeJob({ chatId, senderId, delayMinutes = 60 }) {
    await ensureSnoozeTable();
    const dueInfo = getKstNowInfo(delayMinutes);
    await pRun(
        `INSERT INTO telegram_snooze_jobs (chat_id, sender_id, job_type, due_at, sent)
         VALUES (?, ?, 'medication', ?, 0)`,
        [String(chatId), String(senderId), dueInfo.isoMinute]
    );
    return dueInfo.timeStr;
}

async function processDueTelegramSnoozeJobs(botToken) {
    if (!botToken) return 0;
    await ensureSnoozeTable();
    const nowIso = getKstNowInfo().isoMinute;
    const dueRows = await pAll(
        'SELECT id, chat_id, sender_id FROM telegram_snooze_jobs WHERE sent = 0 AND due_at <= ? ORDER BY id ASC LIMIT 10',
        [nowIso]
    );
    if (dueRows.length === 0) return 0;

    let sentCount = 0;
    for (const job of dueRows) {
        await pRun('UPDATE telegram_snooze_jobs SET sent = 1 WHERE id = ?', [job.id]);
        const auth = await isAuthorizedTelegramUser(job.sender_id).catch(() => null);
        if (!auth || auth.role !== 'admin') continue;

        const today = getKstNowInfo().dateStr;
        const already = await hGet(
            'SELECT 1 FROM records WHERE substr(medication_time, 1, 10) = ? LIMIT 1',
            [today]
        );
        if (already) continue;

        await sendTelegramReply(
            botToken,
            job.chat_id,
            '⏰ <b>약 챙겨먹기 다시 알림</b>\n아직 오늘 약 복용 기록이 없어요. 물 한 잔과 함께 챙겨드세요!',
            {
                replyMarkup: {
                    inline_keyboard: [[
                        { text: '약 먹었어요 ✅', callback_data: 'cb:blood:med_done:today' },
                        { text: '30분 뒤 다시 ⏰', callback_data: 'cb:blood:med_snooze:30' }
                    ]]
                }
            }
        );
        sentCount += 1;
    }
    return sentCount;
}

async function recordMedicationSlotFromTelegram(medId, slotRaw, actorUsername = 'admin') {
    const id = parseInt(medId, 10);
    const digits = String(slotRaw || '').replace(/\D/g, '');
    const slotTime = digits.length === 4 ? `${digits.slice(0, 2)}:${digits.slice(2, 4)}` : String(slotRaw || '').trim();
    const nowInfo = getKstNowInfo();

    const med = await hGet('SELECT * FROM health_medications WHERE id = ?', [id]);
    if (!med) {
        return {
            ok: false,
            toast: '등록된 약 정보를 찾을 수 없어요.',
            messageHtml: '⚠️ 해당 약 정보를 찾을 수 없습니다.'
        };
    }

    const existing = await hGet(
        'SELECT id, taken_at FROM health_medication_logs WHERE medication_id = ? AND log_date = ? AND slot_time = ?',
        [id, nowInfo.dateStr, slotTime]
    );

    const whoLabel = med.target_label && med.target_label !== '본인' ? `[${med.target_label}] ` : '';

    if (existing) {
        return {
            ok: true,
            alreadyRecorded: true,
            toast: '이미 복용 완료로 체크되어 있어요!',
            messageHtml:
                `✅ <b>${whoLabel}${med.med_name} (${slotTime}) 이미 복용 완료됨</b>\n` +
                `• 오늘(${nowInfo.dateStr}) 해당 시간대 복용이 이미 기록되어 있습니다.`,
            replyMarkup: {
                inline_keyboard: [[{ text: '약·복용 대시보드 열기 ↗', url: 'https://blood.j-jg.cc/dashboard.html' }]]
            }
        };
    }

    await hRun(
        `INSERT INTO health_medication_logs (medication_id, user_id, checked_by_user_id, log_date, slot_time, status, taken_at)
         VALUES (?, ?, ?, ?, ?, 'taken', datetime('now', 'localtime'))`,
        [id, med.user_id, actorUsername || 'admin', nowInfo.dateStr, slotTime]
    );

    let remainText = '';
    if (med.remain_count !== null && med.remain_count !== undefined) {
        const nextRemain = Math.max(0, Number(med.remain_count) - 1);
        if (med.med_type === 'course' && nextRemain === 0) {
            await hRun(
                `UPDATE health_medications SET remain_count = 0, is_active = 0, completed_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE id = ?`,
                [id]
            );
            remainText = '\n🎉 <b>처방약 복용을 모두 완료했어요!</b>';
        } else {
            await hRun(
                `UPDATE health_medications SET remain_count = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
                [nextRemain, id]
            );
            remainText = `\n• 남은 횟수: <b>${nextRemain}회</b>`;
        }
    }

    invalidateSummaryCache();

    return {
        ok: true,
        alreadyRecorded: false,
        toast: `💊 ${med.med_name} 복용 완료!`,
        messageHtml:
            `✅ <b>${whoLabel}${med.med_name} (${slotTime}) 복용 완료!</b>\n` +
            `• 체크 시각: <b>${nowInfo.timeStr}</b>${remainText}`,
        replyMarkup: {
            inline_keyboard: [[{ text: '약·복용 대시보드 열기 ↗', url: 'https://blood.j-jg.cc/dashboard.html' }]]
        }
    };
}

module.exports = {
    getKstNowInfo,
    computeMedicationStreakDays,
    getBloodStatusPayload,
    recordQuickMedicationFromTelegram,
    recordMedicationSlotFromTelegram,
    scheduleMedSnoozeJob,
    processDueTelegramSnoozeJobs
};
