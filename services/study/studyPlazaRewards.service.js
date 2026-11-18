/**
 * ==============================================================================
 * 학습 포인트 · 수학 놀이 연동 보상 쿠폰 상점 서비스 (studyPlazaRewards.service.js)
 * ------------------------------------------------------------------------------
 * - 공부/미션/복습 포인트 적립 원장(멱등 ref_key 보장)
 * - 수학 빼기 놀이 확인을 거치는 실생활 보상 쿠폰 상점 & 엄마·아빠 제출/승인
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const { getProfiles, getChildLevels, normalizeChildId, getKstDateString } = require('./studyDb.service');
const parentPlaza = require('./studyParentPlaza.service');

const { dbGet, dbAll, dbRun, ensurePlazaRewardTables, getPlazaConfig, grantParentCareBonus } = parentPlaza;

async function getOwnerPoints(ownerId) {
    await ensurePlazaRewardTables();
    const row = await dbGet('SELECT points FROM study_point_balances WHERE owner_id = ?', [String(ownerId || 'first')]);
    return row ? Number(row.points || 0) : 0;
}

async function awardPoints({ ownerId, delta, reason, refKey = '' }) {
    await ensurePlazaRewardTables();
    const oid = String(ownerId || '').trim();
    const amount = Math.round(Number(delta) || 0);
    if (!oid || amount === 0) return { awarded: false, delta: 0, points: await getOwnerPoints(oid || 'first') };

    const cleanRef = String(refKey || '').trim().slice(0, 100);
    if (cleanRef) {
        const dup = await dbGet('SELECT id FROM study_point_ledger WHERE owner_id = ? AND ref_key = ?', [oid, cleanRef]);
        if (dup) return { awarded: false, duplicate: true, delta: 0, points: await getOwnerPoints(oid) };
    }

    if (amount > 0) {
        await dbRun(
            `INSERT INTO study_point_balances (owner_id, points, updated_at)
             VALUES (?, ?, datetime('now', 'localtime'))
             ON CONFLICT(owner_id) DO UPDATE SET
                points = points + excluded.points,
                updated_at = datetime('now', 'localtime')`,
            [oid, amount]
        );
    } else {
        const res = await dbRun(
            `UPDATE study_point_balances SET points = points + ?, updated_at = datetime('now', 'localtime')
             WHERE owner_id = ? AND points >= ?`,
            [amount, oid, Math.abs(amount)]
        );
        if (res.changes === 0) throw new Error('포인트가 부족해요!');
    }

    await dbRun(
        'INSERT INTO study_point_ledger (owner_id, delta, reason, ref_key) VALUES (?, ?, ?, ?)',
        [oid, amount, String(reason || '학습 포인트').slice(0, 80), cleanRef]
    );
    return { awarded: true, delta: amount, points: await getOwnerPoints(oid) };
}

async function recordWorksheetCompletionPoints(sheet, result = {}, missionProgress = null) {
    if (!sheet?.child_id) return { totalAwarded: 0, balance: 0, breakdown: [] };
    const cid = sheet.child_id;
    const today = getKstDateString();
    const breakdown = [];
    let totalAwarded = 0;

    if (sheet.subject === 'coloring') {
        const r = await awardPoints({ ownerId: cid, delta: 15, reason: '🎨 색칠놀이 완성 보너스', refKey: `sheet-color:${sheet.id}` });
        if (r.awarded) { totalAwarded += r.delta; breakdown.push('색칠 완성 +15P'); }
    } else if (result.stampAwarded) {
        if (!result.alreadyAwarded) {
            const perfectBonus = Number(result.wrongCount || 0) === 0 ? 10 : 0;
            const label = perfectBonus ? '⭐ 학습지 만점 완료' : '⭐ 학습지 완료 포인트';
            const r = await awardPoints({ ownerId: cid, delta: 40 + perfectBonus, reason: label, refKey: `sheet-done:${sheet.id}` });
            if (r.awarded) { totalAwarded += r.delta; breakdown.push(`${label} +${r.delta}P`); }
        } else {
            const r = await awardPoints({ ownerId: cid, delta: 10, reason: '🔁 다시 풀어보기 복습 포인트', refKey: `sheet-retry:${sheet.id}:${today}` });
            if (r.awarded) { totalAwarded += r.delta; breakdown.push('복습 +10P'); }
        }
    }

    if (missionProgress?.bonusGranted) {
        const r = await awardPoints({ ownerId: cid, delta: 50, reason: '🚀 오늘의 3종 미션 모두 달성!', refKey: `mission-bonus:${cid}:${today}` });
        if (r.awarded) { totalAwarded += r.delta; breakdown.push('3종 미션 +50P'); }
    }

    return { totalAwarded, balance: await getOwnerPoints(cid), breakdown };
}

function buildCouponMathQuiz(myPoints, coupon, mathLevel = 1) {
    const my = Math.max(0, Number(myPoints) || 0);
    const cost = Math.max(10, Number(coupon?.cost_points) || 100);
    const remain = my - cost;
    if (remain < 0) return null;

    const step = Number(mathLevel) <= 2 ? 10 : 5;
    const alt1 = Math.max(0, remain + (remain >= step ? -step : step));
    const alt2 = remain + step * 2;
    const rawChoices = [...new Set([remain, alt1, alt2])];
    while (rawChoices.length < 3) rawChoices.push(remain + rawChoices.length * 10);

    return {
        myPoints: my, costPoints: cost, expectedRemain: remain,
        prompt: `${coupon.emoji} ${coupon.title}(${cost}P)을 사면 내 포인트 ${my}P에서 얼마가 남을까요?`,
        visual: `${my}P − ${cost}P = ?`,
        hint: `💡 힌트: ${Math.floor(my / 10)}에서 ${Math.floor(cost / 10)}을 빼면 10P 동전이 ${Math.floor(remain / 10)}개 남아요!`,
        choices: rawChoices.sort(() => Math.random() - 0.5).map((n) => `${n}P`)
    };
}

async function getChildPointsAndCoupons(childId) {
    await ensurePlazaRewardTables();
    const cid = normalizeChildId(childId);
    const [points, ledger, coupons, purchases] = await Promise.all([
        getOwnerPoints(cid),
        dbAll('SELECT id, delta, reason, created_at FROM study_point_ledger WHERE owner_id = ? ORDER BY id DESC LIMIT 12', [cid]),
        dbAll('SELECT * FROM study_reward_coupons WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'),
        dbAll('SELECT * FROM study_coupon_purchases WHERE child_id = ? ORDER BY id DESC LIMIT 20', [cid])
    ]);
    return {
        points, ledger, coupons, purchases,
        requestedCount: purchases.filter((p) => p.status === 'requested').length,
        ownedCount: purchases.filter((p) => p.status === 'owned').length
    };
}

async function getCouponShopQuiz(childId, couponId) {
    await ensurePlazaRewardTables();
    const cid = normalizeChildId(childId);
    const coupon = await dbGet('SELECT * FROM study_reward_coupons WHERE id = ? AND is_active = 1', [Number(couponId)]);
    if (!coupon) throw new Error('찾을 수 없는 쿠폰이에요.');
    const points = await getOwnerPoints(cid);
    if (points < Number(coupon.cost_points)) {
        throw new Error(`${coupon.title}까지 ${Number(coupon.cost_points) - points}P가 더 필요해요! 공부해서 모아봐요 🌟`);
    }
    const levels = await getChildLevels(cid);
    return { coupon, quiz: buildCouponMathQuiz(points, coupon, levels.math || 1) };
}

async function purchaseCoupon({ childId, couponId, mathAnswer }) {
    await ensurePlazaRewardTables();
    const cid = normalizeChildId(childId);
    const coupon = await dbGet('SELECT * FROM study_reward_coupons WHERE id = ? AND is_active = 1', [Number(couponId)]);
    if (!coupon) throw new Error('상점에서 쿠폰을 찾을 수 없어요.');

    const currentPoints = await getOwnerPoints(cid);
    const cost = Number(coupon.cost_points || 0);
    if (currentPoints < cost) throw new Error(`포인트가 ${cost - currentPoints}P 부족해요. 학습지를 풀어 포인트를 모아봐요!`);

    if (mathAnswer !== undefined && mathAnswer !== null && String(mathAnswer).trim() !== '') {
        const numericAns = Number(String(mathAnswer).replace(/[^0-9-]/g, ''));
        if (numericAns !== currentPoints - cost) {
            throw new Error(`아쉬워요! 힌트: ${Math.floor(currentPoints / 10)}에서 ${Math.floor(cost / 10)}을 빼고 0을 붙여 보세요! 💡`);
        }
    }

    await awardPoints({ ownerId: cid, delta: -cost, reason: `${coupon.emoji} '${coupon.title}' 교환` });
    const ins = await dbRun(
        `INSERT INTO study_coupon_purchases (child_id, coupon_id, coupon_title, coupon_emoji, cost_points, status)
         VALUES (?, ?, ?, ?, ?, 'owned')`,
        [cid, coupon.id, coupon.title, coupon.emoji, cost]
    );
    const purchase = await dbGet('SELECT * FROM study_coupon_purchases WHERE id = ?', [ins.lastID]);
    return {
        purchase,
        message: `🎉 '${coupon.emoji} ${coupon.title}'을(를) 샀어요! 이제 엄마·아빠에게 제출해 보세요!`,
        shopState: await getChildPointsAndCoupons(cid)
    };
}

async function requestCouponUse({ childId, purchaseId, note = '' }) {
    await ensurePlazaRewardTables();
    const cid = normalizeChildId(childId);
    const row = await dbGet('SELECT * FROM study_coupon_purchases WHERE id = ? AND child_id = ?', [Number(purchaseId), cid]);
    if (!row) throw new Error('내 쿠폰함에서 쿠폰을 찾지 못했어요.');
    if (row.status === 'requested') throw new Error('이미 엄마·아빠께 제출해서 확인을 기다리고 있어요! ⏳');
    if (row.status === 'approved') throw new Error('이미 사용한 쿠폰이에요!');
    if (row.status === 'refunded') throw new Error('취소되어 포인트로 돌려받은 쿠폰이에요.');

    const cleanNote = String(note || '').trim().slice(0, 60);
    await dbRun(
        `UPDATE study_coupon_purchases SET status = 'requested', child_note = ?, requested_at = datetime('now', 'localtime') WHERE id = ?`,
        [cleanNote, row.id]
    );

    const profiles = await getProfiles();
    const childName = profiles.find((p) => p.id === cid)?.display_name || cid;
    setImmediate(() => {
        try {
            const { sendServerTelegram } = require('../telegramAlert.service');
            const msg = [
                '🎁 *[빨간패드공부] 보상 쿠폰 사용 요청!*',
                `👧 아이: *${childName}*`,
                `🎫 쿠폰: *${row.coupon_emoji} ${row.coupon_title}* (${row.cost_points}P)`,
                cleanNote ? `💬 메모: ${cleanNote}` : null,
                '👉 학습실 어른 잠금 해제 또는 관리자 페이지(학습실)에서 사용 확인해 주세요!'
            ].filter(Boolean).join('\n');
            sendServerTelegram(msg).catch(() => {});
        } catch (_) {}
    });

    return {
        message: `🙋 엄마·아빠에게 '${row.coupon_emoji} ${row.coupon_title}'을(를) 제출했어요! 곧 확인해 주실 거예요!`,
        shopState: await getChildPointsAndCoupons(cid)
    };
}

async function resolveCouponPurchase({ purchaseId, action = 'approve', resolvedBy = '부모님' }) {
    await ensurePlazaRewardTables();
    const row = await dbGet('SELECT * FROM study_coupon_purchases WHERE id = ?', [Number(purchaseId)]);
    if (!row) throw new Error('쿠폰 내역을 찾을 수 없습니다.');
    if (row.status === 'approved' || row.status === 'refunded') throw new Error('이미 처리 완료된 쿠폰입니다.');

    if (action === 'refund') {
        await dbRun(
            `UPDATE study_coupon_purchases SET status = 'refunded', resolved_at = datetime('now', 'localtime'), resolved_by = ? WHERE id = ?`,
            [String(resolvedBy || '부모님').slice(0, 30), row.id]
        );
        await awardPoints({ ownerId: row.child_id, delta: Number(row.cost_points || 0), reason: `↩️ '${row.coupon_title}' 쿠폰 반환 환불` });
        return { action: 'refund', message: `↩️ '${row.coupon_title}' 쿠폰을 취소하고 ${row.cost_points}P를 아이에게 돌려주었습니다.` };
    }

    await dbRun(
        `UPDATE study_coupon_purchases SET status = 'approved', resolved_at = datetime('now', 'localtime'), resolved_by = ? WHERE id = ?`,
        [String(resolvedBy || '부모님').slice(0, 30), row.id]
    );
    await grantParentCareBonus('mom').catch(() => {});
    await grantParentCareBonus('dad').catch(() => {});
    return { action: 'approve', message: `✅ '${row.coupon_emoji} ${row.coupon_title}' 실제 선물 사용을 확인했습니다! (엄마·아빠 포켓몬 간식 지급!)` };
}

async function getAdminPlazaOverview() {
    await ensurePlazaRewardTables();
    const [config, profiles, coupons, purchases, ledger, parentTrainers] = await Promise.all([
        getPlazaConfig(), getProfiles(),
        dbAll('SELECT * FROM study_reward_coupons ORDER BY is_active DESC, sort_order ASC, id ASC'),
        dbAll(`SELECT cp.*, p.display_name, p.avatar_emoji FROM study_coupon_purchases cp LEFT JOIN study_profiles p ON p.id = cp.child_id ORDER BY CASE cp.status WHEN 'requested' THEN 0 WHEN 'owned' THEN 1 ELSE 2 END, cp.id DESC LIMIT 40`),
        dbAll('SELECT * FROM study_point_ledger ORDER BY id DESC LIMIT 25'),
        parentPlaza.getParentTrainersState()
    ]);
    const children = [];
    for (const p of profiles) {
        children.push({ childId: p.id, displayName: p.display_name, avatarEmoji: p.avatar_emoji || '🧒', points: await getOwnerPoints(p.id) });
    }
    return { config, children, coupons, purchases, ledger, parentTrainers };
}

async function upsertAdminCoupon({ id = null, title, emoji = '🎁', description = '', costPoints = 100, isActive = true }) {
    await ensurePlazaRewardTables();
    const cleanTitle = String(title || '').trim().slice(0, 40);
    if (!cleanTitle) throw new Error('쿠폰 이름을 입력해 주세요.');
    const cleanEmoji = String(emoji || '🎁').trim().slice(0, 6) || '🎁';
    const cleanDesc = String(description || '').trim().slice(0, 120);
    const cost = Math.min(5000, Math.max(10, Math.round(Number(costPoints) || 100)));
    const active = isActive ? 1 : 0;

    if (id) {
        await dbRun(`UPDATE study_reward_coupons SET title = ?, emoji = ?, description = ?, cost_points = ?, is_active = ? WHERE id = ?`, [cleanTitle, cleanEmoji, cleanDesc, cost, active, Number(id)]);
    } else {
        await dbRun(`INSERT INTO study_reward_coupons (title, emoji, description, cost_points, is_active) VALUES (?, ?, ?, ?, ?)`, [cleanTitle, cleanEmoji, cleanDesc, cost, active]);
    }
    return dbAll('SELECT * FROM study_reward_coupons ORDER BY is_active DESC, sort_order ASC, id ASC');
}

async function deleteAdminCoupon(couponId) {
    await ensurePlazaRewardTables();
    await dbRun('DELETE FROM study_reward_coupons WHERE id = ?', [Number(couponId)]);
    return dbAll('SELECT * FROM study_reward_coupons ORDER BY is_active DESC, sort_order ASC, id ASC');
}

module.exports = {
    ...parentPlaza,
    getOwnerPoints,
    awardPoints,
    recordWorksheetCompletionPoints,
    getChildPointsAndCoupons,
    getCouponShopQuiz,
    purchaseCoupon,
    requestCouponUse,
    resolveCouponPurchase,
    getAdminPlazaOverview,
    upsertAdminCoupon,
    deleteAdminCoupon
};
