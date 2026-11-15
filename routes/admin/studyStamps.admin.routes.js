/**
 * ==============================================================================
 * 어린이 학습실 도장판 & 종이 학습지 스티커 관리자 API (studyStamps.admin.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const {
    normalizeChildId,
    getProfiles,
    getActiveStampBoard,
    awardStamp,
    deleteStampById,
    removeLastStamp,
    setStampBoardCount,
    resetCurrentStampBoard,
    updateStampEntry,
    listRecentStamps
} = require('../../services/study/studyDb.service');
const {
    getAdminPokemonOverview,
    setPokemonFeatureEnabled,
    rerollUnhatchedEgg
} = require('../../services/study/studyPokemon.service');

router.get('/', async (req, res) => {
    try {
        const profiles = await getProfiles();
        const children = [];
        const stampBoardsMap = {};
        for (const p of profiles) {
            const stampBoard = await getActiveStampBoard(p.id);
            stampBoardsMap[p.id] = stampBoard;
            children.push({
                id: p.id,
                displayName: p.display_name,
                avatarEmoji: p.avatar_emoji || '🌟',
                targetReward: p.target_reward || '',
                stampBoard
            });
        }
        const recentStamps = await listRecentStamps(req.query.childId || 'all', 30);
        const pokemon = await getAdminPokemonOverview(profiles, stampBoardsMap).catch(() => null);
        res.json({ success: true, children, recentStamps, pokemon });
    } catch (err) {
        console.error('관리자 도장판 현황 조회 오류:', err);
        res.status(500).json({ success: false, message: '도장판 현황을 불러오지 못했습니다.' });
    }
});

router.post('/grant', async (req, res) => {
    try {
        const cid = normalizeChildId(req.body?.childId);
        const sourceType = req.body?.sourceType === 'online' ? 'online' : 'paper';
        const note = String(req.body?.note || '').trim();
        const out = await awardStamp({
            childId: cid,
            sourceType,
            note,
            byParent: true
        });
        res.json({
            success: true,
            message: out.reachedTen
                ? '칭찬 도장을 부여해 10칸 도장판을 완성했습니다! 🎉'
                : (sourceType === 'paper' ? '종이 학습지 칭찬 스티커를 부여했습니다.' : '칭찬 도장 1개를 추가했습니다.'),
            ...out
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '도장 부여에 실패했습니다.' });
    }
});

router.post('/undo-last', async (req, res) => {
    try {
        const cid = normalizeChildId(req.body?.childId);
        const out = await removeLastStamp(cid);
        res.json({
            success: true,
            message: out.deletedStamp ? '가장 최근 도장 1개를 삭제했습니다.' : '삭제할 도장이 없습니다.',
            ...out
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '마지막 도장 삭제 실패' });
    }
});

router.post('/set-count', async (req, res) => {
    try {
        const cid = normalizeChildId(req.body?.childId);
        const { targetCount, sourceType, note } = req.body || {};
        const out = await setStampBoardCount(cid, targetCount, { sourceType, note });
        res.json({
            success: true,
            message: `현재 도장판을 ${out.currentCount} / 10칸으로 수정했습니다.`,
            ...out
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '도장 개수 수정 실패' });
    }
});

router.post('/reset', async (req, res) => {
    try {
        const cid = normalizeChildId(req.body?.childId);
        const out = await resetCurrentStampBoard(cid);
        res.json({
            success: true,
            message: `${out.cycleNo}판째 도장판(${out.clearedCount}칸)을 초기화했습니다.`,
            ...out
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '도장판 초기화 실패' });
    }
});

router.patch('/:stampId', async (req, res) => {
    try {
        const cid = normalizeChildId(req.body?.childId);
        const { sourceType, note } = req.body || {};
        const out = await updateStampEntry(cid, req.params.stampId, { sourceType, note });
        res.json({ success: true, message: '도장 기록을 수정했습니다.', ...out });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '도장 수정 실패' });
    }
});

router.delete('/:stampId', async (req, res) => {
    try {
        const cid = normalizeChildId(req.query.childId || req.body?.childId);
        const out = await deleteStampById(cid, req.params.stampId);
        res.json({ success: true, message: '선택한 도장을 삭제했습니다.', ...out });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '도장 삭제 실패' });
    }
});

router.post('/pokemon/toggle', async (req, res) => {
    try {
        const nextEnabled = await setPokemonFeatureEnabled(Boolean(req.body?.enabled));
        res.json({
            success: true,
            enabled: nextEnabled,
            message: nextEnabled
                ? '학습실 포켓몬 알 부화·도감 기능을 켰습니다.'
                : '학습실 포켓몬 알 부화·도감 기능을 껐습니다.'
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '포켓몬 기능 전환 실패' });
    }
});

router.post('/pokemon/reroll', async (req, res) => {
    try {
        const cid = normalizeChildId(req.body?.childId);
        const board = await getActiveStampBoard(cid);
        const nextPokemon = await rerollUnhatchedEgg(cid, board.cycleNo);
        res.json({
            success: true,
            nextPokemon,
            message: `현재 알 속 포켓몬을 "${nextPokemon.nameKo}" 후보로 다시 뽑았습니다.`
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '알 다시 뽑기 실패' });
    }
});

module.exports = router;
