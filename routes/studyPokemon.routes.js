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
    normalizeChildId,
    resolveChildProfileId,
    getActiveStampBoard,
    getSystemConfig
} = require('../services/study/studyDb.service');
const {
    getPokemonStateForBoard,
    acknowledgeEggHatch,
    setPartnerPokemon,
    getOrCachePokemonSprite
} = require('../services/study/studyPokemon.service');
const {
    getOrBuildPokemonColoringSvg,
    getPokeApiSpeciesInfo,
    listGen1ColoringCatalog
} = require('../services/study/pokemonColoring.service');
const { getActiveVisitingGuestsForMeadow } = require('../services/study/studyPokemonSocial.service');

router.get('/api/study/pokemon/state', authenticateToken, async (req, res) => {
    try {
        const cid = await resolveChildProfileId(req.query.childId, req.user);
        const board = await getActiveStampBoard(cid);
        const pokemon = await getPokemonStateForBoard(cid, board);
        if (pokemon && pokemon.enabled) {
            pokemon.visitingGuests = await getActiveVisitingGuestsForMeadow(cid).catch(() => []);
        }
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

router.get('/api/study/pokemon/gen1-list', authenticateToken, async (req, res) => {
    try {
        const enabledRaw = await getSystemConfig('study_pokemon_coloring_enabled', '1');
        const enabled = enabledRaw !== '0';
        const q = String(req.query.q || '').trim();
        const type = String(req.query.type || '').trim();
        const list = enabled ? listGen1ColoringCatalog({ q, type }) : [];
        res.json({ success: true, enabled, total: list.length, list });
    } catch (err) {
        console.error('1세대 포켓몬 목록 조회 오류:', err);
        res.status(500).json({ success: false, message: '1세대 포켓몬 목록을 불러오지 못했어요.' });
    }
});

router.get('/api/study/pokemon/species/:id', authenticateToken, async (req, res) => {
    const idNum = Math.round(Number(req.params.id));
    if (!Number.isInteger(idNum) || idNum < 1 || idNum > 150) {
        return res.status(400).json({ success: false, message: '1~150번 초기 포켓몬만 지원합니다.' });
    }
    try {
        const species = await getPokeApiSpeciesInfo(idNum);
        res.json({ success: true, species });
    } catch (err) {
        console.error('포켓몬 종 정보 조회 오류:', err);
        res.status(500).json({ success: false, message: '포켓몬 정보를 불러오지 못했어요.' });
    }
});

router.get('/api/study/pokemon/coloring-svg/:id', authenticateToken, async (req, res) => {
    const idNum = Math.round(Number(req.params.id));
    if (!Number.isInteger(idNum) || idNum < 1 || idNum > 150) {
        return res.status(400).send('1~150번 초기 포켓몬 번호만 색칠할 수 있습니다.');
    }
    try {
        const svg = await getOrBuildPokemonColoringSvg(idNum);
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'private, max-age=604800');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(svg);
    } catch (err) {
        console.error('포켓몬 색칠 도안 생성 오류:', err);
        res.status(500).send('포켓몬 색칠 도안을 불러오지 못했습니다.');
    }
});

router.get('/api/study/pokemon/sprite/:id', authenticateToken, (req, res) => {
    servePokemonSprite(req, res, { isPublic: false });
});

router.get('/api/public/pokemon/sprite/:id', (req, res) => {
    servePokemonSprite(req, res, { isPublic: true });
});

module.exports = router;
