/**
 * ==============================================================================
 * 가족 포켓몬 광장 · 포인트 · 쿠폰 상점 · 엄마아빠 포켓몬 API 라우터
 * (studyPlazaRewards.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { resolveChildProfileId, verifyParentLockPin } = require('../services/study/studyDb.service');
const plazaSvc = require('../services/study/studyPlazaRewards.service');

router.get('/api/study/plaza/state', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.query.childId, req.user);
        const [config, familyPlaza, shopState, parentTrainers] = await Promise.all([
            plazaSvc.getPlazaConfig(),
            plazaSvc.getFamilyPlazaState(cid),
            plazaSvc.getChildPointsAndCoupons(cid),
            plazaSvc.getParentTrainersState()
        ]);
        res.json({ success: true, viewerRole: req.user?.role || 'family', childId: cid, config, familyPlaza, shopState, parentTrainers });
    } catch (err) {
        console.error('가족 광장 상태 조회 오류:', err);
        res.status(500).json({ success: false, message: '가족 광장 정보를 불러오지 못했어요.' });
    }
});

router.post('/api/study/plaza/reaction', authenticateToken, async (req, res) => {
    try {
        const rawSender = String(req.body?.senderId || '').trim();
        const senderId = ['mom', 'dad'].includes(rawSender)
            ? rawSender
            : await resolveChildProfileId(rawSender, req.user);
        const out = await plazaSvc.postPlazaReaction({
            senderId,
            reactionId: req.body?.reactionId
        });
        res.json({ success: true, ...out });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '인사 말풍선을 보내지 못했어요.' });
    }
});

router.post('/api/study/plaza/theme', authenticateToken, async (req, res) => {
    try {
        if (req.user?.role === 'kid') {
            return res.status(403).json({ success: false, message: '배경 설정은 엄마·아빠 트레이너 하우스에서만 바꿀 수 있어요!' });
        }
        const out = await plazaSvc.setPlazaTheme(req.body?.theme);
        res.json({ success: true, ...out });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '광장 배경을 바꾸지 못했어요.' });
    }
});

router.get('/api/study/parents/overview', authenticateToken, async (req, res) => {
    try {
        if (req.user?.role === 'kid') {
            return res.status(403).json({ success: false, message: '엄마·아빠 트레이너 하우스는 부모님 전용 공간이에요!' });
        }
        const overview = await plazaSvc.getAdminPlazaOverview();
        const familyPlaza = await plazaSvc.getFamilyPlazaState('first');
        res.json({ success: true, viewerRole: req.user?.role || 'family', familyPlaza, ...overview });
    } catch (err) {
        console.error('엄마아빠 페이지 조회 오류:', err);
        res.status(500).json({ success: false, message: '엄마·아빠 포켓몬 하우스 정보를 불러오지 못했어요.' });
    }
});

router.post('/api/study/parents/grant-points', authenticateToken, async (req, res) => {
    try {
        if (req.user?.role === 'kid') {
            return res.status(403).json({ success: false, message: '엄마·아빠 전용 기능이에요!' });
        }
        const cid = await resolveChildProfileId(req.body?.childId, req.user);
        const delta = Math.min(200, Math.max(5, Math.round(Number(req.body?.delta || 20))));
        await plazaSvc.awardPoints({ ownerId: cid, delta, reason: req.body?.reason || '💖 엄마·아빠 칭찬 포인트 선물' });
        const overview = await plazaSvc.getAdminPlazaOverview();
        res.json({ success: true, message: `⭐ +${delta}P 칭찬 포인트를 선물했어요!`, ...overview });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '포인트 선물을 주지 못했어요.' });
    }
});

router.get('/api/study/shop/quiz', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.query.childId, req.user);
        const out = await plazaSvc.getCouponShopQuiz(cid, req.query.couponId);
        res.json({ success: true, ...out });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '쿠폰 계산 놀이를 열지 못했어요.' });
    }
});

router.post('/api/study/shop/buy', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.body?.childId, req.user);
        const out = await plazaSvc.purchaseCoupon({
            childId: cid,
            couponId: req.body?.couponId,
            mathAnswer: req.body?.mathAnswer
        });
        res.json({ success: true, ...out });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '쿠폰을 교환하지 못했어요.' });
    }
});

router.post('/api/study/shop/use', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.body?.childId, req.user);
        const out = await plazaSvc.requestCouponUse({
            childId: cid,
            purchaseId: req.body?.purchaseId,
            note: req.body?.note
        });
        res.json({ success: true, ...out });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '엄마·아빠께 쿠폰을 내지 못했어요.' });
    }
});

const shopPinAttemptMap = new Map();
function allowShopPinAttempt(username) {
    const now = Date.now();
    const key = `shop-pin:${username || 'anon'}`;
    const list = (shopPinAttemptMap.get(key) || []).filter(t => now - t < 5 * 60 * 1000);
    if (list.length >= 12) return false;
    list.push(now);
    shopPinAttemptMap.set(key, list);
    return true;
}

router.post('/api/study/shop/resolve', authenticateToken, async (req, res) => {
    try {
        if (req.user?.role === 'kid') {
            if (!allowShopPinAttempt(req.user.username)) {
                return res.status(429).json({ success: false, message: '잠금 해제 시도가 너무 많습니다. 5분 후 다시 시도해 주세요.' });
            }
            const check = await verifyParentLockPin(req.body?.parentPin || '');
            if (!check.configured || !check.valid) {
                return res.status(403).json({ success: false, message: '부모님 PIN을 먼저 확인해 주세요! 🔒' });
            }
        }
        const resolvedBy = req.user?.nickname || req.user?.username || '부모님';
        const out = await plazaSvc.resolveCouponPurchase({
            purchaseId: req.body?.purchaseId,
            action: req.body?.action === 'refund' ? 'refund' : 'approve',
            resolvedBy
        });
        const cid = await resolveChildProfileId(req.body?.childId, req.user);
        const [shopState, parentTrainers] = await Promise.all([
            plazaSvc.getChildPointsAndCoupons(cid),
            plazaSvc.getParentTrainersState()
        ]);
        res.json({ success: true, ...out, shopState, parentTrainers });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '쿠폰 확인 처리에 실패했어요.' });
    }
});

router.post('/api/study/parent-trainer/partner', authenticateToken, async (req, res) => {
    try {
        if (req.user?.role === 'kid') return res.status(403).json({ success: false, message: '엄마·아빠 전용 공간이에요!' });
        const out = await plazaSvc.pickParentPartner({
            trainerId: req.body?.trainerId,
            pokemonId: req.body?.pokemonId
        });
        res.json({ success: true, ...out });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '단짝을 바꾸지 못했어요.' });
    }
});

router.post('/api/study/parent-trainer/feed', authenticateToken, async (req, res) => {
    try {
        if (req.user?.role === 'kid') return res.status(403).json({ success: false, message: '엄마·아빠 전용 공간이에요!' });
        const out = await plazaSvc.feedParentPokemon({
            trainerId: req.body?.trainerId,
            pokemonId: req.body?.pokemonId,
            snackType: req.body?.snackType
        });
        res.json({ success: true, ...out });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '간식을 주지 못했어요.' });
    }
});

router.post('/api/study/parent-trainer/evolve', authenticateToken, async (req, res) => {
    try {
        if (req.user?.role === 'kid') return res.status(403).json({ success: false, message: '엄마·아빠 전용 공간이에요!' });
        const out = await plazaSvc.evolveParentPokemon({
            trainerId: req.body?.trainerId,
            pokemonId: req.body?.pokemonId
        });
        res.json({ success: true, ...out });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '진화하지 못했어요.' });
    }
});

router.post('/api/study/parent-trainer/adopt', authenticateToken, async (req, res) => {
    try {
        if (req.user?.role === 'kid') return res.status(403).json({ success: false, message: '엄마·아빠 전용 공간이에요!' });
        const out = await plazaSvc.adoptParentEggPokemon({ trainerId: req.body?.trainerId });
        res.json({ success: true, ...out });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '가족 알을 열지 못했어요.' });
    }
});

module.exports = router;
