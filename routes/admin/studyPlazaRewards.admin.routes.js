/**
 * ==============================================================================
 * 관리자 학습실 가족 광장 · 포인트 · 보상 쿠폰 상점 관제 라우터
 * (studyPlazaRewards.admin.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const { setSystemConfig, resolveChildProfileId } = require('../../services/study/studyDb.service');
const plazaSvc = require('../../services/study/studyPlazaRewards.service');

router.get('/plaza-rewards', async (req, res) => {
    try {
        const overview = await plazaSvc.getAdminPlazaOverview();
        res.json({ success: true, ...overview });
    } catch (err) {
        console.error('관리자 가족 광장·쿠폰 조회 오류:', err);
        res.status(500).json({ success: false, message: '가족 광장·포인트·쿠폰 현황을 불러오지 못했습니다.' });
    }
});

router.post('/plaza-rewards/config', async (req, res) => {
    try {
        const body = req.body || {};
        const pairs = [
            ['plazaEnabled', 'study_plaza_enabled'],
            ['couponShopEnabled', 'study_coupon_shop_enabled'],
            ['parentPokemonEnabled', 'study_parent_pokemon_enabled']
        ];
        for (const [prop, dbKey] of pairs) {
            if (typeof body[prop] === 'boolean') {
                await setSystemConfig(dbKey, body[prop] ? '1' : '0');
            }
        }
        const overview = await plazaSvc.getAdminPlazaOverview();
        res.json({ success: true, message: '가족 광장·쿠폰 상점·엄마아빠 포켓몬 설정이 저장되었습니다.', ...overview });
    } catch (err) {
        res.status(500).json({ success: false, message: '설정 저장에 실패했습니다.' });
    }
});

router.post('/plaza-rewards/coupons', async (req, res) => {
    try {
        const coupons = await plazaSvc.upsertAdminCoupon(req.body || {});
        res.json({ success: true, message: '쿠폰 상품이 저장되었습니다.', coupons });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '쿠폰 저장에 실패했습니다.' });
    }
});

router.delete('/plaza-rewards/coupons/:id', async (req, res) => {
    try {
        const coupons = await plazaSvc.deleteAdminCoupon(req.params.id);
        res.json({ success: true, message: '쿠폰이 삭제되었습니다.', coupons });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '쿠폰 삭제에 실패했습니다.' });
    }
});

router.post('/plaza-rewards/purchases/:id/resolve', async (req, res) => {
    try {
        const resolvedBy = req.user?.nickname || req.user?.username || '관리자';
        const out = await plazaSvc.resolveCouponPurchase({
            purchaseId: req.params.id,
            action: req.body?.action === 'refund' ? 'refund' : 'approve',
            resolvedBy
        });
        const overview = await plazaSvc.getAdminPlazaOverview();
        res.json({ success: true, ...out, ...overview });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '쿠폰 처리에 실패했습니다.' });
    }
});

router.post('/plaza-rewards/points/grant', async (req, res) => {
    try {
        const childId = await resolveChildProfileId(req.body?.childId, null);
        const delta = Math.round(Number(req.body?.delta || 0));
        const reason = String(req.body?.reason || '🎁 부모님 칭찬 보너스 포인트').trim();
        await plazaSvc.awardPoints({ ownerId: childId, delta, reason });
        const overview = await plazaSvc.getAdminPlazaOverview();
        res.json({ success: true, message: `포인트(${delta > 0 ? `+${delta}` : delta}P)가 반영되었습니다.`, ...overview });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '포인트 지급에 실패했습니다.' });
    }
});

module.exports = router;
