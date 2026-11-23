const { publishNotificationEvent } = require('./notification/hub.service');

function parseTimesList(raw) {
    let arr = raw;
    if (typeof raw === 'string') {
        try { arr = JSON.parse(raw); } catch (_) { arr = []; }
    }
    if (!Array.isArray(arr)) return [];
    return arr.filter(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t)));
}

function addMinutesToTimeStr(hhmm, offsetMinutes) {
    const [h, m] = String(hhmm).split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    const total = h * 60 + m + offsetMinutes;
    if (total < 0 || total >= 1440) return null;
    const nh = String(Math.floor(total / 60)).padStart(2, '0');
    const nm = String(total % 60).padStart(2, '0');
    return `${nh}:${nm}`;
}

/**
 * 1분마다 health.db의 health_medications / health_medication_logs를 검사하여
 * 복용 시간 도래(health.med_due), 45분 미복용(health.med_missed), 잔여 부족(health.med_refill_low) 알림 발행
 */
function checkFamilyMedicationsAndNotify(healthDb, kstDateStr, kstTimeStr, isWeekendDay, sentHistoryCache) {
    if (!healthDb) return;

    healthDb.all(
        `SELECT * FROM health_medications WHERE is_active = 1 AND med_type != 'as_needed'`,
        [],
        (err, meds) => {
            if (err || !meds || meds.length === 0) return;

            healthDb.all(
                `SELECT medication_id, slot_time, status FROM health_medication_logs WHERE log_date = ?`,
                [kstDateStr],
                (logErr, logs) => {
                    if (logErr) return;
                    const logMap = new Set(
                        (logs || []).map(l => `${l.medication_id}::${l.slot_time}`)
                    );

                    for (const med of meds) {
                        if (med.med_type === 'course') {
                            if (med.start_date && kstDateStr < med.start_date) continue;
                            if (med.end_date && kstDateStr > med.end_date) continue;
                        }

                        const weekday = parseTimesList(med.weekday_times);
                        const weekend = parseTimesList(med.weekend_times);
                        const slots = (med.schedule_mode === 'split' && isWeekendDay && weekend.length > 0)
                            ? weekend
                            : weekday;

                        const whoLabel = med.target_label && med.target_label !== '본인'
                            ? `${med.target_label} `
                            : '';

                        for (const slot of slots) {
                            if (logMap.has(`${med.id}::${slot}`)) continue;

                            // 1) 정시 복용 알림
                            if (kstTimeStr === slot) {
                                const dueKey = `health:med_due:${med.id}:${kstDateStr}:${slot}`;
                                if (!sentHistoryCache.has(dueKey)) {
                                    sentHistoryCache.add(dueKey);
                                    publishNotificationEvent({
                                        service_key: 'health',
                                        event_type: 'health.med_due',
                                        recipient_id: med.user_id,
                                        title: `💊 ${whoLabel}${med.med_name} 드실 시간이에요`,
                                        body: `${slot} 예정된 약을 챙겨드시고 체크해 주세요.${med.dosage_note ? ' (' + med.dosage_note + ')' : ''}`,
                                        action_url: 'https://blood.j-jg.cc/dashboard.html',
                                        severity: 'info',
                                        dedup_key: dueKey
                                    }).catch(() => {});
                                }
                            }

                            // 2) 45분 경과 미복용 리마인드
                            const missedTime = addMinutesToTimeStr(slot, 45);
                            if (missedTime && kstTimeStr === missedTime) {
                                const missedKey = `health:med_missed:${med.id}:${kstDateStr}:${slot}`;
                                if (!sentHistoryCache.has(missedKey)) {
                                    sentHistoryCache.add(missedKey);
                                    publishNotificationEvent({
                                        service_key: 'health',
                                        event_type: 'health.med_missed',
                                        recipient_id: med.user_id,
                                        title: `⏰ ${whoLabel}${med.med_name} 아직 체크되지 않았어요`,
                                        body: `${slot} 복용 체크가 아직 안 되어 있어요. 드셨다면 잊지 말고 체크해 주세요!`,
                                        action_url: 'https://blood.j-jg.cc/dashboard.html',
                                        severity: 'warn',
                                        dedup_key: missedKey
                                    }).catch(() => {});
                                }
                            }
                        }

                        // 3) 매일 오전 09:00 잔여량 부족 경고
                        if (kstTimeStr === '09:00' && med.remain_count !== null && med.remain_count !== undefined) {
                            const warnThreshold = Number(med.refill_warn_threshold ?? 3);
                            if (Number(med.remain_count) <= warnThreshold) {
                                const refillKey = `health:med_refill_low:${med.id}:${kstDateStr}`;
                                if (!sentHistoryCache.has(refillKey)) {
                                    sentHistoryCache.add(refillKey);
                                    publishNotificationEvent({
                                        service_key: 'health',
                                        event_type: 'health.med_refill_low',
                                        recipient_id: med.user_id,
                                        title: `💊 ${whoLabel}${med.med_name} 잔여량 부족`,
                                        body: `남은 약이 ${med.remain_count}개입니다. 미리 처방/구입 일정을 확인해 주세요.`,
                                        action_url: 'https://blood.j-jg.cc/dashboard.html',
                                        severity: 'warn',
                                        dedup_key: refillKey
                                    }).catch(() => {});
                                }
                            }
                        }
                    }
                }
            );
        }
    );
}

module.exports = { checkFamilyMedicationsAndNotify };
