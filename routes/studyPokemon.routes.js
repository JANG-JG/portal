/**
 * ==============================================================================
 * 어린이 학습실 알 부화 & 포켓몬 도감 API 라우터 (studyPokemon.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
    resolveChildProfileId,
    getActiveStampBoard
} = require('../services/study/studyDb.service');
const {
    getPokemonStateForBoard,
    acknowledgeEggHatch,
    setPartnerPokemon,
    getOrCachePokemonSprite
} = require('../services/study/studyPokemon.service');

router.get('/api/study/pokemon/state', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.query.childId, req.user);
        const board = await getActiveStampBoard(cid);
        const pokemon = await getPokemonStateForBoard(cid, board);
        res.json({ success: true, childId: cid, pokemon });
    } catch (err) {
        console.error('포켓몬 상태 조회 오류:', err);
        res.status(500).json({ success: false, message: '알과 도감 상태를 불러오지 못했어요.' });
    }
});

router.post('/api/study/pokemon/ack-hatch', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.body?.childId, req.user);
        const board = await getActiveStampBoard(cid);
        const cycleNo = Math.max(1, Number(req.body?.cycleNo || board.cycleNo || 1));
        await acknowledgeEggHatch(cid, cycleNo);
        const pokemon = await getPokemonStateForBoard(cid, board);
        res.json({ success: true, pokemon });
    } catch (err) {
        console.error('부화 확인 처리 오류:', err);
        res.status(400).json({ success: false, message: err?.message || '부화 확인 처리에 실패했어요.' });
    }
});

router.post('/api/study/pokemon/partner', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.body?.childId, req.user);
        const pokemonId = Number(req.body?.pokemonId);
        if (!Number.isInteger(pokemonId) || pokemonId <= 0) {
            return res.status(400).json({ success: false, message: '올바른 포켓몬을 선택해 주세요.' });
        }
        const partner = await setPartnerPokemon(cid, pokemonId);
        const board = await getActiveStampBoard(cid);
        const pokemon = await getPokemonStateForBoard(cid, board);
        res.json({
            success: true,
            message: `${partner.nameKo}와(과) 함께 공부하기로 정했어요! ✨`,
            pokemon
        });
    } catch (err) {
        console.error('단짝 포켓몬 변경 오류:', err);
        res.status(400).json({ success: false, message: err?.message || '단짝 포켓몬을 바꾸지 못했어요.' });
    }
});

async function servePokemonSprite(req, res, { isPublic = false } = {}) {
    const idNum = Math.round(Number(req.params.id));
    if (!Number.isInteger(idNum) || idNum < 1 || idNum > 1025) {
        return res.status(400).send('올바른 포켓몬 번호가 아닙니다.');
    }
    try {
        const kind = req.query.kind === 'artwork' ? 'artwork' : 'animated';
        const sprite = await getOrCachePokemonSprite(idNum, kind);
        res.setHeader('Content-Type', sprite.contentType);
        res.setHeader('Cache-Control', isPublic ? 'public, max-age=604800' : 'private, max-age=604800');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (isPublic) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        }
        res.send(sprite.buffer);
    } catch (err) {
        res.status(404).send('포켓몬 이미지를 불러올 수 없습니다.');
    }
}

router.get('/api/study/pokemon/sprite/:id', authenticateToken, (req, res) => {
    servePokemonSprite(req, res, { isPublic: false });
});

router.get('/api/public/pokemon/sprite/:id', (req, res) => {
    servePokemonSprite(req, res, { isPublic: true });
});

module.exports = router;
