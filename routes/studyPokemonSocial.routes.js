/**
 * ==============================================================================
 * 포켓몬 초원 소셜·간식 교환·놀러가기·협동 미션 API 라우터 (studyPokemonSocial.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { resolveChildProfileId, normalizeChildId } = require('../services/study/studyDb.service');
const {
    feedPokemonSnack,
    evolvePokemon,
    createTradeOffer,
    prepareTradeQuiz,
    respondToTrade,
    sendPokemonVisit,
    endPokemonVisit,
    claimCoopReward,
    getSocialState
} = require('../services/study/studyPokemonSocial.service');

router.get('/api/study/pokemon/social', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.query.childId, req.user);
        const social = await getSocialState(cid);
        res.json({ success: true, childId: cid, social });
    } catch (err) {
        console.error('포켓몬 소셜 상태 조회 오류:', err);
        res.status(500).json({ success: false, message: '초원 친구 소식을 불러오지 못했어요.' });
    }
});

router.post('/api/study/pokemon/feed', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.body?.childId, req.user);
        const out = await feedPokemonSnack(cid, req.body?.pokemonId, req.body?.snackType);
        const social = await getSocialState(cid);
        res.json({
            success: true,
            message: `${out.pokemon.nameKo}에게 ${out.snack.emoji} ${out.snack.name}을(를) 주었어요! (친밀도 Lv.${out.affection.level})`,
            ...out,
            social
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '간식을 주지 못했어요.' });
    }
});

router.post('/api/study/pokemon/evolve', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.body?.childId, req.user);
        const out = await evolvePokemon(cid, req.body?.pokemonId);
        const social = await getSocialState(cid);
        res.json({
            success: true,
            message: `우와!! ${out.fromPokemon.nameKo}이(가) ${out.toPokemon.nameKo}(으)로 멋지게 진화했어요! ✨🎉`,
            ...out,
            social
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '진화에 실패했어요.' });
    }
});

router.post('/api/study/pokemon/trades', authenticateToken, async (req, res) => {
    try {
        const fromChildId = await resolveChildProfileId(req.body?.childId, req.user);
        const toChildId = normalizeChildId(req.body?.toChildId);
        const trade = await createTradeOffer({
            fromChildId,
            toChildId,
            offerSnack: req.body?.offerSnack,
            offerQty: req.body?.offerQty,
            requestSnack: req.body?.requestSnack,
            requestQty: req.body?.requestQty,
            greetingMsg: req.body?.greetingMsg
        });
        const social = await getSocialState(fromChildId);
        res.json({ success: true, message: '간식 교환·선물 쪽지를 보냈어요! 💌', trade, social });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '교환 요청을 보내지 못했어요.' });
    }
});

router.get('/api/study/pokemon/trades/:id/quiz', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.query.childId, req.user);
        const data = await prepareTradeQuiz(Number(req.params.id), cid);
        res.json({ success: true, ...data });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '교환 확인 문제를 만들지 못했어요.' });
    }
});

router.post('/api/study/pokemon/trades/:id/respond', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.body?.childId, req.user);
        const out = await respondToTrade({
            tradeId: Number(req.params.id),
            receiverChildId: cid,
            action: req.body?.action || 'accept',
            answer: req.body?.answer,
            replyMsg: req.body?.replyMsg
        });
        const social = await getSocialState(cid);
        res.json({ success: Boolean(out.ok), ...out, social });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '교환 처리 중 문제가 생겼어요.' });
    }
});

router.post('/api/study/pokemon/visits', authenticateToken, async (req, res) => {
    try {
        const guestChildId = await resolveChildProfileId(req.body?.childId, req.user);
        const hostChildId = normalizeChildId(req.body?.hostChildId);
        const visit = await sendPokemonVisit({
            guestChildId,
            hostChildId,
            pokemonId: req.body?.pokemonId,
            greetingMsg: req.body?.greetingMsg
        });
        const social = await getSocialState(guestChildId);
        res.json({ success: true, message: `${visit.guest_pokemon_name}이(가) 친구 초원으로 놀러갔어요! 🐾`, visit, social });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '포켓몬이 놀러가지 못했어요.' });
    }
});

router.post('/api/study/pokemon/visits/:id/end', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.body?.childId, req.user);
        const out = await endPokemonVisit(Number(req.params.id), cid);
        const social = await getSocialState(cid);
        res.json({ success: true, ...out, social });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '집으로 부르지 못했어요.' });
    }
});

router.post('/api/study/pokemon/coop/claim', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.body?.childId, req.user);
        const out = await claimCoopReward(cid);
        const social = await getSocialState(cid);
        res.json({ success: true, ...out, social });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '협동 보상을 받지 못했어요.' });
    }
});

module.exports = router;
